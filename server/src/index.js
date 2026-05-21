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
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'));
    }
  },
});

function getQuizPrompt(numQuestions) {
  return `Tu es un générateur de quiz pédagogique. À partir du contenu de ce document, génère exactement ${numQuestions} questions à choix multiple (MCQ). Chaque question a 4 options (A, B, C, D) et une seule bonne réponse. Réponds UNIQUEMENT en JSON valide avec ce format : {"questions": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A"}]}`;
}

// Claude (primary) — streaming to keep the HTTP connection alive
async function generateWithClaude(pdfBase64, numQuestions, onProgress) {
  const prompt = getQuizPrompt(numQuestions);
  const anthropic = new Anthropic();
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: numQuestions > 15 ? 8192 : 4096,
    system: prompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: `Génère un quiz de ${numQuestions} questions MCQ à partir de ce document PDF.` },
        ],
      },
    ],
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
async function generateWithGemini(pdfBase64, numQuestions) {
  const prompt = getQuizPrompt(numQuestions);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const content = [
    { inlineData: { mimeType: 'application/pdf', data: pdfBase64 } },
    { text: prompt + `\nGénère un quiz de ${numQuestions} questions MCQ à partir de ce document PDF.` },
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

// Admin: upload PDF → generate quiz → stream progress + final link (NDJSON)
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
    if (!req.file) {
      send({ type: 'error', error: 'Aucun fichier PDF fourni' });
      return;
    }

    const pdfBase64 = req.file.buffer.toString('base64');
    const numQuestions = parseInt(req.body.numQuestions) || 10;
    let responseText;

    console.log(`Generating quiz with ${numQuestions} questions...`);
    send({ type: 'progress', message: `Analyse du PDF (${numQuestions} questions)...` });

    try {
      console.log('Trying Claude (primary)...');
      responseText = await generateWithClaude(pdfBase64, numQuestions, () => {
        // each delta token from Claude — keep stream active
      });
      console.log('Success with Claude');
    } catch (claudeErr) {
      console.warn(`Claude failed: ${claudeErr.message}`);
      console.log('Falling back to Gemini...');
      send({ type: 'progress', message: 'Bascule sur le modèle de secours...' });
      responseText = await generateWithGemini(pdfBase64, numQuestions);
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      send({ type: 'error', error: 'Réponse IA invalide' });
      return;
    }

    const quiz = JSON.parse(jsonMatch[0]);

    const quizId = crypto.randomBytes(4).toString('hex');
    const title = req.body.title || req.file.originalname.replace('.pdf', '');
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
