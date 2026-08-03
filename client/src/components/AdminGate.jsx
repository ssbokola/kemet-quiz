import { useRef, useState } from 'react';
import Icon from './Icon';
import { checkAdminPassword, setAdminPassword } from '../api';

/** Porte d'entrée de l'espace formateur (mot de passe partagé). */
function AdminGate({ onUnlock }) {
  const [pw, setPw] = useState('');
  // Le texte du refus ET le NUMÉRO de son occurrence. Deux soumissions vides
  // d'affilée, ou deux fois le même mot de passe faux, écrivent la même phrase :
  // sans ce numéro l'état ne changerait pas, React court-circuiterait le rendu,
  // le DOM de la région d'alerte ne muterait pas et le lecteur d'écran resterait
  // muet au second appui. Le numéro n'est jamais affiché : il sert de `key` au
  // message, qui est ainsi démonté puis remonté DANS la région déjà présente —
  // une vraie mutation de son contenu, donc une vraie annonce, à chaque fois.
  const [error, setError] = useState({ texte: '', n: 0 });
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  // Seule porte d'écriture de l'erreur : le numéro s'incrémente à CHAQUE appel,
  // effacement compris. Ne jamais appeler setError directement.
  const signalerErreur = (texte) => setError((prev) => ({ texte, n: prev.n + 1 }));

  const submit = async (e) => {
    e.preventDefault();
    // Le bouton n'est plus désactivé : la double soumission est bloquée ici,
    // et le champ vide devient une erreur annoncée au lieu d'un bouton mort.
    if (busy) return;
    if (!pw) {
      // Ce refus-ci sort AVANT l'effacement qui protège le chemin réseau : c'est
      // le numéro d'occurrence, et lui seul, qui garantit qu'un deuxième envoi à
      // vide soit annoncé comme le premier.
      signalerErreur('Saisissez le mot de passe pour entrer.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    signalerErreur('');
    try {
      await checkAdminPassword(pw);
    } catch (err) {
      // Repli obligatoire : un rejet sans message laisserait le texte à
      // undefined, la région d'alerte resterait vide et l'échec serait à la fois
      // muet et invisible — alors que le focus, lui, reviendrait dans le champ.
      signalerErreur(err?.message || 'La vérification du mot de passe a échoué, réessayez.');
      inputRef.current?.focus();
      return;
    } finally {
      setBusy(false);
    }
    // HORS du try : ces deux appels ne sont pas la vérification. Les y laisser
    // ferait présenter leur échec éventuel comme un refus d'identification,
    // c'est-à-dire comme un mot de passe faux — alors qu'il vient d'être accepté.
    setAdminPassword(pw);
    onUnlock();
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
          aria-invalid={error.texte ? true : undefined}
        />
      </div>

      {/* Région d'alerte permanente : montée vide au premier rendu, donc
          réellement annoncée quand le message arrive. Seul mécanisme d'annonce
          de l'erreur sur cet écran : aucun aria-describedby ne pointe ici, sinon
          le message serait relu comme description du champ qui prend le focus.
          La `key` porte le numéro d'occurrence : à refus identique répété, elle
          change, React remplace le <p> au lieu de le laisser tel quel, et la
          région — elle, toujours montée — voit bien son contenu muter. Sans
          elle, le second refus identique n'est annoncé nulle part. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {error.texte ? (
          <p className="error-msg" key={error.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{error.texte}</span>
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
