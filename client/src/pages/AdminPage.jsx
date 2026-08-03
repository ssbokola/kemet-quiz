import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import UploadPDF from '../components/UploadPDF';
import ReviewQuestions from '../components/ReviewQuestions';
import AdminGate from '../components/AdminGate';
import Icon from '../components/Icon';
import { adminFetch, getAdminPassword } from '../api';

function formatExpiry(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AdminPage() {
  const [unlocked, setUnlocked] = useState(!!getAdminPassword());
  const [step, setStep] = useState('upload'); // upload → review → share
  const [quiz, setQuiz] = useState(null);
  const [dropped, setDropped] = useState(0);
  const [copied, setCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [closing, setClosing] = useState(false);
  // Une seule région polie pour tout l'écran de partage : copie du lien,
  // ouverture / fermeture du quiz. Les erreurs, elles, passent par la région
  // d'alerte assertive plus bas.
  const [announcement, setAnnouncement] = useState('');
  const shareTitleRef = useRef(null);
  // Erreur héritée de l'étape précédente : elle attend ici que l'écran de
  // partage soit monté (voir l'effet ci-dessous).
  const pendingErrorRef = useRef('');
  const copyTimerRef = useRef(null);

  const quizLink = quiz ? `${window.location.origin}/quiz/${quiz.quizId}` : '';

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre principal à son montage. L'écran de partage est rendu par AdminPage
  // elle-même — les écrans « upload » et « review » s'en chargent seuls, d'où
  // la garde : elle n'est pas un doublon du `?.`, elle empêche aussi le dépôt
  // de l'erreur en attente hors de l'écran de partage.
  //
  // Le focus va au TITRE, jamais au message d'erreur : celui-ci vit dans une
  // région role="alert" et serait alors annoncé deux fois (une fois par la
  // région, une fois par le focus). L'erreur est déposée dans la région APRÈS
  // le montage, donc par mutation d'une région live déjà présente : c'est la
  // seule façon d'être sûr qu'elle soit annoncée — et une seule fois.
  useEffect(() => {
    if (step !== 'share') return;
    shareTitleRef.current?.focus();
    if (pendingErrorRef.current) {
      setLoadError(pendingErrorRef.current);
      pendingErrorRef.current = '';
    }
  }, [step]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const handleQuizGenerated = async (data) => {
    setLoadError('');
    pendingErrorRef.current = '';
    setDropped(data.dropped || 0);
    try {
      const res = await adminFetch(`/api/quiz/${data.quizId}/full`);
      const full = await res.json();
      if (!res.ok) throw new Error(full.error || 'Chargement impossible');
      setQuiz({
        quizId: data.quizId,
        title: full.title,
        questions: full.questions,
        closed: full.closed,
        expiresAt: full.expiresAt,
        singleAttempt: full.singleAttempt,
      });
      setStep('review');
    } catch (err) {
      setQuiz({ quizId: data.quizId, title: data.title, questions: [] });
      // Pas de setLoadError ici : la région d'alerte n'existe pas encore, elle
      // naîtrait déjà pleine et ne serait pas annoncée. L'effet [step] la
      // remplit une fois l'écran monté.
      pendingErrorRef.current = err.message;
      setStep('share');
    }
  };

  const handlePublish = async (questions) => {
    setPublishing(true);
    setPublishError('');
    try {
      const res = await adminFetch(`/api/quiz/${quiz.quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible');
      setQuiz((prev) => ({ ...prev, questions }));
      setStep('share');
    } catch (err) {
      setPublishError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const toggleClosed = async () => {
    if (closing) return;
    setClosing(true);
    // On vide l'annonce et l'erreur AVANT l'appel : deux échecs identiques à la
    // suite ne produiraient sinon aucune mutation du DOM, donc aucune annonce.
    setLoadError('');
    setAnnouncement('');
    try {
      const res = await adminFetch(`/api/quiz/${quiz.quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: !quiz.closed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action impossible');
      setQuiz((prev) => ({ ...prev, closed: data.closed }));
      setAnnouncement(
        data.closed
          ? 'Quiz fermé : le lien ne répond plus.'
          : 'Quiz réouvert : le lien fonctionne à nouveau.'
      );
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setClosing(false);
    }
  };

  const handleCopy = async () => {
    clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(quizLink);
      setCopied(true);
      // Le passage « Copier » → « Copié » est un changement de nom accessible
      // sur l'élément qui a le focus : la plupart des lecteurs d'écran ne le
      // disent pas. L'annonce passe donc par la région polie, sans déplacer le
      // focus — l'utilisateur reste sur le bouton.
      setAnnouncement('Lien du quiz copié dans le presse-papiers.');
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        setAnnouncement('');
      }, 2000);
    } catch {
      setCopied(false);
      setAnnouncement('La copie a échoué. Sélectionnez le lien puis copiez-le à la main.');
    }
  };

  const handleShareWhatsApp = () => {
    const message = encodeURIComponent(
      `Bonjour,\nVoici le lien de votre quiz « ${quiz.title} » :\n${quizLink}\n\nBonne chance !`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const reset = () => {
    setQuiz(null);
    setStep('upload');
    setCopied(false);
    setDropped(0);
    setPublishError('');
    setLoadError('');
    pendingErrorRef.current = '';
    setAnnouncement('');
  };

  if (!unlocked) {
    return <AdminGate onUnlock={() => setUnlocked(true)} />;
  }

  if (step === 'upload') {
    return <UploadPDF onQuizGenerated={handleQuizGenerated} />;
  }

  if (step === 'review' && quiz) {
    return (
      <ReviewQuestions
        quizId={quiz.quizId}
        title={quiz.title}
        questions={quiz.questions}
        dropped={dropped}
        onPublish={handlePublish}
        publishing={publishing}
        publishError={publishError}
      />
    );
  }

  const expiry = formatExpiry(quiz.expiresAt);

  return (
    <div className="stack">
      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="share-badge" style={quiz.closed ? { background: 'var(--err-bg)', color: 'var(--err-text)' } : undefined}>
          <Icon name={quiz.closed ? 'close' : 'check'} size={13} width={2.4} />
          {quiz.closed ? 'Quiz fermé' : 'Quiz en ligne'}
        </span>
        <h1 className="share-title" ref={shareTitleRef} tabIndex={-1}>
          {quiz.title}
        </h1>
      </div>

      <div className="meta-row">
        {quiz.questions.length > 0 && <span>{quiz.questions.length} questions</span>}
        <span className="meta-row-sep" />
        <span>{quiz.singleAttempt === false ? 'Rejouable' : '1 tentative par personne'}</span>
        {expiry && (
          <>
            <span className="meta-row-sep" />
            <span>Jusqu’au {expiry}</span>
          </>
        )}
        <button
          type="button"
          className="btn-danger-link"
          onClick={toggleClosed}
          aria-busy={closing}
        >
          {closing ? 'Patientez…' : quiz.closed ? 'Réouvrir' : 'Fermer le quiz'}
        </button>
      </div>

      {/* Région d'alerte assertive, montée VIDE avec l'écran puis remplie :
          c'est l'unique mécanisme d'annonce des erreurs de cet écran, aussi
          bien celle héritée de l'étape précédente (déposée par l'effet [step])
          que celles survenues pendant la session (fermeture / réouverture).
          Le <p> ne reçoit donc jamais le focus : il serait relu une seconde
          fois. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {loadError ? (
          <p className="error-msg">
            <Icon name="info" size={16} width={1.8} />
            <span>{loadError}</span>
          </p>
        ) : null}
      </div>

      {/* Unique région polie de l'écran : copie du lien, ouverture/fermeture. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {announcement}
      </p>

      <div className="qr-frame">
        <QRCodeSVG value={quizLink} size={176} bgColor="#ffffff" fgColor="#1f1d24" level="M" />
        <p className="qr-label">Faites scanner ce code à l’écran</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quiz-link">
          Lien du quiz
        </label>
        <div className="link-row">
          <input id="quiz-link" type="text" value={quizLink} readOnly className="link-input" />
          <button
            type="button"
            className={`btn-copy ${copied ? 'is-copied' : ''}`}
            onClick={handleCopy}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} width={1.7} />
            {copied ? 'Copié' : 'Copier'}
          </button>
          {/* NE PAS poser aria-live sur ce bouton : son propre libellé serait
              relu à chaque bascule, en doublon de la région status. */}
        </div>
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button className="btn btn--wa btn--block" onClick={handleShareWhatsApp} disabled={quiz.closed}>
          <Icon name="send" size={18} width={1.7} />
          Envoyer sur WhatsApp
        </button>
        <div className="split-actions">
          {/* On vide l'erreur en quittant l'écran : sinon elle repeuplerait la
              région d'alerte au retour, qui la ré-annoncerait alors qu'elle
              concerne une action déjà passée. */}
          {quiz.questions.length > 0 && (
            <button
              className="btn btn--ghost"
              onClick={() => {
                setLoadError('');
                setStep('review');
              }}
            >
              <Icon name="edit" size={16} width={1.7} />
              Modifier
            </button>
          )}
          <button className="btn btn--ghost" onClick={reset}>
            Nouveau quiz
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminPage;
