import { useState, useRef } from 'react';

function UploadPDF({ onQuizGenerated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const fileRef = useRef();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setFileName(file.name);
      setError('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const file = fileRef.current.files[0];
    if (!file) {
      setError('Veuillez sélectionner un fichier PDF');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      const text = await res.text();

      if (!res.ok) {
        let errorMsg = `Erreur serveur (${res.status})`;
        try {
          const errData = JSON.parse(text);
          errorMsg = errData.error || errorMsg;
        } catch {}
        throw new Error(errorMsg);
      }

      const data = JSON.parse(text);
      onQuizGenerated(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="upload-section">
      <form onSubmit={handleSubmit} className="upload-form">
        <label className="file-label" htmlFor="pdf-input">
          <span className="file-icon">📄</span>
          <span>{fileName || 'Choisir un fichier PDF'}</span>
        </label>
        <input
          id="pdf-input"
          type="file"
          accept=".pdf"
          ref={fileRef}
          onChange={handleFileChange}
          className="file-input"
        />
        <button type="submit" disabled={loading || !fileName} className="btn btn-primary">
          {loading ? 'Génération du quiz...' : 'Générer le quiz'}
        </button>
      </form>

      {loading && (
        <div className="loader">
          <div className="spinner" />
          <p>Analyse du PDF en cours... Cela peut prendre quelques secondes.</p>
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}

export default UploadPDF;
