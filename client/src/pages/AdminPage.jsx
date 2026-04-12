import { useState } from 'react';
import UploadPDF from '../components/UploadPDF';

function AdminPage() {
  const [quizLink, setQuizLink] = useState('');
  const [quizTitle, setQuizTitle] = useState('');
  const [copied, setCopied] = useState(false);

  const handleQuizGenerated = (data) => {
    const link = `${window.location.origin}/quiz/${data.quizId}`;
    setQuizLink(link);
    setQuizTitle(data.title);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(quizLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const message = encodeURIComponent(
      `Bonjour,\nVoici le lien de votre quiz "${quizTitle}" :\n${quizLink}\n\nBonne chance !`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  const handleReset = () => {
    setQuizLink('');
    setQuizTitle('');
    setCopied(false);
  };

  return (
    <div>
      {!quizLink ? (
        <UploadPDF onQuizGenerated={handleQuizGenerated} />
      ) : (
        <div className="link-section">
          <div className="success-card">
            <div className="success-icon">✓</div>
            <h2>Quiz généré avec succès !</h2>
            <p className="quiz-title">{quizTitle}</p>

            <div className="link-box">
              <input type="text" value={quizLink} readOnly className="link-input" />
              <button className={`btn btn-copy ${copied ? 'copied' : ''}`} onClick={handleCopy}>
                {copied ? '✓ Copié !' : 'Copier'}
              </button>
            </div>

            <div className="action-buttons">
              <button className="btn btn-whatsapp" onClick={handleShareWhatsApp}>
                💬 Envoyer sur WhatsApp
              </button>
              <button className="btn btn-primary" onClick={handleReset}>
                Nouveau quiz
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;
