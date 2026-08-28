import { useState } from 'react';
import ApprenantsListe from './ApprenantsListe';
import ApprenantHistorique from './ApprenantHistorique';
import AnnuaireApprenants from './AnnuaireApprenants';
import FicheApprenant from './FicheApprenant';
import DoublonsProbables from './DoublonsProbables';

/**
 * Écran « Apprenants » — espace formateur uniquement. Il expose les noms et les
 * notes, qui ne regardent que le formateur.
 *
 * Ce composant N'EST QU'UN AIGUILLAGE : aucune requête, aucun état d'erreur,
 * aucune région live. Chacune des quatre vues charge ses propres données et
 * tient sa propre région d'alerte, unique chez elle.
 *
 * Pourquoi quatre composants plutôt qu'un seul à quatre vues : la convention de
 * l'application veut que chaque écran reprenne le focus sur SON titre au
 * montage, et un effet de montage ne rejoue que si l'écran se monte vraiment.
 * QuizResults montre le défaut à ne pas reproduire — il bascule liste et détail
 * dans un même composant, donc cliquer un quiz démonte le bouton qui portait le
 * focus, le <h1> change de texte sans que rien ne se monte, l'effet ne rejoue
 * pas, et le focus retombe sur <body> : la tabulation repart du haut du
 * document. Ici chaque vue est un TYPE de composant distinct rendu à la même
 * position — React démonte l'ancienne, monte la nouvelle, l'effet de focus
 * rejoue, et le formateur au clavier arrive sur le titre de l'écran où il vient
 * d'entrer. Ne jamais fusionner deux de ces vues dans un seul composant.
 */
function Apprenants({ onBack }) {
  const [vue, setVue] = useState('liste'); // liste | historique | annuaire | fiche | doublons
  // L'apprenant ouvert : { id, displayName }. Le nom voyage avec l'identifiant
  // pour que la vue de détail ait un titre à afficher dès son premier rendu,
  // avant même que sa requête ait répondu.
  const [apprenant, setApprenant] = useState(null);
  // Phrase rapportee d'un ecran a l'autre : apres une fusion, le compte rendu
  // (« 3 evaluations deplacees ») doit etre annonce sur l'ecran D'ARRIVEE, celui
  // qui se monte. L'ecran qui la produit est demonte au meme instant.
  const [messageEntrant, setMessageEntrant] = useState('');

  // Entrer dans une vue de détail : elle a besoin d'une fiche.
  const ouvrir = (suivante) => (fiche) => {
    setApprenant(fiche);
    setVue(suivante);
  };

  // En sortir : la fiche est oubliée. Sans cela un nom périmé resterait en
  // mémoire, prêt à s'afficher au prochain aiguillage.
  const aller = (suivante) => () => {
    setApprenant(null);
    setMessageEntrant('');
    setVue(suivante);
  };

  // Sortie de la fiche APRES fusion : meme destination, mais la phrase voyage.
  const apresFusion = (texte) => {
    setApprenant(null);
    setMessageEntrant(texte || '');
    setVue('annuaire');
  };

  // Apres une fusion faite depuis l'ecran des doublons, on RESTE sur cet ecran :
  // le formateur en traite plusieurs a la suite.
  //
  // Mais c'est alors le MEME type de composant a la MEME position : React ne le
  // remonte pas, l'effet de montage ne rejoue pas, la liste resterait perimee
  // (la fiche fusionnee y figurerait encore) et le focus ne reviendrait pas sur
  // le titre. C'est exactement le defaut que l'en-tete de ce fichier decrit. Le
  // compteur sert de `key` : il force le demontage/remontage, donc le
  // rechargement et la reprise du focus.
  const [rafraichir, setRafraichir] = useState(0);
  const apresFusionDoublon = (texte) => {
    setMessageEntrant(texte || '');
    setRafraichir((n) => n + 1);
    setVue('doublons');
  };

  // `vue` et `apprenant` sont toujours écrits ensemble, dans le même
  // gestionnaire : une vue de détail sans fiche n'arrive pas. Ce repli n'est
  // qu'un filet — il renvoie chaque vue de détail vers celle par laquelle on y
  // entre, plutôt que de rendre un écran vide ou de lire un nom sur `null`.
  let vueSure = vue;
  if (!apprenant && vue === 'historique') vueSure = 'liste';
  if (!apprenant && vue === 'fiche') vueSure = 'annuaire';

  if (vueSure === 'historique') {
    return <ApprenantHistorique apprenant={apprenant} onRetour={aller('liste')} />;
  }

  // Les deux sorties de la fiche mènent au même endroit : l'annuaire se remonte,
  // donc se recharge, et la fiche supprimée n'y figure plus. Elles restent deux
  // propriétés distinctes pour que la vue n'ait pas à confondre « je renonce »
  // et « c'est supprimé » — ce sont deux choses différentes à annoncer.
  if (vueSure === 'fiche') {
    return (
      <FicheApprenant
        apprenant={apprenant}
        onRetour={aller('annuaire')}
        onSupprimee={apresFusion}
      />
    );
  }

  if (vueSure === 'doublons') {
    return (
      <DoublonsProbables
        key={`doublons-${rafraichir}`}
        onRetour={aller('annuaire')}
        onFusion={apresFusionDoublon}
        messageEntrant={messageEntrant}
      />
    );
  }

  if (vueSure === 'annuaire') {
    return (
      <AnnuaireApprenants
        onOuvrirFiche={ouvrir('fiche')}
        onDoublons={aller('doublons')}
        onRetour={aller('liste')}
        messageEntrant={messageEntrant}
      />
    );
  }

  return (
    <ApprenantsListe
      onOuvrir={ouvrir('historique')}
      onAnnuaire={aller('annuaire')}
      onBack={onBack}
    />
  );
}

export default Apprenants;
