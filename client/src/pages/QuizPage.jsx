import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Welcome from '../components/Welcome';
import Quiz from '../components/Quiz';
import Results from '../components/Results';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';

const storageKey = (id) => `kemet-quiz-progress-${id}`;

function loadProgress(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
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
  const [errorKind, setErrorKind] = useState('notfound'); // notfound | closed
  const [already, setAlready] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    fetch(`/api/quiz/${id}`)
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          let msg = res.status === 410 ? 'Ce quiz est fermé' : 'Quiz introuvable';
          try {
            msg = JSON.parse(text).error || msg;
          } catch {}
          setErrorKind(res.status === 410 ? 'closed' : 'notfound');
          throw new Error(msg);
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

  useEffect(() => {
    if (step === 'quiz' && playerName) {
      saveProgress(id, { playerName, answers: userAnswers, startedAt: Date.now() });
    }
  }, [id, step, playerName, userAnswers]);

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
        let payload = {};
        try {
          payload = JSON.parse(text);
        } catch {}

        if (res.status === 409 && payload.alreadyAnswered) {
          clearProgress(id);
          setAlready(payload);
          return;
        }

        throw new Error(
          (payload.error || 'Envoi impossible') +
            ' Vos réponses restent enregistrées sur cet appareil : réessayez.'
        );
      }
      clearProgress(id);
      setResultData(JSON.parse(text));
      setStep('results');
    } catch (err) {
      setSubmitError(
        err.message || 'Réseau indisponible. Vos réponses sont conservées, réessayez.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetake = () => {
    clearProgress(id);
    setUserAnswers({});
    setResultData(null);
    setSubmitError('');
    setResumed(false);
    setStep('quiz');
  };

  if (loading) {
    return (
      <div className="app">
        <AppBar />
        <div className="loading-screen">
          <div className="spinner" />
          <p>Chargement du quiz…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <AppBar />
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name={errorKind === 'closed' ? 'close' : 'search'} size={22} width={1.7} />
          </span>
          <h2>{errorKind === 'closed' ? 'Quiz clôturé' : 'Quiz introuvable'}</h2>
          <p>
            {errorKind === 'closed'
              ? `${error}. Contactez votre formateur si vous devez encore y répondre.`
              : 'Ce lien est peut-être expiré ou incorrect. Contactez la personne qui vous l’a envoyé.'}
          </p>
        </div>
      </div>
    );
  }

  if (already) {
    return (
      <div className="app">
        <AppBar />
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="check" size={22} width={2} />
          </span>
          <h2>Déjà répondu</h2>
          <p>{already.error}</p>
          {already.score != null && (
            <span className="tag" style={{ marginTop: 4 }}>
              Score enregistré : {already.score}/{already.total}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (step === 'quiz') {
    return (
      <Quiz
        quizTitle={quizData.title}
        questions={quizData.questions}
        userAnswers={userAnswers}
        onAnswer={(idx, answer) => setUserAnswers((prev) => ({ ...prev, [idx]: answer }))}
        onSubmit={handleQuizSubmit}
        submitting={submitting}
        submitError={submitError}
        onClearSubmitError={() => setSubmitError('')}
        resumed={resumed}
        onRestart={handleRestart}
      />
    );
  }

  if (step === 'results' && resultData) {
    return (
      <div className="app">
        <AppBar />
        <Results
          playerName={resultData.playerName}
          title={resultData.title}
          score={resultData.score}
          total={resultData.total}
          correction={resultData.correction}
          onRetake={quizData.singleAttempt === false ? handleRetake : null}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <AppBar />
      <main className="app-main">
        <Welcome
          quizTitle={quizData.title}
          questionCount={quizData.questions.length}
          singleAttempt={quizData.singleAttempt !== false}
          onSubmit={(name) => {
            setPlayerName(name);
            setStep('quiz');
          }}
        />
      </main>
    </div>
  );
}

export default QuizPage;
