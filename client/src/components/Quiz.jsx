import { useState } from 'react';

function Quiz({ questions, userAnswers, onAnswer, onSubmit }) {
  const [current, setCurrent] = useState(0);
  const answered = Object.keys(userAnswers).length;
  const allAnswered = answered === questions.length;
  const q = questions[current];

  const handleAnswer = (letter) => {
    onAnswer(current, letter);
    // Auto-advance after a short delay
    if (current < questions.length - 1) {
      setTimeout(() => setCurrent(current + 1), 400);
    }
  };

  return (
    <div className="quiz-section">
      {/* Progress */}
      <div className="quiz-progress">
        <div className="progress-header">
          <span>{answered} / {questions.length} questions</span>
          <span className="progress-percent">{Math.round((answered / questions.length) * 100)}%</span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(answered / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Question dots navigation */}
      <div className="question-dots">
        {questions.map((_, idx) => (
          <button
            key={idx}
            className={`dot ${idx === current ? 'active' : ''} ${userAnswers[idx] ? 'answered' : ''}`}
            onClick={() => setCurrent(idx)}
            aria-label={`Question ${idx + 1}`}
          >
            {idx + 1}
          </button>
        ))}
      </div>

      {/* Single question card */}
      <div className="question-card active-card" key={current}>
        <h3 className="question-number">Question {current + 1} / {questions.length}</h3>
        <p className="question-text">{q.question}</p>
        <div className="options">
          {q.options.map((option, optIdx) => {
            const letter = String.fromCharCode(65 + optIdx);
            const isSelected = userAnswers[current] === letter;
            return (
              <button
                key={optIdx}
                className={`option-btn ${isSelected ? 'selected' : ''}`}
                onClick={() => handleAnswer(letter)}
              >
                <span className="option-letter">{letter}</span>
                <span className="option-text">{option.replace(/^[A-D]\)\s*/, '')}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation */}
      <div className="quiz-nav">
        <button
          className="btn btn-nav"
          disabled={current === 0}
          onClick={() => setCurrent(current - 1)}
        >
          ← Précédente
        </button>

        {current < questions.length - 1 ? (
          <button
            className="btn btn-nav btn-next"
            onClick={() => setCurrent(current + 1)}
          >
            Suivante →
          </button>
        ) : (
          <button
            className="btn btn-primary btn-submit"
            disabled={!allAnswered}
            onClick={onSubmit}
          >
            Valider ({answered}/{questions.length})
          </button>
        )}
      </div>
    </div>
  );
}

export default Quiz;
