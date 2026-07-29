import { useState } from 'react';
import Icon from './Icon';

function Welcome({ quizTitle, questionCount, singleAttempt = true, onSubmit }) {
  const [name, setName] = useState('');
  const minutes = questionCount ? Math.max(2, Math.round(questionCount * 0.5)) : null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };

  return (
    <form className="welcome" onSubmit={handleSubmit}>
      <div className="stack">
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="welcome-eyebrow">Vous allez répondre à</span>
          <h1 className="welcome-title">{quizTitle}</h1>
          <div className="tag-row" style={{ marginTop: 4 }}>
            {questionCount ? <span className="tag">{questionCount} questions</span> : null}
            {minutes ? <span className="tag">≈ {minutes} min</span> : null}
            <span className="tag">Correction immédiate</span>
            {singleAttempt && <span className="tag">Une seule tentative</span>}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="player-name">
            Votre prénom
          </label>
          <input
            id="player-name"
            type="text"
            className="input"
            placeholder="Ex. Aya"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            autoComplete="given-name"
          />
        </div>
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button type="submit" className="btn btn--primary btn--block" disabled={!name.trim()}>
          Commencer
          <Icon name="arrowRight" size={18} width={1.8} />
        </button>
        <span className="btn-hint">
          {singleAttempt
            ? 'Vos réponses sont enregistrées : vous pouvez reprendre plus tard, mais vous ne validerez qu’une fois.'
            : 'Vos réponses sont enregistrées : vous pouvez reprendre plus tard.'}
        </span>
      </div>
    </form>
  );
}

export default Welcome;
