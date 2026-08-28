import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { fetchOuReseau } from '../api';

// État « aucune erreur ». Constante de module partagée par les deux états, pour
// qu'ils démarrent sur la MÊME référence : la recopie du montage ne change alors
// rien et n'entraîne aucun rendu supplémentaire.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Le serveur ne suggère rien en dessous de trois caractères utiles : inutile de
// le solliciter avant. Sa limitation de débit nous en saurait gré.
const MIN_CARACTERES = 3;

// Sans anti-rebond, chaque frappe part en requête et le serveur répond 429 au
// bout de quelques lettres.
const DELAI = 300;

/**
 * Accueil de l'apprenant : il donne son nom, puis commence.
 *
 * LA SAISIE ASSISTÉE N'EST PAS UNE COMBOBOX ARIA, délibérément. Un champ texte
 * ordinaire et de vrais boutons dessous, sans role="combobox", sans
 * role="listbox", sans role="option", sans aria-activedescendant. Quatre
 * raisons :
 *  1. La cible est le téléphone. Le cœur d'une combobox éditable est le focus
 *     VIRTUEL (aria-activedescendant), précisément ce que TalkBack et VoiceOver
 *     iOS tiennent le plus mal. De vrais boutons sont atteints au balayage sur
 *     les deux, sans exception.
 *  2. Une combobox à moitié construite MENT : un role="combobox" sans
 *     aria-expanded tenu à jour et sans activedescendant correct est pire que
 *     pas de rôle du tout — le lecteur d'écran annonce un comportement qui
 *     n'arrive jamais.
 *  3. Sémantiquement ce n'en est pas une : l'apprenant peut taper un nom qui ne
 *     correspond à rien et continuer. Les suggestions sont une aide, pas une
 *     contrainte.
 *  4. Le dépôt n'a aucun précédent de combobox, et un excellent de « vrais
 *     boutons + flèches » : RadioGroup.jsx, dont selectIndex déplace le focus
 *     RÉEL avec bouclage.
 * <datalist> est écarté pour les mêmes raisons, plus : rendu erratique sur iOS,
 * filtrage décidé par le navigateur donc incontrôlable, aucun style possible.
 *
 * RÈGLE CARDINALE DE CET ÉCRAN : il fonctionne aujourd'hui et sert de vrais
 * apprenants. Un échec de suggestion — route lente, en panne, 429 — n'est PAS
 * une erreur pour lui : la liste se replie et il tape son nom comme avant.
 * Rien ne s'affiche, rien ne le bloque. Aucun appel réseau ne précède le début
 * du quiz.
 */
function Welcome({ quizTitle, questionCount, singleAttempt = true, quizId, onSubmit }) {
  const [name, setName] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  // Vrai dès que l'apprenant a retenu un nom proposé. C'est ce drapeau, et non
  // la seule égalité des chaînes, qui décide si l'on demande confirmation.
  //
  // Il FIGE aussi le champ (readOnly), et c'est le cœur de la prévention des
  // doublons : sans cela, retenir une suggestion ne faisait que recopier son
  // texte, et un seul caractère retouché derrière rouvrait une fiche neuve.
  // Le verrou reste un confort d'interface, jamais une garantie : la route de
  // suggestion ne rend que des chaînes (contrat de confidentialité), le submit
  // envoie donc du texte libre et le serveur reste seul juge, via nameKey().
  const [verrouille, setVerrouille] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');

  const champRef = useRef(null);
  const listeRef = useRef(null);
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

  // Suggestions. L'effet porte son propre drapeau d'annulation : l'apprenant
  // tape vite, les réponses peuvent revenir dans le désordre, et une réponse
  // périmée afficherait les noms d'un préfixe déjà dépassé.
  useEffect(() => {
    const saisie = name.trim();
    if (!quizId || saisie.length < MIN_CARACTERES || verrouille) {
      setSuggestions([]);
      return undefined;
    }

    let perime = false;
    const minuteur = setTimeout(async () => {
      try {
        const res = await fetchOuReseau(
          `/api/learners/suggest?q=${encodeURIComponent(saisie)}&quizId=${encodeURIComponent(quizId)}`
        );
        if (perime) return;
        // Volontairement silencieux sur !res.ok : un 429 ou un 500 ne regarde
        // pas l'apprenant, qui n'a rien demandé d'autre que de taper son nom.
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json().catch(() => null);
        if (perime) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch {
        // Réseau coupé, serveur arrêté : on replie, sans un mot.
        if (!perime) setSuggestions([]);
      }
    }, DELAI);

    return () => {
      perime = true;
      clearTimeout(minuteur);
    };
  }, [name, quizId, verrouille]);

  // L'annonce polie suit la liste, jamais le rendu : une région live s'écrit
  // depuis un effet.
  //
  // Le verrou est testé EN PREMIER : retenir un nom vide la liste, donc les
  // deux mises à jour d'état arrivent dans le même commit et l'effet ne voit
  // plus qu'une liste vide. Sans cette branche, l'annonce du verrouillage
  // serait immédiatement écrasée par la remise à zéro.
  useEffect(() => {
    if (verrouille) {
      setAnnonce(
        `Nom retenu : ${name.trim()}. Le champ est figé ; bouton « Ce n’est pas moi » pour le corriger.`
      );
      return;
    }
    if (suggestions.length === 0) {
      setAnnonce('');
      return;
    }
    setAnnonce(
      suggestions.length === 1
        ? '1 nom proposé. Flèche bas pour l’atteindre.'
        : `${suggestions.length} noms proposés. Flèche bas pour les atteindre.`
    );
  }, [suggestions, verrouille, name]);

  const retenir = (nom) => {
    setName(nom);
    setVerrouille(true);
    setSuggestions([]);
    setConfirmation(false);
    signaler('');
    champRef.current?.focus();
  };

  // Se dédire. On GARDE le texte et on le sélectionne plutôt que de vider le
  // champ : la première frappe le remplace, et l'apprenant qui s'est trompé de
  // voisin n'a pas à tout retaper. focus() et select() fonctionnent sur un
  // champ encore readOnly — l'attribut ne tombera qu'au rendu suivant.
  const defaire = () => {
    setVerrouille(false);
    setConfirmation(false);
    signaler('');
    champRef.current?.focus();
    champRef.current?.select();
  };

  // Navigation au focus RÉEL entre les noms proposés, sur le modèle de
  // RadioGroup. Le preventDefault sur les flèches est indispensable : sans lui,
  // le curseur de texte se déplace et la page défile.
  const toucheDansLaListe = (e, index) => {
    const boutons = listeRef.current
      ? [...listeRef.current.querySelectorAll('button')]
      : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index + 1 < boutons.length) boutons[index + 1].focus();
      else champRef.current?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) boutons[index - 1].focus();
      else champRef.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestions([]);
      champRef.current?.focus();
    }
    // Entrée et Espace ne sont pas interceptés : ce sont de vrais boutons, leur
    // activation native suffit.
  };

  const toucheDansLeChamp = (e) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      listeRef.current?.querySelector('button')?.focus();
    } else if (e.key === 'Escape' && suggestions.length > 0) {
      e.preventDefault();
      setSuggestions([]);
    }
  };

  const demarrer = () => {
    setConfirmation(false);
    onSubmit(name.trim());
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const saisie = name.trim();

    // Le bouton n'est jamais désactivé : la contrainte est vérifiée ici et
    // annoncée, plutôt que d'être muette derrière un contrôle hors de l'ordre
    // de tabulation.
    if (!saisie) {
      signaler('Saisissez votre nom pour commencer.');
      champRef.current?.focus();
      return;
    }

    // On ne demande confirmation que dans la SEULE situation qui produit
    // réellement des doublons : des noms sont proposés et aucun n'a été retenu.
    // Sans correspondance, il n'y a aucune ambiguïté à lever et une
    // confirmation ne serait que de la friction sur un parcours qui marche.
    //
    // `!verrouille` est redondant depuis que retenir() vide la liste — on le
    // garde parce qu'il dit la règle, et qu'un futur ajout de suggestion en
    // état verrouillé ne doit pas rouvrir cette porte en silence.
    if (suggestions.length > 0 && !verrouille) {
      setConfirmation(true);
      return;
    }

    demarrer();
  };

  // Le texte de la confirmation ne vit pas dans une région live : le focaliser
  // est la seule façon de le faire énoncer.
  useEffect(() => {
    if (confirmation) confirmRef.current?.focus();
  }, [confirmation]);

  return (
    <form className="welcome" onSubmit={handleSubmit}>
      <div className="stack">
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

        <div className="field">
          <label className="field-label" htmlFor="player-name">
            Votre nom
          </label>
          <input
            id="player-name"
            ref={champRef}
            type="text"
            className={verrouille ? 'input input--retenu' : 'input'}
            placeholder="Ex. Aya Koffi"
            value={name}
            // readOnly, JAMAIS disabled : `disabled` sortirait le champ de
            // l'ordre de tabulation et de l'annonce du lecteur d'écran, alors
            // que retenir() lui rend justement le focus.
            readOnly={verrouille}
            onChange={(e) => {
              setName(e.target.value);
              // Toute frappe annule le choix : le nom retenu n'est plus celui
              // qui est dans le champ. Inatteignable tant que le champ est
              // figé — on le garde comme second garde-fou.
              setVerrouille(false);
              setConfirmation(false);
            }}
            onKeyDown={toucheDansLeChamp}
            autoFocus
            // PAS de autoComplete="given-name" : l'autofill du navigateur
            // s'ouvrirait PAR-DESSUS nos suggestions.
            autoComplete="off"
          />

          {/* Le nom retenu est figé, et il faut que ça se VOIE : un champ
              readOnly sans marque ne se distingue d'un champ ordinaire qu'au
              moment où l'on essaie d'y taper.
              Ce bloc est dans le flux, contrairement à la liste : il fait une
              ligne, largement sous les ~190 px que .welcome laisse libres, donc
              `space-between` garde « Commencer » collé en bas — zéro pixel de
              déplacement. Il ne coexiste jamais avec .suggestions : retenir()
              vide la liste et l'effet la laisse vide tant que le verrou tient. */}
          {verrouille && (
            <div className="nom-retenu">
              <span className="nom-retenu-etat">
                <Icon name="check" size={15} width={2.4} />
                Nom retenu
              </span>
              <button type="button" className="nom-retenu-defaire" onClick={defaire}>
                Ce n’est pas moi
              </button>
            </div>
          )}

          {/* Hors du flux (voir App.css) : .welcome est en space-between avec un
              min-height, et une liste en flux ferait remonter le bouton
              « Commencer » à chaque aller-retour réseau, sous le pouce de
              l'apprenant. */}
          {suggestions.length > 0 && (
            <div className="suggestions" ref={listeRef}>
              <span className="suggestions-etat">
                {suggestions.length === 1 ? 'Est-ce vous ?' : 'Êtes-vous l’un d’eux ?'}
              </span>
              {suggestions.map((nom, i) => (
                <button
                  key={nom}
                  type="button"
                  className="suggestion"
                  onClick={() => retenir(nom)}
                  onKeyDown={(e) => toucheDansLaListe(e, i)}
                >
                  {nom}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* La région vit DANS .stack, près du champ qu'elle commente. En enfant
            direct de .welcome elle serait, une fois remplie, un troisième item
            d'un conteneur en space-between : le message atterrirait au milieu du
            vide, loin du champ — et seulement au moment où il compte. */}
        <div className="error-slot" role="alert" aria-atomic="true">
          {annoncee.texte ? (
            <p className="error-msg" key={annoncee.n}>
              <Icon name="info" size={16} width={1.8} />
              <span>{annoncee.texte}</span>
            </p>
          ) : null}
        </div>

        {/* Unique région polie de l'écran. */}
        <p className="sr-only" role="status" aria-atomic="true">
          {annonce}
        </p>

        {confirmation && (
          <div className="card confirm-inline">
            {/* Un bloc dans le flux, pas une modale : le motif modal du dépôt
                fait une centaine de lignes et serait hors de proportion pour une
                question à deux réponses. */}
            <h2 ref={confirmRef} tabIndex={-1} className="h-display">
              Aucun de ces noms n’est le vôtre ?
            </h2>
            <p className="subtle">
              Vous apparaîtrez comme <b>« {name.trim()} »</b> auprès de votre formateur, et
              toutes vos notes seront regroupées sous ce nom. Vérifiez l’orthographe.
            </p>
            <div className="split-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  setConfirmation(false);
                  champRef.current?.focus();
                }}
              >
                Corriger
              </button>
              <button type="button" className="btn btn--ink btn--sm" onClick={demarrer}>
                Oui, c’est mon nom
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

export default Welcome;
