const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PDF sont acceptés'));
    }
  },
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// In-memory quiz store
const quizzes = new Map();

// Admin: upload PDF → generate quiz → return quiz link
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier PDF fourni' });
    }

    const pdfBase64 = req.file.buffer.toString('base64');

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
    let result;
    let lastError;

    for (const modelName of models) {
      try {
        console.log(`Trying model: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });
        result = await model.generateContent([
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            text: `Tu es un générateur de quiz pédagogique. À partir du contenu de ce document, génère exactement 10 questions à choix multiple (MCQ). Chaque question a 4 options (A, B, C, D) et une seule bonne réponse. Réponds UNIQUEMENT en JSON valide avec ce format : {"questions": [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "answer": "A"}]}`,
          },
        ]);
        console.log(`Success with model: ${modelName}`);
        break;
      } catch (modelErr) {
        console.warn(`Model ${modelName} failed: ${modelErr.message}`);
        lastError = modelErr;
        result = null;
      }
    }

    if (!result) {
      throw lastError;
    }

    const responseText = result.response.text();

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Réponse IA invalide' });
    }

    const quiz = JSON.parse(jsonMatch[0]);

    // Generate unique ID and store quiz
    const quizId = crypto.randomBytes(4).toString('hex');
    const title = req.body.title || req.file.originalname.replace('.pdf', '');
    quizzes.set(quizId, {
      title,
      questions: quiz.questions,
      createdAt: new Date().toISOString(),
      results: [],
    });

    console.log(`Quiz created: ${quizId} (${quiz.questions.length} questions)`);

    res.json({ quizId, title, questionsCount: quiz.questions.length });
  } catch (err) {
    console.error('Erreur /api/upload-pdf:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Learner: get quiz by ID (questions without answers)
app.get('/api/quiz/:id', (req, res) => {
  const quiz = quizzes.get(req.params.id);
  if (!quiz) {
    return res.status(404).json({ error: 'Quiz introuvable' });
  }

  // Send questions without answers
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

  // Save result
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
