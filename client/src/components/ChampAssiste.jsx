import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { fetchOuReseau } from '../api';

// Le serveur ne suggère rien en dessous de trois caractères utiles : inutile de
// le solliciter avant. Sa limitation de débit nous en saurait gré.
const MIN_CARACTERES = 3;

// Sans anti-rebond, chaque frappe part en requête et le serveur répond 429 au
// bout de quelques lettres.
const DELAI = 300;

/**
 * Un champ de saisie assistée : suggestion à la frappe, verrouillage du choix.
 *
 * Extrait de Welcome.jsx, qui n'avait qu'un seul champ (le nom) avant que
 * l'officine s'y ajoute. Recopier les ~150 lignes de mécanique pour un second
 * champ SUR LE MÊME ÉCRAN aurait garanti que les deux dérivent au premier
 * correctif ; c'est aussi la seule façon de tenir la règle « une seule région
 * role="status" par écran » — ce composant n'en possède AUCUNE, il remonte son
 * texte par `onAnnonce`, et l'écran appelant garde la région unique.
 *
 * LA SAISIE ASSISTÉE N'EST PAS UNE COMBOBOX ARIA, délibérément. Un champ texte
 * ordinaire et de vrais boutons dessous. Voir l'en-tête d'origine de
 * Welcome.jsx pour les quatre raisons ; elles ne dépendent pas du champ
 * particulier et ne sont pas répétées ici.
 *
 * RÈGLE CARDINALE, héritée telle quelle : un échec de suggestion — route
 * lente, en panne, 429 — n'est PAS une erreur pour l'apprenant. La liste se
 * replie et il tape comme avant. `urlSuggestion` peut valoir `null` (ex.
 * quizId absent) : aucun appel réseau n'est alors tenté.
 *
 * Le verrouillage (readOnly, jamais disabled) reste un CONFORT d'interface,
 * pas une garantie : la route de suggestion ne rend que des chaînes (contrat
 * de confidentialité), la valeur envoyée au submit reste du texte libre.
 */
function ChampAssiste({
  id,
  label,
  placeholder,
  hint,
  urlSuggestion,
  valeur,
  onChangerValeur,
  verrouille,
  onChangerVerrou,
  libelleRetenu,
  libelleDefaire,
  questionUne,
  questionPlusieurs,
  annonceUne,
  annoncePlusieurs,
  annonceRetenue,
  onAnnonce,
  onNombreSuggestions,
  champRef,
  autoFocus = false,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const listeRef = useRef(null);
  const refInterne = useRef(null);
  const ref = champRef || refInterne;

  // Suggestions. L'effet porte son propre drapeau de péremption : l'apprenant
  // tape vite, les réponses peuvent revenir dans le désordre.
  useEffect(() => {
    const saisie = valeur.trim();
    if (!urlSuggestion || saisie.length < MIN_CARACTERES || verrouille) {
      setSuggestions([]);
      return undefined;
    }

    let perime = false;
    const minuteur = setTimeout(async () => {
      try {
        const res = await fetchOuReseau(urlSuggestion(saisie));
        if (perime) return;
        // Volontairement silencieux sur !res.ok : un 429 ou un 500 ne regarde
        // pas l'apprenant, qui n'a rien demandé d'autre que de taper.
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json().catch(() => null);
        if (perime) return;
        setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
      } catch {
        if (!perime) setSuggestions([]);
      }
    }, DELAI);

    return () => {
      perime = true;
      clearTimeout(minuteur);
    };
  }, [valeur, urlSuggestion, verrouille]);

  // L'écran parent décide s'il faut ouvrir une confirmation : il ne peut le
  // faire qu'en connaissant CE nombre, à l'instant où le formulaire est soumis.
  useEffect(() => {
    onNombreSuggestions?.(suggestions.length);
  }, [suggestions, onNombreSuggestions]);

  // L'annonce polie suit la liste, jamais le rendu : une région live s'écrit
  // depuis un effet. Le verrou est testé EN PREMIER, comme dans l'original :
  // retenir() vide la liste dans le même commit, sans cette branche l'annonce
  // du verrouillage serait immédiatement écrasée par la remise à zéro.
  useEffect(() => {
    if (verrouille) {
      onAnnonce(annonceRetenue(valeur.trim()));
      return;
    }
    onAnnonce(
      suggestions.length === 0 ? '' : suggestions.length === 1 ? annonceUne : annoncePlusieurs(suggestions.length)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestions, verrouille, valeur]);

  const retenir = (nom) => {
    onChangerValeur(nom);
    onChangerVerrou(true);
    setSuggestions([]);
    ref.current?.focus();
  };

  // Se dédire. On GARDE le texte et on le sélectionne plutôt que de vider le
  // champ : la première frappe le remplace, et l'apprenant qui s'est trompé
  // n'a pas à tout retaper. focus() et select() fonctionnent sur un champ
  // encore readOnly — l'attribut ne tombera qu'au rendu suivant.
  const defaire = () => {
    onChangerVerrou(false);
    ref.current?.focus();
    ref.current?.select();
  };

  // Navigation au focus RÉEL entre les propositions, sur le modèle de
  // RadioGroup. preventDefault sur les flèches : sans lui, le curseur de texte
  // se déplace et la page défile.
  const toucheDansLaListe = (e, index) => {
    const boutons = listeRef.current ? [...listeRef.current.querySelectorAll('button')] : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (index + 1 < boutons.length) boutons[index + 1].focus();
      else ref.current?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index > 0) boutons[index - 1].focus();
      else ref.current?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setSuggestions([]);
      ref.current?.focus();
    }
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

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type="text"
        className={verrouille ? 'input input--retenu' : 'input'}
        placeholder={placeholder}
        value={valeur}
        // readOnly, JAMAIS disabled : `disabled` sortirait le champ de l'ordre
        // de tabulation et de l'annonce du lecteur d'écran, alors que
        // retenir() lui rend justement le focus.
        readOnly={verrouille}
        onChange={(e) => {
          onChangerValeur(e.target.value);
          // Toute frappe annule le choix : le nom retenu n'est plus celui qui
          // est dans le champ. Inatteignable tant que le champ est figé — on
          // le garde comme second garde-fou.
          onChangerVerrou(false);
        }}
        onKeyDown={toucheDansLeChamp}
        autoFocus={autoFocus}
        // PAS de autoComplete adapté au champ : l'autofill du navigateur
        // s'ouvrirait PAR-DESSUS nos suggestions.
        autoComplete="off"
      />
      {hint && (
        <span className="subtle" id={`${id}-aide`}>
          {hint}
        </span>
      )}

      {/* Le nom retenu est figé, et il faut que ça se VOIE : un champ readOnly
          sans marque ne se distingue d'un champ ordinaire qu'au moment où l'on
          essaie d'y taper. Dans le flux, contrairement à la liste ci-dessous :
          il fait une ligne, largement sous le budget que .welcome laisse libre. */}
      {verrouille && (
        <div className="nom-retenu">
          <span className="nom-retenu-etat">
            <Icon name="check" size={15} width={2.4} />
            {libelleRetenu}
          </span>
          <button type="button" className="nom-retenu-defaire" onClick={defaire}>
            {libelleDefaire}
          </button>
        </div>
      )}

      {/* Hors du flux (voir App.css : .field:has(> .suggestions)) : une liste
          en flux ferait remonter le bouton d'action à chaque aller-retour
          réseau, sous le pouce de l'apprenant. */}
      {suggestions.length > 0 && (
        <div className="suggestions" ref={listeRef}>
          <span className="suggestions-etat">{suggestions.length === 1 ? questionUne : questionPlusieurs}</span>
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
  );
}

export default ChampAssiste;
