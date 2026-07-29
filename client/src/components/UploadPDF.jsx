import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Icon from './Icon';
import { adminFetch } from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const QUESTION_OPTIONS = [5, 10, 15, 20, 30];
const DIFFICULTY_OPTIONS = [
  { value: 'facile', label: 'Facile', desc: 'restitution directe' },
  { value: 'moyen', label: 'Moyen', desc: 'compréhension' },
  { value: 'difficile', label: 'Difficile', desc: "cas d'application" },
];

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Sans limite' },
  { value: 24, label: '24 h' },
  { value: 168, label: '7 jours' },
];

const MINUTES_PER_QUESTION = 0.5;

function formatSize(bytes) {
  if (!bytes) return '';
  const mo = bytes / (1024 * 1024);
  if (mo >= 1) return `${mo.toFixed(1).replace('.', ',')} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}

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
  return { text: text.trim(), pages: pdf.numPages };
}

function UploadPDF({ onQuizGenerated }) {
  const [file, setFile] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [title, setTitle] = useState('');
  const [numQuestions, setNumQuestions] = useState(10);
  const [difficulty, setDifficulty] = useState('moyen');
  const [singleAttempt, setSingleAttempt] = useState(true);
  const [expiresInHours, setExpiresInHours] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 'read' → 'write' → 'verify'
  const [stage, setStage] = useState('read');
  const [readProgress, setReadProgress] = useState(null);
  const inputRef = useRef();

  const acceptFile = (candidate) => {
    if (!candidate) return;
    const isPdf =
      candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setError('Ce format n’est pas géré. Déposez un fichier PDF.');
      return;
    }
    setFile(candidate);
    setPageCount(null);
    setTitle(candidate.name.replace(/\.pdf$/i, ''));
    setError('');
  };

  const clearFile = () => {
    setFile(null);
    setPageCount(null);
    setTitle('');
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const estMinutes = Math.max(2, Math.round(numQuestions * MINUTES_PER_QUESTION));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Choisissez d’abord un PDF.');
      return;
    }

    setLoading(true);
    setError('');
    setStage('read');
    setReadProgress(null);

    try {
      const { text, pages } = await extractTextFromPdf(file, (cur, total) => {
        setReadProgress({ cur, total });
      });
      setPageCount(pages);

      const formData = new FormData();
      formData.append('numQuestions', numQuestions);
      formData.append('difficulty', difficulty);
      formData.append('title', (title || file.name.replace(/\.pdf$/i, '')).trim());
      formData.append('singleAttempt', singleAttempt ? 'true' : 'false');
      formData.append('expiresInHours', String(expiresInHours));

      if (text && text.length > 200) {
        formData.append('text', text);
      } else {
        // PDF scanné : on envoie le binaire, le modèle lit l'image
        formData.append('pdf', file);
      }

      setStage('write');

      const res = await adminFetch('/api/upload-pdf', { method: 'POST', body: formData });
      if (res.status === 401) {
        throw new Error('Session expirée : rechargez la page et saisissez le mot de passe.');
      }
      if (!res.ok) throw new Error(`Le serveur a répondu une erreur (${res.status}).`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === 'done') {
            result = msg;
            done = true;
          } else if (msg.type === 'error') {
            throw new Error(msg.error || 'Erreur inconnue');
          } else if (msg.type === 'progress') {
            setStage('write');
          }
        }
      }

      if (!result) throw new Error('Réponse du serveur incomplète, réessayez.');
      setStage('verify');
      onQuizGenerated(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    const pct = stage === 'read' ? (readProgress ? Math.round((readProgress.cur / readProgress.total) * 25) : 5) : stage === 'write' ? 70 : 95;
    return (
      <div className="progress-screen">
        <div className="progress-head">
          <div className="spinner" />
          <h2>Fabrication du quiz</h2>
          <p>Laissez cet onglet ouvert, comptez environ une minute.</p>
        </div>

        <div className="steps">
          <div className={`step ${stage === 'read' ? 'is-doing' : 'is-done'}`}>
            {stage === 'read' ? (
              <span className="spinner spinner--sm" />
            ) : (
              <span className="step-bullet">
                <Icon name="check" size={13} width={2.4} />
              </span>
            )}
            <span className="step-name">Lecture du document</span>
            <span className="step-meta">
              {readProgress ? `${readProgress.cur} / ${readProgress.total} pages` : ''}
            </span>
          </div>

          <div
            className={`step ${
              stage === 'write' ? 'is-doing' : stage === 'verify' ? 'is-done' : 'is-todo'
            }`}
          >
            {stage === 'write' ? (
              <span className="spinner spinner--sm" />
            ) : stage === 'verify' ? (
              <span className="step-bullet">
                <Icon name="check" size={13} width={2.4} />
              </span>
            ) : (
              <span className="step-bullet" />
            )}
            <span className="step-name">Rédaction des questions</span>
            <span className="step-meta">{numQuestions} attendues</span>
          </div>

          <div className={`step ${stage === 'verify' ? 'is-doing' : 'is-todo'}`}>
            {stage === 'verify' ? (
              <span className="spinner spinner--sm" />
            ) : (
              <span className="step-bullet" />
            )}
            <span className="step-name">Vérification des réponses</span>
          </div>
        </div>

        <div>
          <div className="bar">
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="bar-legend">
            <span>{pct} %</span>
            <span>ne fermez pas la page</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div className="page-head">
        <h1>Créer un quiz</h1>
        <p>Déposez un document, l’IA en tire des questions à choix multiple.</p>
      </div>

      {!file ? (
        <label
          className={`dropzone ${dragOver ? 'is-over' : ''}`}
          htmlFor="pdf-input"
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
        >
          <Icon name="doc" size={34} stroke="var(--gold)" width={1.4} />
          <span className="dropzone-title">Glissez un PDF ici</span>
          <span className="dropzone-alt">
            ou <b>parcourez vos fichiers</b>
          </span>
          <span className="dropzone-meta">PDF texte ou scanné · 20 Mo max</span>
        </label>
      ) : (
        <div className="file-chip">
          <Icon name="doc" size={20} stroke="var(--gold-deep)" width={1.5} />
          <span className="file-chip-body">
            <span className="file-chip-name">{file.name}</span>
            <span className="file-chip-meta">
              {pageCount ? `${pageCount} pages · ` : ''}
              {formatSize(file.size)}
            </span>
          </span>
          <button
            type="button"
            className="file-chip-remove"
            onClick={clearFile}
            aria-label="Retirer le fichier"
          >
            <Icon name="close" size={13} width={2} />
          </button>
        </div>
      )}

      <input
        id="pdf-input"
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="file-input"
        onChange={(e) => acceptFile(e.target.files[0])}
      />

      {file && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="quiz-title">
              Titre du quiz
            </label>
            <input
              id="quiz-title"
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Procédure caisse"
            />
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label">Nombre de questions</span>
              <span className="dropzone-meta">≈ {estMinutes} min</span>
            </div>
            <div className="segments">
              {QUESTION_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`segment ${numQuestions === n ? 'is-active' : ''}`}
                  aria-pressed={numQuestions === n}
                  onClick={() => setNumQuestions(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Niveau</span>
            <div className="choices">
              {DIFFICULTY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`choice ${difficulty === opt.value ? 'is-active' : ''}`}
                  aria-pressed={difficulty === opt.value}
                  onClick={() => setDifficulty(opt.value)}
                >
                  <span className="choice-dot" />
                  <span className="choice-label">{opt.label}</span>
                  <span className="choice-desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Diffusion</span>
            <div className="choices">
              <button
                type="button"
                className={`choice ${singleAttempt ? 'is-active' : ''}`}
                aria-pressed={singleAttempt}
                onClick={() => setSingleAttempt(true)}
              >
                <span className="choice-dot" />
                <span className="choice-label">1 tentative</span>
                <span className="choice-desc">un score par participant</span>
              </button>
              <button
                type="button"
                className={`choice ${!singleAttempt ? 'is-active' : ''}`}
                aria-pressed={!singleAttempt}
                onClick={() => setSingleAttempt(false)}
              >
                <span className="choice-dot" />
                <span className="choice-label">Libre</span>
                <span className="choice-desc">entraînement, rejouable</span>
              </button>
            </div>
            <div className="segments segments--3" style={{ marginTop: 4 }}>
              {EXPIRY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`segment segment--text ${
                    expiresInHours === opt.value ? 'is-active' : ''
                  }`}
                  aria-pressed={expiresInHours === opt.value}
                  onClick={() => setExpiresInHours(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="dropzone-meta">
              Passé ce délai le lien ne fonctionne plus. Vous pourrez aussi fermer le quiz à la
              main.
            </span>
          </div>
        </>
      )}

      {error && (
        <p className="error-msg">
          <Icon name="info" size={16} width={1.8} />
          <span>{error}</span>
        </p>
      )}

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button type="submit" className="btn btn--primary btn--block" disabled={!file}>
          Générer {numQuestions} questions
          <Icon name="arrowRight" size={18} width={1.8} />
        </button>
        <span className="btn-hint">
          {file
            ? 'Vous pourrez relire et corriger avant de partager'
            : 'Choisissez un PDF pour continuer'}
        </span>
      </div>
    </form>
  );
}

export default UploadPDF;
