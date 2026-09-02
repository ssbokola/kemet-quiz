const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
// Load .env in dev, Railway injects env vars directly in prod
const envPath = path.join(__dirname, '..', '..', '.env');
try { require('dotenv').config({ path: envPath, override: true }); } catch {};

const cors = require('cors');
const { nameKey } = require('./name-key');
const { parsePeriode } = require('./periode');

// Si le stockage SQLite refuse de se charger (runtime sans node:sqlite), on
// bascule sur un store en mémoire plutôt que de laisser mourir le serveur :
// mieux vaut un site debout sans persistance qu'un site inaccessible.
//
// UNE SEULE EXCEPTION : une migration ratée. Le repli est fait pour un runtime
// incapable de charger node:sqlite, pas pour une base qui existe et qu'on n'a
// pas su faire évoluer. Sans cette distinction, un ALTER TABLE en échec ferait
// basculer la production en mémoire — le serveur répondrait, les quiz seraient
// créables, et tout serait perdu au redémarrage suivant, sans un bruit. On
// meurt bruyamment : c'est la panne la plus réparable des deux.
let store;
try {
  store = require('./db');
} catch (err) {
  if (err.code === 'MIGRATION_FAILED') throw err;
  console.error('SQLite indisponible — bascule en mémoire, données NON persistées.');
  console.error(`  cause : ${err.message}`);
  store = require('./db-memory');
}

// Sauvegardes périodiques du fichier SQLite (server/src/sauvegarde.js).
// Seulement si le store persiste réellement : le store en mémoire n'a aucun
// fichier à sauvegarder, VACUUM INTO échouerait sur son DB_PATH factice.
if (!store.isEphemeral && store.DB_PATH) {
  try {
    require('./sauvegarde').demarrerSauvegardesAutomatiques({ dbPath: store.DB_PATH });
  } catch (err) {
    // Une sauvegarde qui ne démarre pas n'est pas une raison d'arrêter le
    // site — même logique que le repli sur le store en mémoire ci-dessus.
    console.error('Sauvegardes automatiques non démarrées :', err.message);
  }
}

const app = express();
// 1 et NON true. `true` fait confiance à toute la chaîne X-Forwarded-For, donc
// à l'en-tête que le client écrit lui-même : n'importe qui pourrait se donner
// une IP neuve à chaque requête et pulvériser la limitation de débit de la
// route publique de suggestions. `1` ne fait confiance qu'au dernier relais —
// celui de l'hébergeur, le seul que nous contrôlons.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Espace formateur protégé par un mot de passe partagé (ADMIN_PASSWORD).
// Sans variable d'environnement définie, l'accès reste ouvert (dev).
function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const given = req.get('x-admin-password') || (req.body && req.body.password);
  if (given !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  next();
}

app.use(cors());
app.use(express.json());

// Serve client build in production
const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientBuild));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024, // allow large `text` field (extracted PDF text)
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'));
    }
  },
});

// Modèle Claude, en un seul endroit. `claude-sonnet-4-20250514` ne répondait plus
// (404 not_found_error) et TOUS les quiz partaient donc en silence chez Gemini,
// le repli masquant la panne. Voir HANDOFF.md §5.
const MODEL = 'claude-sonnet-5';
// Profondeur de raisonnement : « medium » est l'équilibre coût / qualité.
const EFFORT = 'medium';

const DIFFICULTY_GUIDANCE = {
  facile: "Niveau FACILE : les questions doivent être basiques et rappeler des faits explicitement présents dans le document. Distracteurs franchement différents de la bonne réponse.",
  moyen: "Niveau MOYEN : mélange équilibré de questions factuelles et de questions de compréhension nécessitant de relier plusieurs éléments du document. Distracteurs plausibles mais discernables.",
  difficile: "Niveau DIFFICILE : les questions doivent nécessiter une réflexion approfondie, des cas d'application, ou nuancer des concepts proches. Distracteurs très plausibles qui ciblent les erreurs typiques.",
};

function getQuizPrompt(numQuestions, difficulty = 'moyen') {
  const level = DIFFICULTY_GUIDANCE[difficulty] || DIFFICULTY_GUIDANCE.moyen;
  return `Tu es un générateur de quiz pédagogique. À partir du contenu de ce document, génère exactement ${numQuestions} questions à choix multiple (MCQ). Chaque question a 4 options (A, B, C, D) et une seule bonne réponse. Ajoute pour chaque question une courte explication (1 à 2 phrases max) qui justifie la bonne réponse en s'appuyant sur le contenu du document.

${level}

Réponds UNIQUEMENT en JSON valide avec ce format : {"questions": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "explanation": "..."}]}`;
}

// Claude (primary) — streaming to keep the HTTP connection alive
// `source` is either { type: 'pdf', base64 } or { type: 'text', text }
async function generateWithClaude(source, numQuestions, difficulty, onProgress) {
  const prompt = getQuizPrompt(numQuestions, difficulty);
  const anthropic = new Anthropic();

  const userContent = source.type === 'pdf'
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.base64 } },
        { type: 'text', text: `Génère un quiz de ${numQuestions} questions MCQ à partir de ce document PDF.` },
      ]
    : [
        { type: 'text', text: `Voici le contenu du document de formation :\n\n${source.text}\n\nGénère un quiz de ${numQuestions} questions MCQ à partir de ce contenu.` },
      ];

  const stream = anthropic.messages.stream({
    model: MODEL,
    // Le raisonnement est actif par défaut sur ce modèle et consomme le même
    // budget que la réponse : d'où des plafonds larges. Ce n'est qu'un plafond,
    // seuls les tokens réellement produits sont facturés.
    max_tokens: numQuestions > 15 ? 32000 : 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: prompt,
    messages: [{ role: 'user', content: userContent }],
  });

  let fullText = '';
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      if (onProgress) onProgress();
    }
  }
  return fullText;
}

// Gemini (fallback)
async function generateWithGemini(source, numQuestions, difficulty) {
  const prompt = getQuizPrompt(numQuestions, difficulty);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];

  const content = source.type === 'pdf'
    ? [
        { inlineData: { mimeType: 'application/pdf', data: source.base64 } },
        { text: prompt + `\nGénère un quiz de ${numQuestions} questions MCQ à partir de ce document PDF.` },
      ]
    : [
        { text: prompt + `\n\nVoici le contenu du document :\n\n${source.text}\n\nGénère un quiz de ${numQuestions} questions MCQ à partir de ce contenu.` },
      ];

  for (const modelName of models) {
    try {
      console.log(`Gemini fallback: trying ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(content);
      console.log(`Success with Gemini ${modelName}`);
      return result.response.text();
    } catch (err) {
      console.warn(`Gemini ${modelName} failed: ${err.message}`);
    }
  }
  throw new Error('Tous les modèles Gemini ont échoué');
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * Contrôle la sortie du modèle AVANT de créer le quiz : une question sans
 * bonne réponse valide ou avec moins de 2 options casse l'écran du participant.
 * Renvoie { questions, dropped }.
 */
function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) throw new Error('Le modèle n’a pas renvoyé de liste de questions');

  const questions = [];
  let dropped = 0;

  for (const item of raw) {
    if (!item || typeof item.question !== 'string' || !item.question.trim()) {
      dropped++;
      continue;
    }

    const options = (Array.isArray(item.options) ? item.options : [])
      .map((o) => String(o == null ? '' : o).replace(/^[A-F]\)\s*/i, '').trim())
      .filter(Boolean)
      .slice(0, 6);

    if (options.length < 2) {
      dropped++;
      continue;
    }

    // La réponse peut arriver en lettre ("B"), en texte, ou en index (1-based)
    let answer = null;
    const rawAnswer = item.answer == null ? '' : String(item.answer).trim();
    const asLetter = rawAnswer.toUpperCase().replace(/[^A-F]/g, '').charAt(0);

    if (asLetter && LETTERS.indexOf(asLetter) > -1 && LETTERS.indexOf(asLetter) < options.length) {
      answer = asLetter;
    } else if (/^[1-6]$/.test(rawAnswer) && Number(rawAnswer) <= options.length) {
      answer = LETTERS[Number(rawAnswer) - 1];
    } else {
      const match = options.findIndex(
        (o) => o.toLowerCase() === rawAnswer.replace(/^[A-F]\)\s*/i, '').trim().toLowerCase()
      );
      if (match > -1) answer = LETTERS[match];
    }

    if (!answer) {
      dropped++;
      continue;
    }

    questions.push({
      question: item.question.trim(),
      options: options.map((o, i) => `${LETTERS[i]}) ${o}`),
      answer,
      explanation:
        typeof item.explanation === 'string' && item.explanation.trim()
          ? item.explanation.trim()
          : null,
    });
  }

  if (questions.length === 0) {
    throw new Error('Aucune question exploitable n’a été produite — relancez la génération');
  }

  return { questions, dropped };
}

function quizAvailability(quiz) {
  if (quiz.closed) return { ok: false, status: 410, error: 'Ce quiz a été fermé par le formateur' };
  if (quiz.expiresAt && new Date(quiz.expiresAt).getTime() < Date.now()) {
    return { ok: false, status: 410, error: 'Ce quiz a expiré' };
  }
  return { ok: true };
}

// Formateur : vérification du mot de passe
app.post('/api/admin/check', (req, res) => {
  if (!ADMIN_PASSWORD) return res.json({ ok: true, open: true });
  const given = req.get('x-admin-password') || (req.body && req.body.password);
  if (given !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Mot de passe incorrect' });
  res.json({ ok: true, open: false });
});

// Admin: upload PDF (or extracted text) → generate quiz → stream progress (NDJSON)
app.post('/api/upload-pdf', requireAdmin, upload.single('pdf'), async (req, res) => {
  // NDJSON streaming response — keeps the proxy connection alive
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => {
    res.write(JSON.stringify(obj) + '\n');
  };

  // Heartbeat every 10s to prevent proxy timeout
  const heartbeat = setInterval(() => send({ type: 'ping' }), 10000);

  try {
    const numQuestions = parseInt(req.body.numQuestions) || 10;
    const difficulty = req.body.difficulty || 'moyen';
    const textPayload = req.body.text;

    // Build source: prefer extracted text (fast path), fall back to PDF binary
    let source;
    if (textPayload && textPayload.length > 200) {
      source = { type: 'text', text: textPayload };
      console.log(`Generating quiz from text (${textPayload.length} chars, ${numQuestions} questions)...`);
    } else if (req.file) {
      source = { type: 'pdf', base64: req.file.buffer.toString('base64') };
      console.log(`Generating quiz from PDF binary (${req.file.size} bytes, ${numQuestions} questions)...`);
    } else {
      send({ type: 'error', error: 'Aucun document fourni' });
      return;
    }

    let responseText;
    send({ type: 'progress', message: `Génération du quiz (${numQuestions} questions, niveau ${difficulty})...` });

    try {
      console.log('Trying Claude (primary)...');
      responseText = await generateWithClaude(source, numQuestions, difficulty, () => {});
      console.log('Success with Claude');
    } catch (claudeErr) {
      console.warn(`Claude failed: ${claudeErr.message}`);
      console.log('Falling back to Gemini...');
      send({ type: 'progress', message: 'Bascule sur le modèle de secours...' });
      responseText = await generateWithGemini(source, numQuestions, difficulty);
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      send({ type: 'error', error: 'Réponse IA invalide' });
      return;
    }

    const parsedQuiz = JSON.parse(jsonMatch[0]);

    let normalized;
    try {
      normalized = normalizeQuestions(parsedQuiz.questions);
    } catch (validationErr) {
      send({ type: 'error', error: validationErr.message });
      return;
    }

    const quizId = crypto.randomBytes(4).toString('hex');
    const fallbackTitle = req.file ? req.file.originalname.replace(/\.pdf$/i, '') : 'Quiz';
    const title = req.body.title || fallbackTitle;

    const expiresInHours = parseInt(req.body.expiresInHours, 10);
    const singleAttempt = req.body.singleAttempt !== 'false';

    store.createQuiz(quizId, {
      title,
      questions: normalized.questions,
      createdAt: new Date().toISOString(),
      // conservé pour permettre la régénération d'une question isolée
      sourceText: source.type === 'text' ? source.text.slice(0, 60000) : null,
      difficulty,
      closed: false,
      singleAttempt,
      expiresAt:
        Number.isFinite(expiresInHours) && expiresInHours > 0
          ? new Date(Date.now() + expiresInHours * 3600 * 1000).toISOString()
          : null,
    });

    if (normalized.dropped) {
      console.warn(`Quiz ${quizId}: ${normalized.dropped} question(s) invalide(s) écartée(s)`);
    }
    console.log(`Quiz created: ${quizId} (${normalized.questions.length} questions)`);
    send({
      type: 'done',
      quizId,
      title,
      questionsCount: normalized.questions.length,
      dropped: normalized.dropped,
    });
  } catch (err) {
    console.error('Erreur /api/upload-pdf:', err.message);
    send({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Admin: full quiz (with answers) — écran de relecture avant partage
app.get('/api/quiz/:id/full', requireAdmin, (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz introuvable' });
  res.json({
    title: quiz.title,
    questions: quiz.questions,
    closed: quiz.closed,
    expiresAt: quiz.expiresAt,
    singleAttempt: quiz.singleAttempt,
    resultsCount: store.countResults(req.params.id),
  });
});

// Admin: enregistrer les corrections du formateur
app.patch('/api/quiz/:id', requireAdmin, (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz introuvable' });

  const { title, questions, closed, expiresInHours, singleAttempt } = req.body;
  const patch = {};

  if (questions !== undefined) {
    try {
      const normalized = normalizeQuestions(questions);
      patch.questions = normalized.questions;
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (typeof title === 'string' && title.trim()) patch.title = title.trim();
  if (typeof closed === 'boolean') patch.closed = closed;
  if (typeof singleAttempt === 'boolean') patch.singleAttempt = singleAttempt;
  if (expiresInHours !== undefined) {
    const hours = parseInt(expiresInHours, 10);
    patch.expiresAt =
      Number.isFinite(hours) && hours > 0
        ? new Date(Date.now() + hours * 3600 * 1000).toISOString()
        : null;
  }

  store.updateQuiz(req.params.id, patch);
  Object.assign(quiz, patch);

  console.log(`Quiz ${req.params.id} mis à jour (${quiz.questions.length} questions)`);
  res.json({
    title: quiz.title,
    questionsCount: quiz.questions.length,
    closed: quiz.closed,
    expiresAt: quiz.expiresAt,
    singleAttempt: quiz.singleAttempt,
  });
});

// Admin: régénérer UNE question à partir du document d'origine
app.post('/api/quiz/:id/regenerate/:index', requireAdmin, async (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz introuvable' });

  const index = parseInt(req.params.index, 10);
  if (Number.isNaN(index) || index < 0 || index >= quiz.questions.length) {
    return res.status(400).json({ error: 'Question inexistante' });
  }
  if (!quiz.sourceText) {
    return res
      .status(400)
      .json({ error: 'Régénération indisponible pour un PDF scanné — modifiez la question à la main' });
  }

  const others = quiz.questions
    .filter((_, i) => i !== index)
    .map((q) => q.question)
    .join('\n- ');

  const instruction = `Voici le contenu d'un document de formation :\n\n${quiz.sourceText}\n\nRédige UNE seule question à choix multiple (4 options A à D, une seule bonne réponse) différente de celles déjà posées :\n- ${others}\n\nRéponds UNIQUEMENT en JSON valide : {"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A", "explanation": "..."}`;

  try {
    let text;
    try {
      const anthropic = new Anthropic();
      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8192,
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT },
        system: DIFFICULTY_GUIDANCE[quiz.difficulty] || DIFFICULTY_GUIDANCE.moyen,
        messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
      });
      // Ne concaténer que les blocs de texte : les blocs de raisonnement
      // n'ont pas de champ `text` et ne doivent pas polluer le JSON attendu.
      text = msg.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    } catch (claudeErr) {
      console.warn(`Claude regenerate failed: ${claudeErr.message} — fallback Gemini`);
      text = await generateWithGemini(
        { type: 'text', text: instruction },
        1,
        quiz.difficulty || 'moyen'
      );
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Réponse IA invalide' });

    const parsed = JSON.parse(match[0]);
    const candidate = parsed.questions ? parsed.questions[0] : parsed;

    let normalized;
    try {
      normalized = normalizeQuestions([candidate]);
    } catch {
      return res.status(502).json({ error: 'Question générée inexploitable, réessayez' });
    }

    quiz.questions[index] = normalized.questions[0];
    store.updateQuiz(req.params.id, { questions: quiz.questions });
    console.log(`Quiz ${req.params.id} — question ${index + 1} régénérée`);
    res.json({ question: normalized.questions[0] });
  } catch (err) {
    console.error('Erreur régénération:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Learner: get quiz by ID (questions without answers)
app.get('/api/quiz/:id', (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  const availability = quizAvailability(quiz);
  if (!availability.ok) {
    return res.status(availability.status).json({ error: availability.error });
  }

  const safeQuestions = quiz.questions.map((q) => ({
    question: q.question,
    options: q.options,
  }));

  res.json({
    title: quiz.title,
    questions: safeQuestions,
    singleAttempt: quiz.singleAttempt !== false,
    expiresAt: quiz.expiresAt || null,
  });
});

// Learner: submit answers
app.post('/api/quiz/:id/submit', (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  const { playerName, pharmacyName, answers } = req.body;
  if (!playerName || !answers) {
    return res.status(400).json({ error: 'Nom et réponses requis' });
  }

  // La garde ci-dessus laisse passer «    » : une chaîne d'espaces est
  // parfaitement « truthy ». Avant l'annuaire, cela ne produisait qu'une ligne de
  // résultat au nom vide ; désormais cela ferait NAÎTRE une fiche à name_key vide,
  // qui adopterait ensuite toutes les saisies vides suivantes — une personne
  // fictive, cumulant les notes de plusieurs vrais apprenants. On resserre ici, au
  // seul endroit où une fiche peut naître côté public.
  const nomSaisi = String(playerName).trim();
  if (!nameKey(nomSaisi)) {
    return res.status(400).json({ error: 'Entrez votre nom pour envoyer vos réponses' });
  }

  const availability = quizAvailability(quiz);
  if (!availability.ok) {
    return res.status(availability.status).json({ error: availability.error });
  }

  // Fiche déjà connue sous ce nom, ou null. resolveLearner ne crée JAMAIS rien :
  // la création se fait plus bas, une fois la copie acceptée.
  const existante = store.resolveLearner(nomSaisi);

  // Tentative unique : on refuse un second envoi sous le même prénom
  if (quiz.singleAttempt !== false) {
    // Double contrôle volontaire. Par fiche d'abord : c'est la seule voie qui
    // reconnaisse quelqu'un renommé depuis sa participation. Par clé de nom
    // ensuite : elle rattrape les lignes antérieures à l'annuaire restées à
    // learner_id NULL si la reprise n'a pas encore tourné. Deux points lookups
    // indexés, le coût est nul.
    const previous =
      (existante && store.findResultByLearner(req.params.id, existante.id)) ||
      store.findResultByName(req.params.id, nomSaisi);
    if (previous) {
      return res.status(409).json({
        error: `Une réponse a déjà été enregistrée pour ${previous.playerName} (${previous.score}/${previous.total}). Ce quiz n’autorise qu’une tentative.`,
        alreadyAnswered: true,
        score: previous.score,
        total: previous.total,
        submittedAt: previous.submittedAt,
      });
    }
  }

  let score = 0;
  const correction = quiz.questions.map((q, i) => {
    const isCorrect = answers[i] === q.answer;
    if (isCorrect) score++;
    return {
      question: q.question,
      options: q.options,
      userAnswer: answers[i],
      correctAnswer: q.answer,
      isCorrect,
      explanation: q.explanation || null,
    };
  });

  // Cette correction était calculée, envoyée à l'apprenant, puis JETÉE. Le
  // formateur savait qu'Aya avait fait 3/5, jamais sur quoi elle s'était
  // trompée — et ne pouvait donc pas répondre à la question la plus utile de
  // cet outil : quelle question est ratée par tout le monde ?
  // Rien n'est recalculé ici, on cesse simplement de jeter.
  //
  // L'énoncé est FIGÉ maintenant, comme playerName l'est déjà : les questions
  // restent modifiables ensuite, et une statistique sur un énoncé qui a changé
  // ne voudrait rien dire.
  // ⚠️ Les réponses sont des LETTRES ('A'..'F'), pas des index — c'est ce que
  // normalizeQuestions produit et ce que Quiz.jsx envoie. Les traiter comme des
  // entiers viderait tout le détail en silence.
  const libelle = (q, lettre) => {
    const i = LETTERS.indexOf(lettre);
    return i > -1 && q.options[i] !== undefined ? q.options[i] : null;
  };
  const detail = quiz.questions.map((q, i) => ({
    questionIndex: i,
    questionText: q.question,
    // Une question sautée vaut null : « pas répondu » et « mauvaise réponse »
    // sont deux informations différentes pour le formateur.
    given: typeof answers[i] === 'string' && answers[i] ? answers[i] : null,
    givenLabel: libelle(q, answers[i]),
    correctAnswer: q.answer,
    // correct_label est NOT NULL en base : on se replie sur la lettre plutôt
    // que de faire échouer TOUT l'envoi si une option venait à manquer.
    // normalizeQuestions garantit déjà que la lettre est dans les bornes, ce
    // repli ne devrait jamais servir — c'est précisément pour ça qu'il est là.
    correctLabel: libelle(q, q.answer) ?? q.answer,
    isCorrect: answers[i] === q.answer,
  }));

  // Seule porte de création d'une fiche côté apprenant, et par EFFET DE BORD de
  // l'envoi des réponses : il n'existe aucune route publique dédiée qu'un curieux
  // pourrait marteler pour peupler ou sonder l'annuaire. Une fiche déjà là est
  // adoptée, et si elle dormait en quarantaine (import), elle est promue.
  const { learner: fiche } = store.ensureLearner(nomSaisi);

  // L'officine est FACULTATIVE ici, côté serveur — l'obligation vit côté client
  // (règle « aucun appel réseau ne précède le début du quiz »). Une session en
  // vol au moment d'un déploiement n'a pas ce champ dans sa reprise depuis
  // localStorage ; lui opposer un 400 enfermerait l'apprenant avec ses réponses
  // et aucune porte de sortie. Absente ou vide → tout reste à null, exactement
  // comme avant l'existence de cette colonne.
  //
  // Même garde-fou que pour le nom : une chaîne de ponctuation pure donnerait
  // une clé vide, qui capterait ensuite toute saisie vide suivante.
  const officineSaisie = String(pharmacyName || '').trim();
  let pharmacyId = null;
  let pharmacyNameFigee = null;
  if (nameKey(officineSaisie)) {
    const { pharmacy } = store.ensurePharmacy(officineSaisie);
    pharmacyId = pharmacy.id;
    // pharmacy_name est la graphie TAPÉE ce jour-là, pas pharmacy.displayName :
    // même doctrine que player_name, qui n'est pas non plus fiche.displayName.
    pharmacyNameFigee = officineSaisie;
    // L'officine ACTUELLE de la fiche suit la dernière participation — décision
    // explicite : qui change d'officine y est rattaché désormais, ses anciens
    // résultats restant à l'ancienne via pharmacy_name.
    store.setLearnerPharmacy(fiche.id, pharmacyId);
  }

  store.addResult(req.params.id, {
    playerName: nomSaisi,
    score,
    total: quiz.questions.length,
    submittedAt: new Date().toISOString(),
    learnerId: fiche.id,
    pharmacyId,
    pharmacyName: pharmacyNameFigee,
    detail,
  });

  console.log(`${nomSaisi} scored ${score}/${quiz.questions.length} on quiz ${req.params.id}`);

  // Corps de réponse INCHANGÉ, champ pour champ : aucune modification du client
  // n'est requise sur ce chemin.
  res.json({
    playerName: nomSaisi,
    score,
    total: quiz.questions.length,
    correction,
    title: quiz.title,
  });
});

// Admin: get results for a quiz
// État du stockage, joint à toute réponse de l'espace formateur qui affiche des
// résultats. Sans volume monté, la base est effacée à chaque déploiement : c'est
// écrit dans les journaux de démarrage, que personne ne lit. L'information doit
// atteindre le formateur là où elle compte — devant les données concernées.
function etatStockage() {
  return {
    persistant: !store.isEphemeral,
    raison: store.ephemeralReason || null,
  };
}

// Liste des quiz créés, pour l'écran « Résultats » de l'espace formateur.
// Protégée : elle expose les titres des supports de formation et le nom des
// apprenants par ricochet.
app.get('/api/quizzes', requireAdmin, (req, res) => {
  res.json({ quizzes: store.listQuizzes(), stockage: etatStockage() });
});

/**
 * Les quatre chiffres clés du tableau de bord. Même verrou que les autres
 * routes formateur — requireAdmin seul, pas requireAnnuaire : cet écran est
 * accessible dès qu'un mot de passe formateur est configuré, exactement comme
 * /api/quizzes, même quand l'annuaire lui-même reste scellé (voir
 * requireAnnuaire plus bas).
 */
app.get('/api/dashboard', requireAdmin, (req, res) => {
  res.json(store.getDashboardStats());
});

/**
 * Les questions d'un quiz, avec leur taux d'échec.
 *
 * ⚠️ Ne porte que sur les participations enregistrées DEPUIS la mise en place
 * du détail : tout l'historique antérieur n'a que son score. `couvertes` dit
 * combien de participations sont réellement comptées, pour que l'écran puisse
 * l'annoncer au lieu d'afficher un vide qu'on prendrait pour une panne.
 */
app.get('/api/quiz/:id/stats', requireAdmin, (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) return res.status(404).json({ error: 'Quiz introuvable' });

  const questions = store.listQuestionStats(req.params.id);
  const total = store.countResults(req.params.id);
  // Toutes les questions d'une même participation sont écrites ensemble : le
  // maximum de `reponses` est donc le nombre de participations détaillées.
  const couvertes = questions.reduce((m, q) => Math.max(m, q.reponses), 0);

  res.json({
    title: quiz.title,
    questions,
    participations: total,
    couvertes,
    // Les participations d'avant, dont le détail n'existe pas et n'existera
    // jamais. L'écran doit le dire plutôt que de laisser croire à un oubli.
    sansDetail: Math.max(0, total - couvertes),
    stockage: etatStockage(),
  });
});

/** Le détail d'UNE participation : ce que la personne a répondu, question par question. */
app.get('/api/results/:resultId/answers', requireAdmin, (req, res) => {
  const reponses = store.listResultAnswers(req.params.resultId);
  res.json({ reponses, stockage: etatStockage() });
});

app.get('/api/quiz/:id/results', requireAdmin, (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  res.json({
    title: quiz.title,
    total: quiz.questions.length,
    results: store.listResults(req.params.id),
    stockage: etatStockage(),
  });
});

// =============================================================================
// Annuaire des apprenants
//
// Ces routes sont déclarées AVANT le repli SPA : `app.get('{*splat}')` attrape
// tout ce qui le précède pas, et renverrait index.html à la place du JSON.
// =============================================================================

/**
 * VERROU. requireAdmin laisse passer TOUT LE MONDE quand ADMIN_PASSWORD est
 * vide — c'est le confort du développement local. Jusqu'ici cet oubli exposait
 * des titres de quiz ; il exposerait désormais un dossier de performance
 * NOMINATIF, apprenant par apprenant, note par note.
 *
 * On ne tue pas l'application au démarrage pour autant : la variable peut
 * manquer sur un déploiement où le quiz, lui, doit continuer de tourner. Seul
 * l'annuaire est scellé. Le quiz se crée, se partage et se répond comme avant.
 */
function requireAnnuaire(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error:
        'L’annuaire des apprenants est scellé : aucun mot de passe formateur n’est ' +
        'configuré sur ce serveur. Définissez la variable d’environnement ' +
        'ADMIN_PASSWORD puis redéployez. Le quiz reste utilisable en attendant.',
      annuaireScelle: true,
    });
  }
  next();
}

// --- Limitation de débit de la route publique de suggestions -----------------
// Seau à jetons par IP : 20 d'avance, 2 par seconde ensuite. Un apprenant tape
// son nom en quelques frappes et n'en verra jamais le bord ; un script qui
// balaie l'alphabet le touche en une seconde.
// 30 et non 20 depuis l'ajout de l'officine : chaque apprenant fait désormais
// tourner DEUX champs assistés au lieu d'un, et une salle de formation entière
// partage souvent une seule IP publique (4G, box de l'officine).
const SEAU_CAPACITE = 30;
const SEAU_RECHARGE_PAR_SECONDE = 2;
// La Map est elle-même un vecteur de saturation : une IP par requête forgée, et
// c'est la mémoire du serveur qui tombe au lieu de l'annuaire. Au-delà de ce
// seuil on purge ce qui dort — un seau plein est un seau qu'on peut oublier.
const SEAU_MAX_ENTREES = 5000;
const SEAU_INACTIF_MS = 60 * 1000;

const seaux = new Map();

function consommerJeton(ip) {
  const maintenant = Date.now();

  if (seaux.size > SEAU_MAX_ENTREES) {
    for (const [cle, seau] of seaux) {
      if (maintenant - seau.vuA > SEAU_INACTIF_MS) seaux.delete(cle);
    }
  }

  let seau = seaux.get(ip);
  if (!seau) {
    seau = { jetons: SEAU_CAPACITE, vuA: maintenant };
    seaux.set(ip, seau);
  } else {
    const ecouleSecondes = (maintenant - seau.vuA) / 1000;
    seau.jetons = Math.min(
      SEAU_CAPACITE,
      seau.jetons + ecouleSecondes * SEAU_RECHARGE_PAR_SECONDE
    );
    seau.vuA = maintenant;
  }

  if (seau.jetons < 1) return false;
  seau.jetons -= 1;
  return true;
}

// Liste blanche appliquée à la clé de nom, pas à la saisie brute.
//
// Elle N'EST PLUS le rempart unique : depuis la réécriture de nameKey(), les
// métacaractères GLOB (* ? [ ]) sont hors de \p{L} ∪ \p{N} ∪ \p{M} et deviennent
// des espaces à la construction de la clé. Une clé ne PEUT plus en contenir,
// quelle que soit la saisie — la sûreté du GLOB sans clause ESCAPE est désormais
// structurelle, et cette liste n'est qu'une seconde ceinture.
//
// L'apostrophe et le trait d'union ont quitté la liste parce qu'ils ont quitté
// les CLÉS : nameKey supprime les premières et balaie les seconds. Les garder
// aurait laissé croire qu'une clé peut encore en contenir.
// Les chiffres et les lettres non latines restent refusés, exactement comme
// avant : une fiche « Aya Koffi 2 » ou « علي » existe, s'ouvre et compte ses
// évaluations — elle n'est simplement pas suggérée.
const CLE_SUGGESTION = /^[a-z][a-z ]*$/;

// Officines : les chiffres sont STRUCTURANTS dans les enseignes ivoiriennes
// (« des 2 Plateaux », « 220 Logements », « du 7e Arrondissement ») et peuvent
// ouvrir le nom. Réutiliser CLE_SUGGESTION rendrait { suggestions: [] } avec un
// 200 — un échec parfaitement muet, personne ne le remarquerait. Une officine
// n'est pas une personne : sa confidentialité n'a pas le même rang, ses
// chiffres si.
//
// NE PAS toucher à CLE_SUGGESTION pour les personnes : refuser les chiffres y
// est un choix anti-énumération assumé (voir son commentaire), pas un oubli.
const CLE_SUGGESTION_OFFICINE = /^[a-z0-9][a-z0-9 ]*$/;

// Trois caractères minimum. À deux, les ~676 bigrammes couvrent tout l'espace
// alphabétique : quelques centaines de requêtes suffiraient à reconstituer
// l'annuaire complet. À trois, l'espace est deux ordres de grandeur plus grand
// que ce que le seau à jetons laisse passer.
const SUGGESTION_MIN = 3;
const SUGGESTION_MAX = 5;

/**
 * Fabrique des routes publiques de suggestion. UNE fabrique, donc UN seul
 * seau : `consommerJeton` est capturé par fermeture sur la Map `seaux`
 * ci-dessus, PARTAGÉE par toutes les routes qu'elle produit.
 *
 * ⛔ NE JAMAIS recopier le corps de cette route pour une seconde entité :
 * chaque visiteur disposerait alors de DEUX budgets de jetons au lieu d'un, et
 * la surface d'énumération doublerait sans qu'aucun test ni aucun journal ne
 * le dise.
 *
 * Réponse toujours { suggestions: [...] }, un tableau de CHAÎNES : ni
 * identifiant, ni moyenne, ni date, ni provenance. 200 dans tous les cas
 * nominaux — jamais 404, jamais 401, jamais 410. Chaque code distinct serait un
 * oracle : « ce quiz existe mais il est fermé », « ce préfixe est invalide ».
 * Un tableau vide ne dit rien de plus que l'absence de réponse.
 */
function routeSuggestion({ suggerer, cleValide }) {
  return (req, res) => {
    // Un annuaire nominatif n'a rien à faire dans un cache partagé.
    res.setHeader('Cache-Control', 'no-store');

    if (!consommerJeton(req.ip || 'inconnue')) {
      return res
        .status(429)
        .json({ error: 'Trop de requêtes. Patientez quelques secondes avant de reprendre.' });
    }

    const vide = { suggestions: [] };

    // Contrôles de la saisie d'abord : ils ne coûtent aucune lecture de base.
    const cle = nameKey(req.query.q);
    if (cle.length < SUGGESTION_MIN) return res.json(vide);
    if (!cleValide.test(cle)) return res.json(vide);

    // Le quiz est la clé de la porte. Sonder l'annuaire suppose de détenir un
    // lien de quiz VIVANT : quand le formateur ferme le quiz ou le laisse
    // expirer, la surface d'exposition disparaît d'elle-même, sans intervention.
    const quizId = typeof req.query.quizId === 'string' ? req.query.quizId : '';
    if (!quizId) return res.json(vide);

    const quiz = store.getQuiz(quizId);
    if (!quiz || !quizAvailability(quiz).ok) return res.json(vide);

    res.json({ suggestions: suggerer(cle, SUGGESTION_MAX) });
  };
}

app.get(
  '/api/learners/suggest',
  routeSuggestion({ suggerer: (c, n) => store.suggestLearners(c, n), cleValide: CLE_SUGGESTION })
);
app.get(
  '/api/pharmacies/suggest',
  routeSuggestion({
    suggerer: (c, n) => store.suggestPharmacies(c, n),
    cleValide: CLE_SUGGESTION_OFFICINE,
  })
);

/**
 * Site UNIQUE d'arrondi des moyennes. Les deux stores renvoient des flottants
 * bruts ; arrondir ici, et nulle part ailleurs, est ce qui garantit que SQLite
 * et le store en mémoire affichent le même nombre pour les mêmes notes.
 * null reste null : une moyenne absente n'est pas une moyenne de zéro.
 */
function arrondirPourcent(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (!Number.isFinite(valeur)) return null;
  return Math.round(valeur * 10) / 10;
}

/**
 * Moyenne DES POURCENTAGES : chaque évaluation compte pour une, qu'elle porte
 * sur 5 questions ou sur 30. Ce n'est pas somme(scores)/somme(totaux), qui
 * pondérerait par la longueur du QCM. Les évaluations à total nul sont ignorées
 * du calcul mais comptées comme tentatives, exactement comme le fait le
 * CASE WHEN total > 0 de la requête SQL.
 */
function resumeDesEvaluations(evaluations) {
  let attempts = 0;
  let somme = 0;
  let comptees = 0;

  for (const e of evaluations) {
    attempts += 1;
    if (e.total > 0) {
      somme += (e.score * 100) / e.total;
      comptees += 1;
    }
  }

  return { attempts, avgPercent: comptees > 0 ? somme / comptees : null };
}

/**
 * Les groupes de fiches qui désignent probablement la même personne.
 *
 * ⚠️ DÉCLARÉE AVANT `/api/learners/:id/history` et les autres routes à
 * paramètre : « doublons » est un segment LITTÉRAL, et un `:id` déclaré plus
 * haut le capterait. Elle est aussi, comme toutes les routes d'API, déclarée
 * avant le repli SPA — sinon elle renverrait index.html avec un 200, res.ok
 * vaudrait true côté client, et l'écran afficherait « réponse inattendue »
 * pendant qu'on chercherait une panne serveur qui n'existe pas.
 *
 * Lecture seule, et c'est le point : elle PROPOSE. La fusion reste un geste du
 * formateur, par POST /api/learners/:id/merge, parce qu'elle est irréversible
 * et non reconstructible.
 */
app.get('/api/learners/doublons', requireAnnuaire, requireAdmin, (req, res) => {
  res.json({ groupes: store.listDuplicateCandidates(), stockage: etatStockage() });
});

// L'annuaire, avec la synthèse de chacun sur la période demandée.
app.get('/api/learners', requireAnnuaire, requireAdmin, (req, res) => {
  const periode = parsePeriode(req.query);
  if (!periode.ok) return res.status(400).json({ error: periode.error });

  const learners = store
    .listLearners({ from: periode.from, to: periode.toExclusive })
    .map((l) => ({
      id: l.id,
      displayName: l.displayName,
      createdBy: l.createdBy,
      suggestible: l.suggestible,
      createdAt: l.createdAt,
      pharmacyId: l.pharmacyId,
      pharmacyName: l.pharmacyName,
      attempts: l.attempts,
      avgPercent: arrondirPourcent(l.avgPercent),
      lastSubmittedAt: l.lastSubmittedAt,
    }));

  // Clés posées dans l'ordre du contrat. `periode` est omise quand le formateur
  // n'a rien restreint : afficher « du néant au néant » n'apprendrait rien.
  const reponse = { learners };
  if (periode.fromDay || periode.toDay) {
    reponse.periode = { from: periode.fromDay, to: periode.toDay, tzOffset: periode.tzOffset };
  }
  reponse.stockage = etatStockage();

  res.json(reponse);
});

// L'historique d'un apprenant à travers toutes ses évaluations.
app.get('/api/learners/:id/history', requireAnnuaire, requireAdmin, (req, res) => {
  const learner = store.getLearner(req.params.id);
  if (!learner) return res.status(404).json({ error: 'Apprenant introuvable' });

  const periode = parsePeriode(req.query);
  if (!periode.ok) return res.status(400).json({ error: periode.error });

  const evaluations = store.listLearnerHistory(learner.id, {
    from: periode.from,
    to: periode.toExclusive,
  });
  const resume = resumeDesEvaluations(evaluations);

  res.json({
    learner,
    // fromInstant et toInstantExclusive rendent la fenêtre RÉELLEMENT appliquée
    // vérifiable à l'œil. C'est la logique la plus facile à casser du chantier :
    // une borne de fin mal posée fait disparaître une journée entière de
    // résultats sans rien casser de visible. Publier les instants transforme un
    // bogue silencieux en anomalie qui se voit.
    periode: {
      from: periode.fromDay,
      to: periode.toDay,
      tzOffset: periode.tzOffset,
      fromInstant: periode.from,
      toInstantExclusive: periode.toExclusive,
    },
    // Le pourcentage est calcule ICI, a la serialisation, comme avgPercent :
    // un seul site d'arrondi pour toute l'application, et les deux stores
    // restent libres de ne rendre que score et total. La garde total > 0 evite
    // un NaN si une donnee ancienne etait incomplete.
    evaluations: evaluations.map((e) => ({
      ...e,
      percent: e.total > 0 ? Math.round((e.score * 100) / e.total) : null,
    })),
    resume: { attempts: resume.attempts, avgPercent: arrondirPourcent(resume.avgPercent) },
    stockage: etatStockage(),
  });
});

// Création d'une fiche à la main par le formateur.
app.post('/api/learners', requireAnnuaire, requireAdmin, (req, res) => {
  const brut = req.body && req.body.displayName;
  const displayName = typeof brut === 'string' ? brut.trim() : '';

  if (!displayName) {
    return res.status(400).json({ error: 'Le nom de l’apprenant est obligatoire.' });
  }
  // Un nom fait entièrement de ponctuation ou d'espaces insécables donne une clé
  // vide : la fiche serait introuvable et capterait ensuite toutes les saisies
  // vides. On refuse à l'entrée plutôt que de laisser l'annuaire se salir.
  if (!nameKey(displayName)) {
    return res.status(400).json({
      error: 'Ce nom ne contient aucune lettre exploitable.',
    });
  }

  try {
    const { learner } = store.createLearner(displayName);
    res.status(201).json({ learner });
  } catch (err) {
    // La route est protégée : le formateur a le droit de savoir QUELLE fiche
    // occupe la place, et peut enchaîner sur un renommage ou une fusion. Ce
    // serait un oracle sur une route publique ; ici c'est un service.
    if (err.code === 'DUPLICATE') {
      return res.status(409).json({ error: err.message, learner: err.learner });
    }
    throw err;
  }
});

// Correction d'une fiche : le nom affiché, la mise en quarantaine, ou les deux.
app.patch('/api/learners/:id', requireAnnuaire, requireAdmin, (req, res) => {
  const existant = store.getLearner(req.params.id);
  if (!existant) return res.status(404).json({ error: 'Apprenant introuvable' });

  const corps = req.body || {};
  const patch = {};

  if (typeof corps.displayName === 'string') {
    const displayName = corps.displayName.trim();
    if (!displayName || !nameKey(displayName)) {
      return res.status(400).json({ error: 'Ce nom ne contient aucune lettre exploitable.' });
    }
    patch.displayName = displayName;
  }

  if (typeof corps.suggestible === 'boolean') patch.suggestible = corps.suggestible;

  // pharmacyId est traité À PART de `patch` (destiné à updateLearner) : c'est
  // une écriture sur une colonne différente, via setLearnerPharmacy, qui ne
  // recalcule aucune clé de nom. `null` retire l'affectation.
  const affecteOfficine = 'pharmacyId' in corps;
  let pharmacyId = null;
  if (affecteOfficine) {
    pharmacyId = corps.pharmacyId === null ? null : String(corps.pharmacyId || '').trim();
    // Un identifiant fautif orphelinerait la fiche EN SILENCE : elle
    // pointerait une officine qui n'existe pas, invisible jusqu'à ce qu'un
    // écran tente de l'afficher. On vérifie ici, avant d'écrire.
    if (pharmacyId && !store.getPharmacy(pharmacyId)) {
      return res.status(404).json({ error: 'Officine introuvable' });
    }
  }

  if (!Object.keys(patch).length && !affecteOfficine) {
    return res.status(400).json({
      error:
        'Rien à modifier : indiquez un nom (displayName), une visibilité (suggestible) ' +
        'ou une officine (pharmacyId).',
    });
  }

  try {
    // Un renommage recalcule la clé de nom et ne touche AUCUNE ligne de results :
    // l'historique conserve le nom tel qu'il a été tapé le jour de l'évaluation.
    const learner = Object.keys(patch).length
      ? store.updateLearner(req.params.id, patch)
      : store.getLearner(req.params.id);
    if (!learner) return res.status(404).json({ error: 'Apprenant introuvable' });

    const final = affecteOfficine ? store.setLearnerPharmacy(req.params.id, pharmacyId) : learner;
    res.json({ learner: final });
  } catch (err) {
    if (err.code === 'DUPLICATE') {
      return res.status(409).json({ error: err.message, learner: err.learner });
    }
    throw err;
  }
});

// Fusion de deux fiches ouvertes pour la même personne : les évaluations de la
// source passent sous la cible, puis la source disparaît.
app.post('/api/learners/:id/merge', requireAnnuaire, requireAdmin, (req, res) => {
  const sourceId = req.params.id;
  const brut = req.body && req.body.intoId;
  const intoId = typeof brut === 'string' ? brut.trim() : '';

  if (!intoId) {
    return res.status(400).json({ error: 'Indiquez la fiche à conserver (intoId).' });
  }
  // Fusionner une fiche avec elle-même la supprimerait juste après y avoir
  // rattaché ses propres résultats. Les deux stores s'en protègent aussi, mais
  // ils répondent { moved: 0 } — un silence qui ressemble à un succès.
  if (intoId === sourceId) {
    return res.status(400).json({ error: 'Une fiche ne peut pas être fusionnée avec elle-même.' });
  }

  if (!store.getLearner(sourceId)) {
    return res.status(404).json({ error: 'Apprenant introuvable' });
  }
  if (!store.getLearner(intoId)) {
    return res.status(404).json({ error: 'Fiche de destination introuvable' });
  }

  const { moved } = store.mergeLearners(sourceId, intoId);
  console.log(`Fusion d'apprenants : ${sourceId} -> ${intoId} (${moved} évaluation(s))`);
  res.json({ moved });
});

// =============================================================================
// Annuaire des officines — copie fonctionnelle du bloc apprenants ci-dessus.
// Même verrou (requireAnnuaire), même discipline d'ordre de déclaration.
// =============================================================================

// ⚠️ DÉCLARÉE AVANT /api/pharmacies/:id (implicite dans les routes suivantes) :
// « doublons » est un segment LITTÉRAL qu'un `:id` capterait s'il passait avant.
app.get('/api/pharmacies/doublons', requireAnnuaire, requireAdmin, (req, res) => {
  res.json({ groupes: store.listDuplicatePharmacyCandidates(), stockage: etatStockage() });
});

app.get('/api/pharmacies', requireAnnuaire, requireAdmin, (req, res) => {
  res.json({ pharmacies: store.listPharmacies(), stockage: etatStockage() });
});

app.post('/api/pharmacies', requireAnnuaire, requireAdmin, (req, res) => {
  const brut = req.body && req.body.displayName;
  const displayName = typeof brut === 'string' ? brut.trim() : '';

  if (!displayName) {
    return res.status(400).json({ error: 'Le nom de l’officine est obligatoire.' });
  }
  if (!nameKey(displayName)) {
    return res.status(400).json({ error: 'Ce nom ne contient aucune lettre exploitable.' });
  }

  try {
    const { pharmacy } = store.createPharmacy(displayName);
    res.status(201).json({ pharmacy });
  } catch (err) {
    if (err.code === 'DUPLICATE') {
      return res.status(409).json({ error: err.message, pharmacy: err.pharmacy });
    }
    throw err;
  }
});

app.patch('/api/pharmacies/:id', requireAnnuaire, requireAdmin, (req, res) => {
  const existant = store.getPharmacy(req.params.id);
  if (!existant) return res.status(404).json({ error: 'Officine introuvable' });

  const corps = req.body || {};
  const patch = {};

  if (typeof corps.displayName === 'string') {
    const displayName = corps.displayName.trim();
    if (!displayName || !nameKey(displayName)) {
      return res.status(400).json({ error: 'Ce nom ne contient aucune lettre exploitable.' });
    }
    patch.displayName = displayName;
  }

  if (typeof corps.suggestible === 'boolean') patch.suggestible = corps.suggestible;

  if (!Object.keys(patch).length) {
    return res.status(400).json({
      error: 'Rien à modifier : indiquez un nom (displayName) ou une visibilité (suggestible).',
    });
  }

  try {
    const pharmacy = store.updatePharmacy(req.params.id, patch);
    if (!pharmacy) return res.status(404).json({ error: 'Officine introuvable' });
    res.json({ pharmacy });
  } catch (err) {
    if (err.code === 'DUPLICATE') {
      return res.status(409).json({ error: err.message, pharmacy: err.pharmacy });
    }
    throw err;
  }
});

// Fusion : déplace les apprenants ET les participations, jamais
// results.pharmacy_name — la graphie figée du jour ne se réécrit jamais.
app.post('/api/pharmacies/:id/merge', requireAnnuaire, requireAdmin, (req, res) => {
  const sourceId = req.params.id;
  const brut = req.body && req.body.intoId;
  const intoId = typeof brut === 'string' ? brut.trim() : '';

  if (!intoId) {
    return res.status(400).json({ error: 'Indiquez l’officine à conserver (intoId).' });
  }
  if (intoId === sourceId) {
    return res.status(400).json({ error: 'Une officine ne peut pas être fusionnée avec elle-même.' });
  }
  if (!store.getPharmacy(sourceId)) {
    return res.status(404).json({ error: 'Officine introuvable' });
  }
  if (!store.getPharmacy(intoId)) {
    return res.status(404).json({ error: 'Officine de destination introuvable' });
  }

  const { movedLearners, movedResults } = store.mergePharmacies(sourceId, intoId);
  console.log(
    `Fusion d'officines : ${sourceId} -> ${intoId} (${movedLearners} apprenant(s), ${movedResults} participation(s))`
  );
  res.json({ movedLearners, movedResults });
});

// Toutes les participations des apprenants de cette officine, tous quiz
// confondus, sur la période — l'analogue de /api/learners/:id/history mais à
// cheval sur plusieurs apprenants. Même forme de réponse, mêmes champs.
app.get('/api/pharmacies/:id/history', requireAnnuaire, requireAdmin, (req, res) => {
  const pharmacy = store.getPharmacy(req.params.id);
  if (!pharmacy) return res.status(404).json({ error: 'Officine introuvable' });

  const periode = parsePeriode(req.query);
  if (!periode.ok) return res.status(400).json({ error: periode.error });

  const evaluations = store.listPharmacyHistory(pharmacy.id, {
    from: periode.from,
    to: periode.toExclusive,
  });
  const resume = resumeDesEvaluations(evaluations);

  res.json({
    pharmacy,
    periode: {
      from: periode.fromDay,
      to: periode.toDay,
      tzOffset: periode.tzOffset,
      fromInstant: periode.from,
      toInstantExclusive: periode.toExclusive,
    },
    evaluations: evaluations.map((e) => ({
      ...e,
      percent: e.total > 0 ? Math.round((e.score * 100) / e.total) : null,
    })),
    resume: { attempts: resume.attempts, avgPercent: arrondirPourcent(resume.avgPercent) },
    stockage: etatStockage(),
  });
});

// SPA fallback — serve index.html for all non-API routes
app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kemet Quiz API running on http://localhost:${PORT}`);
  console.log(`Base de données : ${store.DB_PATH}`);
  if (store.isEphemeral) {
    console.warn(
      `⚠️  Données NON persistées : ${store.ephemeralReason}\n` +
        '    Les quiz et les résultats seront perdus au prochain redémarrage.'
    );
  }
});
