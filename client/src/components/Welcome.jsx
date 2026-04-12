import { useState } from 'react';

function Welcome({ quizTitle, onSubmit }) {
  const [name, setName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
    }
  };

  return (
    <div className="welcome-section">
      <div className="welcome-card">
        <div className="welcome-icon">📝</div>
        <h2>{quizTitle}</h2>
        <p>Entrez votre prénom pour commencer le quiz</p>
        <form onSubmit={handleSubmit} className="welcome-form">
          <input
            type="text"
            placeholder="Votre prénom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="name-input"
            autoFocus
          />
          <button type="submit" disabled={!name.trim()} className="btn btn-primary">
            Commencer le quiz
          </button>
        </form>
      </div>
    </div>
  );
}

export default Welcome;
