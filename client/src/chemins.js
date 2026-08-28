/**
 * Les adresses de l'espace formateur, en un seul endroit.
 *
 * Les motifs correspondants (`<Route path>`) vivent dans App.jsx : les deux
 * listes doivent bouger ensemble. Un gabarit mal tapé ne se voit pas à la
 * relecture — il donne un écran blanc au clic — d'où ce fichier plutôt que huit
 * littéraux disséminés.
 *
 * ⛔ `/quiz/:id` N'EST PAS ICI, et ne doit jamais l'être : c'est l'adresse
 * PUBLIQUE de l'apprenant, imprimée dans des QR codes déjà scannés et envoyée
 * dans des messages WhatsApp déjà partis. Elle est gelée à vie. Tout l'espace
 * formateur vit sous /formateur pour qu'aucun écran protégé ne se retrouve dans
 * l'espace de noms public.
 */
export const chemins = {
  creation: '/formateur',
  mesQuiz: '/formateur/quiz',
  partage: (id) => `/formateur/quiz/${id}`,
  relecture: (id) => `/formateur/quiz/${id}/questions`,
  resultats: (id) => `/formateur/quiz/${id}/resultats`,
  apprenants: '/formateur/apprenants',
};

/** Le lien PUBLIC d'un quiz, celui qu'on met dans le QR code. */
export function lienPublic(id) {
  return `${window.location.origin}/quiz/${id}`;
}
