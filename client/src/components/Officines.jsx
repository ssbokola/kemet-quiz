import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme sur les écrans jumeaux d'apprenants.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Pas de 'import' ici : contrairement aux apprenants, aucun historique
// d'officines n'existe à reprendre — la table naît vide.
const ORIGINES = {
  learner: 'créée par l’apprenant',
  trainer: 'créée par vous',
};

// `attempts` compte des APPRENANTS rattachés, pas des évaluations — c'est ce
// que le formateur pèse pour une officine : « celle-ci en tient douze ».
function texteApprenants(n) {
  if (!Number.isFinite(n) || n <= 0) return 'aucun apprenant rattaché';
  return `${n} apprenant${n > 1 ? 's' : ''}`;
}

/**
 * Écran « Officines » — espace formateur uniquement.
 *
 * Copie fonctionnelle d'AnnuaireApprenants.jsx : même trame (créer, lister,
 * ouvrir pour corriger), mêmes conventions d'accessibilité. Dupliqué plutôt
 * que généralisé — les deux annuaires vont diverger (celui-ci gagnera une vue
 * « apprenants de cette officine ») et un défaut ici, derrière un mot de
 * passe, coûte un rechargement, pas une participation perdue.
 *
 * `onOuvrirFiche` reçoit la fiche entière, comme onOuvrirFiche des apprenants.
 */
function Officines({ onOuvrirFiche, onDoublons, onAffecter, onRetour, messageEntrant = '' }) {
  const [liste, setListe] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [nom, setNom] = useState('');
  const [ajout, setAjout] = useState(false);
  const [doublon, setDoublon] = useState(null);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState(messageEntrant);
  const titreRef = useRef(null);
  const nomRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  const lireAnnuaire = async () => {
    const res = await adminFetchOuReseau('/api/pharmacies');
    if (!res.ok) {
      throw new Error(await messageErreur(res, 'La liste des officines n’a pas pu être chargée.'));
    }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.pharmacies)) {
      throw new Error('Le serveur a renvoyé une réponse inattendue.');
    }
    return data;
  };

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await lireAnnuaire();
        if (annule) return;
        setListe(data.pharmacies);
        setStockage(data.stockage || null);
      } catch (err) {
        if (!annule) signaler(err?.message || MESSAGE_RESEAU);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const ajouter = async (event) => {
    event.preventDefault();
    if (ajout) {
      signaler('L’ajout est déjà en cours. Attendez qu’il se termine, puis réessayez.');
      return;
    }
    const propre = nom.trim();
    setDoublon(null);
    setAnnonce('');
    if (!propre) {
      signaler('Saisissez le nom de l’officine avant d’ajouter la fiche.');
      nomRef.current?.focus();
      return;
    }

    setAjout(true);
    signaler('');
    try {
      const res = await adminFetchOuReseau('/api/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: propre }),
      });
      if (res.status === 409) {
        const conflit = await res.json().catch(() => null);
        if (conflit && conflit.pharmacy) setDoublon(conflit.pharmacy);
        throw new Error(
          conflit && conflit.pharmacy
            ? `Une officine existe déjà sous ce nom : ${conflit.pharmacy.displayName}. Ouvrez-la pour la corriger ou la fusionner.`
            : 'Une officine existe déjà sous ce nom.'
        );
      }
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'L’officine n’a pas pu être créée.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.pharmacy) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      setNom('');
      setAnnonce(`Officine « ${data.pharmacy.displayName} » ajoutée à l’annuaire.`);
      const suite = await lireAnnuaire();
      setListe(suite.pharmacies);
      setStockage(suite.stockage || null);
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setAjout(false);
    }
  };

  const sansOfficine = liste ? liste.every((p) => (p.attempts || 0) === 0) : true;

  return (
    <div className="stack">
      <div className="page-head">
        <div className="field-row">
          <h1 ref={titreRef} tabIndex={-1}>
            Officines
          </h1>
          {(onDoublons || onAffecter) && (
            <div className="tag-row">
              {onDoublons && (
                <button type="button" className="app-bar-link" onClick={onDoublons}>
                  <Icon name="search" size={15} width={1.7} />
                  Doublons probables
                </button>
              )}
              {onAffecter && (
                <button type="button" className="app-bar-link" onClick={onAffecter}>
                  <Icon name="edit" size={15} width={1.7} />
                  Affecter en masse
                </button>
              )}
            </div>
          )}
        </div>
        <p>
          Créez vos officines clientes, réunissez deux fiches qui désignent la même. Ouvrez une
          fiche pour la corriger.
        </p>
      </div>

      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces fiches ne sont pas conservées.</b> Elles disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      {/* Le rappel n'apparaît qu'une fois qu'il y a des officines ET aucun
          apprenant rattaché nulle part : c'est le signal que l'affectation en
          masse des fiches existantes reste à faire. */}
      {!chargement && liste && liste.length > 0 && sansOfficine && onAffecter && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            Aucun apprenant n’est encore rattaché à une officine. Utilisez « Affecter en masse »
            pour les répartir en quelques clics.
          </span>
        </p>
      )}

      <form className="field" onSubmit={ajouter}>
        <label className="field-label" htmlFor="officine-nom">
          Nom de l’officine
        </label>
        <input
          id="officine-nom"
          ref={nomRef}
          type="text"
          className="input"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Ex. Pharmacie Meydeba"
        />
        <button type="submit" className="btn btn--ink btn--sm" aria-busy={ajout}>
          {ajout ? 'Patientez…' : 'Ajouter'}
        </button>
        {doublon && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onOuvrirFiche(doublon)}
          >
            Ouvrir la fiche de {doublon.displayName}
          </button>
        )}
      </form>

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && liste && liste.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="list" size={22} width={1.6} />
          </span>
          <h2>Aucune officine pour l’instant</h2>
          <p>
            Ajoutez vos pharmacies clientes ci-dessus. Vous pourrez ensuite y rattacher vos
            apprenants — les nouveaux la choisiront eux-mêmes en passant un quiz.
          </p>
        </div>
      )}

      {!chargement && liste && liste.length > 0 && (
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 className="eyebrow">
            {liste.length} officine{liste.length > 1 ? 's' : ''}
          </h2>
          {liste.map((p) => (
            <button
              key={p.id}
              type="button"
              className="recent-row"
              onClick={() => onOuvrirFiche(p)}
            >
              <span className="recent-row-body">
                <span className="recent-row-title">{p.displayName}</span>
                <span className="recent-row-meta">
                  {texteApprenants(p.attempts)}
                  {ORIGINES[p.createdBy] ? ` · ${ORIGINES[p.createdBy]}` : ''}
                </span>
              </span>
              <Icon name="chevronRight" size={16} width={1.7} />
            </button>
          ))}
        </div>
      )}

      <button type="button" className="btn btn--ghost btn--block" onClick={onRetour}>
        <Icon name="arrowLeft" size={16} width={1.7} />
        Retour
      </button>
    </div>
  );
}

export default Officines;
