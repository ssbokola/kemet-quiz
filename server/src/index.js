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

const app = express();
const PORT = process.env.PORT || 3001;

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

// In-memory quiz store
const quizzes = new Map();

// Admin: upload PDF (or extracted text) → generate quiz → stream progress (NDJSON)
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
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

    const quiz = JSON.parse(jsonMatch[0]);

    const quizId = crypto.randomBytes(4).toString('hex');
    const fallbackTitle = req.file ? req.file.originalname.replace(/\.pdf$/i, '') : 'Quiz';
    const title = req.body.title || fallbackTitle;
    quizzes.set(quizId, {
      title,
      questions: quiz.questions,
      createdAt: new Date().toISOString(),
      results: [],
    });

    console.log(`Quiz created: ${quizId} (${quiz.questions.length} questions)`);
    send({ type: 'done', quizId, title, questionsCount: quiz.questions.length });
  } catch (err) {
    console.error('Erreur /api/upload-pdf:', err.message);
    send({ type: 'error', error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// Learner: get quiz by ID (questions without answers)
app.get('/api/quiz/:id', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  const safeQuestions = quiz.questions.map((q) => ({
    question: q.question,
    options: q.options,
  }));

  res.json({ title: quiz.title, questions: safeQuestions });
});

// Learner: submit answers
app.post('/api/quiz/:id/submit', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  const { playerName, answers } = req.body;
  if (!playerName || !answers) {
    return res.status(400).json({ error: 'Nom et réponses requis' });
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

  quiz.results.push({
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
app.get('/api/quiz/:id/results', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  res.json({ title: quiz.title, results: quiz.results });
});

// SPA fallback — serve index.html for all non-API routes
app.get('{*splat}', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Kemet Quiz API running on http://localhost:${PORT}`);
});
