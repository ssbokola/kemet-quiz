/**
 * L'état d'un quiz, dit d'un seul endroit.
 *
 * Déplacé sans modification depuis QuizResults.jsx, où il ne servait qu'à la
 * liste. La liste « Mes quiz » et l'écran de partage doivent dire le MÊME mot
 * pour le même quiz, sans quoi le formateur lirait « en ligne » d'un côté et
 * « expiré » de l'autre.
 *
 * L'ORDRE des deux tests n'est pas indifférent : il reprend celui de
 * `quizAvailability` (server/src/index.js), qui teste `closed` avant
 * l'expiration. Un quiz fermé ET expiré reçoit donc ici le même mot que celui
 * que l'apprenant reçoit du serveur. Inverser les deux lignes ferait mentir
 * l'écran.
 */
export function etatDuQuiz(q) {
  if (!q) return 'en ligne';
  if (q.closed) return 'fermé';
  if (q.expiresAt && new Date(q.expiresAt) < new Date()) return 'expiré';
  return 'en ligne';
}

/** Vrai quand le lien répond vraiment. C'est la condition du partage. */
export function estEnLigne(q) {
  return etatDuQuiz(q) === 'en ligne';
}
