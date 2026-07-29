import { useState, useEffect } from 'react';
import Icon from './Icon';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

function stripLetter(text) {
  return String(text).replace(/^[A-F]\)\s*/, '');
}

/**
 * Mode focus : une question par écran, thème encre & or.
 * - pas d'auto-avance : le participant garde la main
 * - barre segmentée + feuille « toutes les questions » (lisible même à 30)
 * - écran de récapitulatif final qui NOMME les questions manquantes
 */
function Quiz({
  quizTitle,
  questions,
  userAnswers,
  onAnswer,
  onSubmit,
  submitting,
  submitError,
  onClearSubmitError,
  resumed,
  onRestart,
}) {
  const total = questions.length;
  // index === total → écran de récapitulatif
  const [current, setCurrent] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const answered = Object.keys(userAnswers).length;
  const allAnswered = answered === total;
  const onRecap = current >= total;
  const q = onRecap ? null : questions[current];
  const missing = questions.map((_, i) => i).filter((i) => !userAnswers[i]);

  useEffect(() => {
    document.body.classList.add('theme-ink');
    return () => document.body.classList.remove('theme-ink');
  }, []);

  useEffect(() => {
    if (!sheetOpen && !confirmOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSheetOpen(false);
        if (!submitting) setConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, confirmOpen, submitting]);

  const goTo = (idx) => {
    setCurrent(idx);
    setSheetOpen(false);
    window.scrollTo({ top: 0 });
  };

  // Raccourcis clavier : A–D (ou 1–4) pour répondre, flèches pour naviguer
  useEffect(() => {
    if (sheetOpen || confirmOpen) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (!onRecap && q) {
        const key = e.key.toUpperCase();
        let optIdx = LETTERS.indexOf(key);
        if (optIdx === -1 && /^[1-6]$/.test(e.key)) optIdx = Number(e.key) - 1;
        if (optIdx > -1 && optIdx < q.options.length) {
          e.preventDefault();
          onAnswer(current, LETTERS[optIdx]);
          return;
        }
      }

      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (onRecap) {
          if (allAnswered) openConfirm();
        } else {
          goTo(current + 1);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (current > 0) goTo(current - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onRecap, q, sheetOpen, confirmOpen, allAnswered, onAnswer]);

  const openConfirm = () => {
    if (onClearSubmitError) onClearSubmitError();
    setConfirmOpen(true);
  };

  return (
    <div className="quiz">
      <div className="quiz-top">
        <div className="quiz-top-row">
          <span className="quiz-doc">{quizTitle}</span>
          <span className="quiz-count">
            {onRecap ? 'Récapitulatif' : `${String(current + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}
          </span>
        </div>
        <div className="quiz-ticks" role="presentation">
          {questions.map((_, idx) => (
            <button
              key={idx}
              type="button"
              className={`tick ${userAnswers[idx] ? 'is-answered' : ''} ${
                idx === current ? 'is-current' : ''
              }`}
              onClick={() => goTo(idx)}
              aria-label={`Aller à la question ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      {resumed && !onRecap && (
        <div className="quiz-resume">
          <span>Reprise de votre quiz</span>
          <button type="button" className="link-btn" onClick={onRestart}>
            Recommencer
          </button>
        </div>
      )}

      {onRecap ? (
        <div className="recap">
          <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2>{allAnswered ? 'Tout est répondu' : 'Il reste des questions'}</h2>
            <p>
              {allAnswered
                ? `Vous avez répondu aux ${total} questions. Vous pouvez encore revenir sur l’une d’elles avant d’envoyer.`
                : `${missing.length} question${missing.length > 1 ? 's' : ''} sans réponse. Touchez un numéro pour y retourner.`}
            </p>
          </div>

          {!allAnswered && (
            <div className="recap-missing">
              <span className="recap-missing-title">À compléter</span>
              <div className="recap-missing-list">
                {missing.map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="recap-missing-chip"
                    onClick={() => goTo(idx)}
                  >
                    Question {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="recap-grid">
            {questions.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`recap-cell ${userAnswers[idx] ? 'is-answered' : ''}`}
                onClick={() => goTo(idx)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="quiz-body" key={current}>
          <h1 className="quiz-question">{q.question}</h1>
          <div className="quiz-options">
            {q.options.map((option, optIdx) => {
              const letter = LETTERS[optIdx];
              const isSelected = userAnswers[current] === letter;
              return (
                <button
                  key={optIdx}
                  type="button"
                  className={`opt ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onAnswer(current, letter)}
                >
                  <span className="opt-letter">{letter}</span>
                  <span className="opt-text">{stripLetter(option)}</span>
                  {isSelected && (
                    <Icon name="check" size={17} width={2.2} className="opt-check" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="kbd-hint">
            <span className="kbd">A</span>
            <span className="kbd">B</span>
            <span className="kbd">C</span>
            <span className="kbd">D</span>
            <span>pour répondre</span>
            <span className="kbd">←</span>
            <span className="kbd">→</span>
            <span>pour naviguer</span>
          </div>
        </div>
      )}

      <div className="quiz-foot">
        <button
          type="button"
          className="btn-ink-ghost btn-ink-ghost--icon"
          onClick={() => goTo(Math.max(0, current - 1))}
          disabled={current === 0}
          aria-label="Question précédente"
        >
          <Icon name="arrowLeft" size={18} width={1.8} />
        </button>

        <button
          type="button"
          className="btn-ink-ghost btn-ink-ghost--icon"
          onClick={() => setSheetOpen(true)}
          aria-label="Voir toutes les questions"
        >
          <Icon name="list" size={18} width={1.7} />
        </button>

        {onRecap ? (
          <button
            type="button"
            className="btn-gold"
            onClick={openConfirm}
            disabled={!allAnswered}
          >
            {allAnswered ? 'Envoyer mes réponses' : `${missing.length} question${missing.length > 1 ? 's' : ''} à compléter`}
            {allAnswered && <Icon name="send" size={17} width={1.8} />}
          </button>
        ) : (
          <button type="button" className="btn-gold" onClick={() => goTo(current + 1)}>
            {current === total - 1 ? 'Terminer' : 'Suivante'}
            <Icon name="arrowRight" size={18} width={1.9} />
          </button>
        )}
      </div>

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="sheet-head">
              <h3>
                Toutes les questions · {answered}/{total}
              </h3>
              <button
                type="button"
                className="sheet-close"
                onClick={() => setSheetOpen(false)}
                aria-label="Fermer"
              >
                <Icon name="close" size={15} width={2} />
              </button>
            </div>
            <div className="sheet-list">
              {questions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`sheet-row ${userAnswers[idx] ? 'is-answered' : ''} ${
                    idx === current ? 'is-current' : ''
                  }`}
                  onClick={() => goTo(idx)}
                >
                  <span className="sheet-row-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="sheet-row-text">{item.question}</span>
                  <span className="sheet-row-state">
                    {userAnswers[idx] ? userAnswers[idx] : '—'}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="btn-ink-ghost" onClick={() => goTo(total)}>
              Aller au récapitulatif
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => !submitting && setConfirmOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>Envoyer vos réponses ?</h3>
            <p>
              Vous avez répondu aux <strong>{total}</strong> questions. Après envoi, vous ne pourrez
              plus les modifier — vous verrez la correction complète.
            </p>
            {submitError && (
              <p className="error-msg">
                <Icon name="info" size={16} width={1.8} />
                <span>{submitError}</span>
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Retour
              </button>
              <button
                type="button"
                className="btn btn--ink"
                onClick={onSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="btn-spinner" /> Envoi…
                  </>
                ) : (
                  'Envoyer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Quiz;
