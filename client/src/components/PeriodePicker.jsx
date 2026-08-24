import { useRef, useState } from 'react';

// Les trois refus possibles, écrits une seule fois. Ils sortent d'ici et de nulle
// part ailleurs : deux rédactions du même refus dériveraient en silence.
//
// « incomplète ou ce jour n’existe pas » n'est pas de la précision gratuite :
// c'est le seul cas de cet écran où le champ A L'AIR REMPLI alors qu'il ne vaut
// rien. Sans cette phrase, le formateur lit « pas valide » devant un 32/13/2026
// parfaitement lisible à l'œil et n'a aucune raison de comprendre ce qu'on lui
// reproche.
const REFUS_DEBUT = 'La date de début n’est pas valide : elle est incomplète ou ce jour n’existe pas.';
const REFUS_FIN = 'La date de fin n’est pas valide : elle est incomplète ou ce jour n’existe pas.';
const REFUS_ORDRE = 'La date de fin doit suivre la date de début.';

/**
 * Sélecteur de période — deux jours saisis, bornes comprises.
 *
 * SOUS-COMPOSANT : il n'a NI région d'alerte, NI région polie, NI reprise de
 * focus au montage. Ces trois choses appartiennent à l'écran parent, qui n'en a
 * qu'un exemplaire chacune. Tout refus remonte par `onRefuser(texte)` et c'est
 * le parent qui l'écrit dans SA région role="alert" — c'est ce qui garantit
 * qu'il n'y ait jamais deux role="alert" sur un même écran. Ne jamais ajouter
 * ici un aria-live « juste pour le champ » : les deux régions parleraient en
 * même temps du même refus.
 *
 * NON CONTRÔLÉ. `du` et `au` amorcent l'état local au montage, puis le
 * composant tient sa propre saisie : le parent ne re-rend pas à chaque frappe,
 * et surtout ne recharge rien tant qu'on n'a pas validé. La contrepartie est
 * explicite : changer `du`/`au` après le montage ne remonte PAS dans les
 * champs. Si le parent doit un jour réimposer une période (retour arrière,
 * période lue dans l'URL), qu'il remonte ce composant avec une `key` qui change
 * — c'est l'échappatoire prévue par React, et elle laisse ce fichier intact.
 *
 * Le composant ne construit JAMAIS d'objet Date et ne fait aucune analyse de
 * texte : il ne manipule que des jours AAAA-MM-JJ, tels que le champ natif les
 * produit. Le décalage horaire (tzOffset) est l'affaire du parent, qui l'envoie
 * avec la requête ; il n'a rien à faire ici.
 *
 * @param du  jour AAAA-MM-JJ ou '' (chaîne vide = pas de borne de début)
 * @param au  jour AAAA-MM-JJ ou '' (chaîne vide = pas de borne de fin)
 * @param onAppliquer (du, au) — appelé à la validation, avec ce que disent les
 *   champs. Une chaîne vide signifie « pas de borne de ce côté » : le parent
 *   omet simplement le paramètre correspondant dans la requête. Les deux vides
 *   sont donc légitimes et veulent dire « tout l'historique ».
 * @param onTout      — bouton « Tout l’historique » : les champs sont vidés ici.
 * @param onRefuser (texte) — dépose le refus dans la région d'alerte du parent.
 */
function PeriodePicker({ du = '', au = '', onAppliquer, onTout, onRefuser }) {
  const [debut, setDebut] = useState(du);
  const [fin, setFin] = useState(au);
  // 'du' | 'au' | null. Posé au clic, effacé au clic suivant : il ne bouge pas
  // pendant la frappe, exactement comme l'aria-invalid d'AdminGate reste tant
  // qu'on n'a pas resoumis. Un attribut qui s'allume et s'éteint à chaque touche
  // ferait bavarder le lecteur d'écran en pleine saisie.
  const [champFautif, setChampFautif] = useState(null);

  // Les refs ne servent PAS à lire la valeur — l'état local la tient déjà. Elles
  // servent à interroger `validity` et à rendre le focus. Voir `appliquer`.
  const debutRef = useRef(null);
  const finRef = useRef(null);

  // Un refus : le texte part vers la région du parent, le champ fautif est
  // marqué, et le focus revient DANS ce champ — jamais sur le message, qui
  // serait alors annoncé deux fois (une par la région live, une par le focus).
  // L'ordre est celui du reste du dépôt : on signale, puis on déplace le focus.
  const refuser = (champ, texte) => {
    setChampFautif(champ);
    onRefuser?.(texte);
    (champ === 'du' ? debutRef : finRef).current?.focus();
  };

  // Validation AU CLIC, jamais pendant la frappe : une date se saisit segment
  // par segment, et toute date est incomplète tant qu'elle n'est pas finie.
  // Valider en cours de frappe reviendrait à refuser chaque étape normale de la
  // saisie.
  const appliquer = () => {
    // LE PIÈGE. Chrome laisse taper 32/13/2026 : il n'accepte pas la valeur —
    // `input.value` reste '' — mais il LAISSE LES CHIFFRES À L'ÉCRAN. L'état
    // local vaut donc '' alors que le champ a l'air rempli, et sans cette garde
    // une date fautive deviendrait silencieusement « tout l'historique » : le
    // formateur croirait lire une période et lirait tout l'historique. C'est le
    // seul cas où la ref est indispensable — la valeur ne dit rien, seule
    // `validity` sait que quelque chose a été tapé.
    // `?.validity?.` et non `.validity.` : la ref est nulle avant le montage et
    // dans un environnement de test sans DOM complet ; un refus impossible à
    // évaluer ne doit pas devenir une exception.
    if (debutRef.current?.validity?.badInput) {
      refuser('du', REFUS_DEBUT);
      return;
    }
    if (finRef.current?.validity?.badInput) {
      refuser('au', REFUS_FIN);
      return;
    }

    // Règle croisée vérifiée ICI, en JavaScript, et surtout PAS par min/max sur
    // les champs : un navigateur qui refuse une valeur hors bornes le fait EN
    // SILENCE — aucun événement, rien à annoncer, rien à afficher. Ce serait
    // l'inverse exact de la convention de l'application, où toute contrainte est
    // vérifiée au moment de l'action et énoncée dans la région d'alerte.
    //
    // Comparaison de CHAÎNES, volontairement : le format AAAA-MM-JJ est à
    // largeur fixe et du plus significatif au moins significatif, donc l'ordre
    // alphabétique EST l'ordre chronologique. Zéro objet Date, donc zéro
    // décalage horaire, zéro « 31 février » silencieusement décalé au 3 mars.
    //
    // `>` strict : du 5 au 5 est une période d'un jour, parfaitement légitime,
    // et n'est pas refusée.
    //
    // Un seul champ rempli n'est pas non plus un refus : la période ouverte d'un
    // côté est prévue par le serveur, `from` et `to` y sont indépendamment
    // facultatifs.
    if (debut && fin && debut > fin) {
      refuser('au', REFUS_ORDRE);
      return;
    }

    // Deux champs vides : ce n'est PAS un refus, c'est « tout l'historique ».
    // On remonte quand même par `onAppliquer` avec deux chaînes vides plutôt que
    // par `onTout` : ce bouton rapporte toujours ce que disent les champs, une
    // seule règle à retenir. Le parent omet les paramètres vides et obtient
    // exactement la même requête que pour `onTout`.
    setChampFautif(null);
    onAppliquer?.(debut, fin);
  };

  // Bouton TOUJOURS rendu, jamais conditionnel : c'est la seule façon fiable de
  // vider un champ date au doigt — iOS n'offre aucune croix, et le calendrier
  // système ne sait qu'écrire une date, pas l'effacer.
  const tout = () => {
    // Écriture DIRECTE dans le DOM, indispensable, et sans danger ici.
    // Indispensable : si le champ est en `badInput` (32/13/2026 tapé à la main),
    // sa valeur DOM vaut déjà '' et l'état local aussi. Un simple setDebut('')
    // ne changerait donc aucun état, React ne re-rendrait pas, React n'écrirait
    // rien dans le champ, et les chiffres fautifs resteraient affichés — bouton
    // « Tout l’historique » cliqué, champ toujours plein à l'œil, et
    // `validity.badInput` toujours vrai au clic suivant.
    // Sans danger : après l'écriture, la valeur DOM ('') et la valeur contrôlée
    // par React ('') sont identiques. Rien ne se désynchronise.
    if (debutRef.current) debutRef.current.value = '';
    if (finRef.current) finRef.current.value = '';
    setDebut('');
    setFin('');
    setChampFautif(null);
    onTout?.();
  };

  return (
    // role="group" + aria-labelledby : sans lui, « Du » et « Au » sont deux
    // libellés orphelins qui ne disent pas de quoi. Le sur-titre « Période » leur
    // donne leur contexte à l'entrée dans le groupe, une fois, et n'est pas
    // recopié dans le nom de chaque champ. Même principe que le `labelledBy` des
    // RadioGroup de l'écran de création.
    <div className="periode" role="group" aria-labelledby="periode-titre">
      {/* .field-row aligne le sur-titre et l'échappatoire sur la même ligne de
          base : « Tout l’historique » est une sortie, pas l'action principale de
          ce bloc — d'où .btn--sm .btn--ghost et non un bouton pleine largeur. */}
      <div className="field-row">
        <span className="eyebrow" id="periode-titre">
          Période
        </span>
        {/* type="button" IMPÉRATIF : dans un <form>, un <button> sans type
            soumet le formulaire au clic. Ce composant est destiné à être posé
            dans un écran qu'on ne contrôle pas depuis ici.
            .btn--sm est un bouton compact de 44 px, plancher tactile de WCAG
            2.5.5 : surtout PAS .tool-btn, qui fait 32 px. */}
        <button type="button" className="btn btn--sm btn--ghost" onClick={tout}>
          Tout l’historique
        </button>
      </div>

      {/* Le champ est un <input type="date"> NATIF. Il donne gratuitement le
          format jj/mm/aaaa en locale française, le calendrier du système au
          toucher — celui que la formatrice connaît déjà — et une valeur
          TOUJOURS en ISO AAAA-MM-JJ. Donc zéro code d'analyse de date, donc zéro
          bug d'analyse de date. Ont été écartés : un calendrier maison (environ
          300 lignes, et inférieur au calendrier système sur téléphone), trois
          <select>, un champ texte masqué.

          Les libellés VISIBLES portent le sens, jamais le format : la locale du
          champ suit la langue du NAVIGATEUR et non le `lang` de la page, donc un
          téléphone configuré en anglais affiche mm/dd/yyyy sous un libellé
          français. « Du » et « Au » restent vrais dans les deux cas.
          Aucun `placeholder` non plus : les champs date l'ignorent presque
          partout, et son contraste ne serait de toute façon pas sous notre
          contrôle — rien d'indispensable ne doit en dépendre.

          Les identifiants sont fixes, comme partout ailleurs dans le dépôt
          (quiz-title, admin-pw, adv-panel) : un seul sélecteur de période par
          écran. Deux exemplaires simultanés casseraient l'association
          label/champ — ce n'est pas prévu, et ce serait visible immédiatement. */}
      <div className="periode-champs">
        <div className="field">
          <label className="field-label" htmlFor="periode-du">
            Du
          </label>
          {/* Ni min ni max : voir le commentaire de la règle croisée dans
              `appliquer`. Pas de aria-describedby vers le message de refus non
              plus — la région d'alerte du parent est l'unique canal d'annonce ;
              le champ ne signale que sa faute, par aria-invalid, sans refaire
              lire le texte que l'alerte vient d'énoncer. */}
          <input
            id="periode-du"
            ref={debutRef}
            type="date"
            className="input"
            value={debut}
            onChange={(e) => setDebut(e.target.value)}
            aria-invalid={champFautif === 'du' ? true : undefined}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="periode-au">
            Au
          </label>
          <input
            id="periode-au"
            ref={finRef}
            type="date"
            className="input"
            value={fin}
            onChange={(e) => setFin(e.target.value)}
            aria-invalid={champFautif === 'au' ? true : undefined}
          />
        </div>
      </div>

      {/* JAMAIS désactivé, même champs vides ou date fautive : un bouton
          désactivé sort de l'ordre de tabulation, donc sa raison d'être
          indisponible n'est lisible nulle part. La contrainte est vérifiée au
          clic et énoncée dans la région d'alerte du parent. */}
      <button type="button" className="btn btn--ghost" onClick={appliquer}>
        Afficher la période
      </button>
    </div>
  );
}

export default PeriodePicker;
