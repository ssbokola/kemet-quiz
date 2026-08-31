import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RadioGroup from './RadioGroup';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { useFocusAuMontage } from '../ecran';

const AUCUNE_ERREUR = { texte: '', n: 0 };

/**
 * Doublons probables — espace formateur uniquement.
 *
 * Paramétré pour servir aussi bien l'annuaire des APPRENANTS (valeurs par
 * défaut, comportement inchangé) que celui des OFFICINES : les cinq points qui
 * liaient l'écran aux apprenants sont devenus des props — l'URL de lecture,
 * l'URL de fusion, le vocabulaire, le décompte (« évaluations » contre
 * « apprenants »), et la lecture de la réponse de fusion (les deux routes ne
 * rendent pas la même forme : { moved } contre { movedLearners, movedResults }).
 *
 * Le serveur PROPOSE des groupes de fiches qui désignent vraisemblablement le
 * même établissement ou la même personne ; cet écran les montre, et le
 * formateur tranche. Rien n'est fusionné automatiquement : une fusion déplace
 * puis supprime la fiche source SANS conserver la provenance — une fusion à
 * tort ne se défait pas, même avec une sauvegarde en main.
 *
 * Des GROUPES et non des paires : sur les vraies données, une même personne
 * saisie de quatre façons produit six paires. Six cartes pour une personne se
 * lisent mal ; un groupe se lit d'un coup.
 *
 * Un seul geste à la fois, volontairement : on choisit la fiche à conserver,
 * puis on rattache les autres UNE PAR UNE, chacune avec sa confirmation. Un
 * bouton « tout fusionner » irait plus vite mais retirerait au formateur le
 * seul endroit où il peut dire « celle-là, non ».
 */
function DoublonsProbables({
  onRetour,
  onFusion,
  messageEntrant = '',
  urlGroupes = '/api/learners/doublons',
  urlFusion = (sourceId) => `/api/learners/${sourceId}/merge`,
  titre = 'Doublons probables',
  description = 'Des fiches qui désignent peut-être la même personne. Rien n’est fusionné sans vous : vérifiez, puis réunissez-les.',
  texteVideTitre = 'Aucun doublon probable',
  texteVideDescription = 'Chaque fiche de l’annuaire semble désigner une personne distincte. Revenez ici après quelques évaluations.',
  libelleFicheAConserver = 'Fiche à conserver',
  libelleARattacher = 'À rattacher',
  libelleRetour = 'Retour à l’annuaire',
  libelleChargement = 'Recherche des doublons…',
  libelleConfirmer = 'Confirmer le rattachement',
  libelleAction = 'Rattacher',
  // Combien de fiches un groupe rapproche : « évaluations » pour les
  // apprenants, « apprenants rattachés » pour les officines.
  compter = (n) => `${n} évaluation${n > 1 ? 's' : ''}`,
  // Ce que la fusion va faire, en toutes lettres — un geste irréversible ne se
  // confirme jamais sur une formulation générique.
  phrase = (source, cible, n) => {
    const combien = Number.isFinite(n) ? n : 0;
    const deplacement =
      combien > 0
        ? `Les ${combien} évaluation${combien > 1 ? 's' : ''} de ${source} passeront sous la fiche de ${cible}.`
        : `${source} n’a aucune évaluation enregistrée : rien ne sera déplacé.`;
    return `${deplacement} La fiche de ${source} disparaîtra ensuite de l’annuaire.`;
  },
  // Lit la réponse de la route de fusion et rend le compte rendu à annoncer,
  // ou null si la forme est inattendue. Les deux routes ne rendent PAS la
  // même chose : { moved } pour les apprenants, { movedLearners, movedResults }
  // pour les officines.
  interpreterReponseFusion = (data, source, cible) => {
    if (!data || !Number.isFinite(data.moved)) return null;
    return `${compter(data.moved)} déplacée${data.moved > 1 ? 's' : ''} vers la fiche de ${
      cible.displayName
    }. La fiche de ${source.displayName} a été fusionnée.`;
  },
}) {
  const [groupes, setGroupes] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  // La fiche à conserver, par groupe : { [indexGroupe]: idFiche }.
  const [gardees, setGardees] = useState({});
  // La fusion en attente de confirmation : { groupe, sourceId }.
  const [confirmation, setConfirmation] = useState(null);
  const [fusion, setFusion] = useState(false);

  const titreRef = useRef(null);
  const confirmationRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  // Le compte rendu de la fusion précédente est annoncé ICI, sur l'écran qui se
  // monte : celui qui l'a produit a été démonté au même instant.
  useEffect(() => {
    if (messageEntrant) setAnnonce(messageEntrant);
  }, [messageEntrant]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const res = await adminFetchOuReseau(urlGroupes);
        if (!res.ok) {
          throw new Error(await messageErreur(res, 'Les doublons n’ont pas pu être chargés.'));
        }
        const data = await res.json().catch(() => null);
        if (annule) return;
        if (!data || !Array.isArray(data.groupes)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        setGroupes(data.groupes);
        setStockage(data.stockage || null);
        // La fiche proposée par le serveur est la première de chaque groupe.
        const defauts = {};
        data.groupes.forEach((g, i) => {
          defauts[i] = g.fiches[0]?.id;
        });
        setGardees(defauts);
        if (!messageEntrant) {
          const n = data.groupes.length;
          setAnnonce(
            n === 0 ? 'Aucun doublon probable.' : `${n} groupe${n > 1 ? 's' : ''} de fiches à vérifier.`
          );
        }
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
  }, [urlGroupes]);

  // Le texte de la confirmation ne vit pas dans une région live : le focaliser
  // est la seule façon de le faire énoncer.
  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  const fusionner = async () => {
    if (!confirmation || fusion) return;
    const { source, cible } = confirmation;
    setFusion(true);
    signaler('');
    setAnnonce('');
    try {
      const res = await adminFetchOuReseau(urlFusion(source.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoId: cible.id }),
      });
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La fusion n’a pas abouti.'));
      }
      const data = await res.json().catch(() => null);
      // Le compte annoncé est celui du SERVEUR, pas celui qu'affichait la
      // carte : entre l'affichage et le clic, un apprenant a pu répondre.
      const compteRendu = interpreterReponseFusion(data, source, cible);
      if (!compteRendu) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      onFusion(compteRendu);
    } catch (err) {
      // L'échec laisse la confirmation ouverte : le focus n'a pas bougé, la
      // région d'alerte dit pourquoi, et le geste reste à portée.
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setFusion(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          {titre}
        </h1>
        <p>{description}</p>
      </div>

      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      {/* Une seule région polie sur l'écran, comme partout ailleurs. */}
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

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>{libelleChargement}</span>
        </div>
      )}

      {!chargement && groupes && groupes.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="check" size={22} width={1.6} />
          </span>
          <h2>{texteVideTitre}</h2>
          <p>{texteVideDescription}</p>
        </div>
      )}

      {!chargement &&
        groupes &&
        groupes.map((groupe, index) => {
          const gardeeId = gardees[index];
          const cible = groupe.fiches.find((f) => f.id === gardeeId) || groupe.fiches[0];
          const autres = groupe.fiches.filter((f) => f.id !== cible.id);
          const idLabel = `doublon-garder-${index}`;
          return (
            <div key={cible.id + index} className="card doublon-groupe">
              <p className="doublon-raisons">
                <Icon name="search" size={15} width={1.8} />
                <span>
                  {groupe.fiches.length} fiches rapprochées — {groupe.raisons.join(', ')}.
                </span>
              </p>

              <div className="field">
                <span className="field-label" id={idLabel}>
                  {libelleFicheAConserver}
                </span>
                <RadioGroup
                  className="choices"
                  labelledBy={idLabel}
                  options={groupe.fiches.map((f) => ({
                    value: f.id,
                    label: f.displayName,
                    desc: compter(f.attempts || 0),
                  }))}
                  value={cible.id}
                  onChange={(id) => {
                    setGardees((prec) => ({ ...prec, [index]: id }));
                    // Le choix change : une confirmation ouverte parlerait
                    // d'une cible qui n'est plus celle qu'on garde.
                    setConfirmation(null);
                  }}
                  optionClassName={(opt, checked) => `choice ${checked ? 'is-active' : ''}`}
                  renderOption={(opt) => (
                    <>
                      <span className="choice-dot" />
                      <span className="choice-label">{opt.label}</span>
                      <span className="choice-desc">{opt.desc}</span>
                    </>
                  )}
                />
              </div>

              <div className="field">
                <span className="field-label">{libelleARattacher}</span>
                {autres.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="recent-row"
                    onClick={() => {
                      signaler('');
                      setConfirmation({ groupe: index, source: f, cible });
                    }}
                    aria-label={`Rattacher ${f.displayName}, ${compter(
                      f.attempts || 0
                    )}, à la fiche de ${cible.displayName}.`}
                  >
                    <span className="recent-row-body">
                      <span className="recent-row-title">{f.displayName}</span>
                      <span className="recent-row-meta">{compter(f.attempts || 0)}</span>
                    </span>
                    <span className="tag">Rattacher</span>
                  </button>
                ))}
              </div>

              {/* Confirmation EN LIGNE, sœur de la carte et non son enfant : une
                  carte dans une carte brouillerait le rang des deux. Le texte
                  est DÉRIVÉ du choix courant, jamais figé à l'ouverture. */}
              {confirmation && confirmation.groupe === index && (
                <div className="notice-confirm">
                  <h3 className="eyebrow" ref={confirmationRef} tabIndex={-1}>
                    {libelleConfirmer}
                  </h3>
                  <p className="notice">
                    <Icon name="info" size={15} width={1.8} />
                    <span>
                      <b>Cette action est irréversible.</b>{' '}
                      {phrase(
                        confirmation.source.displayName,
                        confirmation.cible.displayName,
                        confirmation.source.attempts
                      )}
                    </span>
                  </p>
                  <div className="split-actions">
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => setConfirmation(null)}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      className="btn btn--ink"
                      onClick={fusionner}
                      aria-busy={fusion}
                    >
                      {fusion ? 'Patientez…' : libelleAction}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      {/* Rendu sans condition, y compris pendant le chargement : c'est la seule
          sortie de l'écran, et une requête qui n'aboutit jamais y enfermerait
          sinon l'utilisateur. */}
      <button type="button" className="btn btn--ghost btn--block" onClick={onRetour}>
        <Icon name="arrowLeft" size={16} width={1.7} />
        {libelleRetour}
      </button>
    </div>
  );
}

export default DoublonsProbables;
