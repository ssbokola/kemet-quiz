import { useState } from 'react';
import Icon from './Icon';

import { adminFetch } from '../api';

const LETTERS = ['A', 'B', 'C', 'D'];

function stripLetter(text) {
  return String(text).replace(/^[A-D]\)\s*/, '');
}

/**
 * Relecture / édition des questions générées, avant partage.
 * Le formateur peut reformuler une question, corriger une option,
 * changer la bonne réponse, ou régénérer une question isolée.
 */
function ReviewQuestions({
  quizId,
  title,
  questions,
  dropped = 0,
  onPublish,
  publishing,
  publishError,
}) {
  const [items, setItems] = useState(questions);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [rowError, setRowError] = useState('');

  const update = (idx, patch) =>
    setItems((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));

  const setOption = (idx, optIdx, value) =>
    setItems((prev) =>
      prev.map((q, i) =>
        i === idx
          ? { ...q, options: q.options.map((o, j) => (j === optIdx ? `${LETTERS[j]}) ${value}` : o)) }
          : q
      )
    );

  const regenerate = async (idx) => {
    setBusy(idx);
    setRowError('');
    try {
      const res = await adminFetch(`/api/quiz/${quizId}/regenerate/${idx}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Régénération impossible');
      update(idx, data.question);
    } catch (err) {
      setRowError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="review-head">
        <h2>Relire avant de partager</h2>
        <span className="subtle">
          {items.length} questions générées pour « {title} » — modifiez ce qui doit l’être.
        </span>
      </div>

      {dropped > 0 && (
        <p className="notice" style={{ marginBottom: 12 }}>
          <Icon name="info" size={15} width={1.8} />
          <span>
            {dropped} question{dropped > 1 ? 's' : ''} écartée{dropped > 1 ? 's' : ''} à la
            génération (réponse manquante ou options incomplètes). Utilisez la régénération si vous
            en voulez davantage.
          </span>
        </p>
      )}

      {rowError && (
        <p className="error-msg" style={{ marginBottom: 12 }}>
          <Icon name="info" size={16} width={1.8} />
          <span>{rowError}</span>
        </p>
      )}

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((q, idx) => {
          const isEditing = editing === idx;
          return (
            <div className="q-card" key={idx}>
              <div className="q-card-bar">
                <span className="q-card-num">QUESTION {idx + 1}</span>
                <div className="q-card-tools">
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => setEditing(isEditing ? null : idx)}
                  >
                    <Icon name={isEditing ? 'check' : 'edit'} size={12} width={1.8} />
                    {isEditing ? 'Terminé' : 'Modifier'}
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => regenerate(idx)}
                    disabled={busy !== null}
                    aria-label="Régénérer cette question"
                    title="Régénérer cette question"
                  >
                    {busy === idx ? (
                      <span className="spinner spinner--sm" style={{ width: 13, height: 13 }} />
                    ) : (
                      <Icon name="refresh" size={13} width={1.8} />
                    )}
                  </button>
                </div>
              </div>

              {isEditing ? (
                <textarea
                  className="q-card-input"
                  value={q.question}
                  onChange={(e) => update(idx, { question: e.target.value })}
                />
              ) : (
                <p className="q-card-text">{q.question}</p>
              )}

              <div className="q-options">
                {q.options.map((option, optIdx) => {
                  const letter = LETTERS[optIdx];
                  const isAnswer = q.answer === letter;
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className={`q-option ${isAnswer ? 'is-answer' : ''}`}
                      onClick={() => update(idx, { answer: letter })}
                      title="Définir comme bonne réponse"
                    >
                      <span className="q-option-dot">
                        {isAnswer && <Icon name="check" size={13} width={2.6} />}
                      </span>
                      {isEditing ? (
                        <input
                          className="q-option-input"
                          value={stripLetter(option)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setOption(idx, optIdx, e.target.value)}
                        />
                      ) : (
                        <span>{stripLetter(option)}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {q.explanation && !isEditing && (
                <div className="r-explain">
                  <Icon name="info" size={15} width={1.8} />
                  <span>{q.explanation}</span>
                </div>
              )}
              {q.explanation && isEditing && (
                <textarea
                  className="q-card-input"
                  style={{ minHeight: 60 }}
                  value={q.explanation}
                  onChange={(e) => update(idx, { explanation: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>

      {publishError && (
        <p className="error-msg" style={{ marginTop: 14 }}>
          <Icon name="info" size={16} width={1.8} />
          <span>{publishError}</span>
        </p>
      )}

      <div className="sticky-actions">
        <button
          type="button"
          className="btn btn--ink btn--block"
          onClick={() => onPublish(items)}
          disabled={publishing}
        >
          {publishing ? (
            <>
              <span className="btn-spinner" /> Enregistrement…
            </>
          ) : (
            <>
              Publier le quiz
              <Icon name="arrowRight" size={18} width={1.8} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ReviewQuestions;
