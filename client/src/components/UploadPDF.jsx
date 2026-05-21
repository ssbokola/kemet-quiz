import { useState, useRef } from 'react';

const QUESTION_OPTIONS = [5, 10, 15, 20, 30];

function UploadPDF({ onQuizGenerated }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [numQuestions, setNumQuestions] = useState(10);
  const [progressMsg, setProgressMsg] = useState('');
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
    setProgressMsg('Envoi du document...');

    try {
      const formData = new FormData();
      formData.append('pdf', file);
      formData.append('numQuestions', numQuestions);

      const res = await fetch('/api/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Erreur serveur (${res.status})`);
      }

      // Read NDJSON stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;
      let result = null;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }

          if (msg.type === 'progress' && msg.message) {
            setProgressMsg(msg.message);
          } else if (msg.type === 'done') {
            result = msg;
            done = true;
          } else if (msg.type === 'error') {
            throw new Error(msg.error || 'Erreur inconnue');
          }
        }
      }

      if (!result) throw new Error('Réponse du serveur incomplète');
      onQuizGenerated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  return (
    <div className="upload-section">
      <form onSubmit={handleSubmit} className="upload-form">
        <label className="file-label" htmlFor="pdf-input">
          <span className="file-icon">📄</span>
          <span>{fileName || 'Choisir un support de formation (PDF)'}</span>
        </label>
        <input
          id="pdf-input"
          type="file"
          accept=".pdf"
          ref={fileRef}
          onChange={handleFileChange}
          className="file-input"
        />

        {fileName && (
          <div className="question-count-section">
            <label className="question-count-label">Nombre de questions :</label>
            <div className="question-count-options">
              {QUESTION_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`question-count-btn ${numQuestions === n ? 'active' : ''}`}
                  onClick={() => setNumQuestions(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        <button type="submit" disabled={loading || !fileName} className="btn btn-primary">
          {loading ? 'Generation du quiz...' : `Generer ${numQuestions} questions`}
        </button>
      </form>

      {loading && (
        <div className="loader">
          <div className="spinner" />
          <p>{progressMsg || 'Analyse du PDF en cours...'}</p>
          <p style={{ fontSize: '0.85rem', color: '#aaa', marginTop: '8px' }}>
            Cela peut prendre 1 à 2 minutes pour les gros PDF.
          </p>
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}

export default UploadPDF;
