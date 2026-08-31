import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RadioGroup from './RadioGroup';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { phraseFusionOfficine } from '../nom';

const AUCUNE_ERREUR = { texte: '', n: 0 };

/**
 * Fiche d'une officine — espace formateur uniquement.
 *
 * Copie de FicheApprenant.jsx, DEUX opérations et non trois : renommer et
 * fusionner. Pas de panneau « suggestions/quarantaine » — aucune reprise
 * d'historique n'existe pour les officines, la table naît vide, donc aucune
 * fiche n'y dort jamais en quarantaine à réhabiliter.
 *
 * `officine` est la fiche telle que l'annuaire l'a passée : elle affiche le
 * nom dès le premier rendu, mais tout ce qui est modifié part de la version
 * RECHARGÉE. Un seul appel au montage — GET /api/pharmacies — qui rend à la
 * fois la fiche à jour et les autres, dont la fusion a besoin.
 *
 * `onSupprimee` est appelée après une fusion réussie, avec une phrase toute
 * faite décrivant ce qui a été déplacé — apprenants ET participations, les
 * deux valeurs que mergePharmacies rend.
 *
 * `onHistorique` ouvre les résultats de cette officine (OfficineHistorique) —
 * tous les quiz de ses apprenants, filtrables par période, exportables. C'est
 * le point d'entrée « naviguer en partant de l'officine » demandé par
 * l'utilisateur : annuaire des officines → cette fiche → ses résultats.
 */
function FicheOfficine({ officine, onRetour, onSupprimee, onHistorique }) {
  const [fiche, setFiche] = useState(null);
  const [autres, setAutres] = useState([]);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [introuvable, setIntrouvable] = useState(false);
  const [nom, setNom] = useState(officine?.displayName || '');
  const [enregistrement, setEnregistrement] = useState(false);
  const [cibleId, setCibleId] = useState(null);
  const [confirmation, setConfirmation] = useState(false);
  const [fusion, setFusion] = useState(false);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const titreRef = useRef(null);
  const nomRef = useRef(null);
  const fusionnerRef = useRef(null);
  const confirmationRef = useRef(null);
  const confirmationPrecedente = useRef(false);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
    else if (confirmationPrecedente.current) fusionnerRef.current?.focus();
    confirmationPrecedente.current = confirmation;
  }, [confirmation]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await adminFetchOuReseau('/api/pharmacies');
        if (!res.ok) {
          throw new Error(await messageErreur(res, 'La fiche n’a pas pu être chargée.'));
        }
        const data = await res.json().catch(() => null);
        if (annule) return;
        if (!data || !Array.isArray(data.pharmacies)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        setStockage(data.stockage || null);
        setAutres(data.pharmacies.filter((p) => p.id !== officine?.id));
        const fraiche = data.pharmacies.find((p) => p.id === officine?.id);
        if (!fraiche) {
          setIntrouvable(true);
          signaler('Cette fiche n’existe plus : elle a été fusionnée ou supprimée entre-temps.');
          return;
        }
        setFiche(fraiche);
        setNom(fraiche.displayName);
      } catch (err) {
        if (!annule) signaler(err?.message || MESSAGE_RESEAU);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nomAffiche = fiche ? fiche.displayName : officine?.displayName || '';
  const cible = autres.find((p) => p.id === cibleId) || null;

  const renommer = async () => {
    if (!fiche) return;
    if (enregistrement) {
      signaler('L’enregistrement est déjà en cours. Attendez qu’il se termine.');
      return;
    }
    const propre = nom.trim();
    setAnnonce('');
    if (!propre) {
      signaler('Saisissez un nom : une fiche sans nom ne serait plus reconnaissable.');
      nomRef.current?.focus();
      return;
    }
    if (propre === fiche.displayName) {
      signaler('Ce nom est déjà celui de la fiche : il n’y a rien à enregistrer.');
      nomRef.current?.focus();
      return;
    }

    setEnregistrement(true);
    signaler('');
    try {
      const res = await adminFetchOuReseau(`/api/pharmacies/${fiche.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: propre }),
      });
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'Le nom n’a pas pu être enregistré.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.pharmacy) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      setFiche(data.pharmacy);
      setNom(data.pharmacy.displayName);
      setAnnonce(`Fiche renommée : ${data.pharmacy.displayName}.`);
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setEnregistrement(false);
    }
  };

  const demanderConfirmation = () => {
    setAnnonce('');
    if (!cibleId) {
      signaler('Choisissez d’abord l’officine à conserver.');
      return;
    }
    signaler('');
    setConfirmation(true);
  };

  const fusionner = async () => {
    if (!fiche || !cible) return;
    if (fusion) {
      signaler('La fusion est déjà en cours. Attendez qu’elle se termine.');
      return;
    }
    setFusion(true);
    signaler('');
    setAnnonce('');
    try {
      const res = await adminFetchOuReseau(`/api/pharmacies/${fiche.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoId: cible.id }),
      });
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La fusion n’a pas abouti.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !Number.isFinite(data.movedLearners) || !Number.isFinite(data.movedResults)) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      const nA = data.movedLearners;
      const nR = data.movedResults;
      onSupprimee(
        `${nA} apprenant${nA > 1 ? 's' : ''} déplacé${nA > 1 ? 's' : ''} vers l’officine de ` +
          `${cible.displayName} (${nR} participation${nR > 1 ? 's' : ''}). ` +
          `L’officine de ${nomAffiche} a été fusionnée.`
      );
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setFusion(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="field-row">
          <h1 ref={titreRef} tabIndex={-1}>
            {nomAffiche}
          </h1>
          {nomAffiche ? (
            <span className="app-mark" aria-hidden="true">
              {nomAffiche.trim().charAt(0).toUpperCase()}
            </span>
          ) : null}
        </div>
        <p>Corriger cette fiche, ou la réunir avec une autre.</p>
        {/* .tag-row et non le .field-row du dessus, délibérément : il porte déjà
            l'initiale décorative, et n'a pas de flex-wrap (voir AnnuaireApprenants).
            Un troisième enfant sans .tag-row débordait à 375 px. */}
        {onHistorique && (
          <div className="tag-row">
            <button
              type="button"
              className="app-bar-link"
              onClick={() => onHistorique({ id: officine?.id, displayName: nomAffiche })}
            >
              <Icon name="chart" size={15} width={1.7} />
              Voir les résultats de cette officine
            </button>
          </div>
        )}
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
            <b>Ces fiches ne sont pas conservées.</b> Le nom corrigé et la fusion disparaîtront
            au prochain redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && introuvable && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="info" size={22} width={1.6} />
          </span>
          <h2>Cette fiche n’existe plus</h2>
          <p>
            Elle a été fusionnée avec une autre, ou supprimée depuis un autre onglet. Revenez aux
            officines pour voir les fiches actuelles.
          </p>
        </div>
      )}

      {!chargement && fiche && (
        <>
          {/* 1 — RENOMMER */}
          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="eyebrow">Renommer</h2>
            <div className="field">
              <label className="field-label" htmlFor="officine-fiche-nom">
                Nom de l’officine
              </label>
              <input
                id="officine-fiche-nom"
                ref={nomRef}
                type="text"
                className="input"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                aria-describedby="officine-fiche-nom-aide"
              />
              <span className="subtle" id="officine-fiche-nom-aide">
                Corriger le nom ne change rien aux participations déjà enregistrées : chacune
                garde la graphie saisie le jour où elle a été passée.
              </span>
            </div>
            <button
              type="button"
              className="btn btn--ink btn--sm"
              onClick={renommer}
              aria-busy={enregistrement}
            >
              {enregistrement ? 'Patientez…' : 'Enregistrer'}
            </button>
          </div>

          {/* 2 — FUSIONNER */}
          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="eyebrow">Fusionner</h2>
            <p className="subtle" id="fusion-officine-avertissement">
              Cette fiche désigne la même officine qu’une autre ? Réunissez-les : les apprenants
              de {nomAffiche} et leurs participations passeront sous l’officine que vous
              conservez, et celle-ci disparaîtra. <b>La fusion est irréversible.</b>
            </p>

            {autres.length === 0 ? (
              <p className="subtle">
                L’annuaire ne contient aucune autre officine : il n’y a rien à réunir pour
                l’instant.
              </p>
            ) : (
              <>
                <div className="field">
                  <span className="field-label" id="fusion-officine-cible-label">
                    Officine à conserver
                  </span>
                  <RadioGroup
                    className="stack--tight"
                    style={{ display: 'flex', flexDirection: 'column' }}
                    labelledBy="fusion-officine-cible-label"
                    describedBy="fusion-officine-avertissement"
                    options={autres.map((p) => ({ value: p.id, label: p.displayName }))}
                    value={cibleId}
                    onChange={setCibleId}
                    optionClassName={(opt, checked) =>
                      `btn ${checked ? 'btn--ink' : 'btn--ghost'} btn--block`
                    }
                  />
                </div>
                {!confirmation && (
                  <button
                    type="button"
                    ref={fusionnerRef}
                    className="btn btn--ghost btn--sm"
                    onClick={demanderConfirmation}
                  >
                    Fusionner cette fiche…
                  </button>
                )}
              </>
            )}
          </div>

          {confirmation && cible && (
            <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3 className="eyebrow" ref={confirmationRef} tabIndex={-1}>
                Confirmer la fusion
              </h3>
              <p className="notice">
                <Icon name="info" size={15} width={1.8} />
                <span>
                  <b>Cette action est irréversible.</b>{' '}
                  {phraseFusionOfficine(nomAffiche, cible.displayName, fiche.attempts)}
                </span>
              </p>
              <div className="split-actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setConfirmation(false)}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  className="btn btn--ink"
                  onClick={fusionner}
                  aria-busy={fusion}
                >
                  {fusion ? 'Patientez…' : 'Fusionner'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <button type="button" className="btn btn--ghost btn--block" onClick={onRetour}>
        <Icon name="arrowLeft" size={16} width={1.7} />
        Retour aux officines
      </button>
    </div>
  );
}

export default FicheOfficine;
