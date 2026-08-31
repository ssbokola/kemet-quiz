/**
 * Ce qu'une fusion va faire, en toutes lettres et avec les vrais noms.
 *
 * Sortie de FicheApprenant.jsx : l'écran des doublons probables pose la même
 * question, et deux formulations pour un geste irréversible seraient un défaut.
 *
 * Le cas « aucune évaluation » est dit lui aussi : « les 0 évaluations
 * passeront sous » serait du charabia, et taire la phrase laisserait croire à
 * un déplacement qui n'aura pas lieu.
 */
export function phraseFusion(source, cible, n) {
  const combien = Number.isFinite(n) ? n : 0;
  const deplacement =
    combien > 0
      ? `Les ${combien} évaluation${combien > 1 ? 's' : ''} de ${source} passeront sous la fiche de ${cible}.`
      : `${source} n’a aucune évaluation enregistrée : rien ne sera déplacé.`;
  return `${deplacement} La fiche de ${source} disparaîtra ensuite de l’annuaire.`;
}

/**
 * Le pendant de phraseFusion() pour les officines : ici « n » compte des
 * APPRENANTS rattachés, pas des évaluations — c'est ce qui se déplace le plus
 * visiblement à l'écran, même si les participations suivent aussi.
 */
export function phraseFusionOfficine(source, cible, n) {
  const combien = Number.isFinite(n) ? n : 0;
  const deplacement =
    combien > 0
      ? `Les ${combien} apprenant${combien > 1 ? 's' : ''} de ${source} passeront sous l’officine de ${cible}, avec leurs participations.`
      : `${source} n’a aucun apprenant rattaché : rien ne sera déplacé.`;
  return `${deplacement} L’officine de ${source} disparaîtra ensuite de l’annuaire.`;
}
