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

function rowToResult(row) {
  return {
    playerName: row.player_name,
    score: row.score,
    total: row.total,
    submittedAt: row.submitted_at,
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
    INSERT INTO results (quiz_id, player_name, player_key, score, total, submitted_at)
    VALUES (@quizId, @playerName, @playerKey, @score, @total, @submittedAt)
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

function addResult(quizId, result) {
  stmt.insertResult.run({
    quizId,
    playerName: result.playerName,
    playerKey: nameKey(result.playerName),
    score: result.score,
    total: result.total,
    submittedAt: result.submittedAt,
  });
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
};
