const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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

fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'kemet-quiz.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

/**
 * Clé de comparaison des prénoms : « Awa », « awa » et « Awâ » désignent
 * la même personne pour la règle de tentative unique.
 */
function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

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
  createQuiz,
  getQuiz,
  updateQuiz,
  countResults,
  findResultByName,
  listResults,
  addResult,
};
