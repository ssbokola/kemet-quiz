import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const QUESTION_OPTIONS = [5, 10, 15, 20, 30];

async function extractTextFromPdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n\n';
  }
  return text.trim();
}

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

    try {
      // Step 1: extract text in the browser
      setProgressMsg('Lecture du PDF...');
      const text = await extractTextFromPdf(file, (cur, total) => {
        setProgressMsg(`Lecture du PDF (page ${cur}/${total})...`);
      });

      const formData = new FormData();
      formData.append('numQuestions', numQuestions);
      formData.append('title', file.name.replace(/\.pdf$/i, ''));

      if (text && text.length > 200) {
        // Text extraction succeeded — send only the text (fast path)
        formData.append('text', text);
        setProgressMsg('Envoi du texte au modèle...');
      } else {
        // Likely a scanned PDF — fall back to sending the binary
        formData.append('pdf', file);
        setProgressMsg('PDF scanné détecté — envoi du document complet...');
      }

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
            Cela peut prendre 30 secondes à 1 minute.
          </p>
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}
    </div>
  );
}

export default UploadPDF;
