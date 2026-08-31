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
const { fusionnerSuggestions } = require('./suggestion');
const { groupesProbables } = require('./similarite');
const { MOTS_VIDES_OFFICINE } = require('./mots-vides-officine');

// Interpolé dans le PRAGMA plus bas : PRAGMA n'accepte aucun paramètre lié.
// Ce n'est pas une injection, c'est un littéral du code — jamais une saisie.
const RESULTS_TABLE = 'results';

// Version des DONNÉES, pas du schéma. 1 (ou 0) : clés de nom d'origine.
// 2 : clés renormalisées par la nouvelle nameKey().
//
// PRAGMA user_version plutôt qu'une table `schema_meta` : zéro octet de schéma
// (c'est un entier de l'en-tête, page 1), transactionnel — il repart au
// ROLLBACK — et parfaitement ignoré par une version antérieure de
// l'application. Le mécanisme existant (PRAGMA table_info) ne sait détecter
// qu'un changement de STRUCTURE ; il est aveugle à une migration de données
// déjà jouée. Interpolé pour la même raison que RESULTS_TABLE.
const VERSION_DONNEES = 2;

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

      -- Le détail des réponses, question par question. Une TABLE et non une
      -- colonne JSON sur results : la question la plus utile qu'un formateur
      -- pose à cet outil est « quelle question est ratée par tout le monde ? »,
      -- et c'est précisément celle qu'un JSON empêcherait d'agréger.
      --
      -- CREATE TABLE IF NOT EXISTS suffit ici, contrairement à une COLONNE
      -- ajoutée : une table entièrement nouvelle est bien créée sur une base
      -- existante. C'est l'ajout de colonne qui exige ALTER TABLE.
      --
      -- question_text est FIGÉ à l'instant de la réponse, comme player_name
      -- l'est déjà : les questions restent modifiables après coup
      -- (PATCH /api/quiz/:id), et une statistique portant sur un énoncé qui a
      -- changé depuis ne voudrait rien dire.
      --
      -- quiz_id est porté ICI plutôt que lu par jointure sur results : il rend
      -- l'agrégat « les plus ratées » lisible en un seul balayage d'index.
      -- Dénormalisation assumée, et la CASCADE le tient à jour.
      --
      -- Les réponses circulent en LETTRES dans toute l'application ('A'..'F',
      -- voir LETTERS dans index.js et Quiz.jsx), jamais en index numérique.
      -- given est donc TEXT, et NULLABLE : une question laissée sans réponse
      -- est une donnée, pas un trou. La distinguer d'une mauvaise réponse est
      -- tout l'intérêt.
      --
      -- Les LIBELLÉS sont figés à côté des lettres, pour la même raison que
      -- question_text : les options sont modifiables après coup elles aussi, et
      -- une lettre seule ne dit plus rien si l'option a changé de texte ou de
      -- rang. C'est ce qui permet de dire « Aya a répondu X, il fallait Y »
      -- sans relire le quiz courant, donc sans risquer de le dire faux.
      CREATE TABLE IF NOT EXISTS answers (
        result_id      INTEGER NOT NULL REFERENCES results(id)  ON DELETE CASCADE,
        quiz_id        TEXT    NOT NULL REFERENCES quizzes(id)  ON DELETE CASCADE,
        question_index INTEGER NOT NULL,
        question_text  TEXT    NOT NULL,
        given          TEXT,
        given_label    TEXT,
        correct_answer TEXT    NOT NULL,
        correct_label  TEXT    NOT NULL,
        is_correct     INTEGER NOT NULL,
        PRIMARY KEY (result_id, question_index)
      );

      CREATE INDEX IF NOT EXISTS idx_answers_quiz ON answers(quiz_id, question_index);

      -- Les officines. Mêmes colonnes que la table learners, à dessein :
      -- suggestPharmacies devient la COPIE EXACTE de suggestLearners — même GLOB,
      -- même index, même NOT GLOB. La colonne suggestible est conservée alors
      -- qu'aucune quarantaine d'import n'existe ici : elle permet au formateur de
      -- masquer « test » ou une graphie fautive sans la supprimer. La colonne
      -- created_by ne prend que 'learner' ou 'trainer' : il n'y a rien à
      -- importer, donc pas de 'import'.
      --
      -- ⚠️ AUCUN ACCENT GRAVE dans ces commentaires : ce bloc vit dans un
      -- gabarit de chaîne JavaScript, un accent grave y terminerait la chaîne.
      --
      -- ⚠️ DÉCLARÉE AVANT les ALTER TABLE ci-dessous : PRAGMA foreign_keys est ON,
      -- et une référence vers une table absente serait rejetée.
      CREATE TABLE IF NOT EXISTS pharmacies (
        id           TEXT    PRIMARY KEY,
        display_name TEXT    NOT NULL,
        name_key     TEXT    NOT NULL,
        created_at   TEXT    NOT NULL,
        created_by   TEXT    NOT NULL DEFAULT 'learner',
        suggestible  INTEGER NOT NULL DEFAULT 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacies_key ON pharmacies(name_key);
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

    // Les trois colonnes d'officine. Même motif que learner_id ci-dessus —
    // sonde PRAGMA puis rattrapage de « duplicate column name » — mais écrit
    // une fois : trois recopies du bloc dériveraient.
    //
    // ⛔ ALTER TABLE et surtout PAS une colonne ajoutée au CREATE TABLE :
    // `CREATE TABLE IF NOT EXISTS` n'altère JAMAIS une table déjà créée, et ne
    // le dit pas. La colonne n'existerait jamais en production, en silence.
    const ajouterColonne = (table, colonne, definition) => {
      const existe = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((col) => col.name === colonne);
      if (existe) return;
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
      } catch (err) {
        // Deux processus qui démarrent ensemble lisent le PRAGMA au même
        // instant : le perdant reçoit « duplicate column name », qui est ici un
        // succès déguisé et non une panne.
        if (!/duplicate column name/i.test(err.message)) throw err;
      }
    };

    // L'officine ACTUELLE de la personne. ON DELETE SET NULL, JAMAIS CASCADE :
    // supprimer une officine ne doit effacer ni un apprenant ni une
    // participation. SQLite exige d'ailleurs qu'un ADD COLUMN porteur d'une clé
    // étrangère soit sans DEFAULT, donc nullable.
    ajouterColonne('learners', 'pharmacy_id', 'TEXT REFERENCES pharmacies(id) ON DELETE SET NULL');
    ajouterColonne('results', 'pharmacy_id', 'TEXT REFERENCES pharmacies(id) ON DELETE SET NULL');

    // La graphie du JOUR, FIGÉE — et c'est pour cela qu'elle existe EN PLUS de
    // pharmacy_id. Une clé étrangère n'est pas figée : renommer ou fusionner une
    // officine réécrirait l'histoire, et ON DELETE SET NULL l'effacerait.
    // C'est l'analogue exact du triplet déjà en place sur les personnes :
    // player_name (figé) + player_key + learner_id (référence vivante).
    // Pas de pharmacy_key : rien ne cherche par clé d'officine sur results, il
    // n'existe aucune règle de tentative unique par officine.
    ajouterColonne('results', 'pharmacy_name', 'TEXT');

    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_results_learner_date ON results(learner_id, submitted_at)'
    );
    db.exec('CREATE INDEX IF NOT EXISTS idx_results_pharmacy ON results(quiz_id, pharmacy_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_learners_pharmacy ON learners(pharmacy_id)');
    // Sert listPharmacyHistory : mêmes colonnes de tête que idx_results_pharmacy
    // ne suffiraient pas, cette requête filtre pharmacy_id SEUL puis trie par
    // date — l'analogue exact de idx_results_learner_date, pour une officine.
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_results_pharmacy_date ON results(pharmacy_id, submitted_at)'
    );

    // AVANT backfillLearners, et ce n'est pas indifférent : le backfill
    // regroupe les participations orphelines PAR player_key et fabrique une
    // fiche par groupe. Renormaliser d'abord lui fait produire directement les
    // bonnes fiches, au lieu d'en créer d'anciennes à fusionner ensuite.
    migrerClesDeNom();

    backfillLearners();
  } catch (err) {
    err.code = 'MIGRATION_FAILED';
    throw err;
  }
}

/**
 * Renormalisation des clés de nom — la migration la plus délicate du dépôt.
 *
 * nameKey() a changé : elle écrase les espaces internes multiples, transforme
 * les traits d'union et la ponctuation en espaces, supprime les apostrophes.
 * Les valeurs déjà stockées dans results.player_key et learners.name_key ne
 * correspondent donc plus à ce qu'elle renvoie. Sans cette reprise :
 *   · la règle de tentative unique casserait EN SILENCE sur tout l'historique ;
 *   · ensureLearner() ne retrouverait plus les fiches existantes et créerait
 *     des doublons — exactement la maladie que ce lot soigne.
 *
 * ⛔ NE PAS RENDRE CET ÉCHEC NON FATAL. La tentation est réelle : « la
 * réécriture est cosmétique, un ROLLBACK laisse l'application debout, mieux
 * vaut un annuaire imparfait qu'un site à terre ». C'est faux ici, et
 * dangereusement. Le code et les données sont livrés ENSEMBLE : après un
 * ROLLBACK, la base porte des clés d'ancien format pendant que le code en
 * calcule de nouveau format. Le serveur tournerait en cassant la tentative
 * unique et en fabriquant des doublons à chaque envoi, sans un mot. Mourir est
 * ici le comportement sûr — l'erreur remonte à migrate(), qui la marque
 * MIGRATION_FAILED, et index.js relance au lieu de basculer en mémoire.
 *
 * Sûre à interrompre : tout tient dans UNE transaction, marqueur compris.
 * Idempotente par CONSTRUCTION et pas seulement par le marqueur : la clé est
 * toujours recalculée depuis player_name / display_name — jamais dérivée de la
 * clé stockée — et nameKey(nameKey(x)) === nameKey(x).
 *
 * ⚠️ mergeLearners() n'est PAS appelée ici, et ne PEUT pas l'être : elle ouvre
 * sa propre transaction (SQLite n'en imbrique pas) et surtout elle lit `stmt`,
 * un const initialisé APRÈS l'appel de migrate() — la lire ici lèverait dans sa
 * zone morte temporelle. Toutes les requêtes sont donc préparées LOCALEMENT,
 * comme le fait déjà backfillLearners().
 */
function migrerClesDeNom() {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= VERSION_DONNEES) return;

  // Préparées localement : `stmt` n'existe pas encore à cet instant.
  const lireResultats = db.prepare('SELECT id, player_name, player_key FROM results');
  const ecrireCleResultat = db.prepare('UPDATE results SET player_key = @cle WHERE id = @id');
  const lireFiches = db.prepare(`
    SELECT l.id, l.display_name, l.name_key,
           (SELECT COUNT(*) FROM results r WHERE r.learner_id = l.id) AS attempts
      FROM learners l
     ORDER BY l.name_key
  `);
  const ecrireCleFiche = db.prepare('UPDATE learners SET name_key = @cle WHERE id = @id');

  db.exec('BEGIN IMMEDIATE');
  try {
    // ---- A. results.player_key : réécriture INTÉGRALE.
    // Aucune contrainte d'unicité sur cette colonne (idx_results_name est un
    // index simple) : rien ne peut entrer en collision, c'est un gain net.
    let resultatsReecrits = 0;
    for (const r of lireResultats.all()) {
      const cle = nameKey(r.player_name);
      if (cle === r.player_key) continue;
      ecrireCleResultat.run({ cle, id: r.id });
      resultatsReecrits += 1;
    }

    // ---- B. learners.name_key : réécriture LÀ OÙ LA CLÉ EST LIBRE.
    //
    // idx_learners_key est UNIQUE : les fiches que la nouvelle règle réunit
    // sont précisément celles qui violeraient la contrainte. On ne les fusionne
    // PAS — mergeLearners déplace puis supprime SANS conserver la provenance,
    // une fusion à tort ne se défait pas, même la sauvegarde en main. Elles
    // gardent leur ancienne clé et l'écran « Doublons probables » les montre au
    // formateur, qui tranche.
    const fiches = lireFiches.all().map((l) => ({
      id: l.id,
      displayName: l.display_name,
      ancienne: l.name_key,
      cible: nameKey(l.display_name),
      attempts: l.attempts || 0,
    }));

    // Qui obtient chaque clé cible. Départage : la fiche qui la porte DÉJÀ
    // (elle n'a rien à faire), puis le plus d'évaluations, puis la graphie la
    // plus propre, puis la plus longue. Déterministe.
    const sale = (f) => (/\s{2,}|^\s|\s$/.test(String(f.displayName)) ? 1 : 0);
    const parCible = new Map();
    for (const f of fiches) {
      if (!parCible.has(f.cible)) parCible.set(f.cible, []);
      parCible.get(f.cible).push(f);
    }

    const gagnantes = new Set();
    const perdantes = [];
    for (const [cible, groupe] of parCible) {
      if (!cible) continue; // clé vide : on n'y touche pas.
      const classees = [...groupe].sort(
        (a, b) =>
          (a.ancienne === cible ? 0 : 1) - (b.ancienne === cible ? 0 : 1) ||
          b.attempts - a.attempts ||
          sale(a) - sale(b) ||
          String(b.displayName).length - String(a.displayName).length ||
          String(a.id).localeCompare(String(b.id))
      );
      gagnantes.add(classees[0].id);
      for (const f of classees.slice(1)) perdantes.push(f);
    }

    // Deux passes, et c'est indispensable : réécrire dans l'ordre buterait sur
    // l'index UNIQUE dès qu'une fiche prend la clé qu'une autre n'a pas encore
    // libérée. On vide d'abord vers une clé temporaire unique par construction
    // (l'identifiant), puis on pose les clés définitives.
    const aDeplacer = fiches.filter((f) => f.cible && gagnantes.has(f.id) && f.ancienne !== f.cible);
    for (const f of aDeplacer) {
      ecrireCleFiche.run({ cle: ` migration-${f.id}`, id: f.id });
    }
    for (const f of aDeplacer) {
      ecrireCleFiche.run({ cle: f.cible, id: f.id });
    }

    db.exec(`PRAGMA user_version = ${VERSION_DONNEES}`);
    // Le marqueur est posé DANS la transaction : une coupure avant le COMMIT
    // annule tout, marqueur compris, et le démarrage suivant recommence.
    db.exec('COMMIT');

    console.log(
      `Clés de nom renormalisées : ${resultatsReecrits} participation(s), ` +
        `${aDeplacer.length} fiche(s) réécrite(s), ${perdantes.length} fiche(s) laissée(s) ` +
        `en l'état (doublons à trancher depuis l'écran « Doublons probables »).`
    );
    for (const f of perdantes) {
      console.log(`  doublon révélé : « ${f.displayName} » rejoint « ${f.cible} »`);
    }
  } catch (err) {
    db.exec('ROLLBACK');
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

// learner_id n'entre TOUJOURS pas ici : GET /api/quiz/:id/results reste un
// écran de scores, pas une fiche d'identité. pharmacy_name, lui, est ajouté
// délibérément — c'est la graphie du jour, et c'est ce qui permet à
// QuizResults de regrouper les réponses par officine.
function rowToResult(row) {
  return {
    playerName: row.player_name,
    pharmacyName: row.pharmacy_name ?? null,
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
    // L'officine ACTUELLE de la personne — null tant qu'elle n'en a pas.
    // `row.pharmacy_id` existe sur `SELECT *` dès que la colonne existe ;
    // `undefined` ne se produit que si la requête ne l'a pas sélectionnée.
    pharmacyId: row.pharmacy_id ?? null,
  };
}

// Copie exacte de rowToLearner : mêmes colonnes, même forme.
function rowToPharmacy(row) {
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
    INSERT INTO results
      (quiz_id, player_name, player_key, learner_id, pharmacy_id, pharmacy_name, score, total, submitted_at)
    VALUES
      (@quizId, @playerName, @playerKey, @learnerId, @pharmacyId, @pharmacyName, @score, @total, @submittedAt)
  `),

  insertAnswer: db.prepare(`
    INSERT INTO answers
      (result_id, quiz_id, question_index, question_text, given, given_label, correct_answer, correct_label, is_correct)
    VALUES
      (@resultId, @quizId, @questionIndex, @questionText, @given, @givenLabel, @correctAnswer, @correctLabel, @isCorrect)
  `),

  // L'agrégat qui répond à « quelle question est ratée par tout le monde ? ».
  //
  // GROUP BY sur le seul question_index, jamais sur le texte : un énoncé
  // corrigé en cours de route scinderait sinon la question en deux lignes.
  // L'énoncé affiché est celui de la participation la PLUS RÉCENTE, et
  // formulations signale qu'il a changé — le formateur doit savoir que son
  // pourcentage porte sur deux libellés.
  statsParQuestion: db.prepare(`
    SELECT a.question_index,
           (SELECT a2.question_text
              FROM answers a2
             WHERE a2.quiz_id = a.quiz_id AND a2.question_index = a.question_index
             ORDER BY a2.result_id DESC
             LIMIT 1) AS question_text,
           COUNT(*) AS reponses,
           SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS ratees,
           SUM(CASE WHEN a.given IS NULL THEN 1 ELSE 0 END) AS sans_reponse,
           COUNT(DISTINCT a.question_text) AS formulations
      FROM answers a
     WHERE a.quiz_id = @quizId
     GROUP BY a.question_index
     ORDER BY a.question_index
  `),

  listAnswersByResult: db.prepare(`
    SELECT question_index, question_text, given, given_label, correct_answer, correct_label, is_correct
      FROM answers
     WHERE result_id = @resultId
     ORDER BY question_index
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

  // Correspondance en MILIEU de nom : « Kouassi Aya » doit sortir sur « aya ».
  // C'était le trou le plus fréquent de la saisie assistée — un apprenant connu
  // par son patronyme ne se retrouvait pas et ouvrait une seconde fiche.
  //
  // Le motif « * aya* » a un joker EN TÊTE : SQLite ne peut pas utiliser
  // idx_learners_key et balaie la table. Assumé — quelques centaines de fiches
  // tiennent en trois pages déjà en cache, et le LIMIT arrête le balayage à la
  // cinquième correspondance. À revoir au-delà de ~20 000 fiches, pas avant.
  //
  // L'espace du motif est SIGNIFIANT : il veut dire « un mot qui commence par
  // la saisie, et qui n'est pas le premier ». motsDeCle() applique la même
  // règle côté db-memory.js.
  //
  // NOT GLOB @debut écarte ce que la requête ci-dessus a déjà rendu : une clé
  // comme « aya kouassi aya » correspond aux deux motifs. Les deux listes
  // arrivent donc disjointes à fusionnerSuggestions().
  suggestLearnersMot: db.prepare(`
    SELECT display_name FROM learners
    WHERE suggestible = 1 AND name_key GLOB @motif AND name_key NOT GLOB @debut
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
  // p.display_name via LEFT JOIN, jamais via une sous-requête sur results :
  // c'est l'officine ACTUELLE de la fiche, indépendante de la période
  // demandée — un apprenant sans participation sur la fenêtre garde son
  // officine affichée.
  listLearners: db.prepare(`
    SELECT l.id, l.display_name, l.created_at, l.created_by, l.suggestible,
           l.pharmacy_id, p.display_name AS pharmacy_name,
           COUNT(r.id) AS attempts,
           AVG(CASE WHEN r.total > 0 THEN r.score * 100.0 / r.total END) AS avg_percent,
           MAX(r.submitted_at) AS last_submitted_at
      FROM learners l
      LEFT JOIN pharmacies p ON p.id = l.pharmacy_id
      LEFT JOIN results r
        ON r.learner_id = l.id
       AND (@from IS NULL OR r.submitted_at >= @from)
       AND (@to   IS NULL OR r.submitted_at <  @to)
     GROUP BY l.id
     ORDER BY l.name_key
  `),

  // player_name est renvoyé tel qu'il a été tapé ce jour-là : renommer une
  // fiche ne réécrit jamais une ligne de results.
  // r.pharmacy_name, jamais une jointure vers pharmacies : c'est la graphie du
  // JOUR, figée sur la ligne — l'officine actuelle de la fiche peut avoir
  // changé depuis, l'historique ne doit pas le montrer rétroactivement.
  listLearnerHistory: db.prepare(`
    SELECT r.id AS result_id, r.quiz_id, q.title AS quiz_title, r.player_name,
           r.pharmacy_name, r.score, r.total, r.submitted_at
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

  // Toutes les fiches, avec de quoi les départager. AUCUN filtre de période :
  // cet écran parle d'IDENTITÉ, pas de résultats — le piège du filtre de dates
  // dans le ON plutôt que dans le WHERE ne se pose donc pas ici, et c'est
  // précisément pour cela qu'il faut le dire.
  // Les fiches en quarantaine sont INCLUSES : une fiche d'import est justement
  // celle qu'un doublon récent vient concurrencer.
  listDuplicateCandidates: db.prepare(`
    SELECT l.id, l.display_name, l.name_key, l.created_by, l.suggestible,
           COUNT(r.id) AS attempts,
           MAX(r.submitted_at) AS last_submitted_at
      FROM learners l
      LEFT JOIN results r ON r.learner_id = l.id
     GROUP BY l.id
     ORDER BY l.name_key
  `),

  // ---------------------------------------------------------------------------
  // Annuaire des officines — copie exacte du bloc apprenants ci-dessus, même
  // GLOB, même index, même NOT GLOB. Seul ce qui EST différent change :
  // « attempts » ici compte des APPRENANTS rattachés, pas des participations.
  // ---------------------------------------------------------------------------

  insertPharmacy: db.prepare(`
    INSERT INTO pharmacies (id, display_name, name_key, created_at, created_by, suggestible)
    VALUES (@id, @displayName, @nameKey, @createdAt, @createdBy, @suggestible)
    ON CONFLICT(name_key) DO NOTHING
  `),
  getPharmacy: db.prepare('SELECT * FROM pharmacies WHERE id = ?'),
  getPharmacyByKey: db.prepare('SELECT * FROM pharmacies WHERE name_key = ?'),
  promotePharmacy: db.prepare('UPDATE pharmacies SET suggestible = 1 WHERE id = ?'),
  deletePharmacy: db.prepare('DELETE FROM pharmacies WHERE id = ?'),

  suggestPharmacies: db.prepare(`
    SELECT display_name FROM pharmacies
    WHERE suggestible = 1 AND name_key GLOB @pattern
    ORDER BY name_key
    LIMIT @limit
  `),

  suggestPharmaciesMot: db.prepare(`
    SELECT display_name FROM pharmacies
    WHERE suggestible = 1 AND name_key GLOB @motif AND name_key NOT GLOB @debut
    ORDER BY name_key
    LIMIT @limit
  `),

  // « attempts » = nombre d'APPRENANTS rattachés, pas de participations : un
  // apprenant qui passe cinq quiz ne doit pas peser cinq fois plus qu'un
  // apprenant qui n'en a passé qu'un seul dans le classement des officines.
  listPharmacies: db.prepare(`
    SELECT p.id, p.display_name, p.created_at, p.created_by, p.suggestible,
           COUNT(l.id) AS attempts
      FROM pharmacies p
      LEFT JOIN learners l ON l.pharmacy_id = p.id
     GROUP BY p.id
     ORDER BY p.name_key
  `),

  movePharmacyLearners: db.prepare(
    'UPDATE learners SET pharmacy_id = @intoId WHERE pharmacy_id = @sourceId'
  ),
  // results.pharmacy_id sert au regroupement des scores par officine ; il migre
  // avec la fusion pour rester cohérent. results.pharmacy_name, lui, N'EST PAS
  // touché : c'est la graphie du JOUR, figée, elle ne se réécrit jamais.
  movePharmacyResults: db.prepare(
    'UPDATE results SET pharmacy_id = @intoId WHERE pharmacy_id = @sourceId'
  ),

  listDuplicatePharmacyCandidates: db.prepare(`
    SELECT p.id, p.display_name, p.name_key, p.created_by, p.suggestible,
           COUNT(l.id) AS attempts
      FROM pharmacies p
      LEFT JOIN learners l ON l.pharmacy_id = p.id
     GROUP BY p.id
     ORDER BY p.name_key
  `),

  setLearnerPharmacy: db.prepare('UPDATE learners SET pharmacy_id = @pharmacyId WHERE id = @id'),

  // Toutes les participations des apprenants d'UNE officine, tous quiz
  // confondus. Filtre sur results.pharmacy_id — la graphie FIGÉE du jour —
  // et non sur l'officine actuelle des fiches : un apprenant qui a changé
  // d'officine depuis ne doit pas faire apparaître ses anciennes réponses
  // sous l'officine où il est aujourd'hui (même règle que listLearnerHistory
  // pour player_name, symétrique).
  listPharmacyHistory: db.prepare(`
    SELECT r.id AS result_id, r.quiz_id, q.title AS quiz_title, r.player_name,
           r.score, r.total, r.submitted_at
      FROM results r
      JOIN quizzes q ON q.id = r.quiz_id
     WHERE r.pharmacy_id = @pharmacyId
       AND (@from IS NULL OR r.submitted_at >= @from)
       AND (@to   IS NULL OR r.submitted_at <  @to)
     ORDER BY r.submitted_at ASC, r.id ASC
  `),
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

/**
 * Enregistre une participation, et le DÉTAIL de ses réponses s'il est fourni.
 *
 * `result.detail` : [{ questionIndex, questionText, given, correctIndex,
 * isCorrect }]. Facultatif — une participation sans détail reste valide, c'est
 * le cas de tout l'historique antérieur à cette table.
 *
 * Les deux écritures tiennent dans UNE transaction : une participation dont le
 * détail manquerait à moitié produirait des statistiques fausses, et fausses en
 * silence. Tout ou rien. C'est la seule transaction du chemin d'envoi, qui
 * reste par ailleurs synchrone de bout en bout.
 */
function addResult(quizId, result) {
  const detail = Array.isArray(result.detail) ? result.detail : [];

  db.exec('BEGIN IMMEDIATE');
  try {
    const info = stmt.insertResult.run({
      quizId,
      playerName: result.playerName,
      playerKey: nameKey(result.playerName),
      // `?? null` explicite : node:sqlite lie SILENCIEUSEMENT à NULL un paramètre
      // nommé absent de l'objet. Sans ce défaut écrit noir sur blanc, un jour où
      // l'appelant oublierait learnerId, la participation partirait orpheline
      // sans que rien ne proteste.
      learnerId: result.learnerId ?? null,
      // pharmacyName est la graphie du JOUR, FIGÉE — l'analogue de playerName.
      // pharmacyId sert au regroupement ; ni l'un ni l'autre ne se réécrit si
      // l'officine est renommée ou fusionnée ensuite.
      pharmacyId: result.pharmacyId ?? null,
      pharmacyName: result.pharmacyName ?? null,
      score: result.score,
      total: result.total,
      submittedAt: result.submittedAt,
    });

    // lastInsertRowid peut sortir en BigInt selon le réglage du runtime, et
    // results.id est un INTEGER AUTOINCREMENT : on repasse en Number avant de
    // le relier, sinon la clé étrangère ne correspondrait pas au type attendu.
    const resultId = Number(info.lastInsertRowid);

    for (const r of detail) {
      stmt.insertAnswer.run({
        resultId,
        quizId,
        questionIndex: r.questionIndex,
        questionText: r.questionText,
        // Sans réponse : NULL. Une lettre vide ou un tiret se confondraient
        // avec une option choisie au moment de compter.
        given: r.given ?? null,
        givenLabel: r.givenLabel ?? null,
        correctAnswer: r.correctAnswer,
        correctLabel: r.correctLabel,
        isCorrect: r.isCorrect ? 1 : 0,
      });
    }

    db.exec('COMMIT');
    return { resultId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Pour un quiz, chaque question avec son taux d'échec. Trié par index de
 * question ; c'est l'écran qui décide de reclasser par difficulté.
 * Ne compte QUE les participations postérieures à la mise en place du détail.
 */
function listQuestionStats(quizId) {
  return stmt.statsParQuestion.all({ quizId }).map((row) => ({
    questionIndex: row.question_index,
    questionText: row.question_text,
    reponses: row.reponses,
    ratees: row.ratees,
    sansReponse: row.sans_reponse,
    // Vrai quand l'énoncé a changé entre deux participations : le pourcentage
    // porte alors sur deux formulations, et l'écran doit le dire.
    enonceModifie: row.formulations > 1,
  }));
}

/** Le détail d'UNE participation. Vide pour l'historique antérieur. */
function listResultAnswers(resultId) {
  return stmt.listAnswersByResult.all({ resultId: Number(resultId) }).map((row) => ({
    questionIndex: row.question_index,
    questionText: row.question_text,
    given: row.given,
    givenLabel: row.given_label,
    correctAnswer: row.correct_answer,
    correctLabel: row.correct_label,
    isCorrect: Boolean(row.is_correct),
  }));
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
 * Les apprenants dont UN MOT du nom commence par `prefixKey`.
 * « Kouassi Aya » sort désormais sur « aya », ce qui n'était pas le cas.
 *
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

  // Chaque famille est bornée à `borne` AVANT la fusion, et non à sa part du
  // quota : sans correspondance en milieu de nom, les préfixes doivent pouvoir
  // reprendre toutes les places.
  const prefixes = stmt.suggestLearners
    .all({ pattern: `${prefixe}*`, limit: borne })
    .map((row) => row.display_name);
  const mots = stmt.suggestLearnersMot
    .all({ motif: `* ${prefixe}*`, debut: `${prefixe}*`, limit: borne })
    .map((row) => row.display_name);

  return fusionnerSuggestions(prefixes, mots, borne);
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
    pharmacyId: row.pharmacy_id ?? null,
    pharmacyName: row.pharmacy_name ?? null,
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
      pharmacyName: row.pharmacy_name ?? null,
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

/**
 * Les groupes de fiches qui désignent PROBABLEMENT la même personne.
 * Ne modifie rien : c'est le formateur qui tranche, et mergeLearners qui
 * exécute. Voir server/src/similarite.js pour les trois règles.
 */
function listDuplicateCandidates() {
  return groupesProbables(
    stmt.listDuplicateCandidates.all().map((row) => ({
      id: row.id,
      displayName: row.display_name,
      nameKey: row.name_key,
      createdBy: row.created_by,
      suggestible: Boolean(row.suggestible),
      attempts: row.attempts ?? 0,
      lastSubmittedAt: row.last_submitted_at ?? null,
    }))
  );
}

// ---------------------------------------------------------------------------
// Annuaire des officines — copie fonctionnelle du bloc apprenants ci-dessus.
// ---------------------------------------------------------------------------

/** Les officines dont UN MOT du nom commence par `prefixKey`. Copie de suggestLearners. */
function suggestPharmacies(prefixKey, limit = 8) {
  const prefixe = String(prefixKey ?? '');
  if (!prefixe) return [];

  const n = Math.floor(Number(limit));
  const borne = Number.isFinite(n) && n > 0 ? n : 8;

  const prefixes = stmt.suggestPharmacies
    .all({ pattern: `${prefixe}*`, limit: borne })
    .map((row) => row.display_name);
  const mots = stmt.suggestPharmaciesMot
    .all({ motif: `* ${prefixe}*`, debut: `${prefixe}*`, limit: borne })
    .map((row) => row.display_name);

  return fusionnerSuggestions(prefixes, mots, borne);
}

/** La fiche d'officine correspondant à ce nom, ou null. Ne crée jamais rien. */
function resolvePharmacy(name) {
  return rowToPharmacy(stmt.getPharmacyByKey.get(nameKey(name)));
}

/**
 * La fiche d'officine, créée au besoin. Seule porte d'entrée publique :
 * une fiche naît par effet de bord de l'envoi des réponses, comme pour
 * ensureLearner — jamais par une route dédiée qu'un curieux pourrait marteler.
 */
function ensurePharmacy(name) {
  const key = nameKey(name);
  const existant = stmt.getPharmacyByKey.get(key);

  if (existant) {
    if (!existant.suggestible) {
      stmt.promotePharmacy.run(existant.id);
      existant.suggestible = 1;
    }
    return { pharmacy: rowToPharmacy(existant), created: false };
  }

  const id = newId();
  stmt.insertPharmacy.run({
    id,
    displayName: String(name ?? '').trim(),
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy: 'learner',
    suggestible: 1,
  });

  const row = stmt.getPharmacyByKey.get(key);
  return { pharmacy: rowToPharmacy(row), created: row.id === id };
}

/** Création à la main par le formateur. Le doublon est une erreur parlante. */
function createPharmacy(displayName) {
  const nom = String(displayName ?? '').trim();
  const key = nameKey(nom);

  const doublon = (fiche) => {
    const err = new Error('Une officine porte déjà ce nom.');
    err.code = 'DUPLICATE';
    err.pharmacy = rowToPharmacy(fiche);
    return err;
  };

  const existant = stmt.getPharmacyByKey.get(key);
  if (existant) throw doublon(existant);

  const id = newId();
  stmt.insertPharmacy.run({
    id,
    displayName: nom,
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy: 'trainer',
    suggestible: 1,
  });

  const row = stmt.getPharmacyByKey.get(key);
  if (row.id !== id) throw doublon(row);
  return { pharmacy: rowToPharmacy(row) };
}

/** Écriture partielle. Renommer recalcule name_key mais ne réécrit AUCUNE ligne
 * de results — pharmacy_name y reste la graphie du jour, figée. */
function updatePharmacy(id, patch) {
  const actuel = stmt.getPharmacy.get(id);
  if (!actuel) return null;

  const sets = [];
  const values = { id };

  if ('displayName' in patch) {
    const nom = String(patch.displayName ?? '').trim();
    const key = nameKey(nom);
    const collision = stmt.getPharmacyByKey.get(key);
    if (collision && collision.id !== id) {
      const err = new Error('Une officine porte déjà ce nom.');
      err.code = 'DUPLICATE';
      err.pharmacy = rowToPharmacy(collision);
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

  if (!sets.length) return rowToPharmacy(actuel);

  db.prepare(`UPDATE pharmacies SET ${sets.join(', ')} WHERE id = @id`).run(values);
  return rowToPharmacy(stmt.getPharmacy.get(id));
}

function getPharmacy(id) {
  return rowToPharmacy(stmt.getPharmacy.get(id));
}

/** Toutes les officines, avec le nombre d'apprenants rattachés à chacune. */
function listPharmacies() {
  return stmt.listPharmacies.all().map((row) => ({
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at,
    createdBy: row.created_by,
    suggestible: Boolean(row.suggestible),
    attempts: row.attempts ?? 0,
  }));
}

/**
 * Fusionne deux fiches d'officine. Déplace DEUX choses — les apprenants ET les
 * participations rattachés — dans une seule transaction : une fusion à moitié
 * faite laisserait des résultats attachés à une officine supprimée.
 * results.pharmacy_name n'est PAS touché : c'est la graphie figée du jour.
 */
function mergePharmacies(sourceId, intoId) {
  if (!sourceId || !intoId || sourceId === intoId) return { movedLearners: 0, movedResults: 0 };

  const source = stmt.getPharmacy.get(sourceId);
  const cible = stmt.getPharmacy.get(intoId);
  if (!source || !cible) return { movedLearners: 0, movedResults: 0 };

  db.exec('BEGIN IMMEDIATE');
  try {
    const infoLearners = stmt.movePharmacyLearners.run({ intoId, sourceId });
    const infoResults = stmt.movePharmacyResults.run({ intoId, sourceId });
    stmt.deletePharmacy.run(sourceId);
    db.exec('COMMIT');
    return { movedLearners: Number(infoLearners.changes), movedResults: Number(infoResults.changes) };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Les groupes d'officines qui désignent PROBABLEMENT le même établissement.
 * Les mots ultra-fréquents (« pharmacie », « nouvelle »…) sont neutralisés
 * dans R3 — voir server/src/mots-vides-officine.js et le commentaire de
 * groupesProbables dans similarite.js.
 */
function listDuplicatePharmacyCandidates() {
  return groupesProbables(
    stmt.listDuplicatePharmacyCandidates.all().map((row) => ({
      id: row.id,
      displayName: row.display_name,
      nameKey: row.name_key,
      createdBy: row.created_by,
      suggestible: Boolean(row.suggestible),
      attempts: row.attempts ?? 0,
    })),
    { motsVides: MOTS_VIDES_OFFICINE }
  );
}

/** Affecte (ou retire, avec null) l'officine actuelle d'un apprenant. */
function setLearnerPharmacy(learnerId, pharmacyId) {
  const actuel = stmt.getLearner.get(learnerId);
  if (!actuel) return null;
  stmt.setLearnerPharmacy.run({ id: learnerId, pharmacyId: pharmacyId ?? null });
  return rowToLearner(stmt.getLearner.get(learnerId));
}

/**
 * Les participations des apprenants d'une officine, sur la période, de la
 * plus ancienne à la plus récente — analogue de listLearnerHistory, mais à
 * cheval sur plusieurs apprenants et plusieurs quiz.
 */
function listPharmacyHistory(pharmacyId, { from = null, to = null } = {}) {
  if (!pharmacyId) return [];
  return stmt.listPharmacyHistory
    .all({ pharmacyId, from: from ?? null, to: to ?? null })
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
  // 22e fonction. Ajoutée AU MÊME RANG dans db-memory.js, dans le même commit :
  // en mode dégradé, `store.listDuplicateCandidates` absent donnerait un 500
  // que messagePourFormateur filtrerait en message générique — une panne muette.
  listDuplicateCandidates,
  // 23e et 24e : le détail des réponses. Même règle, même rang.
  listQuestionStats,
  listResultAnswers,
  // 25e à 34e : l'annuaire des officines. Même règle : ajoutées APRÈS tout ce
  // qui précède, AU MÊME RANG dans db-memory.js, dans le même commit.
  suggestPharmacies,
  resolvePharmacy,
  ensurePharmacy,
  createPharmacy,
  updatePharmacy,
  getPharmacy,
  listPharmacies,
  mergePharmacies,
  listDuplicatePharmacyCandidates,
  setLearnerPharmacy,
  // 35e fonction. Même règle : ajoutée APRÈS tout ce qui précède, au même
  // rang dans db-memory.js, dans le même commit.
  listPharmacyHistory,
};
