import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import ChampAssiste from './ChampAssiste';

// État « aucune erreur ». Constante de module partagée par les deux états, pour
// qu'ils démarrent sur la MÊME référence : la recopie du montage ne change alors
// rien et n'entraîne aucun rendu supplémentaire.
const AUCUNE_ERREUR = { texte: '', n: 0 };

/**
 * Accueil de l'apprenant, en DEUX ÉTAPES : le nom, puis l'officine.
 *
 * ⚠️ CE N'EST PAS LE DESIGN DE DÉPART. La première version tenait les deux
 * champs sur un seul écran. Mesuré sur le vrai écran d'accueil à 375×667 (le
 * titre de quiz le plus long, « PROCEDURE SAISIE DES ORDONNANCES ») : le
 * budget d'espace libre sous .welcome (space-between) vaut 125 px ; un champ
 * verrouillé en coûte 52. Les DEUX champs verrouillés auraient dépassé le
 * budget de ~29 px — le bouton « Commencer » se serait mis à bouger sous le
 * pouce au moment précis où l'apprenant s'apprête à l'atteindre. Deux étapes
 * courtes, chacune à la géométrie IDENTIQUE à l'écran d'avant l'officine,
 * tiennent le budget par construction : zéro pixel de déplacement, à chaque
 * étape, garanti sans mesurer.
 *
 * Bénéfice inattendu du découpage forcé : chaque étape est un écran à part
 * entière, donc chacune a droit à SA propre région role="status" — le casse-
 * tête d'une région unique pour deux champs, que la version à un seul écran
 * aurait posé, disparaît de lui-même.
 *
 * RÈGLE CARDINALE, héritée de la version à un champ : aucun appel réseau ne
 * précède le début du quiz, un échec de suggestion n'est jamais une erreur
 * pour l'apprenant.
 *
 * L'officine est OBLIGATOIRE À REMPLIR, pas obligatoire à CORRESPONDRE à une
 * officine connue : une saisie inconnue crée sa fiche et l'apprenant démarre,
 * exactement comme pour le nom. Le serveur, lui, l'accepte facultative — voir
 * le commentaire de POST /api/quiz/:id/submit : une session en vol au moment
 * d'un déploiement n'a pas ce champ dans sa reprise, et lui opposer un refus
 * enfermerait l'apprenant avec ses réponses.
 */
function Welcome({ quizTitle, questionCount, singleAttempt = true, quizId, onSubmit }) {
  const [etape, setEtape] = useState('nom'); // nom | officine

  const [nom, setNom] = useState('');
  const [nomVerrouille, setNomVerrouille] = useState(false);
  const [nbSuggestionsNom, setNbSuggestionsNom] = useState(0);
  const [confirmationNom, setConfirmationNom] = useState(false);
  const [annonceNom, setAnnonceNom] = useState('');

  const [officine, setOfficine] = useState('');
  const [officineVerrouille, setOfficineVerrouille] = useState(false);
  const [nbSuggestionsOfficine, setNbSuggestionsOfficine] = useState(0);
  const [confirmationOfficine, setConfirmationOfficine] = useState(false);
  const [annonceOfficine, setAnnonceOfficine] = useState('');

  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);

  const nomRef = useRef(null);
  const officineRef = useRef(null);
  const confirmRef = useRef(null);

  const minutes = questionCount ? Math.max(2, Math.round(questionCount * 0.5)) : null;

  // Seule porte d'écriture de l'erreur : le numéro s'incrémente à CHAQUE appel,
  // effacement compris. Deux refus identiques d'affilée écriraient sinon la même
  // chaîne, React court-circuiterait le rendu, le DOM de la région d'alerte ne
  // muterait pas, et le lecteur d'écran resterait muet au second appui.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  // Le texte de la confirmation ne vit pas dans une région live : le focaliser
  // est la seule façon de le faire énoncer.
  useEffect(() => {
    if (confirmationNom || confirmationOfficine) confirmRef.current?.focus();
  }, [confirmationNom, confirmationOfficine]);

  // Sans quizId, la suggestion n'a rien à interroger : `null` empêche
  // ChampAssiste de tenter le moindre appel, exactement le comportement
  // d'origine (`if (!quizId || …) return`).
  const urlSuggestionNom = quizId
    ? (saisie) => `/api/learners/suggest?q=${encodeURIComponent(saisie)}&quizId=${encodeURIComponent(quizId)}`
    : null;
  const urlSuggestionOfficine = quizId
    ? (saisie) => `/api/pharmacies/suggest?q=${encodeURIComponent(saisie)}&quizId=${encodeURIComponent(quizId)}`
    : null;

  const continuer = (e) => {
    e.preventDefault();
    const saisie = nom.trim();

    // Le bouton n'est jamais désactivé : la contrainte est vérifiée ici et
    // annoncée, plutôt que d'être muette derrière un contrôle hors de l'ordre
    // de tabulation.
    if (!saisie) {
      signaler('Saisissez votre nom pour continuer.');
      nomRef.current?.focus();
      return;
    }

    // On ne demande confirmation que dans la SEULE situation qui produit
    // réellement des doublons : des noms sont proposés et aucun n'a été
    // retenu. Sans correspondance, il n'y a aucune ambiguïté à lever.
    if (nbSuggestionsNom > 0 && !nomVerrouille) {
      setConfirmationNom(true);
      return;
    }

    passerAOfficine();
  };

  const passerAOfficine = () => {
    setConfirmationNom(false);
    signaler('');
    setEtape('officine');
  };

  const demarrer = (e) => {
    e.preventDefault();
    const saisie = officine.trim();

    if (!saisie) {
      signaler('Indiquez votre officine pour commencer.');
      officineRef.current?.focus();
      return;
    }

    if (nbSuggestionsOfficine > 0 && !officineVerrouille) {
      setConfirmationOfficine(true);
      return;
    }

    envoyer();
  };

  const envoyer = () => {
    setConfirmationOfficine(false);
    onSubmit(nom.trim(), officine.trim());
  };

  // Bloc d'orientation partagé par les deux étapes : le titre du quiz et ses
  // caractéristiques. Rendre EXACTEMENT le même bloc aux deux étapes maintient
  // la géométrie mesurée identique — c'est ce qui garde le budget de pixels
  // valable à l'étape 2 sans avoir à la mesurer séparément.
  const enTete = (
    <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="welcome-eyebrow">Vous allez répondre à</span>
      <h1 className="welcome-title">{quizTitle}</h1>
      <div className="tag-row" style={{ marginTop: 4 }}>
        {questionCount ? <span className="tag">{questionCount} questions</span> : null}
        {minutes ? <span className="tag">≈ {minutes} min</span> : null}
        <span className="tag">Correction immédiate</span>
        {singleAttempt && <span className="tag">Une seule tentative</span>}
      </div>
    </div>
  );

  if (etape === 'officine') {
    return (
      <form className="welcome" onSubmit={demarrer}>
        <div className="stack">
          {enTete}

          <ChampAssiste
            id="player-pharmacy"
            label="Votre officine"
            placeholder="Ex. Pharmacie Meydeba"
            hint={`Bonjour ${nom.trim()} — dernière étape.`}
            urlSuggestion={urlSuggestionOfficine}
            valeur={officine}
            onChangerValeur={(v) => {
              setOfficine(v);
              setConfirmationOfficine(false);
            }}
            verrouille={officineVerrouille}
            onChangerVerrou={(v) => {
              setOfficineVerrouille(v);
              setConfirmationOfficine(false);
            }}
            libelleRetenu="Officine retenue"
            libelleDefaire="Ce n’est pas la bonne"
            questionUne="Est-ce la vôtre ?"
            questionPlusieurs="Êtes-vous dans l’une d’elles ?"
            annonceUne="1 officine proposée. Flèche bas pour l’atteindre."
            annoncePlusieurs={(n) => `${n} officines proposées. Flèche bas pour les atteindre.`}
            annonceRetenue={(v) => `Officine retenue : ${v}. Le champ est figé ; bouton « Ce n’est pas la bonne » pour le corriger.`}
            onAnnonce={setAnnonceOfficine}
            onNombreSuggestions={setNbSuggestionsOfficine}
            champRef={officineRef}
            autoFocus
          />

          <div className="error-slot" role="alert" aria-atomic="true">
            {annoncee.texte ? (
              <p className="error-msg" key={annoncee.n}>
                <Icon name="info" size={16} width={1.8} />
                <span>{annoncee.texte}</span>
              </p>
            ) : null}
          </div>

          {/* Unique région polie de CETTE étape. */}
          <p className="sr-only" role="status" aria-atomic="true">
            {annonceOfficine}
          </p>

          {confirmationOfficine && (
            <div className="card confirm-inline">
              <h2 ref={confirmRef} tabIndex={-1} className="h-display">
                Aucune de ces officines n’est la vôtre ?
              </h2>
              <p className="subtle">
                Vos résultats seront rattachés à <b>« {officine.trim()} »</b>. Vérifiez
                l’orthographe.
              </p>
              <div className="split-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setConfirmationOfficine(false);
                    officineRef.current?.focus();
                  }}
                >
                  Corriger
                </button>
                <button type="button" className="btn btn--ink btn--sm" onClick={envoyer}>
                  Oui, c’est la bonne
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          <button type="submit" className="btn btn--primary btn--block">
            Commencer
            <Icon name="arrowRight" size={18} width={1.8} />
          </button>
          <span className="btn-hint">
            {singleAttempt
              ? 'Vos réponses sont enregistrées : vous pouvez reprendre plus tard, mais vous ne validerez qu’une fois.'
              : 'Vos réponses sont enregistrées : vous pouvez reprendre plus tard.'}
          </span>
        </div>
      </form>
    );
  }

  return (
    <form className="welcome" onSubmit={continuer}>
      <div className="stack">
        {enTete}

        <ChampAssiste
          id="player-name"
          label="Votre nom"
          placeholder="Ex. Aya Koffi"
          urlSuggestion={urlSuggestionNom}
          valeur={nom}
          onChangerValeur={(v) => {
            setNom(v);
            setConfirmationNom(false);
          }}
          verrouille={nomVerrouille}
          onChangerVerrou={(v) => {
            setNomVerrouille(v);
            setConfirmationNom(false);
          }}
          libelleRetenu="Nom retenu"
          libelleDefaire="Ce n’est pas moi"
          questionUne="Est-ce vous ?"
          questionPlusieurs="Êtes-vous l’un d’eux ?"
          annonceUne="1 nom proposé. Flèche bas pour l’atteindre."
          annoncePlusieurs={(n) => `${n} noms proposés. Flèche bas pour les atteindre.`}
          annonceRetenue={(v) => `Nom retenu : ${v}. Le champ est figé ; bouton « Ce n’est pas moi » pour le corriger.`}
          onAnnonce={setAnnonceNom}
          onNombreSuggestions={setNbSuggestionsNom}
          champRef={nomRef}
          autoFocus
        />

        {/* La région vit DANS .stack, près du champ qu'elle commente. En
            enfant direct de .welcome elle serait, une fois remplie, un
            troisième item d'un conteneur en space-between : le message
            atterrirait au milieu du vide, loin du champ. */}
        <div className="error-slot" role="alert" aria-atomic="true">
          {annoncee.texte ? (
            <p className="error-msg" key={annoncee.n}>
              <Icon name="info" size={16} width={1.8} />
              <span>{annoncee.texte}</span>
            </p>
          ) : null}
        </div>

        <p className="sr-only" role="status" aria-atomic="true">
          {annonceNom}
        </p>

        {confirmationNom && (
          <div className="card confirm-inline">
            <h2 ref={confirmRef} tabIndex={-1} className="h-display">
              Aucun de ces noms n’est le vôtre ?
            </h2>
            <p className="subtle">
              Vous apparaîtrez comme <b>« {nom.trim()} »</b> auprès de votre formateur, et toutes
              vos notes seront regroupées sous ce nom. Vérifiez l’orthographe.
            </p>
            <div className="split-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setConfirmationNom(false);
                  nomRef.current?.focus();
                }}
              >
                Corriger
              </button>
              <button type="button" className="btn btn--ink btn--sm" onClick={passerAOfficine}>
                Oui, c’est mon nom
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button type="submit" className="btn btn--primary btn--block">
          Continuer
          <Icon name="arrowRight" size={18} width={1.8} />
        </button>
        <span className="btn-hint">Encore une question avant de commencer.</span>
      </div>
    </form>
  );
}

export default Welcome;
