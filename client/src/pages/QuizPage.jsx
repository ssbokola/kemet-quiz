import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Welcome from '../components/Welcome';
import Quiz from '../components/Quiz';
import Results from '../components/Results';

const storageKey = (id) => `kemet-quiz-progress-${id}`;

function loadProgress(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

function saveProgress(id, data) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(data));
  } catch {}
}

function clearProgress(id) {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {}
}

function QuizPage() {
  const { id } = useParams();
  const [step, setStep] = useState('welcome');
  const [playerName, setPlayerName] = useState('');
  const [quizData, setQuizData] = useState(null);
  const [userAnswers, setUserAnswers] = useState({});
  const [resultData, setResultData] = useState(null);
  const [error, setError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resumed, setResumed] = useState(false);

  // Load quiz + resume progress if any
  useEffect(() => {
    fetch(`/api/quiz/${id}`)
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          try {
            const err = JSON.parse(text);
            throw new Error(err.error || 'Quiz introuvable');
          } catch {
            throw new Error('Quiz introuvable');
          }
        }
        return JSON.parse(text);
      })
      .then((data) => {
        setQuizData(data);

        const saved = loadProgress(id);
        if (saved && saved.playerName) {
          setPlayerName(saved.playerName);
          setUserAnswers(saved.answers || {});
          setStep('quiz');
          setResumed(true);
        }

        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  // Persist progress on any change while in quiz step
  useEffect(() => {
    if (step === 'quiz' && playerName) {
      saveProgress(id, {
        playerName,
        answers: userAnswers,
        startedAt: Date.now(),
      });
    }
  }, [id, step, playerName, userAnswers]);

  const handleNameSubmit = (name) => {
    setPlayerName(name);
    setStep('quiz');
  };

  const handleRestart = () => {
    clearProgress(id);
    setUserAnswers({});
    setPlayerName('');
    setResumed(false);
    setStep('welcome');
  };

  const handleQuizSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch(`/api/quiz/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, answers: userAnswers }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = 'Erreur lors de la soumission';
        try {
          const err = JSON.parse(text);
          msg = err.error || msg;
        } catch {}
        throw new Error(msg);
      }
      const data = JSON.parse(text);
      clearProgress(id);
      setResultData(data);
      setStep('results');
    } catch (err) {
      setSubmitError(err.message || 'Erreur réseau, réessayez');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetake = () => {
    clearProgress(id);
    setUserAnswers({});
    setResultData(null);
    setSubmitError('');
    setStep('quiz');
  };

  if (loading) {
    return (
      <div className="loader">
        <div className="spinner" />
        <p>Chargement du quiz...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-not-found">
        <div className="not-found-icon">🔍</div>
        <h2>Quiz introuvable</h2>
        <p>Ce lien est peut-être expiré ou incorrect.</p>
        <p className="subtle">Contactez la personne qui vous l'a envoyé.</p>
        <Link to="/" className="btn btn-primary">Retour à l'accueil</Link>
      </div>
    );
  }

  return (
    <div>
      {step === 'welcome' && (
        <Welcome quizTitle={quizData.title} onSubmit={handleNameSubmit} />
      )}

      {step === 'quiz' && (
        <>
          {resumed && (
            <div className="resume-banner">
              <span>Reprise de votre quiz, {playerName}</span>
              <button onClick={handleRestart} className="link-btn">Recommencer</button>
            </div>
          )}
          <Quiz
            questions={quizData.questions}
            userAnswers={userAnswers}
            onAnswer={(idx, answer) =>
              setUserAnswers((prev) => ({ ...prev, [idx]: answer }))
            }
            onSubmit={handleQuizSubmit}
            submitting={submitting}
            submitError={submitError}
            onClearSubmitError={() => setSubmitError('')}
          />
        </>
      )}

      {step === 'results' && resultData && (
        <Results
          playerName={resultData.playerName}
          title={resultData.title}
          score={resultData.score}
          total={resultData.total}
          correction={resultData.correction}
          onRetake={handleRetake}
        />
      )}
    </div>
  );
}

export default QuizPage;
