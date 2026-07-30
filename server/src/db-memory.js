/**
 * Store de repli, en mémoire — MÊME interface que db.js.
 *
 * Utilisé uniquement si db.js refuse de se charger (typiquement un runtime Node
 * sans le module intégré node:sqlite). Dans ce cas l'application continue de
 * fonctionner, mais les données ne survivent pas à un redémarrage : c'est le
 * comportement d'avant la persistance, et c'est très préférable à un serveur mort.
 *
 * Toute évolution de la signature de db.js doit être répercutée ici.
 */
const { nameKey } = require('./name-key');

const quizzes = new Map();
const results = new Map(); // quizId -> tableau de participations

const DB_PATH = '(mémoire — aucune persistance)';
const isEphemeral = true;
const ephemeralReason = 'le stockage SQLite n’a pas pu être chargé (voir l’erreur ci-dessus)';

function createQuiz(id, quiz) {
  quizzes.set(id, {
    id,
    title: quiz.title,
    questions: quiz.questions,
    createdAt: quiz.createdAt,
    sourceText: quiz.sourceText ?? null,
    difficulty: quiz.difficulty ?? null,
    closed: Boolean(quiz.closed),
    singleAttempt: quiz.singleAttempt !== false,
    expiresAt: quiz.expiresAt ?? null,
  });
}

function getQuiz(id) {
  const quiz = quizzes.get(id);
  // Copie défensive : db.js relit la base à chaque appel, personne ne doit
  // pouvoir muter le store en modifiant l'objet renvoyé.
  return quiz ? { ...quiz, questions: quiz.questions.map((q) => ({ ...q })) } : null;
}

const UPDATABLE = ['title', 'questions', 'closed', 'singleAttempt', 'expiresAt'];

function updateQuiz(id, patch) {
  const quiz = quizzes.get(id);
  if (!quiz) return;
  for (const key of UPDATABLE) {
    if (!(key in patch)) continue;
    if (key === 'closed' || key === 'singleAttempt') quiz[key] = Boolean(patch[key]);
    else quiz[key] = patch[key] ?? null;
  }
}

function countResults(quizId) {
  return (results.get(quizId) || []).length;
}

function findResultByName(quizId, playerName) {
  const key = nameKey(playerName);
  const found = (results.get(quizId) || []).find((r) => nameKey(r.playerName) === key);
  return found ? { ...found } : null;
}

function listResults(quizId) {
  return (results.get(quizId) || []).map((r) => ({ ...r }));
}

function addResult(quizId, result) {
  if (!results.has(quizId)) results.set(quizId, []);
  results.get(quizId).push({
    playerName: result.playerName,
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
  listResults,
  addResult,
};
