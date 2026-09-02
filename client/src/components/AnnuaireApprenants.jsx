import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme dans QuizResults et UploadPDF : la recopie du montage ne
// change alors rien et n'entraîne aucun rendu supplémentaire.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// `createdBy` tel que le serveur le renvoie. Trois valeurs, et rien d'autre :
// une quatrième arriverait sans libellé — la ligne dirait alors seulement le
// nombre d'évaluations — plutôt qu'avec un mot inventé sur place.
const ORIGINES = {
  learner: 'créée par l’apprenant',
  trainer: 'créée par vous',
  import: 'reprise de l’historique',
};

// `attempts` vaut 0 pour une fiche sans participation : c'est un cas NORMAL de
// cet écran (une fiche créée à l'avance, une fiche dont la période ne retient
// rien), pas un vide à masquer.
function texteEvaluations(n) {
  if (!Number.isFinite(n) || n <= 0) return 'aucune évaluation';
  return `${n} évaluation${n > 1 ? 's' : ''}`;
}

/**
 * Écran « Gérer l’annuaire » — espace formateur uniquement.
 *
 * C'est l'écran d'ENTRETIEN des fiches d'apprenants : y créer une fiche à
 * l'avance, et surtout ouvrir celle qu'il faut corriger ou fusionner. Il
 * n'affiche NI moyenne NI période : la lecture des résultats est le travail de
 * l'écran de suivi, pas celui-ci.
 *
 * On dit « apprenant » et non « stagiaire » : la même officine forme des
 * stagiaires, des auxiliaires embauchés et parfois des pharmaciens.
 *
 * `onOuvrirFiche` reçoit la fiche entière (l'objet `learner` du serveur), pas
 * seulement son identifiant : l'écran de fiche peut ainsi afficher le nom dès
 * son premier rendu, avant même d'avoir rechargé quoi que ce soit.
 *
 * Aucune couleur ni aucune bordure n'est introduite ici : chaque teinte vient
 * d'une classe déjà auditée (.recent-row, .tag, .notice, .error-msg…), les
 * ratios de contraste restent donc ceux d'App.css.
 */
function AnnuaireApprenants({ onOuvrirFiche, onDoublons, onRetour, messageEntrant = '' }) {
  const [liste, setListe] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [nom, setNom] = useState('');
  const [ajout, setAjout] = useState(false);
  // Fiche renvoyée par le serveur dans le corps d'un 409 : elle existe déjà.
  // On la garde pour proposer de l'OUVRIR — sans quoi le formateur lit
  // « une fiche existe déjà » et doit la retrouver lui-même dans la liste.
  const [doublon, setDoublon] = useState(null);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  // Message rapporte par l'ecran precedent (« 3 evaluations deplacees »). Il est
  // pose comme etat INITIAL de la region polie : la region nait donc vide au
  // premier rendu puis se remplit, seule sequence fiablement annoncee. Le poser
  // depuis un effet reviendrait au meme, en plus verbeux.
  const [annonce, setAnnonce] = useState(messageEntrant);
  const titreRef = useRef(null);
  const nomRef = useRef(null);

  // Seule porte d'écriture de l'erreur : le numéro d'occurrence s'incrémente à
  // CHAQUE appel, effacement compris. Deux refus identiques d'affilée — deux
  // appuis sur « Ajouter » sans nom — doivent être annoncés deux fois. Ne
  // jamais appeler setErreur directement.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Convention de l'application : chaque écran reprend le focus sur SON titre
  // au montage. L'écran précédent est démonté avec l'élément focalisé ; sans
  // reprise, le focus retombe sur <body>.
  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable. Elle naît
  // vide, cet effet la remplit au commit suivant.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  // Un seul point de lecture de l'annuaire : le montage et le retour d'un ajout
  // affichent forcément la même chose, contrôlée de la même façon.
  // Ordre IMPOSÉ : res.ok AVANT toute lecture du corps — `messageErreur`
  // consomme la réponse et un corps ne se lit qu'une fois. C'est aussi ce qui
  // évite l'erreur d'analyse JSON quand l'API est arrêtée : le proxy renvoie
  // alors une page d'erreur qui n'est pas du JSON.
  const lireAnnuaire = async () => {
    const res = await adminFetchOuReseau('/api/learners');
    if (!res.ok) {
      // Un 503 « mot de passe formateur non configuré » ressort ici avec le
      // texte du serveur : `messageErreur` ne substitue sa phrase générique de
      // 5xx que lorsque le serveur n'a rien dit d'exploitable.
      throw new Error(await messageErreur(res, 'L’annuaire n’a pas pu être chargé.'));
    }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.learners)) {
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
        setListe(data.learners);
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
    // Le bouton n'est jamais désactivé : c'est ce garde d'entrée qui empêche
    // deux créations simultanées, et le refus est MOTIVÉ — un bouton qui ne
    // fait rien sans dire pourquoi est le pire des deux maux.
    if (ajout) {
      signaler('L’ajout est déjà en cours. Attendez qu’il se termine, puis réessayez.');
      return;
    }
    const propre = nom.trim();
    setDoublon(null);
    setAnnonce('');
    if (!propre) {
      // Contrainte vérifiée AU CLIC et annoncée dans la région d'alerte, jamais
      // par un bouton désactivé : désactivé, il sortirait de l'ordre de
      // tabulation et sa raison d'être indisponible ne serait lisible nulle
      // part. Le focus revient au champ à corriger — et non au message, qui
      // serait alors annoncé deux fois.
      signaler('Saisissez le nom de l’apprenant avant d’ajouter la fiche.');
      nomRef.current?.focus();
      return;
    }

    setAjout(true);
    signaler('');
    try {
      const res = await adminFetchOuReseau('/api/learners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: propre }),
      });
      // 409 : seul statut d'échec dont le CORPS nous intéresse — il porte la
      // fiche existante. On le lit donc nous-mêmes et on ne passe jamais cette
      // réponse à `messageErreur`, qui parlerait de la même chose deux fois.
      if (res.status === 409) {
        const conflit = await res.json().catch(() => null);
        if (conflit && conflit.learner) setDoublon(conflit.learner);
        throw new Error(
          conflit && conflit.learner
            ? `Une fiche existe déjà sous ce nom : ${conflit.learner.displayName}. Ouvrez-la pour la corriger ou la fusionner.`
            : 'Une fiche existe déjà sous ce nom.'
        );
      }
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La fiche n’a pas pu être créée.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.learner) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      setNom('');
      setAnnonce(`Fiche de ${data.learner.displayName} ajoutée à l’annuaire.`);
      // Relecture plutôt qu'ajout en bout de liste : c'est le serveur qui
      // décide de l'ordre des fiches, l'insérer nous-mêmes inventerait un
      // classement qui divergerait au premier rechargement.
      const suite = await lireAnnuaire();
      setListe(suite.learners);
      setStockage(suite.stockage || null);
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setAjout(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        {/* Même motif que « Gérer l'annuaire » sur l'écran précédent : l'accès
            secondaire s'aligne sur la ligne de base du titre, discrètement.
            Icône `search` et non `refresh` — la flèche circulaire est réservée
            à « régénérer / refaire ». Un seul accès désormais : l'ancien lien
            « Officines » a disparu avec ce lot, redondant avec l'onglet de
            navigation persistant du même nom. */}
        <div className="field-row">
          <h1 ref={titreRef} tabIndex={-1}>
            Gérer l’annuaire
          </h1>
          {onDoublons && (
            <button type="button" className="app-bar-link" onClick={onDoublons}>
              <Icon name="search" size={15} width={1.7} />
              Doublons probables
            </button>
          )}
        </div>
        <p>
          Corrigez un nom mal saisi, réunissez deux fiches qui désignent la même personne.
          Ouvrez une fiche pour la modifier.
        </p>
      </div>

      {/* Une région d'alerte, montée INCONDITIONNELLEMENT, remplie au commit
          suivant. Forme ternaire obligatoire : `{annoncee.texte && …}` laisserait
          un nœud texte vide et casserait .error-slot:empty, qui sort la région
          du flux tant qu'elle est muette. La `key` porte le numéro d'occurrence :
          à refus identique répété, React remplace le <p> et la région — elle,
          toujours montée — voit bien son contenu muter. */}
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

      {/* L'avertissement va là où il compte : devant les fiches concernées. Un
          annuaire non conservé est plus grave qu'un résultat non conservé — on
          y saisit des noms à la main. */}
      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces fiches ne sont pas conservées.</b> Elles disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      <form className="field" onSubmit={ajouter}>
        <label className="field-label" htmlFor="annuaire-nom">
          Nom de l’apprenant
        </label>
        <input
          id="annuaire-nom"
          ref={nomRef}
          type="text"
          className="input"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Ex. Aïcha Traoré"
        />
        {/* Volontairement TOUJOURS actif, y compris pendant l'envoi : le refus
            et l'attente se disent, ils ne se signifient pas par un contrôle
            devenu inatteignable au clavier. */}
        <button type="submit" className="btn btn--ink btn--sm" aria-busy={ajout}>
          {ajout ? 'Patientez…' : 'Ajouter'}
        </button>
        {doublon && (
          // type="button" IMPÉRATIF dans un <form> : sans lui, le clic soumet
          // le formulaire et relance la création qui vient d'échouer.
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
          <h2>Aucune fiche pour l’instant</h2>
          <p>
            Les fiches se créent toutes seules : dès qu’un apprenant donne son nom au début
            d’un quiz, il entre dans l’annuaire. Vous pouvez aussi en ajouter une ci-dessus.
          </p>
        </div>
      )}

      {!chargement && liste && liste.length > 0 && (
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          <h2 className="eyebrow">
            {liste.length} fiche{liste.length > 1 ? 's' : ''}
          </h2>
          {liste.map((l) => (
            <button
              key={l.id}
              type="button"
              className="recent-row"
              onClick={() => onOuvrirFiche(l)}
            >
              <span className="recent-row-body">
                <span className="recent-row-title">{l.displayName}</span>
                <span className="recent-row-meta">
                  {texteEvaluations(l.attempts)}
                  {ORIGINES[l.createdBy] ? ` · ${ORIGINES[l.createdBy]}` : ''}
                </span>
              </span>
              {/* Le chevron est le SECOND enfant de la ligne : .recent-row est en
                  space-between, il tient la colonne de droite et laisse le corps
                  du texte collé à gauche. Décoratif — la ligne est déjà un
                  bouton, son nom accessible est le nom de l'apprenant. */}
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

export default AnnuaireApprenants;
