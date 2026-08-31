import { useState } from 'react';
import ApprenantsListe from './ApprenantsListe';
import ApprenantHistorique from './ApprenantHistorique';
import AnnuaireApprenants from './AnnuaireApprenants';
import FicheApprenant from './FicheApprenant';
import DoublonsProbables from './DoublonsProbables';
import Officines from './Officines';
import FicheOfficine from './FicheOfficine';
import OfficineHistorique from './OfficineHistorique';
import AffecterOfficines from './AffecterOfficines';
import { phraseFusionOfficine } from '../nom';

/**
 * Écran « Apprenants » — espace formateur uniquement. Il expose les noms et les
 * notes, qui ne regardent que le formateur.
 *
 * Ce composant N'EST QU'UN AIGUILLAGE : aucune requête, aucun état d'erreur,
 * aucune région live. Chacune des vues charge ses propres données et tient sa
 * propre région d'alerte, unique chez elle.
 *
 * Pourquoi autant de composants plutôt qu'un seul à plusieurs vues : la
 * convention de l'application veut que chaque écran reprenne le focus sur SON
 * titre au montage, et un effet de montage ne rejoue que si l'écran se monte
 * vraiment. QuizResults montre le défaut à ne pas reproduire — il bascule
 * liste et détail dans un même composant, donc cliquer une ligne démonte le
 * bouton qui portait le focus, le <h1> change de texte sans que rien ne se
 * monte, l'effet ne rejoue pas, et le focus retombe sur <body> : la tabulation
 * repart du haut du document. Ici chaque vue est un TYPE de composant distinct
 * rendu à la même position — React démonte l'ancienne, monte la nouvelle,
 * l'effet de focus rejoue. Ne jamais fusionner deux de ces vues dans un seul
 * composant.
 *
 * Les officines suivent EXACTEMENT le même schéma que les apprenants : liste,
 * fiche, doublons — d'où la duplication délibérée plutôt qu'une généralisation
 * du store (voir le commentaire de tête de db.js) et le paramétrage de
 * DoublonsProbables plutôt que sa duplication (les cinq points qui le liaient
 * aux apprenants sont devenus des props).
 */
function Apprenants({ onBack }) {
  const [vue, setVue] = useState('liste');
  // vue ∈ liste | historique | annuaire | fiche | doublons
  //     | officines | ficheOfficine | doublonsOfficines | affecterOfficines
  //     | historiqueOfficine
  // L'apprenant ouvert : { id, displayName }. Le nom voyage avec l'identifiant
  // pour que la vue de détail ait un titre à afficher dès son premier rendu,
  // avant même que sa requête ait répondu.
  const [apprenant, setApprenant] = useState(null);
  // Même rôle pour l'officine ouverte.
  const [officine, setOfficine] = useState(null);
  // Phrase rapportee d'un ecran a l'autre : apres une fusion, le compte rendu
  // (« 3 evaluations deplacees ») doit etre annonce sur l'ecran D'ARRIVEE, celui
  // qui se monte. L'ecran qui la produit est demonte au meme instant.
  const [messageEntrant, setMessageEntrant] = useState('');

  // Entrer dans une vue de détail : elle a besoin d'une fiche.
  const ouvrir = (suivante) => (fiche) => {
    setApprenant(fiche);
    setVue(suivante);
  };
  const ouvrirOfficine = (fiche) => {
    setOfficine(fiche);
    setVue('ficheOfficine');
  };
  const ouvrirHistoriqueOfficine = (fiche) => {
    setOfficine(fiche);
    setVue('historiqueOfficine');
  };

  // En sortir : la fiche est oubliée. Sans cela un nom périmé resterait en
  // mémoire, prêt à s'afficher au prochain aiguillage.
  const aller = (suivante) => () => {
    setApprenant(null);
    setOfficine(null);
    setMessageEntrant('');
    setVue(suivante);
  };

  // Sortie de la fiche APRES fusion : meme destination, mais la phrase voyage.
  const apresFusion = (texte) => {
    setApprenant(null);
    setMessageEntrant(texte || '');
    setVue('annuaire');
  };
  const apresFusionOfficine = (texte) => {
    setOfficine(null);
    setMessageEntrant(texte || '');
    setVue('officines');
  };

  // Apres une fusion faite depuis un ecran de doublons, on RESTE sur cet ecran :
  // le formateur en traite plusieurs a la suite.
  //
  // Mais c'est alors le MEME type de composant a la MEME position : React ne le
  // remonte pas, l'effet de montage ne rejoue pas, la liste resterait perimee
  // (la fiche fusionnee y figurerait encore) et le focus ne reviendrait pas sur
  // le titre. C'est exactement le defaut que l'en-tete de ce fichier decrit. Le
  // compteur sert de `key` : il force le demontage/remontage, donc le
  // rechargement et la reprise du focus. La clé inclut l'ENTITÉ (apprenants ou
  // officines) : les deux emplois de DoublonsProbables ne doivent jamais être
  // confondus par React, qui ne regarde que la clé pour décider de remonter.
  const [rafraichir, setRafraichir] = useState(0);
  const apresFusionDoublon = (texte) => {
    setMessageEntrant(texte || '');
    setRafraichir((n) => n + 1);
    setVue('doublons');
  };
  const apresFusionDoublonOfficine = (texte) => {
    setMessageEntrant(texte || '');
    setRafraichir((n) => n + 1);
    setVue('doublonsOfficines');
  };

  // `vue` et `apprenant`/`officine` sont toujours écrits ensemble, dans le même
  // gestionnaire : une vue de détail sans fiche n'arrive pas. Ce repli n'est
  // qu'un filet — il renvoie chaque vue de détail vers celle par laquelle on y
  // entre, plutôt que de rendre un écran vide ou de lire un nom sur `null`.
  let vueSure = vue;
  if (!apprenant && vue === 'historique') vueSure = 'liste';
  if (!apprenant && vue === 'fiche') vueSure = 'annuaire';
  if (!officine && vue === 'ficheOfficine') vueSure = 'officines';
  if (!officine && vue === 'historiqueOfficine') vueSure = 'officines';

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
        key={`doublons-apprenants-${rafraichir}`}
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
        onOfficines={aller('officines')}
        onRetour={aller('liste')}
        messageEntrant={messageEntrant}
      />
    );
  }

  if (vueSure === 'ficheOfficine') {
    return (
      <FicheOfficine
        officine={officine}
        onRetour={aller('officines')}
        onSupprimee={apresFusionOfficine}
        onHistorique={ouvrirHistoriqueOfficine}
      />
    );
  }

  if (vueSure === 'historiqueOfficine') {
    return <OfficineHistorique officine={officine} onRetour={aller('officines')} />;
  }

  if (vueSure === 'doublonsOfficines') {
    return (
      <DoublonsProbables
        key={`doublons-officines-${rafraichir}`}
        urlGroupes="/api/pharmacies/doublons"
        urlFusion={(sourceId) => `/api/pharmacies/${sourceId}/merge`}
        titre="Officines en double"
        description="Des fiches qui désignent peut-être la même officine. Rien n’est fusionné sans vous : vérifiez, puis réunissez-les."
        texteVideTitre="Aucun doublon probable"
        texteVideDescription="Chaque officine de l’annuaire semble distincte. Revenez ici après quelques affectations."
        libelleFicheAConserver="Officine à conserver"
        libelleARattacher="À rattacher"
        libelleRetour="Retour aux officines"
        libelleChargement="Recherche des doublons…"
        libelleConfirmer="Confirmer le rattachement"
        libelleAction="Rattacher"
        compter={(n) => `${n} apprenant${n > 1 ? 's' : ''}`}
        phrase={phraseFusionOfficine}
        interpreterReponseFusion={(data, source, cible) => {
          if (!data || !Number.isFinite(data.movedLearners) || !Number.isFinite(data.movedResults)) {
            return null;
          }
          const nA = data.movedLearners;
          const nR = data.movedResults;
          return (
            `${nA} apprenant${nA > 1 ? 's' : ''} déplacé${nA > 1 ? 's' : ''} vers l’officine de ` +
            `${cible.displayName} (${nR} participation${nR > 1 ? 's' : ''}). ` +
            `L’officine de ${source.displayName} a été fusionnée.`
          );
        }}
        onRetour={aller('officines')}
        onFusion={apresFusionDoublonOfficine}
        messageEntrant={messageEntrant}
      />
    );
  }

  if (vueSure === 'affecterOfficines') {
    return (
      <AffecterOfficines
        onRetour={aller('officines')}
        onAffectees={(texte) => {
          setMessageEntrant(texte || '');
          setVue('officines');
        }}
      />
    );
  }

  if (vueSure === 'officines') {
    return (
      <Officines
        onOuvrirFiche={ouvrirOfficine}
        onDoublons={aller('doublonsOfficines')}
        onAffecter={aller('affecterOfficines')}
        onRetour={aller('annuaire')}
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
