/**
 * Dates de l'espace formateur.
 *
 * Un seul endroit décide comment une date se dit en français, pour que l'écran
 * « Apprenants » et ceux qui suivront ne redérivent pas chacun leur variante.
 *
 * Deux natures de valeur circulent dans l'application, et elles ne se lisent
 * PAS de la même façon :
 *   · un INSTANT ISO complet (`createdAt`, `submittedAt`, `lastSubmittedAt`) :
 *     un point du temps, à rendre dans le fuseau du formateur ;
 *   · un JOUR nu « AAAA-MM-JJ » (les deux bornes de période qu'il saisit) :
 *     une case du calendrier, sans heure ni fuseau.
 *
 * `new Date('2026-02-03')` lit le second comme minuit UTC. À l'ouest de UTC,
 * l'affichage reculerait donc d'un jour et la période saisie « du 3 février »
 * s'annoncerait « Du 2 février » — le formateur ne verrait pas ce qu'il a
 * demandé. Les jours nus sont pour cette raison reconstruits en heure locale,
 * et c'est la même raison qui interdit `toISOString()` dans `aujourdhuiISO`.
 */

// Un jour de calendrier, sans partie horaire. Tout le reste est un instant.
const JOUR_NU = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Date exploitable, ou `null` si la valeur n'en est pas une. Aucune fonction
 * publique ci-dessous ne formate sans être passée par ici : c'est la garde
 * Number.isNaN, écrite une fois.
 */
function enDate(valeur) {
  if (!valeur) return null;
  if (typeof valeur === 'string') {
    const jour = JOUR_NU.exec(valeur);
    // Minuit LOCAL, et non minuit UTC : voir l'en-tête du fichier.
    if (jour) {
      const d = new Date(Number(jour[1]), Number(jour[2]) - 1, Number(jour[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** « 3 août 2026 ». Chaîne vide si la valeur n'est pas une date. */
// En francais, le premier jour du mois est un ORDINAL : « 1er aout », jamais
// « 1 aout ». Intl ne le fait pas — il rend « 1 » — et c'est le seul jour
// concerne. Applique une fois ici, donc partout : formatJourHeure et
// libellePeriode passent tous deux par formatJour.
function avecPremier(texte, jour) {
  return jour === 1 ? texte.replace(/^1(?=\s)/, '1er') : texte;
}

export function formatJour(valeur) {
  const d = enDate(valeur);
  if (!d) return '';
  return avecPremier(
    d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    d.getDate()
  );
}

/**
 * « 3 août 2026, 14:02 ».
 *
 * Composé à la main plutôt que par un seul `toLocaleString` : celui-ci écrit
 * « 3 août 2026 à 14:02 » dans les moteurs récents et « 3 août 2026, 14:02 »
 * dans les plus anciens. Le séparateur serait donc décidé par le navigateur du
 * formateur, pas par nous.
 */
export function formatJourHeure(valeur) {
  const d = enDate(valeur);
  if (!d) return '';
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${formatJour(d)}, ${heure}`;
}

/**
 * Phrase qui dit la période couverte, à partir de deux jours « AAAA-MM-JJ »
 * (l'un et l'autre facultatifs, `null` valant « pas de borne ») :
 *
 *   ( null, null )               → « Tout l’historique »
 *   ( '2026-02-03', null )       → « Depuis le 3 février 2026 »
 *   ( null, '2026-03-12' )       → « Jusqu’au 12 mars 2026 »
 *   ( '2026-02-03', '2026-03-12' ) → « Du 3 février au 12 mars 2026 »
 *
 * Le millésime de la borne de départ n'est sous-entendu que lorsque les deux
 * bornes tombent la même année. À cheval sur deux années il est écrit — « Du 3
 * février 2025 au 12 mars 2026 » — sans quoi la phrase la plus courte serait
 * aussi la plus fausse.
 *
 * Cette fonction ne fait que dire : elle ne juge pas de l'ordre des bornes.
 * Une période à l'envers se refuse à la saisie, sur l'écran, là où le formateur
 * peut la corriger.
 */
export function libellePeriode(du, au) {
  const debut = enDate(du);
  const fin = enDate(au);

  if (!debut && !fin) return 'Tout l’historique';
  if (debut && !fin) return `Depuis le ${formatJour(debut)}`;
  if (!debut && fin) return `Jusqu’au ${formatJour(fin)}`;

  const memeAnnee = debut.getFullYear() === fin.getFullYear();
  const depart = memeAnnee
    ? avecPremier(debut.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }), debut.getDate())
    : formatJour(debut);
  return `Du ${depart} au ${formatJour(fin)}`;
}

/**
 * Le jour courant en « AAAA-MM-JJ », lu à l'heure LOCALE.
 *
 * `toISOString().slice(0, 10)` donnerait la veille en fin de journée à l'ouest
 * de UTC : la borne « aujourd'hui » proposée au formateur exclurait alors les
 * évaluations de sa propre journée.
 */
export function aujourdhuiISO() {
  const d = new Date();
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jour}`;
}

/**
 * Décalage du fuseau du formateur, en minutes à l'EST de UTC — la convention
 * attendue par le serveur, qui s'en sert pour découper les journées.
 *
 * `getTimezoneOffset()` compte à l'envers (les minutes à AJOUTER à l'heure
 * locale pour retomber sur UTC, donc positives à l'ouest) : d'où le signe.
 * Recalculé à chaque appel, jamais figé au chargement du module — un passage à
 * l'heure d'été pendant que l'onglet reste ouvert changerait la valeur.
 */
export function tzOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}
