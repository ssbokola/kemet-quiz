/**
 * Store de repli, en mémoire — MÊME interface que db.js.
 *
 * Utilisé uniquement si db.js refuse de se charger (typiquement un runtime Node
 * sans le module intégré node:sqlite). Dans ce cas l'application continue de
 * fonctionner, mais les données ne survivent pas à un redémarrage : c'est le
 * comportement d'avant la persistance, et c'est très préférable à un serveur mort.
 *
 * Toute évolution de la signature de db.js doit être répercutée ici.
 *
 * Ce fichier tient trois collections : les quiz, les participations, et depuis
 * l'annuaire d'apprenants une fiche par personne. La fiche est indexée DEUX
 * fois, par identifiant et par clé de nom. Le second index ne sert pas la
 * performance — quelques centaines de fiches tiennent dans un mouchoir — mais
 * la sémantique : il rend l'unicité de la clé de nom structurelle en mémoire
 * comme la contrainte UNIQUE la rend structurelle en SQL. Sans lui, les deux
 * stores répondraient différemment au même doublon, et c'est exactement le
 * genre d'écart que ce fichier existe pour éviter.
 *
 * Migration : sans objet. Les Map naissent vides à chaque démarrage, isEphemeral
 * vaut déjà true, il n'y a aucun existant à rattraper.
 */
const { nameKey, motsDeCle } = require('./name-key');
const { newId } = require('./ids');
const { fusionnerSuggestions } = require('./suggestion');
const { groupesProbables } = require('./similarite');
const { MOTS_VIDES_OFFICINE } = require('./mots-vides-officine');

const quizzes = new Map();
const results = new Map(); // quizId -> tableau de participations
const learners = new Map(); // id -> fiche d'apprenant
const learnersByKey = new Map(); // nameKey -> id, l'unicité rendue structurelle
const pharmacies = new Map(); // id -> fiche d'officine
const pharmaciesByKey = new Map(); // nameKey -> id

// Équivalent du AUTOINCREMENT de results.id : l'historique d'un apprenant
// renvoie un resultId, il faut donc que chaque participation en porte un.
let nextResultId = 1;

const DB_PATH = '(mémoire — aucune persistance)';
const isEphemeral = true;
const ephemeralReason = 'le stockage SQLite n’a pas pu être chargé (voir l’erreur ci-dessus)';

/**
 * Équivalent exact de rowToResult() dans db.js : une participation sort d'ici
 * champ par champ, jamais par copie d'objet. Une entrée en mémoire porte aussi
 * un id interne et un learnerId ; ni l'un ni l'autre ne doit fuir vers
 * GET /api/quiz/:id/results, que db.js n'expose pas non plus.
 */
function toResult(entry) {
  return {
    playerName: entry.playerName,
    pharmacyName: entry.pharmacyName ?? null,
    score: entry.score,
    total: entry.total,
    submittedAt: entry.submittedAt,
  };
}

/**
 * Les suffixes d'une clé, un par mot NON INITIAL — équivalent mémoire du motif
 * GLOB « * xxx* » de db.js.
 *
 * ⚠️ Un seul mot ne suffit pas : GLOB '* des 2 pl*' cherche l'apparition de LA
 * CHAÎNE « des 2 pl » après un espace, pas un mot unique qui commencerait par
 * elle. Un préfixe à plusieurs mots (« des 2 pl ») ne peut donc JAMAIS être
 * trouvé par un simple `mot.startsWith(prefix)` : aucun mot pris seul ne
 * contient d'espace. Il faut comparer contre le reste de la clé À PARTIR de
 * chaque mot, espaces compris — exactement ce que fait un GLOB sur la chaîne
 * entière.
 */
function suffixesInternes(cle) {
  const mots = motsDeCle(cle);
  const suffixes = [];
  for (let i = 1; i < mots.length; i += 1) suffixes.push(mots.slice(i).join(' '));
  return suffixes;
}

/** Copie défensive d'une fiche : personne ne mute le store par mégarde. */
function toLearner(learner) {
  if (!learner) return null;
  return {
    id: learner.id,
    pharmacyId: learner.pharmacyId ?? null,
    displayName: learner.displayName,
    nameKey: learner.nameKey,
    createdAt: learner.createdAt,
    createdBy: learner.createdBy,
    suggestible: Boolean(learner.suggestible),
  };
}

/**
 * ORDER BY name_key, c'est l'ordre BINARY de SQLite. localeCompare rangerait
 * « emile » et « émile » côte à côte selon des règles de locale : ce n'est pas
 * le même ordre, et deux stores qui ne trient pas pareil finiraient par
 * afficher deux annuaires différents. (listQuizzes utilise localeCompare sur
 * une date : incohérence préexistante, on ne la propage pas ici.)
 */
function compareKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Fenêtre temporelle : `from` et `to` sont des INSTANTS ISO ou null, et `to`
 * est EXCLUSIF. Comparer des chaînes est légitime uniquement parce que
 * toISOString() rend toujours 24 caractères de largeur fixe : même forme, même
 * longueur, donc ordre lexicographique = ordre chronologique. Aucune date
 * calendaire ni aucun fuseau ne descend jusqu'ici, c'est l'affaire d'index.js.
 */
function inWindow(submittedAt, from, to) {
  if (from && submittedAt < from) return false;
  if (to && submittedAt >= to) return false;
  return true;
}

/** Parcours de toutes les participations, tous quiz confondus. */
function* allEntries() {
  for (const [quizId, list] of results) {
    for (const entry of list) yield { quizId, entry };
  }
}

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
  return found ? toResult(found) : null;
}

// Même contrat que db.js : les plus récents d'abord, sans les questions.
//
// avgPercent, topPharmacyName, pharmacyCount : équivalent JS des trois
// sous-requêtes ajoutées à stmt.listQuizzes dans db.js, pour le tableau dense
// de « Mes quiz ». Le groupement par officine reprend l'esprit du ORDER BY
// SQL — la plus fréquente d'abord, alphabétique à égalité — mais compare les
// chaînes BRUTES (`<`/`>`), pas via localeCompare : listQuizzes n'est pas
// couvert par le test de parité des deux stores (contrairement à
// suggestLearners et listDuplicateCandidates), et cette égalité PARFAITE
// entre les deux stores n'est donc pas un contrat à tenir — seul l'ordre
// général (le plus récent d'abord) l'est.
function listQuizzes() {
  return [...quizzes.values()]
    .map((q) => {
      const participations = results.get(q.id) || [];
      const comptees = participations.filter((r) => r.total > 0);
      const avgPercent =
        comptees.length > 0
          ? comptees.reduce((somme, r) => somme + (r.score * 100) / r.total, 0) / comptees.length
          : null;

      const parOfficine = new Map();
      for (const r of participations) {
        if (!r.pharmacyName) continue;
        parOfficine.set(r.pharmacyName, (parOfficine.get(r.pharmacyName) || 0) + 1);
      }
      const officines = [...parOfficine.entries()].sort(
        ([nomA, nA], [nomB, nB]) => nB - nA || (nomA < nomB ? -1 : nomA > nomB ? 1 : 0)
      );

      return {
        id: q.id,
        title: q.title,
        createdAt: q.createdAt,
        closed: Boolean(q.closed),
        singleAttempt: q.singleAttempt !== false,
        expiresAt: q.expiresAt ?? null,
        resultCount: participations.length,
        avgPercent,
        topPharmacyName: officines.length > 0 ? officines[0][0] : null,
        pharmacyCount: officines.length,
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function listResults(quizId) {
  return (results.get(quizId) || []).map(toResult);
}

/**
 * Enregistre une participation et le détail de ses réponses.
 * Même contrat que db.js : `result.detail` est facultatif, et rend { resultId }.
 * Ici le détail vit sur l'entrée elle-même — pas de seconde table à tenir, donc
 * pas de transaction : une affectation d'objet est atomique par construction.
 */
function addResult(quizId, result) {
  if (!results.has(quizId)) results.set(quizId, []);
  const resultId = nextResultId++;
  results.get(quizId).push({
    id: resultId,
    playerName: result.playerName,
    score: result.score,
    total: result.total,
    submittedAt: result.submittedAt,
    // `?? null` explicite : une participation sans fiche reste possible, et
    // undefined dans une Map ne se distingue pas d'une clé absente.
    learnerId: result.learnerId ?? null,
    // pharmacyName est la graphie du JOUR, FIGÉE — l'analogue de playerName.
    // pharmacyId sert au regroupement ; ni l'un ni l'autre ne se réécrit si
    // l'officine est renommée ou fusionnée ensuite.
    pharmacyId: result.pharmacyId ?? null,
    pharmacyName: result.pharmacyName ?? null,
    detail: (Array.isArray(result.detail) ? result.detail : []).map((r) => ({
      questionIndex: r.questionIndex,
      questionText: r.questionText,
      // Les réponses sont des LETTRES ('A'..'F'), jamais des index. NULL quand
      // la question est restée sans réponse.
      given: r.given ?? null,
      givenLabel: r.givenLabel ?? null,
      correctAnswer: r.correctAnswer,
      correctLabel: r.correctLabel,
      isCorrect: Boolean(r.isCorrect),
    })),
  });
  return { resultId };
}

/**
 * Pour un quiz, chaque question avec son taux d'échec.
 * Reproduit le GROUP BY question_index de db.js, y compris le choix de
 * l'énoncé le plus RÉCENT et le signalement d'un énoncé modifié.
 */
function listQuestionStats(quizId) {
  const parIndex = new Map();
  for (const entry of results.get(quizId) || []) {
    for (const r of entry.detail || []) {
      if (!parIndex.has(r.questionIndex)) {
        parIndex.set(r.questionIndex, { reponses: 0, ratees: 0, sansReponse: 0, textes: [] });
      }
      const acc = parIndex.get(r.questionIndex);
      acc.reponses += 1;
      if (!r.isCorrect) acc.ratees += 1;
      if (r.given === null) acc.sansReponse += 1;
      // Empilé dans l'ordre d'insertion : le dernier est le plus récent, comme
      // le ORDER BY result_id DESC de db.js.
      acc.textes.push({ id: entry.id, texte: r.questionText });
    }
  }
  return [...parIndex.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([questionIndex, acc]) => {
      const recent = [...acc.textes].sort((a, b) => b.id - a.id)[0];
      return {
        questionIndex,
        questionText: recent ? recent.texte : '',
        reponses: acc.reponses,
        ratees: acc.ratees,
        sansReponse: acc.sansReponse,
        enonceModifie: new Set(acc.textes.map((t) => t.texte)).size > 1,
      };
    });
}

/** Le détail d'UNE participation. Vide pour l'historique antérieur. */
function listResultAnswers(resultId) {
  const cible = Number(resultId);
  for (const { entry } of allEntries()) {
    if (entry.id === cible) {
      return [...(entry.detail || [])].sort((a, b) => a.questionIndex - b.questionIndex);
    }
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Annuaire d'apprenants                                              *
 * ------------------------------------------------------------------ */

/**
 * Insertion d'une fiche, chemin unique des trois créateurs possibles.
 * L'appelant a DÉJÀ vérifié que la clé est libre (équivalent du
 * ON CONFLICT DO NOTHING) : ici on écrit, on ne tranche pas.
 */
function insertLearner(displayName, key, createdBy) {
  const learner = {
    id: newId(),
    displayName,
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy,
    suggestible: true,
  };
  learners.set(learner.id, learner);
  learnersByKey.set(key, learner.id);
  return toLearner(learner);
}

/** L'erreur que db.js lève sur violation de UNIQUE(name_key), même forme. */
function duplicateError(existing) {
  const err = new Error(`Un apprenant nommé « ${existing.displayName} » existe déjà.`);
  err.code = 'DUPLICATE';
  err.learner = toLearner(existing);
  return err;
}

/**
 * Suggestions à la frappe. Équivaut aux deux GLOB de db.js :
 *  · `name_key GLOB 'ay*'`      → startsWith sur la clé (tête de nom) ;
 *  · `name_key GLOB '* ay*'`    → un mot NON INITIAL qui commence pareil,
 *    d'où motsDeCle(...).slice(1) — l'espace du motif GLOB et le découpage de
 *    motsDeCle doivent trancher identiquement.
 *
 * Le store répond exactement à ce qu'on lui demande, GLOB comme startsWith :
 * c'est index.js qui doit refuser un préfixe trop court, sans quoi la liste
 * complète des apprenants sortirait par une route publique.
 */
function suggestLearners(prefixKey, limit) {
  const prefix = String(prefixKey ?? '');
  // Un prefixe vide ferait correspondre TOUTES les fiches (''.startsWith rend
  // toujours vrai) : l'annuaire entier sortirait par une route publique. Le
  // meme garde-fou existe dans db.js. Il est pose ICI EN PLUS de la validation
  // d'index.js : la confidentialite ne doit pas dependre d'un seul rempart.
  if (!prefix) return [];

  // LIMIT absent ou absurde : on borne, comme db.js. « Rendre tout » serait
  // ici le pire repli possible sur une fonction qui alimente une route publique.
  const max = Number.isInteger(limit) && limit > 0 ? limit : 8;

  const proposables = [...learners.values()]
    .filter((l) => l.suggestible)
    .sort((a, b) => compareKeys(a.nameKey, b.nameKey));

  const enTete = proposables.filter((l) => l.nameKey.startsWith(prefix));
  // Le NOT GLOB @debut de db.js : on exclut ce que la première famille rend
  // déjà, pour que les deux listes arrivent disjointes à la fusion.
  const enMilieu = proposables.filter(
    (l) => !l.nameKey.startsWith(prefix) && suffixesInternes(l.nameKey).some((s) => s.startsWith(prefix))
  );

  return fusionnerSuggestions(
    enTete.slice(0, max).map((l) => l.displayName),
    enMilieu.slice(0, max).map((l) => l.displayName),
    max
  );
}

/** La fiche correspondant à un nom tapé, ou null. Ne crée jamais rien. */
function resolveLearner(name) {
  const id = learnersByKey.get(nameKey(name));
  return id === undefined ? null : toLearner(learners.get(id));
}

/**
 * Résout par clé de nom, et crée la fiche si elle manque. Seul chemin de
 * création par un apprenant : il n'existe aucune route publique dédiée.
 *
 * Une fiche déjà là est ADOPTÉE, jamais dupliquée. Et si elle dormait en
 * quarantaine (suggestible faux, mise de côté par le formateur), le fait qu'une
 * personne réponde de nouveau sous ce nom la PROMEUT : le formateur l'a écartée
 * des suggestions, la réalité vient de le contredire.
 */
function ensureLearner(name) {
  const displayName = String(name ?? '').trim();
  const key = nameKey(displayName);

  if (learnersByKey.has(key)) {
    const learner = learners.get(learnersByKey.get(key));
    if (!learner.suggestible) learner.suggestible = true;
    return { learner: toLearner(learner), created: false };
  }

  return { learner: insertLearner(displayName, key, 'learner'), created: true };
}

/**
 * Création par le formateur, depuis l'annuaire. En cas de doublon on lève
 * plutôt que d'écraser, et l'erreur porte la fiche existante pour que
 * l'appelant puisse proposer de l'ouvrir au lieu d'un message sec.
 */
function createLearner(displayName) {
  const name = String(displayName ?? '').trim();
  const key = nameKey(name);

  if (learnersByKey.has(key)) throw duplicateError(learners.get(learnersByKey.get(key)));

  return { learner: insertLearner(name, key, 'trainer') };
}

/**
 * Correction d'une fiche : le nom affiché, la mise en quarantaine, ou les deux.
 * Renommer déplace la fiche dans l'index par clé — les deux index doivent
 * rester d'accord, sans quoi l'unicité qu'ils portent ne veut plus rien dire.
 * Un renommage qui percuterait une autre fiche lève, comme le ferait le UNIQUE
 * de db.js.
 */
function updateLearner(id, patch) {
  const learner = learners.get(id);
  if (!learner) return null;

  if ('displayName' in patch) {
    const displayName = String(patch.displayName ?? '').trim();
    const key = nameKey(displayName);
    const holder = learnersByKey.get(key);
    if (holder !== undefined && holder !== id) throw duplicateError(learners.get(holder));

    learnersByKey.delete(learner.nameKey);
    learner.displayName = displayName;
    learner.nameKey = key;
    learnersByKey.set(key, id);
  }

  if ('suggestible' in patch) learner.suggestible = Boolean(patch.suggestible);

  return toLearner(learner);
}

function getLearner(id) {
  return toLearner(learners.get(id));
}

/**
 * L'annuaire avec, pour chacun, son activité sur la période demandée.
 * Équivaut au LEFT JOIN ... GROUP BY de db.js : un apprenant sans aucune
 * participation reste dans la liste, avec attempts à 0 — c'est même souvent lui
 * que le formateur cherche.
 *
 * MOYENNE = moyenne des pourcentages, chaque évaluation comptant pareil, et non
 * somme des scores sur somme des totaux : un QCM de 5 questions pèse autant
 * qu'un QCM de 30. Les flottants sortent BRUTS, l'arrondi se fait une seule
 * fois, dans index.js, à la sérialisation.
 */
function listLearners({ from = null, to = null } = {}) {
  const stats = new Map(); // learnerId -> agrégats sur la fenêtre

  for (const { entry } of allEntries()) {
    if (!entry.learnerId) continue;
    if (!inWindow(entry.submittedAt, from, to)) continue;

    let s = stats.get(entry.learnerId);
    if (!s) {
      s = { attempts: 0, sum: 0, counted: 0, last: null };
      stats.set(entry.learnerId, s);
    }
    // COUNT(r.id) compte toutes les lignes jointes…
    s.attempts += 1;
    // …là où AVG(score * 100.0 / total) ignore les divisions par zéro, que
    // SQLite rend NULL et qu'une moyenne saute.
    if (entry.total > 0) {
      s.sum += (entry.score * 100) / entry.total;
      s.counted += 1;
    }
    if (s.last === null || entry.submittedAt > s.last) s.last = entry.submittedAt;
  }

  return [...learners.values()]
    .sort((a, b) => compareKeys(a.nameKey, b.nameKey))
    .map((l) => {
      const s = stats.get(l.id);
      return {
        id: l.id,
        displayName: l.displayName,
        createdAt: l.createdAt,
        createdBy: l.createdBy,
        suggestible: Boolean(l.suggestible),
        pharmacyId: l.pharmacyId ?? null,
        // L'officine ACTUELLE de la fiche, indépendante de la période :
        // même équivalence que le LEFT JOIN pharmacies de db.js.
        pharmacyName: l.pharmacyId ? (pharmacies.get(l.pharmacyId)?.displayName ?? null) : null,
        attempts: s ? s.attempts : 0,
        // AVG sur zéro ligne rend NULL en SQL : ici null, jamais 0 — qui se
        // lirait « il a eu zéro » — et jamais NaN.
        avgPercent: s && s.counted > 0 ? s.sum / s.counted : null,
        lastSubmittedAt: s ? s.last : null,
      };
    });
}

/**
 * Le détail des participations d'un apprenant sur la période, la plus récente
 * d'abord — c'est la dernière note que le formateur regarde en premier.
 * playerName est celui SAISI ce jour-là, pas le nom de la fiche : si les deux
 * diffèrent, c'est justement ce qu'il faut voir.
 */
function listLearnerHistory(learnerId, { from = null, to = null } = {}) {
  if (!learnerId) return [];

  const rows = [];
  for (const { quizId, entry } of allEntries()) {
    if (entry.learnerId !== learnerId) continue;
    if (!inWindow(entry.submittedAt, from, to)) continue;
    const quiz = quizzes.get(quizId);
    rows.push({
      resultId: entry.id,
      quizId,
      quizTitle: quiz ? quiz.title : null,
      playerName: entry.playerName,
      pharmacyName: entry.pharmacyName ?? null,
      score: entry.score,
      total: entry.total,
      submittedAt: entry.submittedAt,
    });
  }

  // Deux envois dans la même milliseconde : l'ordre d'insertion tranche.
  // Du plus ANCIEN au plus recent, comme db.js (ORDER BY submitted_at ASC,
  // id ASC) : c'est l'ordre d'une progression, et celui que sert l'index
  // idx_results_learner_date sans tri temporaire. Un ordre different entre
  // les deux stores tracerait la courbe a l'envers selon le store actif.
  rows.sort((a, b) => compareKeys(a.submittedAt, b.submittedAt) || a.resultId - b.resultId);
  return rows;
}

/**
 * La participation d'un apprenant à un quiz donné, par sa fiche et non par son
 * nom : c'est ce qui permet de reconnaître quelqu'un qui a tapé son nom
 * autrement. Projette comme toutes les autres lectures de participation.
 */
function findResultByLearner(quizId, learnerId) {
  // `learner_id = NULL` ne matche rien en SQL ; sans ce garde-fou, on
  // rapprocherait ici toutes les participations sans fiche.
  if (!learnerId) return null;
  const found = (results.get(quizId) || []).find((r) => r.learnerId === learnerId);
  return found ? toResult(found) : null;
}

/**
 * Fusion de deux fiches créées pour la même personne (« Awa » et « Awa K. ») :
 * les participations passent sous la fiche cible, puis la fiche source
 * disparaît. Les deux index sont nettoyés ensemble.
 *
 * Refuse les deux cas dégénérés que la clé étrangère de db.js interdirait :
 * une cible inexistante, et une fusion sur soi-même qui supprimerait la fiche
 * juste après y avoir rattaché ses propres résultats.
 */
function mergeLearners(sourceId, intoId) {
  if (!sourceId || !intoId || sourceId === intoId) return { moved: 0 };
  const source = learners.get(sourceId);
  if (!source || !learners.has(intoId)) return { moved: 0 };

  let moved = 0;
  for (const { entry } of allEntries()) {
    if (entry.learnerId !== sourceId) continue;
    entry.learnerId = intoId;
    moved += 1;
  }

  learnersByKey.delete(source.nameKey);
  learners.delete(sourceId);
  return { moved };
}

/**
 * Les groupes de fiches qui désignent PROBABLEMENT la même personne.
 * Même sortie que db.js — c'est similarite.js qui décide, ici comme là-bas ;
 * seul le rassemblement des compteurs diffère.
 */
function listDuplicateCandidates() {
  const compte = new Map();
  const dernier = new Map();
  for (const { entry } of allEntries()) {
    if (!entry.learnerId) continue;
    compte.set(entry.learnerId, (compte.get(entry.learnerId) || 0) + 1);
    const precedent = dernier.get(entry.learnerId);
    if (!precedent || String(entry.submittedAt) > String(precedent)) {
      dernier.set(entry.learnerId, entry.submittedAt);
    }
  }
  return groupesProbables(
    [...learners.values()]
      // Même ordre d'entrée que le ORDER BY name_key de db.js : les deux
      // stores doivent produire des groupes identiques, membres compris.
      .sort((a, b) => compareKeys(a.nameKey, b.nameKey))
      .map((l) => ({
        id: l.id,
        displayName: l.displayName,
        nameKey: l.nameKey,
        createdBy: l.createdBy,
        suggestible: Boolean(l.suggestible),
        attempts: compte.get(l.id) || 0,
        lastSubmittedAt: dernier.get(l.id) || null,
      }))
  );
}

// ---------------------------------------------------------------------------
// Annuaire des officines — copie fonctionnelle du bloc apprenants ci-dessus.
// ---------------------------------------------------------------------------

/** Copie défensive d'une fiche d'officine. Mêmes champs que toLearner, sans pharmacyId. */
function toPharmacy(pharmacy) {
  if (!pharmacy) return null;
  return {
    id: pharmacy.id,
    displayName: pharmacy.displayName,
    nameKey: pharmacy.nameKey,
    createdAt: pharmacy.createdAt,
    createdBy: pharmacy.createdBy,
    suggestible: Boolean(pharmacy.suggestible),
  };
}

function duplicatePharmacyError(existing) {
  const err = new Error(`Une officine nommée « ${existing.displayName} » existe déjà.`);
  err.code = 'DUPLICATE';
  err.pharmacy = toPharmacy(existing);
  return err;
}

function insertPharmacy(displayName, key, createdBy) {
  const pharmacy = {
    id: newId(),
    displayName,
    nameKey: key,
    createdAt: new Date().toISOString(),
    createdBy,
    suggestible: true,
  };
  pharmacies.set(pharmacy.id, pharmacy);
  pharmaciesByKey.set(key, pharmacy.id);
  return toPharmacy(pharmacy);
}

/** Copie de suggestLearners. */
function suggestPharmacies(prefixKey, limit) {
  const prefix = String(prefixKey ?? '');
  if (!prefix) return [];

  const max = Number.isInteger(limit) && limit > 0 ? limit : 8;

  const proposables = [...pharmacies.values()]
    .filter((p) => p.suggestible)
    .sort((a, b) => compareKeys(a.nameKey, b.nameKey));

  const enTete = proposables.filter((p) => p.nameKey.startsWith(prefix));
  const enMilieu = proposables.filter(
    (p) => !p.nameKey.startsWith(prefix) && suffixesInternes(p.nameKey).some((s) => s.startsWith(prefix))
  );

  return fusionnerSuggestions(
    enTete.slice(0, max).map((p) => p.displayName),
    enMilieu.slice(0, max).map((p) => p.displayName),
    max
  );
}

/** Copie de resolveLearner. */
function resolvePharmacy(name) {
  const id = pharmaciesByKey.get(nameKey(name));
  return id === undefined ? null : toPharmacy(pharmacies.get(id));
}

/** Copie de ensureLearner. */
function ensurePharmacy(name) {
  const displayName = String(name ?? '').trim();
  const key = nameKey(displayName);

  if (pharmaciesByKey.has(key)) {
    const pharmacy = pharmacies.get(pharmaciesByKey.get(key));
    if (!pharmacy.suggestible) pharmacy.suggestible = true;
    return { pharmacy: toPharmacy(pharmacy), created: false };
  }

  return { pharmacy: insertPharmacy(displayName, key, 'learner'), created: true };
}

/** Copie de createLearner. */
function createPharmacy(displayName) {
  const name = String(displayName ?? '').trim();
  const key = nameKey(name);

  if (pharmaciesByKey.has(key)) throw duplicatePharmacyError(pharmacies.get(pharmaciesByKey.get(key)));

  return { pharmacy: insertPharmacy(name, key, 'trainer') };
}

/** Copie de updateLearner. */
function updatePharmacy(id, patch) {
  const pharmacy = pharmacies.get(id);
  if (!pharmacy) return null;

  if ('displayName' in patch) {
    const displayName = String(patch.displayName ?? '').trim();
    const key = nameKey(displayName);
    const holder = pharmaciesByKey.get(key);
    if (holder !== undefined && holder !== id) throw duplicatePharmacyError(pharmacies.get(holder));

    pharmaciesByKey.delete(pharmacy.nameKey);
    pharmacy.displayName = displayName;
    pharmacy.nameKey = key;
    pharmaciesByKey.set(key, id);
  }

  if ('suggestible' in patch) pharmacy.suggestible = Boolean(patch.suggestible);

  return toPharmacy(pharmacy);
}

function getPharmacy(id) {
  return toPharmacy(pharmacies.get(id));
}

/** attempts = nombre d'APPRENANTS rattachés, comme le COUNT(l.id) de db.js. */
function listPharmacies() {
  const compte = new Map();
  for (const l of learners.values()) {
    if (!l.pharmacyId) continue;
    compte.set(l.pharmacyId, (compte.get(l.pharmacyId) || 0) + 1);
  }
  return [...pharmacies.values()]
    .sort((a, b) => compareKeys(a.nameKey, b.nameKey))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      createdAt: p.createdAt,
      createdBy: p.createdBy,
      suggestible: Boolean(p.suggestible),
      attempts: compte.get(p.id) || 0,
    }));
}

/**
 * Fusionne deux fiches d'officine : déplace les apprenants ET les résultats
 * rattachés, jamais results.pharmacyName (la graphie figée du jour).
 */
function mergePharmacies(sourceId, intoId) {
  if (!sourceId || !intoId || sourceId === intoId) return { movedLearners: 0, movedResults: 0 };
  const source = pharmacies.get(sourceId);
  if (!source || !pharmacies.has(intoId)) return { movedLearners: 0, movedResults: 0 };

  let movedLearners = 0;
  for (const l of learners.values()) {
    if (l.pharmacyId !== sourceId) continue;
    l.pharmacyId = intoId;
    movedLearners += 1;
  }

  let movedResults = 0;
  for (const { entry } of allEntries()) {
    if (entry.pharmacyId !== sourceId) continue;
    entry.pharmacyId = intoId;
    movedResults += 1;
  }

  pharmaciesByKey.delete(source.nameKey);
  pharmacies.delete(sourceId);
  return { movedLearners, movedResults };
}

/** Copie de listDuplicateCandidates, avec les mots vides d'officine injectés. */
function listDuplicatePharmacyCandidates() {
  const compte = new Map();
  for (const l of learners.values()) {
    if (!l.pharmacyId) continue;
    compte.set(l.pharmacyId, (compte.get(l.pharmacyId) || 0) + 1);
  }
  return groupesProbables(
    [...pharmacies.values()]
      .sort((a, b) => compareKeys(a.nameKey, b.nameKey))
      .map((p) => ({
        id: p.id,
        displayName: p.displayName,
        nameKey: p.nameKey,
        createdBy: p.createdBy,
        suggestible: Boolean(p.suggestible),
        attempts: compte.get(p.id) || 0,
      })),
    { motsVides: MOTS_VIDES_OFFICINE }
  );
}

/** Affecte (ou retire, avec null) l'officine actuelle d'un apprenant. */
function setLearnerPharmacy(learnerId, pharmacyId) {
  const learner = learners.get(learnerId);
  if (!learner) return null;
  learner.pharmacyId = pharmacyId ?? null;
  return toLearner(learner);
}

/**
 * Les participations des apprenants d'une officine, sur la période, de la
 * plus ancienne à la plus récente — analogue de listLearnerHistory, mais à
 * cheval sur plusieurs apprenants et plusieurs quiz. Filtre sur
 * entry.pharmacyId, la graphie FIGÉE de la participation, jamais sur
 * l'officine actuelle de la fiche.
 */
function listPharmacyHistory(pharmacyId, { from = null, to = null } = {}) {
  if (!pharmacyId) return [];

  const rows = [];
  for (const { quizId, entry } of allEntries()) {
    if (entry.pharmacyId !== pharmacyId) continue;
    if (!inWindow(entry.submittedAt, from, to)) continue;
    const quiz = quizzes.get(quizId);
    rows.push({
      resultId: entry.id,
      quizId,
      quizTitle: quiz ? quiz.title : null,
      playerName: entry.playerName,
      score: entry.score,
      total: entry.total,
      submittedAt: entry.submittedAt,
    });
  }

  // Même ordre que db.js (ORDER BY submitted_at ASC, id ASC) : voir
  // listLearnerHistory ci-dessus, même raison.
  rows.sort((a, b) => compareKeys(a.submittedAt, b.submittedAt) || a.resultId - b.resultId);
  return rows;
}

/**
 * Équivalent mémoire de la requête à quatre sous-requêtes de db.js. Même
 * contrat : avgPercent sort null (jamais 0 ni NaN) quand aucune participation
 * n'a de total > 0, exactement comme listLearners plus haut.
 */
function getDashboardStats() {
  let totalResponses = 0;
  let sum = 0;
  let counted = 0;
  for (const { entry } of allEntries()) {
    totalResponses += 1;
    if (entry.total > 0) {
      sum += (entry.score * 100) / entry.total;
      counted += 1;
    }
  }

  const officinesActives = new Set();
  for (const l of learners.values()) {
    if (l.pharmacyId) officinesActives.add(l.pharmacyId);
  }

  return {
    avgPercent: counted > 0 ? sum / counted : null,
    totalResponses,
    totalLearners: learners.size,
    activePharmacies: officinesActives.size,
  };
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
  // 22e fonction, au MÊME RANG que dans db.js. Le test de parité échoue si
  // l'une des deux listes bouge sans l'autre.
  listDuplicateCandidates,
  listQuestionStats,
  listResultAnswers,
  // 25e à 34e : l'annuaire des officines, au MÊME RANG que dans db.js.
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
  // 35e fonction, au MÊME RANG que dans db.js.
  listPharmacyHistory,
  // 36e fonction, au MÊME RANG que dans db.js.
  getDashboardStats,
};
