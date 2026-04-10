import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Welcome from '../components/Welcome';
import Quiz from '../components/Quiz';
import Results from '../components/Results';

function QuizPage() {
  const { id } = useParams();
  const [step, setStep] = useState('welcome');
  const [playerName, setPlayerName] = useState('');
  const [quizData, setQuizData] = useState(null);
  const [userAnswers, setUserAnswers] = useState({});
  const [resultData, setResultData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Load quiz on mount
  useEffect(() => {
    fetch(`/api/quiz/${id}`)
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) {
          try {
            const err = JSON.parse(text);
            throw new Error(err.error);
          } catch {
            throw new Error('Quiz introuvable');
          }
        }
        return JSON.parse(text);
      })
      .then((data) => {
        setQuizData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  const handleNameSubmit = (name) => {
    setPlayerName(name);
    setStep('quiz');
  };

  const handleQuizSubmit = async () => {
    try {
      const res = await fetch(`/api/quiz/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, answers: userAnswers }),
      });
      const text = await res.text();
      if (!res.ok) {
        try {
          const err = JSON.parse(text);
          throw new Error(err.error);
        } catch {
          throw new Error('Erreur lors de la soumission');
        }
      }
      const data = JSON.parse(text);
      setResultData(data);
      setStep('results');
    } catch (err) {
      setError(err.message);
    }
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
    return <p className="error-msg">{error}</p>;
  }

  return (
    <div>
      {step === 'welcome' && (
        <Welcome quizTitle={quizData.title} onSubmit={handleNameSubmit} />
      )}

      {step === 'quiz' && (
        <Quiz
          questions={quizData.questions}
          userAnswers={userAnswers}
          onAnswer={(idx, answer) =>
            setUserAnswers((prev) => ({ ...prev, [idx]: answer }))
          }
          onSubmit={handleQuizSubmit}
        />
      )}

      {step === 'results' && resultData && (
        <Results
          playerName={resultData.playerName}
          title={resultData.title}
          score={resultData.score}
          total={resultData.total}
          correction={resultData.correction}
        />
      )}
    </div>
  );
}

export default QuizPage;
