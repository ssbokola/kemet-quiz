import { useRef } from 'react';

/**
 * Groupe de choix exclusifs, sémantique ARIA « radiogroup ».
 *
 * - Un seul bouton du groupe est dans l'ordre de tabulation (roving tabindex) :
 *   Tab entre dans le groupe sur l'option cochée, Tab en ressort directement.
 * - Les quatre flèches, Origine (Home) et Fin (End) déplacent le focus ET la
 *   sélection, avec bouclage : comportement identique à <input type="radio">.
 * - Espace / Entrée cochent l'option focalisée (comportement natif du <button>).
 *
 * Le rendu est entièrement piloté par l'appelant (className / optionClassName /
 * renderOption) : aucune classe CSS n'est imposée ici.
 *
 * Nommage : passer `labelledBy` (id d'un libellé visible) OU `label` (texte
 * pour aria-label) quand le groupe n'a pas de libellé visible propre.
 *
 * Description : `describedBy` n'est PAS posé sur le conteneur role="radiogroup"
 * mais sur le seul bouton focalisable du moment (celui du roving tabindex).
 * aria-describedby n'est énoncé de façon fiable que sur l'élément qui REÇOIT le
 * focus, et le focus ne va jamais au conteneur : posée sur lui, la description
 * risque de n'être jamais lue. Deux emplacements étaient possibles sur les
 * boutons ; celui-ci a été retenu contre « la description sur chaque option » :
 *   · à l'entrée dans le groupe (Tab, clic) le focus atterrit forcément sur le
 *     bouton focalisable, donc sur le porteur : la description est énoncée, et
 *     une seule fois ;
 *   · en navigation interne (flèches) la sélection suit le focus, l'attribut
 *     migre donc au commit React SUIVANT alors que .focus() a déjà eu lieu :
 *     rien n'est répété à chaque flèche. Sur chaque option, la description
 *     serait au contraire relue à chaque appui — et pour une description
 *     calculée (« ≈ N min ») ce serait la valeur d'AVANT le changement, le
 *     focus précédant le rendu : une annonce non seulement bavarde, mais fausse.
 *   · en mode navigation (curseur virtuel) le texte figure une fois dans le
 *     tampon au lieu d'être recopié sous chacune des options.
 */
function RadioGroup({
  options,
  value,
  onChange,
  className,
  style,
  label,
  labelledBy,
  describedBy,
  optionClassName,
  renderOption,
}) {
  const buttonsRef = useRef([]);

  // Déplace focus + sélection sur l'index demandé, en bouclant aux extrémités.
  const selectIndex = (index) => {
    const count = options.length;
    const next = ((index % count) + count) % count;
    onChange(options[next].value);
    const node = buttonsRef.current[next];
    if (node) node.focus();
  };

  const handleKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        selectIndex(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        selectIndex(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        selectIndex(0);
        break;
      case 'End':
        event.preventDefault();
        selectIndex(options.length - 1);
        break;
      default:
        break;
    }
  };

  const selectedIndex = options.findIndex((opt) => opt.value === value);
  // Si rien n'est coché, c'est la première option qui reçoit le focus au Tab.
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  return (
    <div
      className={className}
      style={style}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
    >
      {options.map((opt, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={String(opt.value)}
            ref={(node) => {
              buttonsRef.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === tabbableIndex ? 0 : -1}
            // Portée par le bouton focalisable, jamais par le conteneur ni par
            // les autres options : voir l'en-tête du fichier.
            aria-describedby={index === tabbableIndex ? describedBy : undefined}
            className={
              typeof optionClassName === 'function'
                ? optionClassName(opt, checked)
                : optionClassName
            }
            onClick={() => onChange(opt.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {renderOption ? renderOption(opt, checked) : opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default RadioGroup;
