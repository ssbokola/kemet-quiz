import { adminJson } from './api';

/**
 * Les quatre appels de l'espace formateur qui parlent de quiz.
 *
 * Séparés de api.js, qui tient sa ligne « primitives génériques, aucune route
 * nommée ». Leur apport réel n'est pas d'éviter d'écrire une URL deux fois :
 * c'est que les PHRASES DE REPLI vivent en un seul endroit. Sans cela l'écran
 * de partage et l'écran de relecture chargent le même quiz et diraient deux
 * choses différentes quand ça échoue.
 *
 * Périmètre strict : on ne touche NI aux routes /api/learners*, NI au parcours
 * apprenant, qui a ses propres appels et son propre vocabulaire.
 */

/** La liste des quiz, du plus récent au plus ancien. */
export function listerQuiz() {
  return adminJson('/api/quizzes', {
    repli: 'La liste des quiz n’a pas pu être chargée.',
  });
}

/** Un quiz AVEC ses réponses : titre, questions, état, expiration. */
export function chargerQuizComplet(id) {
  return adminJson(`/api/quiz/${id}/full`, {
    repli: 'Le quiz n’a pas pu être chargé.',
  });
}

/**
 * Modifie un quiz. `patch` accepte title, questions, closed, expiresInHours,
 * singleAttempt — et rien d'autre, le serveur ignore le reste.
 *
 * La réponse porte l'état RETENU par le serveur. C'est elle qui doit mettre
 * l'écran à jour, jamais la valeur demandée : `expiresInHours: 24` revient en
 * `expiresAt` absolu, et c'est cette date-là qui s'affiche.
 */
export function modifierQuiz(id, patch, repli = 'Le quiz n’a pas pu être modifié.') {
  return adminJson(`/api/quiz/${id}`, {
    repli,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** Les scores enregistrés pour un quiz. */
export function chargerResultats(id) {
  return adminJson(`/api/quiz/${id}/results`, {
    repli: 'Les résultats n’ont pas pu être chargés.',
  });
}
