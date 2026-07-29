import { useState } from 'react';
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

  const quizLink = quiz ? `${window.location.origin}/quiz/${quiz.quizId}` : '';

  const handleQuizGenerated = async (data) => {
    setLoadError('');
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
      setLoadError(err.message);
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
    setClosing(true);
    try {
      const res = await adminFetch(`/api/quiz/${quiz.quizId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ closed: !quiz.closed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action impossible');
      setQuiz((prev) => ({ ...prev, closed: data.closed }));
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setClosing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(quizLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
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
        <h1 className="share-title">{quiz.title}</h1>
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
        <button className="btn-danger-link" onClick={toggleClosed} disabled={closing}>
          {closing ? '…' : quiz.closed ? 'Réouvrir' : 'Fermer le quiz'}
        </button>
      </div>

      {loadError && (
        <p className="error-msg">
          <Icon name="info" size={16} width={1.8} />
          <span>{loadError}</span>
        </p>
      )}

      <div className="qr-frame">
        <QRCodeSVG value={quizLink} size={176} bgColor="#ffffff" fgColor="#1f1d24" level="M" />
        <p className="qr-label">Faites scanner ce code à l’écran</p>
      </div>

      <div className="field">
        <span className="field-label">Lien du quiz</span>
        <div className="link-row">
          <input type="text" value={quizLink} readOnly className="link-input" />
          <button className={`btn-copy ${copied ? 'is-copied' : ''}`} onClick={handleCopy}>
            <Icon name={copied ? 'check' : 'copy'} size={15} width={1.7} />
            {copied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button className="btn btn--wa btn--block" onClick={handleShareWhatsApp} disabled={quiz.closed}>
          <Icon name="send" size={18} width={1.7} />
          Envoyer sur WhatsApp
        </button>
        <div className="split-actions">
          {quiz.questions.length > 0 && (
            <button className="btn btn--ghost" onClick={() => setStep('review')}>
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
