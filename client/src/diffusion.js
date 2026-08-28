/**
 * Les durées de validité d'un lien de quiz.
 *
 * Sorties de UploadPDF.jsx pour que l'écran de partage propose EXACTEMENT les
 * mêmes que l'écran de création. Deux listes séparées dériveraient, et le
 * formateur trouverait « 7 jours » à la création et « une semaine » ailleurs.
 *
 * ⛔ NE JAMAIS importer une constante depuis UploadPDF.jsx : ce module pose
 * `pdfjsLib.GlobalWorkerOptions.workerSrc` au niveau module, donc l'importer
 * tirerait pdf.js tout entier dans le lot de l'écran de partage.
 *
 * `resume` : le mot qui représente l'option quand le tiroir est replié. Chaque
 * résumé est AUTOPORTANT — il nomme sa propre dimension — parce qu'il se lit
 * hors de son libellé : « Libre » seul ne dirait pas de quoi.
 *
 * La valeur est le nombre d'heures attendu par `PATCH /api/quiz/:id`
 * (`expiresInHours`). `0` y signifie « sans limite » : le serveur ne pose une
 * date que si `parseInt(...) > 0`.
 */
export const EXPIRY_OPTIONS = [
  { value: 0, label: 'Sans limite', resume: 'Lien sans limite' },
  { value: 24, label: '24 h', resume: 'Lien valide 24 h' },
  { value: 168, label: '7 jours', resume: 'Lien valide 7 jours' },
];
