import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

// Identifiants des titres de dialogue, cibles d'aria-labelledby. Les deux
// dialogues s'excluent mutuellement et ne sont jamais montés en double : des
// identifiants constants suffisent.
const SHEET_TITLE_ID = 'quiz-sheet-title';
const CONFIRM_TITLE_ID = 'quiz-confirm-title';

function stripLetter(text) {
  return String(text).replace(/^[A-F]\)\s*/, '');
}

/* Garde du raccourci clavier global (voir l'effet plus bas).
   Le raccourci écoute keydown sur window : il voit donc AUSSI les touches
   destinées au contrôle qui a le focus. Deux niveaux de retrait, et non un
   seul, parce que tous les contrôles ne consomment pas les mêmes touches.

   FIELD_SELECTOR — champs de saisie et composites (listes, onglets, groupes
   radio…) : ils consomment les lettres ET les flèches. Le raccourci leur
   abandonne la TOTALITÉ du clavier, comme le faisait déjà le garde d'origine
   pour INPUT et TEXTAREA.

   CONTROL_SELECTOR — tout ce qui s'active au clavier, boutons compris. Le
   raccourci ne leur abandonne que les touches d'ACTIVATION. C'est le correctif
   du défaut bloquant : e.preventDefault() sur Entrée annulait la synthèse du
   clic, si bien qu'aucun bouton de l'écran de passation ne s'activait plus à la
   touche Entrée — pastilles de progression, « Question précédente », « Voir
   toutes les questions », « Suivante » / « Terminer », « Recommencer », puces
   du récapitulatif.

   ARBITRAGE — les lettres et les flèches, elles, restent actives quand le focus
   est sur un bouton. Un <button> ne fait rien de « A » ni de « → » : les
   intercepter ne vole aucun comportement natif, alors que les retirer casserait
   l'usage le plus courant de cet écran. Les options de réponse SONT des
   boutons : à la souris, cliquer une option y laisse le focus, et
   l'utilisateur qui corrige ensuite au clavier (« B », puis « → » pour avancer)
   ne verrait plus rien se produire — alors que l'aide affichée juste en dessous
   annonce « A B C D pour répondre » et « ← → pour naviguer ». Répondre « A » en
   tabulant sur « Suivante » reste donc possible, mais l'effet est visible à
   l'écran, sur la question affichée, et c'est bien ce que demandait
   l'utilisateur en tapant une lettre : le risque est moindre que celui de
   rendre muette l'aide affichée. */
const FIELD_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="radiogroup"]',
  '[role="radio"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tablist"]',
  '[role="tab"]',
].join(',');

const CONTROL_SELECTOR = [
  FIELD_SELECTOR,
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
].join(',');

// Entrée et Espace activent le contrôle qui a le focus : elles ne peuvent pas
// servir de raccourci global tant qu'un contrôle est focalisé. Espace n'est pas
// utilisé par le raccourci aujourd'hui ; la règle est posée pour qu'il ne le
// devienne pas par mégarde.
const ACTIVATION_KEYS = ['Enter', ' '];

/* Ordre de tabulation à l'intérieur d'un dialogue.
   [tabindex="-1"] est exclu : c'est le cas du titre, cible du focus à
   l'ouverture mais pas étape de tabulation.
   :not([disabled]) est indispensable — pendant l'envoi, « Retour » et
   « Envoyer » sont tous deux désactivés et la liste devient vide.
   Aucun filtre de visibilité : les deux dialogues n'affichent que des contrôles
   visibles, et un filtre trop zélé (offsetParent, getClientRects) casserait le
   piège plus sûrement qu'il ne l'affinerait. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Gestion du focus d'un dialogue modal : entrée, piège à tabulation,
 * restitution au déclencheur.
 *
 * aria-modal="true" retire tout le reste de la page de l'arbre
 * d'accessibilité. Sans ces trois pièces, l'utilisateur reste focalisé sur un
 * contrôle devenu invisible pour son lecteur d'écran, et la tabulation promène
 * le focus dans un document vide.
 *
 * ENTRÉE — le focus va sur le TITRE (tabIndex -1), pas sur le premier élément
 * focalisable. Trois raisons :
 *   · c'est déjà la convention de l'application (les écrans du parcours
 *     formateur reprennent le focus sur leur titre au montage) ;
 *   · le titre est le nom accessible du dialogue : le lecteur d'écran énonce
 *     rôle + nom, puis l'utilisateur lit vers le bas sans rien sauter. Entrer
 *     sur le premier focalisable ferait manquer le corps du dialogue — la liste
 *     des questions dans la feuille, l'avertissement « après envoi, vous ne
 *     pourrez plus les modifier » et le message d'erreur dans la confirmation ;
 *   · dans la feuille, ce premier focalisable est « Fermer » : mauvais point
 *     d'entrée. Et pendant l'envoi, la confirmation n'a AUCUN focalisable —
 *     le titre, lui, reste toujours une cible valide.
 *
 * SORTIE — le focus revient au déclencheur au démontage de l'effet, quelle que
 * soit la cause de la fermeture (bouton, Échap, clic sur le fond) : les trois
 * passent par le même changement d'état. SAUF si la fermeture s'accompagne d'un
 * changement d'écran — voir `aChangeDEcran`.
 *
 * @param aChangeDEcran fonction STABLE, interrogée au moment de rendre le
 *   focus : vraie quand la fermeture s'accompagne d'un changement d'écran. Le
 *   piège rend alors la main, le focus appartient au titre du nouvel écran.
 *   Une fonction et non l'état lui-même : elle est appelée au nettoyage, donc
 *   elle lit une valeur fraîche là où une valeur capturée serait périmée.
 */
function useDialogFocus(open, aChangeDEcran) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    // Capturé AVANT tout déplacement. Le déclencheur a le focus à cet instant,
    // qu'il ait été activé au clavier ou à la souris (un clic sur un <button>
    // le focalise). Quand ce n'est pas le cas — ouverture de la confirmation
    // par le raccourci Entrée depuis le récapitulatif, où le focus est sur
    // <body> — la restitution retombe sur <body>, c'est-à-dire exactement d'où
    // l'on venait.
    const trigger = document.activeElement;

    titleRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;

      const nodes = Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) {
        // Envoi en cours : les deux boutons sont désactivés, il ne reste rien à
        // focaliser. On garde le focus sur le titre plutôt que de laisser la
        // tabulation s'échapper vers une page qu'aria-modal a retirée de
        // l'arbre d'accessibilité.
        e.preventDefault();
        titleRef.current?.focus();
        return;
      }

      const index = nodes.indexOf(document.activeElement);
      if (index === -1) {
        // Focus hors du cycle : sur le titre, ou égaré hors du dialogue. On le
        // ramène à l'extrémité correspondant au sens demandé — c'est ce cas qui
        // fait que Maj+Tab depuis le titre boucle sur le DERNIER contrôle au
        // lieu de sortir du dialogue par le haut.
        e.preventDefault();
        (e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus();
        return;
      }
      if (e.shiftKey && index === 0) {
        e.preventDefault();
        nodes[nodes.length - 1].focus();
      } else if (!e.shiftKey && index === nodes.length - 1) {
        e.preventDefault();
        nodes[0].focus();
      }
    };

    // Écoute sur window et non sur le conteneur : si le focus s'échappe malgré
    // tout du dialogue, un écouteur posé sur le conteneur ne verrait plus rien
    // et le piège serait définitivement perdu.
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      // La fermeture s'accompagne d'un CHANGEMENT D'ÉCRAN : « Aller au
      // récapitulatif », ou le clic sur une autre question dans la feuille. Le
      // déclencheur, lui, est toujours monté — il vit dans le pied de page,
      // commun aux deux écrans — donc `document.contains` ne l'écarte pas. Lui
      // rendre le focus le reprendrait au titre du nouvel écran, posé au même
      // commit par l'effet dédié, et le participant changerait de question sans
      // rien entendre. Le drapeau est remis à zéro par cet effet-là, qui suit
      // toujours ce nettoyage.
      if (aChangeDEcran?.()) return;
      // document.contains : l'envoi démonte Quiz en entier. On ne rend jamais le
      // focus à un déclencheur qui n'est plus dans le document.
      if (trigger instanceof HTMLElement && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, [open, aChangeDEcran]);

  return { dialogRef, titleRef };
}

/**
 * Mode focus : une question par écran, thème encre & or.
 * - pas d'auto-avance : le participant garde la main
 * - barre segmentée + feuille « toutes les questions » (lisible même à 30)
 * - écran de récapitulatif final qui NOMME les questions manquantes
 */
function Quiz({
  quizTitle,
  questions,
  userAnswers,
  onAnswer,
  onSubmit,
  submitting,
  submitError,
  onClearSubmitError,
  resumed,
  onRestart,
}) {
  const total = questions.length;
  // index === total → écran de récapitulatif
  const [current, setCurrent] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Copie retardée d'un commit de `submitError`, et VERSIONNÉE. Voir l'effet
  // plus bas et la région d'alerte de la confirmation.
  const [erreurAnnoncee, setErreurAnnoncee] = useState({ n: 0, message: '' });

  // Titre de l'écran affiché : le h1 de la question, ou celui du récapitulatif
  // qui le remplace. Les deux ne sont jamais montés ensemble, une seule ref
  // suffit.
  const titreEcranRef = useRef(null);
  // Écran vu au dernier passage de l'effet de focus. Comparer, plutôt que lever
  // un drapeau « premier rendu » : StrictMode monte, démonte puis remonte les
  // effets en développement, et un drapeau consommé au premier passage
  // laisserait le second voler le focus au chargement de la page.
  const ecranPrecedentRef = useRef(current);
  // Levé par `goTo` quand la navigation change réellement d'écran, lu par le
  // piège à focus des dialogues, remis à zéro par l'effet de focus.
  const changementEcranRef = useRef(false);
  // Version du message d'erreur annoncé. En ref et non en état : elle ne sert
  // qu'à fabriquer la `key` du paragraphe, jamais à décider d'un rendu.
  const versionErreurRef = useRef(0);
  // Identité stable : elle entre dans les dépendances de l'effet des dialogues,
  // qui ne doit surtout pas se remonter à chaque rendu — il redéplacerait le
  // focus sur le titre du dialogue à la moindre frappe.
  const aChangeDEcran = useCallback(() => changementEcranRef.current, []);

  // Déstructuré à l'appel, et non conservé en objet : lire `x.titleRef` pendant
  // le rendu est signalé comme un accès de ref pendant le rendu
  // (react-hooks/refs), alors que la ref elle-même se transmet librement.
  const { dialogRef: sheetDialogRef, titleRef: sheetTitleRef } = useDialogFocus(
    sheetOpen,
    aChangeDEcran
  );
  const { dialogRef: confirmDialogRef, titleRef: confirmTitleRef } = useDialogFocus(
    confirmOpen,
    aChangeDEcran
  );

  const answered = Object.keys(userAnswers).length;
  const allAnswered = answered === total;
  const onRecap = current >= total;
  const q = onRecap ? null : questions[current];
  const missing = questions.map((_, i) => i).filter((i) => !userAnswers[i]);

  useEffect(() => {
    document.body.classList.add('theme-ink');
    return () => document.body.classList.remove('theme-ink');
  }, []);

  useEffect(() => {
    if (!sheetOpen && !confirmOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSheetOpen(false);
        if (!submitting) setConfirmOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, confirmOpen, submitting]);

  // useCallback : `goTo` lit `current` et entre donc dans les dépendances de
  // l'effet du raccourci clavier, qui dépend déjà de `current` — l'abonnement
  // n'est pas repris plus souvent qu'avant.
  const goTo = useCallback((idx) => {
    // Levé AVANT le changement d'état, à partir de l'écran encore affiché : le
    // piège à focus du dialogue qui se ferme dans le même commit le lit pour
    // savoir s'il doit rendre le focus à son déclencheur. Une navigation vers
    // l'écran déjà affiché (clic sur la ligne courante dans la feuille) ne
    // change rien : le focus doit alors bien revenir au déclencheur.
    changementEcranRef.current = idx !== current;
    setCurrent(idx);
    setSheetOpen(false);
    window.scrollTo({ top: 0 });
  }, [current]);

  /* Changement de question ou passage au récapitulatif : le focus va sur le
     titre du nouvel écran.

     Sans cela, trois défauts se cumulent. Le nouvel écran n'est ANNONCÉ nulle
     part — la question change en silence. Le focus RESTE sur le contrôle
     d'origine, ou tombe sur <body> quand ce contrôle se désactive du fait de
     sa propre activation (« Question précédente » sur la question 1, dernier
     bouton d'or remonté par sa `key`) ; le raccourci clavier global se rearme
     alors et la MÊME touche Entrée produit deux effets opposés à une frappe
     d'intervalle. Enfin, quand la navigation vient de la feuille, le piège à
     focus rendait la main à un déclencheur du pied de page, à l'opposé de ce
     que le participant vient de faire.

     Le titre porte tabIndex={-1} : cible de focus, hors de l'ordre de
     tabulation. Le focus sur un titre est la convention de l'application.

     PREMIER MONTAGE EXCLU : voler le focus au chargement d'une page est une
     régression d'accessibilité — le participant doit pouvoir partir du haut du
     document. `ecranPrecedentRef` est initialisée avec l'écran de départ, donc
     le premier passage ne déplace rien. */
  useEffect(() => {
    if (ecranPrecedentRef.current === current) return;
    ecranPrecedentRef.current = current;
    titreEcranRef.current?.focus();
    // Consommé : le nettoyage du dialogue, s'il y en avait un, est passé juste
    // avant (React démonte tous les effets d'un commit avant d'en monter aucun).
    changementEcranRef.current = false;
  }, [current]);

  const openConfirm = useCallback(() => {
    if (onClearSubmitError) onClearSubmitError();
    setConfirmOpen(true);
  }, [onClearSubmitError]);

  // Raccourcis clavier : A–D (ou 1–4) pour répondre, flèches pour naviguer.
  // Neutralisé tant qu'un dialogue est ouvert : la feuille et la confirmation
  // ont leur propre clavier (Tab piégé, Échap).
  useEffect(() => {
    if (sheetOpen || confirmOpen) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // closest, et non tagName : la cible peut être un descendant du contrôle
      // (le <span> d'un bouton, un nœud d'une zone contenteditable) et le
      // contrôle peut n'être identifiable que par son rôle ARIA. Quand le focus
      // est « nulle part », e.target vaut <body> : aucun sélecteur ne matche et
      // le raccourci s'applique pleinement. Voir l'en-tête des deux sélecteurs.
      const target = e.target instanceof Element ? e.target : null;
      if (target && target.closest(FIELD_SELECTOR)) return;
      if (target && ACTIVATION_KEYS.includes(e.key) && target.closest(CONTROL_SELECTOR)) return;

      if (!onRecap && q) {
        const key = e.key.toUpperCase();
        let optIdx = LETTERS.indexOf(key);
        if (optIdx === -1 && /^[1-6]$/.test(e.key)) optIdx = Number(e.key) - 1;
        if (optIdx > -1 && optIdx < q.options.length) {
          e.preventDefault();
          onAnswer(current, LETTERS[optIdx]);
          return;
        }
      }

      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (onRecap) {
          if (allAnswered) openConfirm();
        } else {
          goTo(current + 1);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (current > 0) goTo(current - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // openConfirm capture `onClearSubmitError`, une prop : sans elle dans les
    // dépendances, l'effet garderait une version périmée du gestionnaire. D'où
    // le useCallback plus haut — la référence ne change que si la prop change.
  }, [current, onRecap, q, sheetOpen, confirmOpen, allAnswered, onAnswer, openConfirm, goTo]);

  /* Recopie retardée d'un commit : la région d'alerte de la confirmation est
     montée VIDE, puis remplie au commit suivant. Une région live ajoutée au DOM
     en même temps que son texte n'est pas annoncée.

     `n` est une VERSION, pas un compteur d'affichage. Deux échecs identiques
     consécutifs sont ici le cas le plus probable — on réappuie sur « Envoyer »
     —, et réécrire la même chaîne ne mute pas le DOM, donc n'annonce rien.
     Portée par la `key` du paragraphe, la version force son remontage : le
     contenu de la région change vraiment et la n-ième occurrence est annoncée
     comme la première. */
  useEffect(() => {
    // Montage : rien à annoncer et rien à effacer, on évite un rendu pour rien.
    if (!submitError && versionErreurRef.current === 0) return;
    versionErreurRef.current += 1;
    setErreurAnnoncee({ n: versionErreurRef.current, message: submitError });
  }, [submitError]);

  // Passage à l'état d'envoi : « Retour » et « Envoyer » se désactivent dans le
  // même commit. Le bouton qui portait le focus devient inerte, le navigateur
  // rend donc le focus à <body> — hors du dialogue, c'est-à-dire hors de tout ce
  // qu'aria-modal="true" laisse dans l'arbre d'accessibilité, et le piège ne le
  // rattrape qu'à la prochaine touche Tab. Le titre reste, lui, une cible
  // valide, et c'est à côté de lui que l'échec sera annoncé.
  useEffect(() => {
    if (confirmOpen && submitting) confirmTitleRef.current?.focus();
  }, [confirmOpen, submitting, confirmTitleRef]);

  return (
    <div className="quiz">
      <div className="quiz-top">
        <div className="quiz-top-row">
          <span className="quiz-doc">{quizTitle}</span>
          <span className="quiz-count">
            {onRecap ? 'Récapitulatif' : `${String(current + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`}
          </span>
        </div>
        <div className="quiz-ticks" role="presentation">
          {questions.map((_, idx) => (
            <button
              key={idx}
              type="button"
              className={`tick ${userAnswers[idx] ? 'is-answered' : ''} ${
                idx === current ? 'is-current' : ''
              }`}
              onClick={() => goTo(idx)}
              aria-label={`Aller à la question ${idx + 1}`}
            />
          ))}
        </div>
      </div>

      {resumed && !onRecap && (
        <div className="quiz-resume">
          <span>Reprise de votre quiz</span>
          <button type="button" className="link-btn" onClick={onRestart}>
            Recommencer
          </button>
        </div>
      )}

      {onRecap ? (
        <div className="recap">
          <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            {/* h1 : le récapitulatif REMPLACE .quiz-body, seul porteur du
                niveau 1 de la passation (.quiz-question). Les deux ne sont
                jamais montés ensemble — pas de h1 en double — et sans cette
                promotion l'écran n'a aucun titre de niveau 1.
                tabIndex={-1} : cible du focus à l'arrivée sur l'écran. */}
            <h1 ref={titreEcranRef} tabIndex={-1}>
              {allAnswered ? 'Tout est répondu' : 'Il reste des questions'}
            </h1>
            <p>
              {allAnswered
                ? `Vous avez répondu aux ${total} questions. Vous pouvez encore revenir sur l’une d’elles avant d’envoyer.`
                : `${missing.length} question${missing.length > 1 ? 's' : ''} sans réponse. Touchez un numéro pour y retourner.`}
            </p>
          </div>

          {!allAnswered && (
            <div className="recap-missing">
              <span className="recap-missing-title">À compléter</span>
              <div className="recap-missing-list">
                {missing.map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="recap-missing-chip"
                    onClick={() => goTo(idx)}
                  >
                    Question {idx + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="recap-grid">
            {questions.map((_, idx) => (
              <button
                key={idx}
                type="button"
                className={`recap-cell ${userAnswers[idx] ? 'is-answered' : ''}`}
                onClick={() => goTo(idx)}
              >
                {idx + 1}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="quiz-body" key={current}>
          {/* tabIndex={-1} : cible du focus à chaque changement de question. */}
          <h1 className="quiz-question" ref={titreEcranRef} tabIndex={-1}>
            {q.question}
          </h1>
          <div className="quiz-options">
            {q.options.map((option, optIdx) => {
              const letter = LETTERS[optIdx];
              const isSelected = userAnswers[current] === letter;
              return (
                <button
                  key={optIdx}
                  type="button"
                  className={`opt ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onAnswer(current, letter)}
                >
                  <span className="opt-letter">{letter}</span>
                  <span className="opt-text">{stripLetter(option)}</span>
                  {isSelected && (
                    <Icon name="check" size={17} width={2.2} className="opt-check" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="kbd-hint">
            <span className="kbd">A</span>
            <span className="kbd">B</span>
            <span className="kbd">C</span>
            <span className="kbd">D</span>
            <span>pour répondre</span>
            <span className="kbd">←</span>
            <span className="kbd">→</span>
            <span>pour naviguer</span>
          </div>
        </div>
      )}

      <div className="quiz-foot">
        <button
          type="button"
          className="btn-ink-ghost btn-ink-ghost--icon"
          onClick={() => goTo(Math.max(0, current - 1))}
          disabled={current === 0}
          aria-label="Question précédente"
        >
          <Icon name="arrowLeft" size={18} width={1.8} />
        </button>

        <button
          type="button"
          className="btn-ink-ghost btn-ink-ghost--icon"
          onClick={() => setSheetOpen(true)}
          aria-label="Voir toutes les questions"
        >
          <Icon name="list" size={18} width={1.7} />
        </button>

        {/* `key` distinctes, et non un seul bouton dont le contenu change :
            même position, même type, React RÉUTILISERAIT le nœud DOM. Le focus
            y reste alors au passage dernière question → récapitulatif, et le
            nom accessible du bouton focalisé passe de « Terminer » à « Envoyer
            mes réponses » sans que rien ne l'annonce. Les `key` forcent le
            remontage ; l'annonce du nouvel écran, elle, vient du focus porté
            sur son titre. */}
        {onRecap ? (
          <button
            key="envoyer"
            type="button"
            className="btn-gold"
            onClick={openConfirm}
            disabled={!allAnswered}
          >
            {allAnswered ? 'Envoyer mes réponses' : `${missing.length} question${missing.length > 1 ? 's' : ''} à compléter`}
            {allAnswered && <Icon name="send" size={17} width={1.8} />}
          </button>
        ) : (
          <button
            key="suivante"
            type="button"
            className="btn-gold"
            onClick={() => goTo(current + 1)}
          >
            {current === total - 1 ? 'Terminer' : 'Suivante'}
            <Icon name="arrowRight" size={18} width={1.9} />
          </button>
        )}
      </div>

      {sheetOpen && (
        <div className="sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div
            className="sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={SHEET_TITLE_ID}
            ref={sheetDialogRef}
          >
            <div className="sheet-head">
              {/* h2 : le dialogue s'ouvre PAR-DESSUS l'écran de passation ou de
                  récapitulatif, qui porte déjà le niveau 1. Un h3 y ferait
                  sauter la hiérarchie de h1 à h3.
                  tabIndex -1 : cible du focus à l'ouverture, hors tabulation. */}
              <h2 id={SHEET_TITLE_ID} ref={sheetTitleRef} tabIndex={-1}>
                Toutes les questions · {answered}/{total}
              </h2>
              <button
                type="button"
                className="sheet-close"
                onClick={() => setSheetOpen(false)}
                aria-label="Fermer"
              >
                <Icon name="close" size={15} width={2} />
              </button>
            </div>
            <div className="sheet-list">
              {questions.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`sheet-row ${userAnswers[idx] ? 'is-answered' : ''} ${
                    idx === current ? 'is-current' : ''
                  }`}
                  onClick={() => goTo(idx)}
                >
                  <span className="sheet-row-num">{String(idx + 1).padStart(2, '0')}</span>
                  <span className="sheet-row-text">{item.question}</span>
                  <span className="sheet-row-state">
                    {userAnswers[idx] ? userAnswers[idx] : '—'}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="btn-ink-ghost" onClick={() => goTo(total)}>
              Aller au récapitulatif
            </button>
          </div>
        </div>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => !submitting && setConfirmOpen(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={CONFIRM_TITLE_ID}
            ref={confirmDialogRef}
          >
            {/* h2 : voir le titre de la feuille, même raison.
                tabIndex -1 : cible du focus à l'ouverture, hors tabulation, et
                de la reprise au passage à l'état d'envoi. */}
            <h2 id={CONFIRM_TITLE_ID} ref={confirmTitleRef} tabIndex={-1}>
              Envoyer vos réponses ?
            </h2>
            <p>
              Vous avez répondu aux <strong>{total}</strong> questions. Après envoi, vous ne pourrez
              plus les modifier — vous verrez la correction complète.
            </p>
            {/* Conteneur monté dès l'OUVERTURE du dialogue et jamais démonté :
                c'est lui qui porte role="alert", pas le message. Sans lui,
                l'échec d'envoi n'était annoncé nulle part — aria-modal="true"
                retire le reste de la page de l'arbre d'accessibilité, le focus
                restait sur « Envoyer », et le participant pouvait réappuyer
                indéfiniment sans jamais savoir. Le message n'est PAS
                focalisable : il est annoncé par la région et par elle seule, le
                focus reste sur le titre juste au-dessus.
                Garder la forme ternaire : `{x && …}` avec une chaîne vide peut
                laisser un nœud texte vide et casser :empty.
                Les DEUX conditions comptent. `submitError` est l'état vrai du
                parent : sans lui, rouvrir la confirmation après un échec
                remonterait la région avec le message PRÉCÉDENT — encore dans
                l'état retardé au commit d'ouverture — le temps d'un rendu.
                `erreurAnnoncee` est le report d'un commit qui garantit que la
                région naît vide et se remplit ensuite. */}
            <div className="error-slot" role="alert" aria-atomic="true">
              {submitError && erreurAnnoncee.message ? (
                <p className="error-msg" key={erreurAnnoncee.n}>
                  <Icon name="info" size={16} width={1.8} />
                  <span>{erreurAnnoncee.message}</span>
                </p>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Retour
              </button>
              <button
                type="button"
                className="btn btn--ink"
                onClick={onSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <span className="btn-spinner" /> Envoi…
                  </>
                ) : (
                  'Envoyer'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Quiz;
