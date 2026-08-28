import { useEffect } from 'react';

/**
 * Ce qu'un écran formateur doit faire à son montage : reprendre le focus sur
 * son titre, et nommer l'onglet.
 *
 * Ce module existe parce que les vraies adresses ont cassé une prémisse qui
 * tenait jusqu'ici. Sept composants reprennent le focus sur leur titre au
 * montage ; un seul le fait sous condition (UploadPDF), parce qu'il était le
 * SEUL écran capable d'être le tout premier monté — AdminPage démarrait
 * toujours à l'étape « upload ». Avec une adresse par écran, n'importe lequel
 * peut désormais être le premier : chacun d'eux volerait le focus au chargement
 * du document, ce qui est une régression d'accessibilité — et une régression
 * qui ne se voit pas à l'œil.
 */

// Le drapeau distingue les deux façons dont un écran arrive à l'affichage :
//   · le CHARGEMENT du document (F5, favori, lien collé, second onglet) —
//     l'utilisateur n'a rien fait, la tabulation doit repartir du haut ;
//   · un CHANGEMENT d'écran — il a cliqué, tapé, ou utilisé le bouton
//     Précédent ; l'écran change sous lui et le focus doit le suivre.
//
// Évalué au chargement du module, donc avant toute interaction possible.
let aAgi = false;

if (typeof window !== 'undefined') {
  const marquer = () => {
    aAgi = true;
    window.removeEventListener('pointerdown', marquer, true);
    window.removeEventListener('keydown', marquer, true);
    window.removeEventListener('popstate', marquer, true);
  };
  // En phase de capture : l'écouteur passe avant le gestionnaire React qui
  // provoque le changement d'écran, le drapeau est donc déjà vrai quand le
  // montage suivant le consulte.
  window.addEventListener('pointerdown', marquer, true);
  window.addEventListener('keydown', marquer, true);
  // `popstate` est l'ajout qu'imposent les vraies adresses : le bouton
  // Précédent du navigateur ne produit NI pointerdown NI keydown dans la page.
  // Sans cette ligne, revenir en arrière changerait tout l'écran en laissant le
  // focus sur un élément démonté, donc sur <body>. L'écouteur est enregistré à
  // l'importation, donc avant que BrowserRouter ne crée son propre historique :
  // il passe en premier.
  window.addEventListener('popstate', marquer, true);
}

/** Vrai dès que l'utilisateur a agi dans ce document. */
export function utilisateurAAgi() {
  return aAgi;
}

/**
 * Reprend le focus sur le titre de l'écran, sauf au chargement du document.
 *
 * La cible est TOUJOURS le titre, jamais un message d'erreur : celui-ci vit
 * dans une région role="alert" et serait alors annoncé deux fois — une fois par
 * la région, une fois par le focus.
 */
export function useFocusAuMontage(ref) {
  useEffect(() => {
    if (utilisateurAAgi()) ref.current?.focus();
    // Volontairement au montage seul : un écran reprend le focus quand il
    // arrive, pas quand son contenu change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Nomme l'onglet. Nécessaire depuis que deux quiz peuvent être ouverts côte à
 * côte : sans cela les deux onglets s'intitulent « Kemet Quiz — Transformez vos
 * PDF… » et rien ne les distingue.
 *
 * Le titre n'est posé qu'une fois la donnée chargée, donc après le mur de mot
 * de passe : le titre d'un quiz ne doit pas s'afficher à un visiteur non
 * authentifié. On restaure au démontage pour ne pas laisser le nom d'un quiz
 * sur l'écran suivant.
 */
export function useTitreDocument(texte) {
  useEffect(() => {
    if (!texte) return undefined;
    const precedent = document.title;
    document.title = `${texte} — Kemet Quiz`;
    return () => {
      document.title = precedent;
    };
  }, [texte]);
}
