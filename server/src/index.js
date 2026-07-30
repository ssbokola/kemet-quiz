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
const store = require('./db');

const app = express();
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
    model: 'claude-sonnet-4-20250514',
    max_tokens: numQuestions > 15 ? 8192 : 4096,
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: DIFFICULTY_GUIDANCE[quiz.difficulty] || DIFFICULTY_GUIDANCE.moyen,
        messages: [{ role: 'user', content: [{ type: 'text', text: instruction }] }],
      });
      text = msg.content.map((c) => c.text || '').join('');
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

  const { playerName, answers } = req.body;
  if (!playerName || !answers) {
    return res.status(400).json({ error: 'Nom et réponses requis' });
  }

  const availability = quizAvailability(quiz);
  if (!availability.ok) {
    return res.status(availability.status).json({ error: availability.error });
  }

  // Tentative unique : on refuse un second envoi sous le même prénom
  if (quiz.singleAttempt !== false) {
    const previous = store.findResultByName(req.params.id, playerName);
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

  store.addResult(req.params.id, {
    playerName,
    score,
    total: quiz.questions.length,
    submittedAt: new Date().toISOString(),
  });

  console.log(`${playerName} scored ${score}/${quiz.questions.length} on quiz ${req.params.id}`);

  res.json({
    playerName,
    score,
    total: quiz.questions.length,
    correction,
    title: quiz.title,
  });
});

// Admin: get results for a quiz
app.get('/api/quiz/:id/results', requireAdmin, (req, res) => {
  const quiz = store.getQuiz(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  res.json({ title: quiz.title, results: store.listResults(req.params.id) });
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
      '⚠️  Aucun volume Railway monté : la base vit dans le conteneur et sera EFFACÉE au prochain déploiement.\n' +
        '    Attachez un Volume au service (Railway → service → Volumes), puis redéployez.'
    );
  }
});
