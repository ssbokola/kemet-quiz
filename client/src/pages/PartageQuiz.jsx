import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../components/Icon';
import RadioGroup from '../components/RadioGroup';
import { MESSAGE_RESEAU } from '../api';
import { chargerQuizComplet, modifierQuiz } from '../quiz-api';
import { chemins, lienPublic } from '../chemins';
import { etatDuQuiz, estEnLigne } from '../quiz-etat';
import { EXPIRY_OPTIONS } from '../diffusion';
import { formatJourHeure } from '../dates';
import { useFocusAuMontage, useTitreDocument } from '../ecran';

const AUCUNE_ERREUR = { texte: '', n: 0 };

const LIBELLE_ETAT = { 'en ligne': 'Quiz en ligne', fermé: 'Quiz fermé', expiré: 'Quiz expiré' };
const ICONE_ETAT = { 'en ligne': 'check', fermé: 'close', expiré: 'info' };
// Trois états à dire, contre deux auparavant. L'état nominal n'a pas de
// modificateur : .share-badge le porte déjà.
const MODIF_ETAT = { 'en ligne': '', fermé: 'share-badge--closed', expiré: 'share-badge--expired' };

/**
 * Écran de partage d'un quiz — QR code, lien, WhatsApp, remise en ligne.
 *
 * C'était le `return` final d'AdminPage, atteignable UNIQUEMENT juste après la
 * création : un rafraîchissement le perdait, et la liste des quiz n'y menait
 * pas. Il a maintenant sa propre adresse, /formateur/quiz/:id, qui se met en
 * favori et s'ouvre en double.
 *
 * ⚠️ `quizLink` est dérivé de l'identifiant de l'URL, JAMAIS des données
 * chargées. C'est ce qui rend l'écran robuste : le QR code, le champ et le
 * bouton « Copier » sont exacts AVANT même le retour de la requête, et le
 * restent si elle échoue. Le formateur repart avec son lien même quand le
 * serveur bafouille.
 */
function PartageQuiz() {
  const { id } = useParams();
  const quizLink = lienPublic(id);

  const [quiz, setQuiz] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [introuvable, setIntrouvable] = useState(false);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const [copied, setCopied] = useState(false);
  const [closing, setClosing] = useState(false);
  const [dureeOuverte, setDureeOuverte] = useState(false);
  // Aucune option n'est pré-cochée, volontairement : `expiresAt` est une date
  // absolue et ne correspond à AUCUNE des trois durées — un quiz créé pour
  // 7 jours et regardé 3 jours plus tard n'est « ni 24 h ni 7 jours ». Le
  // groupe demande une NOUVELLE durée, comptée à partir de maintenant.
  const [duree, setDuree] = useState(null);
  const [appliqueEnCours, setAppliqueEnCours] = useState(false);

  const titreRef = useRef(null);
  const copyTimerRef = useRef(null);
  const [rechargement, setRechargement] = useState(0);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);
  useTitreDocument(quiz?.title);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    setIntrouvable(false);
    (async () => {
      try {
        const data = await chargerQuizComplet(id);
        if (annule) return;
        setQuiz(data);
      } catch (err) {
        if (annule) return;
        // Un quiz introuvable n'est pas une panne : c'est un écran à part
        // entière, pas un message d'erreur au milieu d'un écran à moitié vide.
        if (err?.statut === 404) setIntrouvable(true);
        else signaler(err?.message || MESSAGE_RESEAU);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [id, rechargement]);

  const etat = etatDuQuiz(quiz);
  const enLigne = estEnLigne(quiz);
  const expiry = quiz?.expiresAt ? formatJourHeure(quiz.expiresAt) : null;

  const toggleClosed = async () => {
    if (closing || !quiz) return;
    setClosing(true);
    // On vide l'annonce ET l'erreur AVANT l'appel : deux échecs identiques à la
    // suite ne produiraient sinon aucune mutation du DOM, donc aucune annonce.
    signaler('');
    setAnnonce('');
    try {
      const data = await modifierQuiz(
        id,
        { closed: !quiz.closed },
        'Le statut du quiz n’a pas pu être modifié.'
      );
      // C'est l'état RETENU par le serveur qui met l'écran à jour, jamais la
      // valeur demandée.
      const suivant = { ...quiz, closed: data.closed, expiresAt: data.expiresAt };
      setQuiz(suivant);
      if (data.closed) {
        setAnnonce('Quiz fermé : le lien ne répond plus.');
      } else if (etatDuQuiz(suivant) === 'expiré') {
        // Le piège du « j'ai réouvert et le lien ne marche toujours pas » : un
        // quiz peut être fermé ET expiré, et lever un seul verrou ne suffit pas.
        setAnnonce(
          'Quiz réouvert, mais le lien reste expiré : prolongez sa durée de validité ci-dessous.'
        );
        setDureeOuverte(true);
      } else {
        setAnnonce('Quiz réouvert : le lien fonctionne à nouveau.');
      }
    } catch (err) {
      signaler(err?.message || 'Le statut du quiz n’a pas pu être modifié.');
    } finally {
      setClosing(false);
    }
  };

  const appliquerDuree = async () => {
    if (appliqueEnCours || !quiz) return;
    signaler('');
    setAnnonce('');
    // Le bouton reste ACTIF et le refus est motivé dans la région d'alerte :
    // un contrôle désactivé sort de l'ordre de tabulation et ne dit pas
    // pourquoi. Même règle que dans UploadPDF et ReviewQuestions.
    if (duree === null) {
      signaler('Choisissez d’abord une durée de validité.');
      return;
    }
    setAppliqueEnCours(true);
    try {
      const data = await modifierQuiz(
        id,
        { expiresInHours: duree },
        'La durée de validité n’a pas pu être modifiée.'
      );
      const suivant = { ...quiz, closed: data.closed, expiresAt: data.expiresAt };
      setQuiz(suivant);
      const quand = data.expiresAt
        ? `Lien valide jusqu’au ${formatJourHeure(data.expiresAt)}.`
        : 'Lien sans limite de durée.';
      setAnnonce(
        suivant.closed
          ? `${quand} Mais le quiz est fermé : réouvrez-le pour que le lien réponde.`
          : `${quand} Le lien fonctionne.`
      );
    } catch (err) {
      signaler(err?.message || 'La durée de validité n’a pas pu être modifiée.');
    } finally {
      setAppliqueEnCours(false);
    }
  };

  const handleCopy = async () => {
    clearTimeout(copyTimerRef.current);
    setAnnonce('');
    signaler('');
    try {
      await navigator.clipboard.writeText(quizLink);
      setCopied(true);
      // « Copier » → « Copié » est un changement de nom accessible sur
      // l'élément qui a le focus : la plupart des lecteurs d'écran ne le disent
      // pas. L'annonce passe par la région polie, sans déplacer le focus.
      setAnnonce('Lien du quiz copié dans le presse-papiers.');
      copyTimerRef.current = setTimeout(() => {
        setCopied(false);
        setAnnonce('');
      }, 2000);
    } catch {
      setCopied(false);
      signaler('La copie a échoué. Sélectionnez le lien puis copiez-le à la main.');
    }
  };

  const handleShareWhatsApp = () => {
    const message = encodeURIComponent(
      `Bonjour,\nVoici le lien de votre quiz « ${quiz?.title || ''} » :\n${quizLink}\n\nBonne chance !`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  if (introuvable) {
    return (
      <div className="stack">
        <div className="page-head">
          <h1 ref={titreRef} tabIndex={-1}>
            Quiz introuvable
          </h1>
          <p>Ce lien ne correspond à aucun quiz. Il a peut-être été supprimé.</p>
        </div>
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="search" size={22} width={1.6} />
          </span>
          <h2>Rien à cette adresse</h2>
          <p>Vérifiez le lien, ou retrouvez le quiz dans votre liste.</p>
          <Link className="btn btn--ghost" to={chemins.mesQuiz}>
            <Icon name="list" size={16} width={1.7} />
            Mes quiz
          </Link>
        </div>
      </div>
    );
  }

  const resume = EXPIRY_OPTIONS.find((o) => o.value === duree)?.resume;

  return (
    <div className="stack">
      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Le badge ne paraît qu'une fois l'état connu : afficher « Quiz en
            ligne » pendant le chargement serait affirmer ce qu'on ignore. */}
        {/* « En ligne » n'a pas de modificateur : c'est l'état par défaut de
            .share-badge (aplat vert), et les deux autres s'en écartent. */}
        {quiz && (
          <span className={`share-badge${MODIF_ETAT[etat] ? ` ${MODIF_ETAT[etat]}` : ''}`}>
            <Icon name={ICONE_ETAT[etat]} size={13} width={2.4} />
            {LIBELLE_ETAT[etat]}
          </span>
        )}
        {/* Un SEUL <h1>, monté dès le premier rendu et focalisé une seule fois.
            Son texte devient le titre du quiz quand la requête revient : aucun
            second déplacement de focus, et jamais de focus retombé sur <body>. */}
        <h1 className="share-title" ref={titreRef} tabIndex={-1}>
          {quiz ? quiz.title : 'Partage du quiz'}
        </h1>
      </div>

      {quiz && (
        <div className="meta-row">
          {quiz.questions?.length > 0 && <span>{quiz.questions.length} questions</span>}
          <span className="meta-row-sep" />
          <span>{quiz.singleAttempt === false ? 'Rejouable' : '1 tentative par personne'}</span>
          {/* Le nombre de réponses déjà reçues est dit ICI, au moment où le
              formateur s'apprête à rediffuser : il rappelle que les nouvelles
              réponses s'AJOUTENT aux anciennes sur le même lien. */}
          {typeof quiz.resultsCount === 'number' && (
            <>
              <span className="meta-row-sep" />
              <span>
                {quiz.resultsCount} réponse{quiz.resultsCount > 1 ? 's' : ''}
              </span>
            </>
          )}
          {expiry && (
            <>
              <span className="meta-row-sep" />
              <span>Jusqu’au {expiry}</span>
            </>
          )}
          <button type="button" className="btn-danger-link" onClick={toggleClosed} aria-busy={closing}>
            {closing ? 'Patientez…' : quiz.closed ? 'Réouvrir' : 'Fermer le quiz'}
          </button>
        </div>
      )}

      {/* Région d'alerte assertive, montée VIDE avec l'écran puis remplie. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      {/* Unique région polie de l'écran. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {/* Le chargement n'escamote NI le QR NI le lien : ils ne dépendent que de
          l'identifiant de l'URL. Seul ce qui vient du serveur attend. */}
      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && !quiz && (
        <button type="button" className="btn btn--ghost" onClick={() => setRechargement((n) => n + 1)}>
          <Icon name="refresh" size={16} width={1.7} />
          Réessayer
        </button>
      )}

      <div className="qr-frame">
        <QRCodeSVG value={quizLink} size={176} bgColor="#ffffff" fgColor="#1f1d24" level="M" />
        <p className="qr-label">Faites scanner ce code à l’écran</p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quiz-link">
          Lien du quiz
        </label>
        <div className="link-row">
          <input id="quiz-link" type="text" value={quizLink} readOnly className="link-input" />
          <button
            type="button"
            className={`btn-copy ${copied ? 'is-copied' : ''}`}
            onClick={handleCopy}
          >
            <Icon name={copied ? 'check' : 'copy'} size={15} width={1.7} />
            {copied ? 'Copié' : 'Copier'}
          </button>
          {/* NE PAS poser aria-live sur ce bouton : son propre libellé serait
              relu à chaque bascule, en doublon de la région status. */}
        </div>
      </div>

      {/* Remise en ligne. Le tiroir reprend trait pour trait le motif audité de
          « Diffusion du lien » (UploadPDF) : le panneau est TOUJOURS rendu,
          seul `hidden` bascule, pour qu'aria-controls désigne un élément
          existant dans les deux états. */}
      {quiz && (
        <div className="advanced">
          <button
            type="button"
            className={`disclosure ${duree !== null ? 'is-custom' : ''}`}
            aria-expanded={dureeOuverte}
            aria-controls="duree-panel"
            onClick={() => setDureeOuverte((o) => !o)}
          >
            <span className="disclosure-label">Durée de validité</span>
            <span className="disclosure-values">
              {resume || (expiry ? `Jusqu’au ${expiry}` : 'Lien sans limite')}
            </span>
            <Icon name="chevronDown" size={16} className="disclosure-chevron" />
          </button>

          <div id="duree-panel" className="adv-panel" hidden={!dureeOuverte}>
            <div className="field">
              <span className="field-label" id="duree-label">
                Nouvelle durée, à compter de maintenant
              </span>
              <RadioGroup
                className="segments segments--3"
                labelledBy="duree-label"
                describedBy="duree-help"
                options={EXPIRY_OPTIONS}
                value={duree}
                onChange={setDuree}
                optionClassName={(opt, checked) =>
                  `segment segment--text ${checked ? 'is-active' : ''}`
                }
              />
              <span className="dropzone-meta" id="duree-help">
                Rien n’est coché : la durée en cours est une date, pas un délai. Choisissez une
                durée puis appliquez-la — elle repart de maintenant.
              </span>
            </div>
            {/* Un bouton « Appliquer » explicite, jamais d'écriture au
                changement de sélection : les flèches du RadioGroup déplacent
                focus ET sélection, une seule traversée au clavier enverrait
                donc trois PATCH. */}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={appliquerDuree}
              aria-busy={appliqueEnCours}
            >
              {appliqueEnCours ? 'Patientez…' : 'Appliquer'}
            </button>
          </div>
        </div>
      )}

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        <button
          className="btn btn--wa btn--block"
          onClick={handleShareWhatsApp}
          // Conditionné à l'état RÉEL, et plus au seul `closed` : sans cela le
          // formateur envoie le lien d'un quiz expiré et l'apprenant reçoit un
          // 410 — précisément le scénario que cet écran doit éviter.
          disabled={!quiz || !enLigne}
        >
          <Icon name="send" size={18} width={1.7} />
          Envoyer sur WhatsApp
        </button>
        {/* Un bouton désactivé n'est pas atteignable au clavier : la raison
            vit à côté, dans le flux, jamais dans un title. */}
        {quiz && !enLigne && (
          <span className="btn-hint">
            {etat === 'fermé'
              ? 'Le quiz est fermé : réouvrez-le pour pouvoir l’envoyer.'
              : 'Le lien a expiré : prolongez sa durée de validité pour pouvoir l’envoyer.'}
          </span>
        )}

        <div className="split-actions">
          <Link className="btn btn--ghost" to={chemins.relecture(id)}>
            <Icon name="edit" size={16} width={1.7} />
            Modifier
          </Link>
          <Link className="btn btn--ghost" to={chemins.resultats(id)}>
            <Icon name="list" size={16} width={1.7} />
            Résultats
          </Link>
          <Link className="btn btn--ghost" to={chemins.mesQuiz}>
            <Icon name="arrowLeft" size={16} width={1.7} />
            Mes quiz
          </Link>
          <Link className="btn btn--ghost" to={chemins.nouveau}>
            Nouveau quiz
          </Link>
        </div>
      </div>
    </div>
  );
}

export default PartageQuiz;
