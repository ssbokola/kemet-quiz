function Quiz({ questions, userAnswers, onAnswer, onSubmit }) {
  const allAnswered = Object.keys(userAnswers).length === questions.length;

  return (
    <div className="quiz-section">
      <div className="quiz-progress">
        <span>{Object.keys(userAnswers).length} / {questions.length} répondu(es)</span>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(Object.keys(userAnswers).length / questions.length) * 100}%` }}
          />
        </div>
      </div>

      {questions.map((q, idx) => (
        <div key={idx} className={`question-card ${userAnswers[idx] ? 'answered' : ''}`}>
          <h3 className="question-number">Question {idx + 1}</h3>
          <p className="question-text">{q.question}</p>
          <div className="options">
            {q.options.map((option, optIdx) => {
              const letter = String.fromCharCode(65 + optIdx);
              const isSelected = userAnswers[idx] === letter;
              return (
                <button
                  key={optIdx}
                  className={`option-btn ${isSelected ? 'selected' : ''}`}
                  onClick={() => onAnswer(idx, letter)}
                >
                  <span className="option-letter">{letter}</span>
                  <span className="option-text">{option.replace(/^[A-D]\)\s*/, '')}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <button
        className="btn btn-primary btn-submit"
        disabled={!allAnswered}
        onClick={onSubmit}
      >
        Valider mes réponses ({Object.keys(userAnswers).length}/{questions.length})
      </button>
    </div>
  );
}

export default Quiz;
