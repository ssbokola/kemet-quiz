import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RadioGroup from './RadioGroup';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';

const AUCUNE_ERREUR = { texte: '', n: 0 };

/**
 * Affectation en masse — espace formateur uniquement.
 *
 * Le besoin qui l'a fait naître : rattacher d'un coup les fiches d'apprenants
 * créées AVANT l'existence des officines, sans ouvrir chacune à la main.
 *
 * ⛔ PAS DE ROUTE DE LOT côté serveur : une route en masse exigerait sa
 * transaction, son contrat d'échec partiel et une fonction de store de plus
 * des deux côtés — pour quelques dizaines de lignes. On boucle
 * SÉQUENTIELLEMENT sur PATCH /api/learners/:id, un appel par apprenant : un
 * seul écrivain SQLite à la fois, et un échec est imputable à UNE fiche
 * précise plutôt que noyé dans un lot. `Promise.all` est délibérément écarté.
 *
 * Ne montre QUE les apprenants sans officine : une fois affectés, ils
 * disparaissent de cette liste au rechargement suivant — le formateur voit
 * le travail qui reste, pas celui déjà fait.
 */
function AffecterOfficines({ onRetour, onAffectees }) {
  const [apprenants, setApprenants] = useState(null);
  const [officines, setOfficines] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [cibleId, setCibleId] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const titreRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [resL, resP] = await Promise.all([
          adminFetchOuReseau('/api/learners'),
          adminFetchOuReseau('/api/pharmacies'),
        ]);
        if (!resL.ok) {
          throw new Error(await messageErreur(resL, 'La liste des apprenants n’a pas pu être chargée.'));
        }
        if (!resP.ok) {
          throw new Error(await messageErreur(resP, 'La liste des officines n’a pas pu être chargée.'));
        }
        const dataL = await resL.json().catch(() => null);
        const dataP = await resP.json().catch(() => null);
        if (annule) return;
        if (!dataL || !Array.isArray(dataL.learners) || !dataP || !Array.isArray(dataP.pharmacies)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        const sansOfficine = dataL.learners.filter((l) => !l.pharmacyId);
        setApprenants(sansOfficine);
        setOfficines(dataP.pharmacies);
        setStockage(dataL.stockage || null);
        setAnnonce(
          sansOfficine.length === 0
            ? 'Tous les apprenants ont déjà une officine.'
            : `${sansOfficine.length} apprenant${sansOfficine.length > 1 ? 's' : ''} sans officine.`
        );
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

  const basculer = (id) => {
    setSelection((prec) => {
      const suivant = new Set(prec);
      if (suivant.has(id)) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  };

  const toutSelectionner = () => setSelection(new Set((apprenants || []).map((a) => a.id)));
  const toutDeselectionner = () => setSelection(new Set());

  const affecter = async () => {
    if (enCours) return;
    setAnnonce('');
    if (!cibleId) {
      signaler('Choisissez d’abord l’officine à appliquer.');
      return;
    }
    if (selection.size === 0) {
      signaler('Sélectionnez au moins un apprenant.');
      return;
    }

    setEnCours(true);
    signaler('');
    const officine = officines.find((p) => p.id === cibleId);
    let reussies = 0;
    let echecs = 0;

    // Séquentiel, délibérément : voir le commentaire de tête.
    for (const id of selection) {
      try {
        const res = await adminFetchOuReseau(`/api/learners/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pharmacyId: cibleId }),
        });
        if (res.ok) reussies += 1;
        else echecs += 1;
      } catch {
        echecs += 1;
      }
    }

    setEnCours(false);
    const resume =
      echecs === 0
        ? `${reussies} apprenant${reussies > 1 ? 's' : ''} rattaché${reussies > 1 ? 's' : ''} à ${officine?.displayName || 'l’officine choisie'}.`
        : `${reussies} apprenant${reussies > 1 ? 's' : ''} rattaché${reussies > 1 ? 's' : ''}, ${echecs} en échec — recommencez pour ceux qui restent.`;

    if (reussies > 0) {
      onAffectees(resume);
    } else {
      signaler(resume);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          Affecter en masse
        </h1>
        <p>Rattachez d’un coup les apprenants qui n’ont pas encore d’officine.</p>
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
            <b>Ces affectations ne sont pas conservées.</b> Elles disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && officines && officines.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="info" size={22} width={1.6} />
          </span>
          <h2>Aucune officine n’existe encore</h2>
          <p>Créez au moins une officine avant de pouvoir affecter des apprenants.</p>
        </div>
      )}

      {!chargement && apprenants && apprenants.length === 0 && officines && officines.length > 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="check" size={22} width={1.6} />
          </span>
          <h2>Tous les apprenants ont déjà une officine</h2>
          <p>Il n’y a rien à affecter pour l’instant.</p>
        </div>
      )}

      {!chargement && apprenants && apprenants.length > 0 && officines && officines.length > 0 && (
        <>
          <div className="field">
            <span className="field-label" id="affecter-cible-label">
              Officine à appliquer
            </span>
            <RadioGroup
              className="stack--tight"
              style={{ display: 'flex', flexDirection: 'column' }}
              labelledBy="affecter-cible-label"
              options={officines.map((p) => ({ value: p.id, label: p.displayName }))}
              value={cibleId}
              onChange={setCibleId}
              optionClassName={(opt, checked) => `btn ${checked ? 'btn--ink' : 'btn--ghost'} btn--block`}
            />
          </div>

          <div className="field">
            <span className="field-label">
              {selection.size} apprenant{selection.size > 1 ? 's' : ''} sélectionné
              {selection.size > 1 ? 's' : ''} sur {apprenants.length}
            </span>
            <div className="split-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={toutSelectionner}>
                Tout sélectionner
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={toutDeselectionner}>
                Tout désélectionner
              </button>
            </div>
          </div>

          <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            {apprenants.map((a) => {
              const coche = selection.has(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  className="recent-row"
                  aria-pressed={coche}
                  onClick={() => basculer(a.id)}
                >
                  <span className="recent-row-body">
                    <span className="recent-row-title">{a.displayName}</span>
                  </span>
                  {coche && <span className="tag">Sélectionné</span>}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="btn btn--ink btn--block"
            onClick={affecter}
            aria-busy={enCours}
          >
            {enCours
              ? 'Patientez…'
              : `Rattacher les ${selection.size} sélectionné${selection.size > 1 ? 's' : ''}`}
          </button>
        </>
      )}

      <button type="button" className="btn btn--ghost btn--block" onClick={onRetour}>
        <Icon name="arrowLeft" size={16} width={1.7} />
        Retour aux officines
      </button>
    </div>
  );
}

export default AffecterOfficines;
