import { useState } from 'react';
import Icon from './Icon';
import { checkAdminPassword, setAdminPassword } from '../api';

/** Porte d'entrée de l'espace formateur (mot de passe partagé). */
function AdminGate({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await checkAdminPassword(pw);
      setAdminPassword(pw);
      onUnlock();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit} style={{ maxWidth: 380, margin: '8vh auto 0' }}>
      <div className="page-head">
        <h1>Espace formateur</h1>
        <p>Cet espace crée des quiz et consomme le crédit du modèle : il est protégé.</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="admin-pw">
          Mot de passe
        </label>
        <input
          id="admin-pw"
          type="password"
          className="input"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
      </div>

      {error && (
        <p className="error-msg">
          <Icon name="info" size={16} width={1.8} />
          <span>{error}</span>
        </p>
      )}

      <button type="submit" className="btn btn--ink btn--block" disabled={busy || !pw}>
        {busy ? (
          <>
            <span className="btn-spinner" /> Vérification…
          </>
        ) : (
          <>
            Entrer
            <Icon name="arrowRight" size={18} width={1.8} />
          </>
        )}
      </button>
    </form>
  );
}

export default AdminGate;
