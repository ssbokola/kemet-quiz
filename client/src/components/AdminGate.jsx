import { useRef, useState } from 'react';
import Icon from './Icon';
import { checkAdminPassword, setAdminPassword } from '../api';

/** Porte d'entrée de l'espace formateur (mot de passe partagé). */
function AdminGate({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    // Le bouton n'est plus désactivé : la double soumission est bloquée ici,
    // et le champ vide devient une erreur annoncée au lieu d'un bouton mort.
    if (busy) return;
    if (!pw) {
      setError('Saisissez le mot de passe pour entrer.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await checkAdminPassword(pw);
      setAdminPassword(pw);
      onUnlock();
    } catch (err) {
      setError(err.message);
      inputRef.current?.focus();
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
        {/* Pas d'aria-describedby vers le message : la région d'alerte ci-dessous
            est l'unique canal d'annonce. Le champ reprend le focus pour que la
            correction soit immédiate, et signale la faute par aria-invalid
            (« invalide ») sans refaire lire le texte que l'alerte vient d'énoncer. */}
        <input
          id="admin-pw"
          ref={inputRef}
          type="password"
          className="input"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
        />
      </div>

      {/* Région d'alerte permanente : montée vide au premier rendu, donc
          réellement annoncée quand le message arrive. Seul mécanisme d'annonce
          de l'erreur sur cet écran : aucun aria-describedby ne pointe ici, sinon
          le message serait relu comme description du champ qui prend le focus. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {error ? (
          <p className="error-msg">
            <Icon name="info" size={16} width={1.8} />
            <span>{error}</span>
          </p>
        ) : null}
      </div>

      {/* Unique région polie de l'écran : elle ne parle que pendant l'attente. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {busy ? 'Vérification du mot de passe…' : ''}
      </p>

      <button type="submit" className="btn btn--ink btn--block" aria-busy={busy}>
        {busy ? (
          <>
            <span className="btn-spinner" aria-hidden="true" /> Vérification…
          </>
        ) : (
          <>
            Entrer
            <Icon name="arrowRight" size={18} width={1.8} />
          </>
        )}
      </button>

      {/* Repère pour le participant égaré : la route / ne mène qu'ici. */}
      <p className="subtle" style={{ textAlign: 'center' }}>
        Vous êtes participant ? Ouvrez le lien ou scannez le QR code que votre formateur vous a
        transmis.
      </p>
    </form>
  );
}

export default AdminGate;
