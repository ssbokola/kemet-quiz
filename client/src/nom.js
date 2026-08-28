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
