import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Icon from './Icon';
import RadioGroup from './RadioGroup';
import {
  adminFetchOuReseau,
  messageErreur,
  messagePourFormateur,
  setAdminPassword,
  MESSAGE_RESEAU,
} from '../api';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const QUESTION_OPTIONS = [5, 10, 15, 20, 30].map((n) => ({ value: n, label: String(n) }));
const DIFFICULTY_OPTIONS = [
  { value: 'facile', label: 'Facile', desc: 'restitution directe' },
  { value: 'moyen', label: 'Moyen', desc: 'compréhension' },
  { value: 'difficile', label: 'Difficile', desc: "cas d'application" },
];

const EXPIRY_OPTIONS = [
  { value: 0, label: 'Sans limite' },
  { value: 24, label: '24 h' },
  { value: 168, label: '7 jours' },
];

const ATTEMPT_OPTIONS = [
  { value: true, label: '1 tentative', desc: 'un score par participant' },
  { value: false, label: 'Libre', desc: 'entraînement, rejouable' },
];

const STAGE_ORDER = ['read', 'write', 'verify'];

const STAGE_LABELS = {
  read: 'Lecture du document',
  write: 'Rédaction des questions',
  verify: 'Vérification des réponses',
};

const MINUTES_PER_QUESTION = 0.5;

// Ce module est évalué au chargement de l'application, donc AVANT toute
// interaction possible. Le drapeau sépare les deux façons dont cet écran arrive
// à l'affichage : le tout premier rendu de l'application (mot de passe déjà en
// session, aucun clic ni aucune touche encore émis) et un changement d'écran,
// qui suppose TOUJOURS une action de l'utilisateur — validation du mur de mot
// de passe, « Nouveau quiz » depuis l'écran de partage. Seul le second cas
// justifie de reprendre le focus.
let userHasActed = false;

if (typeof window !== 'undefined') {
  const markActed = () => {
    userHasActed = true;
    window.removeEventListener('pointerdown', markActed, true);
    window.removeEventListener('keydown', markActed, true);
  };
  // En phase de capture : l'écouteur passe avant le gestionnaire React qui
  // provoque le changement d'écran, le drapeau est donc déjà vrai quand le
  // montage suivant le consulte.
  window.addEventListener('pointerdown', markActed, true);
  window.addEventListener('keydown', markActed, true);
}

// État « aucune erreur ». Partagé par les deux états d'erreur pour qu'ils
// démarrent sur la MÊME référence : la recopie du montage ne change alors rien
// et n'entraîne aucun rendu supplémentaire. Jamais muté : chaque écriture
// produit un objet neuf.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Le filtre qui écarte les traces d'exception (« Unexpected token … is not valid
// JSON », « Connection error. ») au profit d'un texte français actionnable vit
// désormais dans api.js : il sert au flux NDJSON ci-dessous ET à toutes les
// réponses HTTP, via messageErreur. Une seule définition, une seule règle.

function formatSize(bytes) {
  if (!bytes) return '';
  const mo = bytes / (1024 * 1024);
  if (mo >= 1) return `${mo.toFixed(1).replace('.', ',')} Mo`;
  return `${Math.round(bytes / 1024)} Ko`;
}

async function extractTextFromPdf(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    if (onProgress) onProgress(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n\n';
  }
  return { text: text.trim(), pages: pdf.numPages };
}

function UploadPDF({ onQuizGenerated }) {
  const [file, setFile] = useState(null);
  const [pageCount, setPageCount] = useState(null);
  const [title, setTitle] = useState('');
  const [numQuestions, setNumQuestions] = useState(10);
  const [difficulty, setDifficulty] = useState('moyen');
  const [singleAttempt, setSingleAttempt] = useState(true);
  const [expiresInHours, setExpiresInHours] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // Le texte du refus ET le NUMÉRO de son occurrence. Deux refus identiques
  // d'affilée écrivent la même phrase : sans ce numéro l'état ne changerait
  // pas, React court-circuiterait le rendu, le DOM de la région d'alerte ne
  // muterait pas et le lecteur d'écran resterait muet au second appui. Le cas
  // est PRÉVU par le code — handleInputChange remet la valeur de l'input à zéro
  // pour que redéposer le MÊME fichier redéclenche onChange, donc redonne le
  // même refus. Le numéro n'est jamais affiché : il sert de `key` au message,
  // qui est ainsi démonté puis remonté DANS la région déjà présente. C'est une
  // vraie mutation de son contenu, donc une vraie annonce, à chaque fois.
  const [error, setError] = useState(AUCUNE_ERREUR);
  // Copie retardée d'un commit de `error` : c'est elle qui est rendue dans la
  // région d'alerte. Voir l'effet plus bas.
  const [announcedError, setAnnouncedError] = useState(AUCUNE_ERREUR);
  const [loading, setLoading] = useState(false);
  // 'read' → 'write' → 'verify'
  const [stage, setStage] = useState('read');
  const [readProgress, setReadProgress] = useState(null);
  const [liveMessage, setLiveMessage] = useState('');
  const inputRef = useRef(null);
  // true = l'input qui portait le focus va être démonté par ce changement
  // d'état ; il faut redonner le focus au nouvel input après le rendu.
  const refocusRef = useRef(false);
  const formHeadingRef = useRef(null);
  const progressHeadingRef = useRef(null);
  const submitRef = useRef(null);
  const wasLoadingRef = useRef(false);

  // Seules portes d'écriture de l'erreur : le numéro d'occurrence s'incrémente
  // à CHAQUE appel, effacement compris. Ne jamais appeler setError directement,
  // ce serait retomber sur l'état inchangé que ce numéro existe pour éviter.
  const signalerErreur = (texte) => setError((prev) => ({ texte, n: prev.n + 1 }));
  const effacerErreur = () => signalerErreur('');

  // Montage de l'écran. L'écran précédent (mur de mot de passe, écran de
  // partage) est démonté avec l'élément qui portait le focus : sans reprise, le
  // focus retombe sur <body> et la tabulation repart du haut du document. Ce
  // composant ne prend en charge que SON titre, les autres écrans font de même
  // chez eux.
  // Le premier rendu de l'application est volontairement exclu : quand le mot
  // de passe est déjà en session, cet écran est le tout premier affiché, et
  // voler le focus au chargement d'une page est une régression d'accessibilité
  // — l'utilisateur doit pouvoir commencer par le haut du document. Aucun
  // délai ni aucune propriété venant d'un autre composant n'est nécessaire pour
  // trancher : `userHasActed` est faux tant que l'utilisateur n'a rien fait.
  useEffect(() => {
    if (userHasActed) formHeadingRef.current?.focus();
  }, []);

  // Un seul input fichier est monté à la fois : dans la dropzone (aucun
  // fichier) OU dans la puce (fichier retenu). React démonte l'un et monte
  // l'autre, le focus clavier serait perdu sur le <body> sans ceci.
  useEffect(() => {
    if (!refocusRef.current) return;
    refocusRef.current = false;
    inputRef.current?.focus();
  }, [file]);

  // UNE seule région live parle pendant la fabrication, et elle ne dit que
  // l'étape. Le pourcentage et le compteur de pages changent trop souvent :
  // ils vivent dans aria-valuetext de la barre, consultable à la demande.
  // Le message est écrit dans un effet, pas pendant le rendu : la région est
  // donc montée VIDE au premier commit puis modifiée au commit suivant, ce qui
  // est la seule séquence réellement annoncée par les lecteurs d'écran.
  useEffect(() => {
    if (!loading) {
      setLiveMessage('');
      return;
    }
    const index = STAGE_ORDER.indexOf(stage) + 1;
    setLiveMessage(`Étape ${index} sur 3 : ${STAGE_LABELS[stage].toLowerCase()}.`);
  }, [loading, stage]);

  // Aller : le bouton d'envoi qui avait le focus est démonté avec le
  // formulaire. Sans reprise, le focus retombe sur <body> et la tabulation
  // repart du haut du document.
  useEffect(() => {
    if (loading) progressHeadingRef.current?.focus();
  }, [loading]);

  // Le message n'est jamais rendu dans le commit qui monte sa région : il est
  // recopié ici, au commit suivant. Au retour de l'écran de fabrication le
  // formulaire est remonté avec `error` déjà rempli ; sans ce report la région
  // d'alerte naîtrait avec son texte et ne serait pas annoncée de façon fiable.
  // Elle naît donc VIDE puis se remplit — même séquence que la région de
  // progression. Sur les erreurs sans changement d'écran la région est déjà
  // montée : le report d'un commit ne se voit pas.
  // `error` étant un objet neuf à chaque écriture, cet effet se redéclenche même
  // quand le texte est identique : c'est ce qui porte le numéro d'occurrence
  // jusqu'à la `key` du message, et donc l'annonce du refus répété.
  useEffect(() => {
    setAnnouncedError(error);
  }, [error]);

  // Retour après échec : le titre de l'écran de fabrication qui portait le
  // focus est démonté, il faut donc reprendre le focus. La cible est le bouton
  // d'envoi, SITUÉ HORS de la région d'alerte : le message est annoncé une
  // seule fois, par la région, et non une seconde fois comme contenu d'un
  // nouvel élément focalisé. L'erreur reste visible juste au-dessus du bouton,
  // atteignable sans repartir du haut du document, et l'utilisateur se trouve
  // déjà sur la commande pour réessayer. Les erreurs sans changement d'écran
  // (mauvais format, envoi sans PDF) ne déplacent rien : le focus est resté
  // dans le formulaire et la région parle seule.
  useEffect(() => {
    if (!loading && wasLoadingRef.current && error.texte) submitRef.current?.focus();
    wasLoadingRef.current = loading;
  }, [loading, error]);

  // fromPicker : true quand la sélection vient du sélecteur natif (clic ou
  // clavier sur le label), false quand elle vient d'un glisser-déposer — dans
  // ce cas le focus n'était pas dans le sélecteur, on ne le déplace pas.
  const acceptFile = (candidate, fromPicker = false) => {
    if (!candidate) return;
    const isPdf =
      candidate.type === 'application/pdf' || candidate.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      // Refus typiquement répété : on redépose le même fichier non PDF sans
      // avoir compris, d'où le passage obligé par signalerErreur.
      signalerErreur('Ce format n’est pas géré. Déposez un fichier PDF.');
      return;
    }
    refocusRef.current = fromPicker;
    setFile(candidate);
    setPageCount(null);
    setTitle(candidate.name.replace(/\.pdf$/i, ''));
    effacerErreur();
  };

  // La valeur est remise à zéro pour que re-choisir le MÊME fichier déclenche
  // bien un nouvel onChange (cas : on clique « Changer » puis on reprend le
  // même PDF, ou on choisit deux fois de suite un fichier refusé).
  const handleInputChange = (e) => {
    acceptFile(e.target.files?.[0], true);
    e.target.value = '';
  };

  const clearFile = () => {
    // Le bouton « Retirer » va disparaître avec la puce : on rend le focus au
    // sélecteur de la dropzone qui le remplace.
    refocusRef.current = true;
    setFile(null);
    setPageCount(null);
    setTitle('');
    effacerErreur();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  const estMinutes = Math.max(2, Math.round(numQuestions * MINUTES_PER_QUESTION));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) {
      // Deuxième appui sur « Générer » toujours sans fichier : même phrase, mais
      // occurrence suivante, donc annoncée de nouveau.
      signalerErreur(
        'Choisissez d’abord un PDF : déposez-le dans la zone ci-dessus ou parcourez vos fichiers.'
      );
      return;
    }

    setLoading(true);
    effacerErreur();
    setStage('read');
    setReadProgress(null);

    try {
      const { text, pages } = await extractTextFromPdf(file, (cur, total) => {
        setReadProgress({ cur, total });
      });
      setPageCount(pages);

      const formData = new FormData();
      formData.append('numQuestions', numQuestions);
      formData.append('difficulty', difficulty);
      formData.append('title', (title || file.name.replace(/\.pdf$/i, '')).trim());
      formData.append('singleAttempt', singleAttempt ? 'true' : 'false');
      formData.append('expiresInHours', String(expiresInHours));

      if (text && text.length > 200) {
        formData.append('text', text);
      } else {
        // PDF scanné : on envoie le binaire, le modèle lit l'image
        formData.append('pdf', file);
      }

      setStage('write');

      // La promesse de fetch ne rejette QUE si la requête n'aboutit pas du tout
      // — API arrêtée, réseau coupé. Ce cas n'a ni statut ni corps à traduire :
      // `adminFetchOuReseau` le rejette avec MESSAGE_RESEAU, et il ne doit
      // surtout pas se retrouver dans le repli générique ci-dessous, qui
      // parlerait d'une réponse du serveur alors qu'il n'y en a jamais eu.
      const res = await adminFetchOuReseau('/api/upload-pdf', {
        method: 'POST',
        body: formData,
      });

      if (res.status === 401) {
        // Le mot de passe conservé en session vient d'être refusé. Il faut le
        // PURGER avant d'annoncer quoi que ce soit : l'espace formateur
        // s'initialise déverrouillé dès que la session en contient un, donc
        // tant qu'il y reste, recharger la page ne montre pas le mur de mot de
        // passe — on retombe sur cet écran, on retente, on relit le même
        // message, sans issue. Une fois purgé, le rechargement redemande
        // réellement le mot de passe : l'action décrite ci-dessous fonctionne.
        setAdminPassword('');
        throw new Error(
          'Votre accès n’est plus valide : rechargez la page, le mot de passe vous sera redemandé.'
        );
      }
      // Tout ce qui porte un statut passe par `messageErreur` : elle rend le
      // message du serveur quand il en donne un, et dit que le serveur a échoué
      // sur un 500 sans corps exploitable — celui du proxy quand l'API n'est pas
      // démarrée — plutôt que d'inventer une cause.
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La génération du quiz a échoué.'));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;
      let done = false;

      while (!done) {
        // Une lecture qui rejette, c'est le flux coupé en pleine fabrication
        // (API arrêtée entre-temps, connexion perdue) : pas d'erreur métier, pas
        // de statut, pas de corps — même message que pour une requête qui
        // n'aboutit pas.
        let chunk;
        try {
          chunk = await reader.read();
        } catch {
          throw new Error(MESSAGE_RESEAU);
        }
        const { value, done: streamDone } = chunk;
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === 'done') {
            result = msg;
            done = true;
          } else if (msg.type === 'error') {
            // Erreur annoncée par le serveur dans le flux. Son message ne passe
            // QUE s'il s'adresse à un humain : le serveur y relaie aussi, tel
            // quel, le message d'une exception interne (anglais, technique).
            // Le repli s'adresse au formateur et non au développeur.
            throw new Error(
              messagePourFormateur(msg.error, 'La fabrication du quiz a échoué, réessayez.')
            );
          } else if (msg.type === 'progress') {
            setStage('write');
          }
        }
      }

      if (!result) throw new Error('Réponse du serveur incomplète, réessayez.');
      setStage('verify');
      // ATTENDU, impérativement : le gestionnaire du parent est asynchrone (il
      // enchaîne une requête avant de changer d'écran). Sans `await`, le
      // `finally` ci-dessous retirait l'état de chargement AVANT cette bascule :
      // le formulaire de création réapparaissait pour toute la durée de la
      // requête, fichier, options et bouton « Générer » actifs — un second envoi
      // était possible — et le titre de l'écran de fabrication qui portait le
      // focus était démonté sans reprise, renvoyant le focus sur <body>.
      await onQuizGenerated(result);
    } catch (err) {
      // Le gestionnaire du parent étant attendu, son échec arrive ici : la
      // reprise du formulaire est le comportement voulu (message dans la région
      // d'alerte, focus rendu au bouton d'envoi par l'effet plus haut), et non
      // un écran de progression figé. Repli sur un texte : rien ne garantit
      // qu'un rejet porte une Error, et sans message `error` resterait vide —
      // région muette et reprise de focus inopérante.
      signalerErreur(err?.message || 'La génération a échoué, réessayez.');
    } finally {
      // Succès : le parent a déjà changé d'écran, ce composant est démonté et
      // l'appel est sans effet. Échec : il rend le formulaire utilisable.
      setLoading(false);
    }
  };

  if (loading) {
    const pct = stage === 'read' ? (readProgress ? Math.round((readProgress.cur / readProgress.total) * 25) : 5) : stage === 'write' ? 70 : 95;
    const valueText =
      stage === 'read' && readProgress
        ? `${pct} %, lecture de la page ${readProgress.cur} sur ${readProgress.total}`
        : `${pct} %, ${STAGE_LABELS[stage].toLowerCase()}`;

    return (
      <div className="progress-screen">
        {/* Unique région live de l'écran. Ne rien ajouter d'autre en aria-live
            ici : ni sur les étapes, ni sur la barre, ni sur la légende. */}
        <p className="sr-only" role="status" aria-atomic="true">
          {liveMessage}
        </p>

        <div className="progress-head">
          <div className="spinner" aria-hidden="true" />
          <h1 ref={progressHeadingRef} tabIndex={-1}>
            Fabrication du quiz
          </h1>
          <p>Laissez cet onglet ouvert, comptez environ une minute.</p>
        </div>

        <div className="steps">
          <div className={`step ${stage === 'read' ? 'is-doing' : 'is-done'}`}>
            {stage === 'read' ? (
              <span className="spinner spinner--sm" aria-hidden="true" />
            ) : (
              <span className="step-bullet" aria-hidden="true">
                <Icon name="check" size={13} width={2.4} />
              </span>
            )}
            <span className="step-name">Lecture du document</span>
            <span className="sr-only">{stage === 'read' ? 'en cours' : 'terminé'}</span>
            <span className="step-meta">
              {readProgress ? `${readProgress.cur} / ${readProgress.total} pages` : ''}
            </span>
          </div>

          <div
            className={`step ${
              stage === 'write' ? 'is-doing' : stage === 'verify' ? 'is-done' : 'is-todo'
            }`}
          >
            {stage === 'write' ? (
              <span className="spinner spinner--sm" aria-hidden="true" />
            ) : stage === 'verify' ? (
              <span className="step-bullet" aria-hidden="true">
                <Icon name="check" size={13} width={2.4} />
              </span>
            ) : (
              <span className="step-bullet" aria-hidden="true" />
            )}
            <span className="step-name">Rédaction des questions</span>
            <span className="sr-only">
              {stage === 'write' ? 'en cours' : stage === 'verify' ? 'terminé' : 'à venir'}
            </span>
            <span className="step-meta">{numQuestions} attendues</span>
          </div>

          <div className={`step ${stage === 'verify' ? 'is-doing' : 'is-todo'}`}>
            {stage === 'verify' ? (
              <span className="spinner spinner--sm" aria-hidden="true" />
            ) : (
              <span className="step-bullet" aria-hidden="true" />
            )}
            <span className="step-name">Vérification des réponses</span>
            <span className="sr-only">{stage === 'verify' ? 'en cours' : 'à venir'}</span>
          </div>
        </div>

        <div>
          <div
            className="bar"
            role="progressbar"
            aria-label="Progression de la fabrication"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={valueText}
          >
            <div className="bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="bar-legend">
            <span>{pct} %</span>
            <span>ne fermez pas la page</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      <div className="page-head">
        {/* tabIndex={-1} : cible de la reprise de focus au changement d'écran,
            hors de l'ordre de tabulation. */}
        <h1 ref={formHeadingRef} tabIndex={-1}>
          Créer un quiz
        </h1>
        <p>Déposez un document, l’IA en tire des questions à choix multiple.</p>
      </div>

      {!file ? (
        <label
          className={`dropzone ${dragOver ? 'is-over' : ''}`}
          htmlFor="pdf-input"
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            // Sans ce garde-fou, passer sur l'icône ou un <span> enfant fait
            // remonter un dragleave et éteint l'état visuel en plein survol.
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setDragOver(false);
          }}
        >
          <Icon name="doc" size={34} stroke="var(--gold)" width={1.4} />
          <span className="dropzone-title">Glissez un PDF ici</span>
          <span className="dropzone-alt">
            ou <b>parcourez vos fichiers</b>
          </span>
          <span className="dropzone-meta" id="pdf-input-hint">
            PDF texte ou scanné · 20 Mo max
          </span>
          {/* L'input vit DANS le label : c'est ce qui permet :focus-within de
              rendre le focus visible sur la zone, et Entrée/Espace d'ouvrir le
              sélecteur depuis « ou parcourez vos fichiers ». Ne jamais le
              ressortir du label. */}
          <input
            id="pdf-input"
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="file-input"
            aria-label="Glissez un PDF ici ou parcourez vos fichiers"
            aria-describedby="pdf-input-hint"
            onChange={handleInputChange}
          />
        </label>
      ) : (
        <div className="file-chip">
          <Icon name="doc" size={20} stroke="var(--gold-deep)" width={1.5} />
          <span className="file-chip-body">
            <span className="file-chip-name">{file.name}</span>
            <span className="file-chip-meta">
              {pageCount ? `${pageCount} pages · ` : ''}
              {formatSize(file.size)}
            </span>
          </span>
          {/* Déclencheur VISIBLE du sélecteur quand un fichier est déjà retenu :
              il porte l'input masqué, donc le focus clavier a toujours une
              cible visible et on peut changer de PDF sans le retirer d'abord. */}
          <label className="file-chip-change" htmlFor="pdf-input-change">
            Changer
            <input
              id="pdf-input-change"
              ref={inputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="file-input"
              aria-label="Changer de fichier PDF"
              onChange={handleInputChange}
            />
          </label>
          <button
            type="button"
            className="file-chip-remove"
            onClick={clearFile}
            aria-label="Retirer le fichier"
          >
            <Icon name="close" size={13} width={2} />
          </button>
        </div>
      )}

      {/* Région live montée en permanence (donc active avant l'arrivée du
          message) : confirme la sélection du fichier aux lecteurs d'écran.
          Périmètre : la CONFIRMATION DE SÉLECTION uniquement — les erreurs et
          la progression sont annoncées par leurs propres régions. */}
      <p className="sr-live" role="status">
        {file ? `Fichier retenu : ${file.name}, ${formatSize(file.size)}.` : ''}
      </p>

      {file && (
        <>
          <div className="field">
            <label className="field-label" htmlFor="quiz-title">
              Titre du quiz
            </label>
            <input
              id="quiz-title"
              type="text"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex. Procédure caisse"
            />
          </div>

          <div className="field">
            <div className="field-row">
              <span className="field-label" id="qcount-label">Nombre de questions</span>
              {/* Aucune région live ici : les flèches du radiogroup appellent
                  onChange à CHAQUE appui, une région polie empilerait autant
                  d'annonces (« ≈ 5 min », « ≈ 8 min »…) par-dessus l'annonce de
                  focus de chaque option. L'estimation est exposée par le
                  aria-describedby que RadioGroup pose sur l'option focalisable,
                  lue à l'entrée du focus dans le groupe. */}
              <span className="dropzone-meta" id="qcount-est">
                ≈ {estMinutes} min
              </span>
            </div>
            <RadioGroup
              className="segments"
              labelledBy="qcount-label"
              describedBy="qcount-est"
              options={QUESTION_OPTIONS}
              value={numQuestions}
              onChange={setNumQuestions}
              optionClassName={(opt, checked) => `segment ${checked ? 'is-active' : ''}`}
            />
          </div>

          <div className="field">
            <span className="field-label" id="level-label">Niveau</span>
            <RadioGroup
              className="choices"
              labelledBy="level-label"
              options={DIFFICULTY_OPTIONS}
              value={difficulty}
              onChange={setDifficulty}
              optionClassName={(opt, checked) => `choice ${checked ? 'is-active' : ''}`}
              renderOption={(opt) => (
                <>
                  <span className="choice-dot" />
                  <span className="choice-label">{opt.label}</span>
                  <span className="choice-desc">{opt.desc}</span>
                </>
              )}
            />
          </div>

          <div className="field">
            <span className="field-label" id="diffusion-label">Diffusion</span>
            <RadioGroup
              className="choices"
              labelledBy="diffusion-label"
              options={ATTEMPT_OPTIONS}
              value={singleAttempt}
              onChange={setSingleAttempt}
              optionClassName={(opt, checked) => `choice ${checked ? 'is-active' : ''}`}
              renderOption={(opt) => (
                <>
                  <span className="choice-dot" />
                  <span className="choice-label">{opt.label}</span>
                  <span className="choice-desc">{opt.desc}</span>
                </>
              )}
            />
            <RadioGroup
              className="segments segments--3"
              style={{ marginTop: 4 }}
              label="Durée de validité du lien"
              describedBy="expiry-help"
              options={EXPIRY_OPTIONS}
              value={expiresInHours}
              onChange={setExpiresInHours}
              optionClassName={(opt, checked) =>
                `segment segment--text ${checked ? 'is-active' : ''}`
              }
            />
            <span className="dropzone-meta" id="expiry-help">
              Passé ce délai le lien ne fonctionne plus. Vous pourrez aussi fermer le quiz à la
              main.
            </span>
          </div>
        </>
      )}

      {/* Conteneur monté en permanence : c'est lui qui porte role="alert",
          pas le message. Une alerte qui apparaît en même temps que son texte
          n'est pas annoncée de façon fiable ; ici la région préexiste et seul
          son contenu change — d'où `announcedError`, retardé d'un commit, qui
          garantit cette séquence même au remontage du formulaire. Le message
          n'est PAS focalisable : il est annoncé par la région et par elle
          seule, la reprise de focus vise le bouton d'envoi juste en dessous.
          Garder la forme ternaire : `{announcedError.texte && …}` avec une
          chaîne vide peut laisser un nœud texte vide et casser :empty.
          La `key` porte le numéro d'occurrence : à refus identique répété, elle
          change, React remplace le <p> au lieu de le laisser tel quel, et la
          région — elle, toujours montée — voit bien son contenu muter. Sans
          elle, le second refus identique n'est annoncé nulle part. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {announcedError.texte ? (
          <p className="error-msg" key={announcedError.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{announcedError.texte}</span>
          </p>
        ) : null}
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Bouton volontairement TOUJOURS actif : un bouton désactivé n'est pas
            atteignable au clavier, donc sa raison d'être indisponible n'est
            lisible nulle part. La contrainte est vérifiée au clic et rendue
            dans la région d'alerte ci-dessus. */}
        <button
          ref={submitRef}
          type="submit"
          className="btn btn--primary btn--block"
          aria-describedby="submit-hint"
        >
          Générer {numQuestions} questions
          <Icon name="arrowRight" size={18} width={1.8} />
        </button>
        <span className="btn-hint" id="submit-hint">
          Vous pourrez relire et corriger avant de partager.
        </span>
      </div>
    </form>
  );
}

export default UploadPDF;
