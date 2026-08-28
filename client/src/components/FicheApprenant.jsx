import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import RadioGroup from './RadioGroup';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { phraseFusion } from '../nom';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence : la recopie du montage ne change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// phraseFusion vit désormais dans client/src/nom.js : l'écran des doublons
// probables pose la même question, et deux formulations pour un geste
// irréversible seraient un défaut.

/**
 * Fiche d'un apprenant — espace formateur uniquement.
 *
 * Trois opérations d'ENTRETIEN, et rien d'autre : renommer, retirer la fiche
 * des suggestions, la fusionner avec une autre. La lecture des résultats se
 * fait ailleurs ; cet écran ne montre aucune note.
 *
 * `apprenant` est la fiche telle que l'annuaire l'a passée : elle sert à
 * afficher le nom dès le premier rendu (donc au moment où le titre prend le
 * focus), mais tout ce qui est modifié ici part de la version RECHARGÉE.
 *
 * Un seul appel au montage : GET /api/learners. Il rend à la fois la fiche à
 * jour et les autres fiches, dont la fusion a besoin — deux requêtes diraient
 * la même chose deux fois. Corollaire : une fiche absente de la réponse
 * n'existe plus (fusionnée depuis un autre onglet), et l'écran le dit au lieu
 * de proposer des commandes qui échoueraient toutes en 404.
 *
 * `onSupprimee` est appelée après une fusion réussie, avec une phrase toute
 * faite décrivant ce qui a été déplacé : l'écran appelant peut l'annoncer dans
 * SA région polie, ou l'ignorer. Ce composant, lui, est démonté à cet instant.
 *
 * Aucune couleur ni aucune bordure n'est introduite : toutes viennent de
 * classes déjà auditées dans App.css (.card, .notice, .tag, .btn--ink…).
 */
function FicheApprenant({ apprenant, onRetour, onSupprimee }) {
  const [fiche, setFiche] = useState(null);
  const [autres, setAutres] = useState([]);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [introuvable, setIntrouvable] = useState(false);
  const [nom, setNom] = useState(apprenant?.displayName || '');
  const [enregistrement, setEnregistrement] = useState(false);
  const [bascule, setBascule] = useState(false);
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

  // Seule porte d'écriture de l'erreur : le numéro d'occurrence s'incrémente à
  // CHAQUE appel, effacement compris. Deux refus identiques d'affilée — deux
  // appuis sur « Enregistrer » avec un champ vide — doivent être annoncés deux
  // fois. Ne jamais appeler setErreur directement.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Convention de l'application : chaque écran reprend le focus sur SON titre au
  // montage. Le focus va au titre, JAMAIS au message d'erreur — il serait alors
  // annoncé deux fois, une par la région live et une par le focus.
  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  // Aucun message n'est rendu dans le commit qui monte sa région : elle naît
  // vide, cet effet la remplit au commit suivant.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  // La confirmation en ligne REMPLACE le bouton qui l'a ouverte : sans reprise,
  // le focus retomberait sur <body> et la tabulation repartirait du haut du
  // document. La cible est le TITRE du bloc, comme pour un changement d'écran :
  //  · pas le bouton « Confirmer », qu'une frappe malheureuse suffirait alors à
  //    déclencher sur une action irréversible ;
  //  · pas l'avertissement, qui est du texte inerte lu par le curseur virtuel
  //    juste après le titre.
  // À la fermeture, le focus revient au bouton d'origine — et seulement si la
  // confirmation était réellement ouverte, sinon le montage de l'écran volerait
  // le focus au titre.
  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
    else if (confirmationPrecedente.current) fusionnerRef.current?.focus();
    confirmationPrecedente.current = confirmation;
  }, [confirmation]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        // Ordre IMPOSÉ : res.ok AVANT toute lecture du corps — `messageErreur`
        // consomme la réponse et un corps ne se lit qu'une fois. Un 503 « mot
        // de passe formateur non configuré » ressort avec le texte du serveur :
        // la phrase générique de 5xx ne le remplace que s'il n'a rien dit
        // d'exploitable.
        const res = await adminFetchOuReseau('/api/learners');
        if (!res.ok) {
          throw new Error(await messageErreur(res, 'La fiche n’a pas pu être chargée.'));
        }
        const data = await res.json().catch(() => null);
        if (annule) return;
        if (!data || !Array.isArray(data.learners)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        setStockage(data.stockage || null);
        setAutres(data.learners.filter((l) => l.id !== apprenant?.id));
        const fraiche = data.learners.find((l) => l.id === apprenant?.id);
        if (!fraiche) {
          setIntrouvable(true);
          signaler(
            'Cette fiche n’existe plus : elle a été fusionnée ou supprimée entre-temps.'
          );
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

  const nomAffiche = fiche ? fiche.displayName : apprenant?.displayName || '';
  const cible = autres.find((l) => l.id === cibleId) || null;

  const renommer = async () => {
    if (!fiche) return;
    // Le bouton n'est jamais désactivé : ce garde empêche deux enregistrements
    // simultanés, et le refus est MOTIVÉ — un bouton muet laisserait croire à
    // une panne.
    if (enregistrement) {
      signaler('L’enregistrement est déjà en cours. Attendez qu’il se termine.');
      return;
    }
    const propre = nom.trim();
    setAnnonce('');
    // Contraintes vérifiées AU CLIC et annoncées dans la région d'alerte, jamais
    // par un bouton désactivé : désactivé, il sortirait de l'ordre de tabulation
    // et sa raison d'être indisponible ne serait lisible nulle part. Le focus
    // revient au champ à corriger, jamais au message.
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
      const res = await adminFetchOuReseau(`/api/learners/${fiche.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: propre }),
      });
      if (!res.ok) {
        // 409 compris : le serveur dit lui-même qu'une autre fiche porte déjà
        // ce nom, et c'est sa phrase qui passe.
        throw new Error(await messageErreur(res, 'Le nom n’a pas pu être enregistré.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.learner) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      // C'est l'état RETENU PAR LE SERVEUR qui est affiché et annoncé, pas la
      // valeur demandée : il peut avoir rogné les espaces ou refusé une casse.
      setFiche(data.learner);
      setNom(data.learner.displayName);
      setAnnonce(`Fiche renommée : ${data.learner.displayName}.`);
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setEnregistrement(false);
    }
  };

  const basculerSuggestions = async () => {
    if (!fiche) return;
    if (bascule) {
      signaler('Le changement est déjà en cours. Attendez qu’il se termine.');
      return;
    }
    setBascule(true);
    signaler('');
    setAnnonce('');
    try {
      const res = await adminFetchOuReseau(`/api/learners/${fiche.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestible: !fiche.suggestible }),
      });
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'Le réglage n’a pas pu être modifié.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.learner) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      setFiche(data.learner);
      setAnnonce(
        data.learner.suggestible
          ? 'Cette fiche est de nouveau proposée aux apprenants qui saisissent leur nom.'
          : 'Cette fiche n’est plus proposée aux apprenants qui saisissent leur nom.'
      );
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setBascule(false);
    }
  };

  const demanderConfirmation = () => {
    setAnnonce('');
    if (!cibleId) {
      signaler('Choisissez d’abord la fiche à conserver.');
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
      const res = await adminFetchOuReseau(`/api/learners/${fiche.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intoId: cible.id }),
      });
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La fusion n’a pas abouti.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !Number.isFinite(data.moved)) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      // Le compte annoncé est celui du SERVEUR (`moved`), pas celui qu'affichait
      // la fiche : entre l'affichage et le clic, un apprenant a pu répondre.
      onSupprimee(
        `${data.moved} évaluation${data.moved > 1 ? 's' : ''} déplacée${
          data.moved > 1 ? 's' : ''
        } vers la fiche de ${cible.displayName}. La fiche de ${nomAffiche} a été fusionnée.`
      );
    } catch (err) {
      // L'échec laisse la confirmation ouverte : le focus n'a pas bougé, il est
      // resté sur « Confirmer », et la région d'alerte juste au-dessus dit
      // pourquoi. Rien n'a été déplacé, le geste reste à portée.
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      // Succès : le parent a déjà changé d'écran, ce composant est démonté et
      // l'appel est sans effet. Échec : il rend le bouton utilisable.
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
          {/* Pastille décorative : l'initiale de l'apprenant. aria-hidden — le
              nom est juste à côté, en toutes lettres. Ternaire et non `&&` :
              une chaîne vide laisserait un nœud texte dans la ligne. */}
          {nomAffiche ? (
            <span className="app-mark" aria-hidden="true">
              {nomAffiche.trim().charAt(0).toUpperCase()}
            </span>
          ) : null}
        </div>
        <p>Corriger cette fiche, la retirer des suggestions, ou la réunir avec une autre.</p>
      </div>

      {/* Région d'alerte montée INCONDITIONNELLEMENT, contenu en ternaire :
          `{annoncee.texte && …}` laisserait un nœud texte vide et casserait
          .error-slot:empty, qui sort la région du flux tant qu'elle est muette.
          La `key` porte le numéro d'occurrence, sans quoi deux refus identiques
          d'affilée ne muteraient pas le DOM — donc ne seraient annoncés qu'une
          fois. */}
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
            <b>Ces fiches ne sont pas conservées.</b> Le nom corrigé et la fusion
            disparaîtront au prochain redéploiement de l’application
            {stockage.raison ? ` — ${stockage.raison}` : ''}.
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
            Elle a été fusionnée avec une autre, ou supprimée depuis un autre onglet.
            Revenez à l’annuaire pour voir les fiches actuelles.
          </p>
        </div>
      )}

      {!chargement && fiche && (
        <>
          {/* 1 — RENOMMER */}
          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="eyebrow">Renommer</h2>
            <div className="field">
              <label className="field-label" htmlFor="fiche-nom">
                Nom de l’apprenant
              </label>
              <input
                id="fiche-nom"
                ref={nomRef}
                type="text"
                className="input"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                aria-describedby="fiche-nom-aide"
              />
              {/* Enfant IMMÉDIAT du champ qu'il décrit : la position visuelle et
                  le lien aria-describedby désignent le même contrôle. */}
              <span className="subtle" id="fiche-nom-aide">
                Corriger le nom ne change rien aux évaluations déjà enregistrées : chacune
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

          {/* 2 — SUGGESTIONS */}
          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="eyebrow">Suggestions</h2>
            {/* .tag-row et non la pastille seule : dans une colonne flex, un
                .tag isolé s'étirerait sur toute la largeur de la carte. */}
            <div className="tag-row">
              <span className="tag">
                {fiche.suggestible ? 'Proposée à la saisie' : 'Non proposée'}
              </span>
            </div>
            <p className="subtle">
              Une fiche non proposée n’apparaît plus quand un apprenant tape son nom au
              début d’un quiz. Ses évaluations, elles, restent enregistrées et comptent
              toujours.
            </p>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={basculerSuggestions}
              aria-busy={bascule}
            >
              {bascule
                ? 'Patientez…'
                : fiche.suggestible
                  ? 'Ne plus proposer cette fiche'
                  : 'Proposer cette fiche de nouveau'}
            </button>
          </div>

          {/* 3 — FUSIONNER */}
          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <h2 className="eyebrow">Fusionner</h2>
            <p className="subtle" id="fusion-avertissement">
              Cette fiche désigne la même personne qu’une autre ? Réunissez-les : les
              évaluations de {nomAffiche} passeront sous la fiche que vous conservez, et
              celle-ci disparaîtra. <b>La fusion est irréversible.</b>
            </p>

            {autres.length === 0 ? (
              <p className="subtle">
                L’annuaire ne contient aucune autre fiche : il n’y a rien à réunir pour
                l’instant.
              </p>
            ) : (
              <>
                <div className="field">
                  <span className="field-label" id="fusion-cible-label">
                    Fiche à conserver
                  </span>
                  {/* Les options sont des .btn : l'option cochée passe en
                      .btn--ink (aplat encre, texte blanc, 16,67:1) et les autres
                      restent en .btn--ghost (fond blanc, contour --line-control
                      à 3,76:1). L'état coché ne repose donc pas sur la seule
                      couleur, ni sur le seul aria-checked. Aucune teinte neuve :
                      les deux variantes existent et sont déjà auditées.
                      `describedBy` est posé par RadioGroup sur le SEUL bouton
                      focalisable : l'avertissement d'irréversibilité est énoncé
                      à l'entrée dans le groupe, et une seule fois. */}
                  <RadioGroup
                    className="stack--tight"
                    style={{ display: 'flex', flexDirection: 'column' }}
                    labelledBy="fusion-cible-label"
                    describedBy="fusion-avertissement"
                    options={autres.map((l) => ({ value: l.id, label: l.displayName }))}
                    value={cibleId}
                    onChange={setCibleId}
                    optionClassName={(opt, checked) =>
                      `btn ${checked ? 'btn--ink' : 'btn--ghost'} btn--block`
                    }
                  />
                </div>
                {/* Rendu seulement quand la confirmation est fermée : le bouton
                    n'est jamais DÉSACTIVÉ, il est remplacé par le bloc qui prend
                    sa suite — et le focus le suit dans les deux sens. */}
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

          {/* Confirmation EN LIGNE, pas une modale : le motif modal du dépôt
              (piège à tabulation, aria-modal, restitution du focus) fait une
              centaine de lignes et serait hors de proportion pour un écran
              d'entretien. Elle est SŒUR de la carte « Fusionner », pas son
              enfant : une carte dans une carte brouillerait le rang des deux.
              Le texte est DÉRIVÉ de `cible`, jamais figé à l'ouverture : le
              choix reste modifiable au-dessus, et ce qui est écrit ici est
              toujours ce que « Fusionner » exécutera. */}
          {confirmation && cible && (
            <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3 className="eyebrow" ref={confirmationRef} tabIndex={-1}>
                Confirmer la fusion
              </h3>
              <p className="notice">
                <Icon name="info" size={15} width={1.8} />
                <span>
                  <b>Cette action est irréversible.</b>{' '}
                  {phraseFusion(nomAffiche, cible.displayName, fiche.attempts)}
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
        Retour à l’annuaire
      </button>
    </div>
  );
}

export default FicheApprenant;
