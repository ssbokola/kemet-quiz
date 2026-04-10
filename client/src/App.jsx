import { useState } from 'react';
import Welcome from './components/Welcome';
import UploadPDF from './components/UploadPDF';
import Quiz from './components/Quiz';
import Results from './components/Results';
import './App.css';

function App() {
  const [step, setStep] = useState('welcome');
  const [playerName, setPlayerName] = useState('');
  const [questions, setQuestions] = useState([]);
  const [userAnswers, setUserAnswers] = useState({});
  const [score, setScore] = useState(0);

  const handleNameSubmit = (name) => {
    setPlayerName(name);
    setStep('upload');
  };

  const handleQuizGenerated = (data) => {
    setQuestions(data.questions);
    setUserAnswers({});
    setStep('quiz');
  };

  const handleQuizSubmit = () => {
    let correct = 0;
    questions.forEach((q, i) => {
      if (userAnswers[i] === q.answer) correct++;
    });
    setScore(correct);
    setStep('results');
  };

  const handleRestart = () => {
    setQuestions([]);
    setUserAnswers({});
    setScore(0);
    setStep('upload');
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Kemet Quiz</h1>
        <p>Transformez vos PDF en quiz interactifs</p>
      </header>

      <main className="app-main">
        {step === 'welcome' && (
          <Welcome onSubmit={handleNameSubmit} />
        )}

        {step === 'upload' && (
          <UploadPDF onQuizGenerated={handleQuizGenerated} />
        )}

        {step === 'quiz' && (
          <Quiz
            questions={questions}
            userAnswers={userAnswers}
            onAnswer={(idx, answer) =>
              setUserAnswers((prev) => ({ ...prev, [idx]: answer }))
            }
            onSubmit={handleQuizSubmit}
          />
        )}

        {step === 'results' && (
          <Results
            playerName={playerName}
            questions={questions}
            userAnswers={userAnswers}
            score={score}
            onRestart={handleRestart}
          />
        )}
      </main>
    </div>
  );
}

export default App;
