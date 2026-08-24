const fs = require('fs');
const path = require('path');
// SQLite intégré au runtime Node (>= 22.13). Volontairement PAS better-sqlite3 :
// son binaire natif provoquait un « Segmentation fault » au démarrage sur Nixpacks
// (Railway), impossible à rattraper. Un module intégré supprime cette classe de panne.
// Le préfixe `node:` est obligatoire.
const { DatabaseSync } = require('node:sqlite');

// Où poser le fichier de base.
// Sur Railway, un volume monté expose son chemin dans RAILWAY_VOLUME_MOUNT_PATH :
// sans volume, on retombe sur un dossier du conteneur, effacé à chaque déploiement.
const DATA_DIR =
  process.env.DATA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(__dirname, '..', '..', 'data');

// Vrai quand on tourne sur Railway sans volume : les données ne survivront pas.
const isEphemeral = Boolean(
  (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) &&
    !process.env.DATA_DIR &&
    !process.env.RAILWAY_VOLUME_MOUNT_PATH
);

const ephemeralReason = isEphemeral
  ? 'aucun volume Railway monté — attachez un Volume au service, puis redéployez'
  : null;

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'kemet-quiz.db');
const db = new DatabaseSync(DB_PATH);

// node:sqlite n'a pas de db.pragma() : les pragmas passent par exec().
// Il attend aussi 0 ms sur base verrouillée, là où better-sqlite3 attendait 5 s.
db.exec('PRAGMA busy_timeout = 5000');
// WAL améliore la concurrence, mais certains systèmes de fichiers le refusent.
// On dégrade vers le journal par défaut plutôt que de tuer le serveur au démarrage.
try {
  db.exec('PRAGMA journal_mode = WAL');
} catch (err) {
  console.warn('WAL indisponible, journal par défaut :', err.message);
}
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS quizzes (
    id             TEXT PRIMARY KEY,
    title          TEXT    NOT NULL,
    questions      TEXT    NOT NULL,
    created_at     TEXT    NOT NULL,
    source_text    TEXT,
    difficulty     TEXT,
    closed         INTEGER NOT NULL DEFAULT 0,
    single_attempt INTEGER NOT NULL DEFAULT 1,
    expires_at     TEXT
  );

  CREATE TABLE IF NOT EXISTS results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id      TEXT    NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    player_name  TEXT    NOT NULL,
    player_key   TEXT    NOT NULL,
    score        INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    submitted_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_results_quiz ON results(quiz_id);
  CREATE INDEX IF NOT EXISTS idx_results_name ON results(quiz_id, player_key);
`);

const { nameKey } = require('./name-key');
const { newId } = require('./ids');

// Interpolé dans le PRAGMA plus bas : PRAGMA n'accepte aucun paramètre lié.
// Ce n'est pas une injection, c'est un littéral du code — jamais une saisie.
const RESULTS_TABLE = 'results';

/**
 * Migration du schéma — le point dur.
 *
 * Le bloc ci-dessus repose sur CREATE TABLE IF NOT EXISTS, qui n'altère JAMAIS
 * une table déjà créée. Ajouter une colonne à la déclaration de `results` ne
 * ferait donc rien du tout sur la base de production, et en silence. Seul
 * ALTER TABLE ADD COLUMN passe — c'est une écriture de métadonnée, instantanée
 * même sur une table peuplée.
 *
 * Sa place dans le fichier est imposée : entre le schéma et l'objet `stmt`.
 * Les requêtes sont préparées au chargement du module et lèveraient dès
 * qu'elles citent learner_id si la colonne n'existait pas encore.
 *
 * Toute erreur ressort marquée MIGRATION_FAILED. C'est vital : index.js
 * attrape n'importe quelle erreur de require('./db') et bascule sur le store
 * en mémoire. Sans ce marquage, une migration ratée ne tuerait pas le serveur,
 * elle ferait perdre la persistance sans bruit, en production.
 */
function migrate() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS learners (
        id           TEXT    PRIMARY KEY,
        display_name TEXT    NOT NULL,
        name_key     TEXT    NOT NULL,
        created_at   TEXT    NOT NULL,
        created_by   TEXT    NOT NULL DEFAULT 'learner',
        suggestible  INTEGER NOT NULL DEFAULT 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_key ON learners(name_key);
    `);

    const hasLearnerId = db
      .prepare(`PRAGMA table_info(${RESULTS_TABLE})`)
      .all()
      .some((col) => col.name === 'learner_id');

    if (!hasLearnerId) {
      // Ceinture et bretelles. Deux processus qui démarrent ensemble peuvent
      // lire le PRAGMA au même instant : le perdant reçoit « duplicate column
      // name », qui est ici un succès déguisé et non une panne.
      // La colonne n'a pas de DEFAULT, donc sa valeur par défaut est NULL :
      // SQLite l'exige pour un ADD COLUMN porteur d'une clé étrangère.
      try {
        db.exec(
          'ALTER TABLE results ADD COLUMN learner_id TEXT REFERENCES learners(id) ON DELETE SET NULL'
        );
      } catch (err) {
        if (!/duplicate column name/i.test(err.message)) throw err;
      }
    }

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_results_learner_date ON results(learner_id, submitted_at)'
    );

    backfillLearners();
  } catch (err) {
    err.code = 'MIGRATION_FAILED';
    throw err;
  }
}

/**
 * Reprise de l'historique déjà en base, EN QUARANTAINE.
 *
 * Les participations antérieures à l'annuaire n'ont qu'un player_key. On leur
 * fabrique des fiches created_by = 'import', suggestible = 0 : le formateur
 * retrouve tout son historique, mais rien de cet import ne remonte dans les
 * suggestions publiques — personne n'a consenti à voir son nom proposé au
 * clavier d'un inconnu. La première participation réelle promeut la fiche
 * (voir ensureLearner).
 */
function backfillLearners() {
  // Garde de sortie. Sans le TRIM, une seule ligne au player_key vide — à
  // laquelle on n'attachera jamais de fiche, faute de personne identifiable
  // derrière — serait retrouvée à chaque démarrage et rejouerait la reprise
  // indéfiniment. idx_results_learner_date sert ce test (learner_id IS NULL),
  // il reste quasi gratuit une fois la reprise faite.
  const reste = db
    .prepare(
      `SELECT 1 AS ok FROM results WHERE learner_id IS NULL AND TRIM(player_key) <> '' LIMIT 1`
    )
    .get();
  if (!reste) return;

  // Le displayName retenu est la graphie de la participation LA PLUS RÉCENTE,
  // et surtout pas MIN(player_name) : la collation est BINARY, MIN remonterait
  // « AYA » avant « Aya ». created_at est la date de la PREMIÈRE participation,
  // pas celle de la migration — la fiche date de la personne, pas de l'outil.
  const groupes = db
    .prepare(`
      SELECT r.player_key AS name_key,
             MIN(r.submitted_at) AS created_at,
             (SELECT r2.player_name
                FROM results r2
               WHERE r2.player_key = r.player_key
                 AND r2.learner_id IS NULL
               ORDER BY r2.submitted_at DESC, r2.id DESC
               LIMIT 1) AS display_name
        FROM results r
       WHERE r.learner_id IS NULL AND TRIM(r.player_key) <> ''
       GROUP BY r.player_key
    `)
    .all();

  // ON CONFLICT DO NOTHING rend le rejeu inoffensif : une reprise interrompue
  // puis relancée retombe sur ses pieds au lieu de casser sur l'index unique.
  const insertLearner = db.prepare(`
    INSERT INTO learners (id, display_name, name_key, created_at, created_by, suggestible)
    VALUES (@id, @displayName, @nameKey, @createdAt, 'import', 0)
    ON CONFLICT(name_key) DO NOTHING
  `);
  const findByKey = db.prepare('SELECT id FROM learners WHERE name_key = ?');
  const rattacher = db.prepare(
    'UPDATE results SET learner_id = @learnerId WHERE player_key = @nameKey AND learner_id IS NULL'
  );

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const groupe of groupes) {
      insertLearner.run({
        id: newId(),
        displayName: groupe.display_name,
        nameKey: groupe.name_key,
        createdAt: groupe.created_at,
      });
      // Relecture systématique : avec DO NOTHING, l'identifiant qui compte est
      // celui de la fiche EN BASE, pas celui qu'on vient de tirer au hasard.
      const fiche = findByKey.get(groupe.name_key);
      if (fiche) rattacher.run({ learnerId: fiche.id, nameKey: groupe.name_key });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

migrate();

function rowToQuiz(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    questions: JSON.parse(row.questions),
    createdAt: row.created_at,
    sourceText: row.source_text,
    difficulty: row.difficulty,
    closed: Boolean(row.closed),
    singleAttempt: Boolean(row.single_attempt),
    expiresAt: row.expires_at,
  };
}

// Volontairement INCHANGÉ : learner_id n'entre pas ici. GET /api/quiz/:id/results
// doit renvoyer exactement les mêmes champs qu'avant l'annuaire.
function rowToResult(row) {
  return {
    playerName: row.player_name,
    score: row.score,
    total: row.total,
    submittedAt: row.submitted_at,
  };
}

// suggestible en booléen JS, comme closed et single_attempt dans rowToQuiz :
// SQLite ne connaît que 0 et 1, et un 0 traversant l'API serait « faux » à
// l'affichage mais « vrai » à un `if (learner.suggestible)` mal écrit.
function rowToLearner(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    nameKey: row.name_key,
    createdAt: row.created_at,
    createdBy: row.created_by,
    suggestible: Boolean(row.suggestible),
  };
}

const stmt = {
  insertQuiz: db.prepare(`
    INSERT INTO quizzes
      (id, title, questions, created_at, source_text, difficulty, closed, single_attempt, expires_at)
    VALUES
      (@id, @title, @questions, @createdAt, @sourceText, @difficulty, @closed, @singleAttempt, @expiresAt)
  `),
  getQuiz: db.prepare('SELECT * FROM quizzes WHERE id = ?'),
  countResults: db.prepare('SELECT COUNT(*) AS n FROM results WHERE quiz_id = ?'),
  findResultByName: db.prepare(
    'SELECT * FROM results WHERE quiz_id = ? AND player_key = ? ORDER BY id LIMIT 1'
  ),
  listResults: db.prepare('SELECT * FROM results WHERE quiz_id = ? ORDER BY id'),
  // Le décompte se fait en sous-requête plutôt qu'en jointure : une jointure
  // aurait écarté les quiz sans aucune réponse, qui sont précisément ceux que
  // le formateur cherche quand il se demande si son lien a été ouvert.
  listQuizzes: db.prepare(`
    SELECT id, title, created_at, closed, single_attempt, expires_at,
           (SELECT COUNT(*) FROM results WHERE results.quiz_id = quizzes.id) AS result_count
    FROM quizzes
    ORDER BY created_at DESC
  `),
  insertResult: db.prepare(`
    INSERT INTO results (quiz_id, player_name, player_key, learner_id, score, total, submitted_at)
    VALUES (@quizId, @playerName, @playerKey, @learnerId, @score, @total, @submittedAt)
  `),

  // ---------------------------------------------------------------------------
  // Annuaire des apprenants
  // ---------------------------------------------------------------------------

  // DO NOTHING plutôt que de laisser lever l'index unique : deux apprenants qui
  // envoient leurs réponses à la même seconde ne doivent pas produire un 500.
  // L'appelant relit ensuite par name_key et adopte la fiche gagnante.
  insertLearner: db.prepare(`
    INSERT INTO learners (id, display_name, name_key, created_at, created_by, suggestible)
    VALUES (@id, @displayName, @nameKey, @createdAt, @createdBy, @suggestible)
    ON CONFLICT(name_key) DO NOTHING
  `),
  getLearner: db.prepare('SELECT * FROM learners WHERE id = ?'),
  getLearnerByKey: db.prepare('SELECT * FROM learners WHERE name_key = ?'),
  promoteLearner: db.prepare('UPDATE learners SET suggestible = 1 WHERE id = ?'),
  deleteLearner: db.prepare('DELETE FROM learners WHERE id = ?'),

  // GLOB et non LIKE. SQLite n'utilise l'index pour LIKE 'préfixe%' que si la
  // colonne est en collation NOCASE ; la nôtre est BINARY, un LIKE balaierait
  // toute la table. GLOB est optimisable sur BINARY — et name_key est déjà en
  // minuscules sans diacritiques, donc la casse est réglée en amont.
  // Contrepartie : GLOB n'a pas de clause ESCAPE. Les métacaractères * ? [ ]
  // d'une saisie changeraient le motif ; leur validation se fait dans index.js,
  // pas ici. ORDER BY name_key suit l'index, le tri ne coûte rien.
  suggestLearners: db.prepare(`
    SELECT display_name FROM learners
    WHERE suggestible = 1 AND name_key GLOB @pattern
    ORDER BY name_key
    LIMIT @limit
  `),

  // Le filtre de dates est dans le ON, JAMAIS dans le WHERE. Dans le WHERE il
  // annulerait la jointure externe et ferait DISPARAÎTRE de la liste tout
  // apprenant sans participation sur la période — le formateur croirait ses
  // apprenants effacés. Ils restent affichés, à attempts = 0 et avgPercent null.
  //
  // AVG(score * 100.0 / total) : le .0 n'est pas cosmétique, INTEGER/INTEGER est
  // une division entière en SQLite, 7/10 vaudrait 0 et toutes les moyennes
  // sortiraient à zéro. Et c'est bien la moyenne des pourcentages, pas
  // SUM(score)/SUM(total) qui pondérerait par le nombre de questions : une
  // évaluation de 5 questions pèse autant qu'une de 30.
  //
  // Tri par name_key et non display_name : name_key est en minuscules sans
  // diacritiques, son ordre BINARY est alphabétique, là où display_name
  // rangerait toutes les majuscules avant toutes les minuscules.
  listLearners: db.prepare(`
    SELECT l.id, l.display_name, l.created_at, l.created_by, l.suggestible,
           COUNT(r.id) AS attempts,
           AVG(CASE WHEN r.total > 0 THEN r.score * 100.0 / r.total END) AS avg_percent,
           MAX(r.submitted_at) AS last_submitted_at
      FROM learners l
      LEFT JOIN results r
        ON r.learner_id = l.id
       AND (@from IS NULL OR r.submitted_at >= @from)
       AND (@to   IS NULL OR r.submitted_at <  @to)
     GROUP BY l.id
     ORDER BY l.name_key
  `),

  // player_name est renvoyé tel qu'il a été tapé ce jour-là : renommer une
  // fiche ne réécrit jamais une ligne de results.
  listLearnerHistory: db.prepare(`
    SELECT r.id AS result_id, r.quiz_id, q.title AS quiz_title, r.player_name,
           r.score, r.total, r.submitted_at
      FROM results r
      JOIN quizzes q ON q.id = r.quiz_id
     WHERE r.learner_id = @learnerId
       AND (@from IS NULL OR r.submitted_at >= @from)
       AND (@to   IS NULL OR r.submitted_at <  @to)
     ORDER BY r.submitted_at ASC, r.id ASC
  `),
  findResultByLearner: db.prepare(
    'SELECT * FROM results WHERE quiz_id = ? AND learner_id = ? ORDER BY id LIMIT 1'
  ),
  moveResults: db.prepare('UPDATE results SET learner_id = @intoId WHERE learner_id = @sourceId'),
};

// Champs modifiables par PATCH /api/quiz/:id, chacun vers sa colonne.
const UPDATABLE = {
  title: 'title',
  questions: 'questions',
  closed: 'closed',
  singleAttempt: 'single_attempt',
  expiresAt: 'expires_at',
};

function createQuiz(id, quiz) {
  stmt.insertQuiz.run({
    id,
    title: quiz.title,
    questions: JSON.stringify(quiz.questions),
    createdAt: quiz.createdAt,
    sourceText: quiz.sourceText ?? null,
    difficulty: quiz.difficulty ?? null,
    closed: quiz.closed ? 1 : 0,
    singleAttempt: quiz.singleAttempt === false ? 0 : 1,
    expiresAt: quiz.expiresAt ?? null,
  });
}

function getQuiz(id) {
  return rowToQuiz(stmt.getQuiz.get(id));
}

/**
 * Écriture partielle : seules les clés présentes dans `patch` sont touchées.
 * `questions` doit déjà être passé par normalizeQuestions().
 */
function updateQuiz(id, patch) {
  const sets = [];
  const values = {};

  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = @${key}`);
    if (key === 'questions') values[key] = JSON.stringify(patch[key]);
    else if (key === 'closed' || key === 'singleAttempt') values[key] = patch[key] ? 1 : 0;
    else values[key] = patch[key] ?? null;
  }

  if (!sets.length) return;
  values.id = id;
  db.prepare(`UPDATE quizzes SET ${sets.join(', ')} WHERE id = @id`).run(values);
}

function countResults(quizId) {
  return stmt.countResults.get(quizId).n;
}

function findResultByName(quizId, playerName) {
  const row = stmt.findResultByName.get(quizId, nameKey(playerName));
  return row ? rowToResult(row) : null;
}

/**
 * Tous les quiz, du plus récent au plus ancien, avec le nombre de réponses
 * reçues. Volontairement SANS les questions ni le texte source : cette liste
 * alimente un écran de survol, pas une relecture, et charger 30 questions par
 * quiz pour afficher une ligne serait du gaspillage.
 */
function listQuizzes() {
  return stmt.listQuizzes.all().map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    closed: Boolean(row.closed),
    singleAttempt: Boolean(row.single_attempt),
    expiresAt: row.expires_at,
    resultCount: row.result_count,
  }));
}

function listResults(quizId) {
  return stmt.listResults.all(quizId).map(rowToResult);
}

function addResult(quizId, result) {
  stmt.insertResult.run({
    quizId,
    playerName: result.playerName,
    playerKey: nameKey(result.playerName),
    // `?? null` explicite : node:sqlite lie SILENCIEUSEMENT à NULL un paramètre
    // nommé absent de l'objet. Sans ce défaut écrit noir sur blanc, un jour où
    // l'appelant oublierait learnerId, la participation partirait orpheline
    // sans que rien ne proteste.
    learnerId: result.learnerId ?? null,
    score: result.score,
    total: result.total,
    submittedAt: result.submittedAt,
  });
}

// -----------------------------------------------------------------------------
// Annuaire des apprenants
//
// Rappel de contrat, commun aux deux stores : `from` et `to` sont des instants
// ISO ou null, `to` est EXCLUSIF. Aucune date calendaire, aucune logique de
// fuseau ne descend jusqu'ici. Les moyennes sortent en flottants BRUTS :
// l'arrondi se fait une seule fois, dans index.js, à la sérialisation.
// -----------------------------------------------------------------------------

/**
 * Les prénoms qui commencent par `prefixKey`, et eux seuls.
 * Renvoie les displayName, jamais les identifiants : la suggestion sert à
 * reconnaître son propre nom, pas à parcourir l'annuaire.
 */
function suggestLearners(prefixKey, limit = 8) {
  const prefixe = String(prefixKey ?? '');
  // Un préfixe vide donnerait le motif '*', c'est-à-dire l'annuaire entier
  // exposé publiquement. On refuse ici en plus de la validation d'index.js.
  if (!prefixe) return [];

  // LIMIT NULL, en SQLite, signifie « aucune limite ». Un `limit` non numérique
  // se lierait à NULL et déverserait toute la table : on borne avant de lier.
  const n = Math.floor(Number(limit));
  const borne = Number.isFinite(n) && n > 0 ? n : 8;

  return stmt.suggestLearners
    .all({ pattern: `${prefixe}*`, limit: borne })
    .map((row) => row.display_name);
}

/** La fiche correspondant à ce nom, à la casse et aux accents près, ou null. */
function resolveLearner(name) {
  return rowToLearner(stmt.getLearnerByKey.get(nameKey(name)));
}

/**
 * La fiche de cet apprenant, créée au besoin. Seule porte d'entrée publique
 * vers l'annuaire : une fiche naît par effet de bord de l'envoi des réponses,
 * jamais par une route dédiée qu'un curieux pourrait marteler.
 *
 * Si la fiche existe elle est ADOPTÉE — et si elle était en quarantaine (une
 * fiche d'import, suggestible = 0), la personne vient de se manifester
 * elle-même : la fiche est PROMUE et rejoint les suggestions.
 */
function ensureLearner(name) {
  const key = nameKey(name);
  const existant = stmt.getLearnerByKey.get(key);

  if (existant) {
    if (!existant.suggestible) {
      stmt.promoteLearner.run(existant.id);
      existant.suggestible = 1;
    }
    return { learner: rowToLearner(existant), created: false };
  }

  const id = newId();
  stmt.insertLearner.run({
    id,
    displayName: String(name ?? '').trim(),
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy: 'learner',
    suggestible: 1,
  });

  // Relecture plutôt que confiance : avec ON CONFLICT DO NOTHING, une fiche
  // créée entre-temps par une requête concurrente a gagné, et c'est la sienne
  // qui fait foi. `created` dit qui a réellement écrit la ligne.
  const row = stmt.getLearnerByKey.get(key);
  return { learner: rowToLearner(row), created: row.id === id };
}

/** Création à la main par le formateur. Le doublon est une erreur parlante. */
function createLearner(displayName) {
  const nom = String(displayName ?? '').trim();
  const key = nameKey(nom);

  const doublon = (fiche) => {
    const err = new Error('Une fiche porte déjà ce nom.');
    err.code = 'DUPLICATE';
    err.learner = rowToLearner(fiche);
    return err;
  };

  const existant = stmt.getLearnerByKey.get(key);
  if (existant) throw doublon(existant);

  const id = newId();
  stmt.insertLearner.run({
    id,
    displayName: nom,
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy: 'trainer',
    suggestible: 1,
  });

  const row = stmt.getLearnerByKey.get(key);
  // Course perdue contre une autre écriture : c'est encore un doublon, et le
  // formateur mérite le même message que s'il avait été deuxième d'une seconde.
  if (row.id !== id) throw doublon(row);
  return { learner: rowToLearner(row) };
}

/**
 * Écriture partielle, sur le modèle d'updateQuiz : seules les clés présentes
 * dans `patch` sont touchées. Renommer recalcule name_key mais ne réécrit
 * AUCUNE ligne de results — l'historique garde le nom tel qu'il a été tapé.
 */
function updateLearner(id, patch) {
  const actuel = stmt.getLearner.get(id);
  if (!actuel) return null;

  const sets = [];
  const values = { id };

  if ('displayName' in patch) {
    const nom = String(patch.displayName ?? '').trim();
    const key = nameKey(nom);
    // Renommer vers une clé déjà prise casserait l'index unique. On le dit
    // avant, avec la fiche fautive en main — de quoi proposer une fusion —
    // plutôt que de laisser remonter une erreur SQLite brute.
    const collision = stmt.getLearnerByKey.get(key);
    if (collision && collision.id !== id) {
      const err = new Error('Une fiche porte déjà ce nom.');
      err.code = 'DUPLICATE';
      err.learner = rowToLearner(collision);
      throw err;
    }
    sets.push('display_name = @displayName', 'name_key = @nameKey');
    values.displayName = nom;
    values.nameKey = key;
  }

  if ('suggestible' in patch) {
    sets.push('suggestible = @suggestible');
    values.suggestible = patch.suggestible ? 1 : 0;
  }

  if (!sets.length) return rowToLearner(actuel);

  db.prepare(`UPDATE learners SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return rowToLearner(stmt.getLearner.get(id));
}

function getLearner(id) {
  return rowToLearner(stmt.getLearner.get(id));
}

/**
 * L'annuaire complet, avec la synthèse de chacun sur la période. Un apprenant
 * sans participation sur la période reste dans la liste, à attempts = 0 et
 * avgPercent null — null et jamais 0, un zéro se lirait comme une note nulle.
 */
function listLearners({ from = null, to = null } = {}) {
  return stmt.listLearners.all({ from: from ?? null, to: to ?? null }).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    createdBy: row.created_by,
    suggestible: Boolean(row.suggestible),
    attempts: row.attempts ?? 0,
    avgPercent: row.avg_percent ?? null,
    lastSubmittedAt: row.last_submitted_at ?? null,
  }));
}

/** Les participations d'un apprenant sur la période, de la plus ancienne à la plus récente. */
function listLearnerHistory(learnerId, { from = null, to = null } = {}) {
  if (!learnerId) return [];
  return stmt.listLearnerHistory
    .all({ learnerId, from: from ?? null, to: to ?? null })
    .map((row) => ({
      resultId: row.result_id,
      quizId: row.quiz_id,
      quizTitle: row.quiz_title,
      playerName: row.player_name,
      score: row.score,
      total: row.total,
      submittedAt: row.submitted_at,
    }));
}

/**
 * Pendant de findResultByName, mais par fiche : la règle de tentative unique
 * doit tenir même si l'apprenant a été renommé depuis sa participation.
 */
function findResultByLearner(quizId, learnerId) {
  if (!learnerId) return null;
  const row = stmt.findResultByLearner.get(quizId, learnerId);
  return row ? rowToResult(row) : null;
}

/**
 * Fusionne deux fiches — typiquement une fiche d'import et la fiche vivante
 * de la même personne. Les participations changent de propriétaire, puis la
 * source disparaît. Tout ou rien : une fusion à moitié faite laisserait de
 * l'historique attaché à une fiche supprimée.
 */
function mergeLearners(sourceId, intoId) {
  if (!sourceId || !intoId || sourceId === intoId) return { moved: 0 };

  const source = stmt.getLearner.get(sourceId);
  const cible = stmt.getLearner.get(intoId);
  // Cible introuvable : on ne supprime SURTOUT pas la source, ce serait perdre
  // l'historique au lieu de le déplacer.
  if (!source || !cible) return { moved: 0 };

  db.exec('BEGIN IMMEDIATE');
  try {
    const info = stmt.moveResults.run({ intoId, sourceId });
    stmt.deleteLearner.run(sourceId);
    db.exec('COMMIT');
    // changes peut sortir en BigInt selon le réglage du runtime.
    return { moved: Number(info.changes) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = {
  DB_PATH,
  isEphemeral,
  ephemeralReason,
  createQuiz,
  getQuiz,
  updateQuiz,
  countResults,
  findResultByName,
  listQuizzes,
  listResults,
  addResult,
  // Annuaire — ajoutés APRÈS les onze existants, dans l'ordre du contrat
  // partagé avec db-memory.js. Aucun des onze n'a bougé.
  suggestLearners,
  resolveLearner,
  ensureLearner,
  createLearner,
  updateLearner,
  getLearner,
  listLearners,
  listLearnerHistory,
  findResultByLearner,
  mergeLearners,
};
