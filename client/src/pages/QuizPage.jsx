import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Welcome from '../components/Welcome';
import Quiz from '../components/Quiz';
import Results from '../components/Results';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';
import { fetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';

const storageKey = (id) => `kemet-quiz-progress-${id}`;

/* Statuts qui disent « le serveur n'a pas fait son travail », par opposition à
   « ce lien ne mène nulle part ». Le 500 à corps vide en fait partie : c'est
   celui que renvoie le proxy de développement quand l'API n'est pas démarrée,
   et il était jusqu'ici présenté au participant comme un quiz introuvable.
   Ce sont aussi les seuls statuts pour lesquels un nouvel essai a un sens. */
const STATUTS_SERVEUR = [500, 502, 503, 504];

/* Consignes qui terminent un message d'échec d'envoi. « Réessayez » n'est
   proposé QUE là où un nouvel essai peut aboutir — panne passagère du serveur,
   requête qui n'aboutit pas. Un quiz fermé, un lien mort ou un envoi refusé ne
   s'arrangeront pas d'eux-mêmes : réessayer n'y ferait que répéter l'échec, la
   consigne devient donc « prévenez votre formateur ». Dans les deux cas la
   première chose que le participant doit lire est que ses réponses sont
   toujours là : il vient d'en saisir jusqu'à trente. */
const CONSIGNE_REESSAI =
  'Vos réponses restent enregistrées sur cet appareil : patientez un instant, puis réessayez.';
const CONSIGNE_FORMATEUR =
  'Vos réponses restent enregistrées sur cet appareil : signalez-le à votre formateur.';

/**
 * Assemble une cause et une consigne en DEUX phrases.
 * La cause vient du serveur : rien ne dit comment elle se termine, et la
 * concaténation brute d'origine donnait « Ce quiz a été fermé par le formateur
 * Vos réponses restent enregistrées sur cet appareil : réessayez. » On retire
 * la ponctuation finale avant d'en remettre une seule. Même classe de
 * caractères que `avecCode` dans api.js, pour que les deux normalisations de
 * l'application restent cohérentes ; « ? » en est volontairement exclu, le
 * supprimer changerait le sens de la phrase.
 */
function avecConsigne(cause, consigne) {
  const debut = String(cause || '')
    .trim()
    .replace(/\s*[.!…]+$/, '');
  return debut ? `${debut}. ${consigne}` : consigne;
}

/* Écran d'erreur de chargement : un titre et un texte par cause.
   RÈGLE DE RÉDACTION — le participant n'exploite pas le serveur. On ne lui
   demande jamais de le démarrer (c'est ce que dit MESSAGE_RESEAU, écrit pour le
   formateur) : on lui dit d'attendre, de recharger, et de prévenir. */
const ECRANS_ERREUR = {
  notfound: {
    icone: 'search',
    trait: 1.7,
    titre: 'Quiz introuvable',
    texte: () =>
      'Ce lien est peut-être expiré ou incorrect. Contactez la personne qui vous l’a envoyé.',
  },
  closed: {
    icone: 'close',
    trait: 2,
    titre: 'Quiz clôturé',
    // Seul écran qui affiche le message du serveur (« Ce quiz a été fermé par
    // le formateur », « Ce quiz a expiré ») : sa ponctuation est normalisée
    // avant la consigne, sinon les deux phrases se collent.
    texte: (msg) =>
      avecConsigne(msg, 'Contactez votre formateur si vous devez encore y répondre.'),
  },
  reseau: {
    icone: 'info',
    trait: 1.7,
    titre: 'Le serveur ne répond pas',
    texte: () =>
      'Le serveur qui héberge ce quiz ne répond pas pour le moment. Votre lien n’est pas en cause : patientez quelques minutes, puis rechargez la page. Si le quiz reste inaccessible, prévenez votre formateur.',
  },
};

function loadProgress(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function saveProgress(id, data) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify(data));
  } catch {}
}

function clearProgress(id) {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {}
}

function QuizPage() {
  const { id } = useParams();
  const [step, setStep] = useState('welcome');
  const [playerName, setPlayerName] = useState('');
  const [quizData, setQuizData] = useState(null);
  const [userAnswers, setUserAnswers] = useState({});
  const [resultData, setResultData] = useState(null);
  const [error, setError] = useState('');
  // notfound | closed | reseau — voir ECRANS_ERREUR. 'reseau' distingue le
  // serveur muet du lien mort : sans lui, une API arrêtée accusait le lien.
  const [errorKind, setErrorKind] = useState('notfound');
  const [already, setAlready] = useState(null);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    // fetchOuReseau : une requête qui n'aboutit pas du tout (API arrêtée,
    // réseau coupé) rejette avec MESSAGE_RESEAU au lieu du « Failed to fetch »
    // du navigateur, ce qui permet de la reconnaître dans le .catch.
    fetchOuReseau(`/api/quiz/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          setErrorKind(
            res.status === 410
              ? 'closed'
              : STATUTS_SERVEUR.includes(res.status)
              ? 'reseau'
              : 'notfound'
          );
          // messageErreur lit une COPIE de la réponse et ne jette jamais : elle
          // est appelée avant toute lecture du corps, et le corps reste
          // disponible ensuite si besoin.
          throw new Error(
            await messageErreur(res, res.status === 410 ? 'Ce quiz est fermé' : 'Quiz introuvable')
          );
        }
        // Un 200 dont le corps n'est pas exploitable ne doit pas non plus être
        // mis sur le dos du lien : c'est bien le serveur qui a mal répondu. Le
        // contrôle protège aussi les écrans suivants, qui lisent
        // quizData.questions sans filet.
        let data = null;
        try {
          data = await res.json();
        } catch {
          // Corps absent ou illisible : `data` reste nul, le contrôle qui suit
          // s'en charge. L'exception du parseur, elle, est en anglais.
        }
        if (!data || !Array.isArray(data.questions)) {
          setErrorKind('reseau');
          throw new Error('Réponse du serveur inexploitable.');
        }
        return data;
      })
      .then((data) => {
        setQuizData(data);
        const saved = loadProgress(id);
        if (saved && saved.playerName) {
          setPlayerName(saved.playerName);
          setUserAnswers(saved.answers || {});
          setStep('quiz');
          setResumed(true);
        }
        setLoading(false);
      })
      .catch((err) => {
        // Requête qui n'a pas abouti : c'est le cas que l'écran accusait
        // jusqu'ici d'être un lien introuvable. Le message lui-même n'est pas
        // affiché — l'écran « reseau » a son propre texte, MESSAGE_RESEAU
        // s'adressant à qui peut démarrer le serveur.
        if (err && err.message === MESSAGE_RESEAU) setErrorKind('reseau');
        // `error` sert d'abord de drapeau : seul l'écran « closed » en rend le
        // contenu, les deux autres ont un texte fixe.
        setError(err.message);
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    if (step === 'quiz' && playerName) {
      saveProgress(id, { playerName, answers: userAnswers, startedAt: Date.now() });
    }
  }, [id, step, playerName, userAnswers]);

  const handleRestart = () => {
    clearProgress(id);
    setUserAnswers({});
    setPlayerName('');
    setResumed(false);
    setStep('welcome');
  };

  const handleQuizSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetchOuReseau(`/api/quiz/${id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, answers: userAnswers }),
      });

      if (!res.ok) {
        // messageErreur rend le message du serveur quand il en donne un ; sur
        // un serveur muet (502/503/504, 500 sans corps) elle rend en revanche
        // une phrase écrite pour l'EXPLOITANT — « Vérifiez qu'il est bien
        // démarré ». Le participant ne peut rien démarrer : ces statuts ont ici
        // leur propre formulation, le code restant en fin de phrase pour le
        // formateur à qui il le signalera.
        const cause = STATUTS_SERVEUR.includes(res.status)
          ? `Le serveur du quiz n’a pas répondu correctement (code ${res.status})`
          : await messageErreur(res, 'Envoi impossible');

        // messageErreur a lu une copie : le corps est encore là.
        let payload = {};
        try {
          payload = await res.json();
        } catch {
          // Pas de corps JSON : `payload` reste vide, le test qui suit échoue
          // proprement. Le message d'erreur, lui, est déjà construit.
        }

        // Tentative déjà enregistrée : ce n'est pas un échec à réessayer mais
        // un écran à part entière, et la sauvegarde locale n'a plus d'objet.
        if (res.status === 409 && payload.alreadyAnswered) {
          clearProgress(id);
          setAlready(payload);
          return;
        }

        setSubmitError(
          avecConsigne(
            cause,
            STATUTS_SERVEUR.includes(res.status) ? CONSIGNE_REESSAI : CONSIGNE_FORMATEUR
          )
        );
        return;
      }

      // ORDRE IMPÉRATIF : on parse AVANT d'effacer quoi que ce soit. La
      // sauvegarde locale était effacée dès le 200 reçu ; un corps illisible
      // faisait alors échouer l'affichage APRÈS la disparition des réponses,
      // sans aucun moyen de les renvoyer.
      let data = null;
      try {
        data = await res.json();
      } catch {
        // Un 200 illisible ne doit surtout pas remonter au .catch général :
        // l'exception y serait traitée comme une panne réseau, et son message
        // est de toute façon en anglais. `data` reste nul, le contrôle suit.
      }
      if (
        !data ||
        !Array.isArray(data.correction) ||
        typeof data.score !== 'number' ||
        typeof data.total !== 'number'
      ) {
        setSubmitError(
          avecConsigne('Le serveur a répondu, mais sa réponse est inexploitable', CONSIGNE_REESSAI)
        );
        return;
      }

      setResultData(data);
      // Seulement ici : les données sont valides et l'écran de résultats va
      // les afficher.
      clearProgress(id);
      setStep('results');
    } catch (err) {
      // Seule cause attendue : la requête n'a pas abouti (fetchOuReseau). Le
      // message d'une exception n'est JAMAIS affiché tel quel — ni le « Failed
      // to fetch » du navigateur, que l'ancien repli laissait passer parce
      // qu'il ne se déclenchait que sur un message VIDE, ni MESSAGE_RESEAU,
      // écrit pour l'exploitant du serveur.
      const injoignable = err && err.message === MESSAGE_RESEAU;
      setSubmitError(
        avecConsigne(
          injoignable ? 'Impossible de joindre le serveur du quiz' : 'L’envoi n’a pas abouti',
          CONSIGNE_REESSAI
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetake = () => {
    clearProgress(id);
    setUserAnswers({});
    setResultData(null);
    setSubmitError('');
    setResumed(false);
    setStep('quiz');
  };

  if (loading) {
    return (
      <div className="app">
        <AppBar />
        <div className="loading-screen">
          {/* Titre masqué : cet écran est transitoire et volontairement nu (un
              disque qui tourne, une ligne grise centrée). Un h1 visible y
              retomberait sur le style navigateur — 2em gras sans-serif — faute
              de règle ciblant un titre dans .loading-screen, et le rendu doit
              rester inchangé. Le texte reprend mot pour mot le paragraphe
              visible : c'est le même message, pas une seconde information. */}
          <h1 className="sr-only">Chargement du quiz</h1>
          <div className="spinner" />
          <p>Chargement du quiz…</p>
        </div>
      </div>
    );
  }

  if (error) {
    const ecran = ECRANS_ERREUR[errorKind] || ECRANS_ERREUR.notfound;
    return (
      <div className="app">
        <AppBar />
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name={ecran.icone} size={22} width={ecran.trait} />
          </span>
          {/* h1 et non h2 : cet écran remplace toute la page, il n'a aucun titre
              au-dessus de lui (la barre d'application n'en porte pas). Un seul
              titre par écran, quelle que soit la cause. */}
          <h1>{ecran.titre}</h1>
          <p>{ecran.texte(error)}</p>
        </div>
      </div>
    );
  }

  if (already) {
    return (
      <div className="app">
        <AppBar />
        <div className="empty-state">
          <span className="empty-state-icon">
            <Icon name="check" size={22} width={2} />
          </span>
          {/* Même règle que l'écran d'erreur : titre de niveau 1. */}
          <h1>Déjà répondu</h1>
          <p>{already.error}</p>
          {already.score != null && (
            <span className="tag" style={{ marginTop: 4 }}>
              Score enregistré : {already.score}/{already.total}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (step === 'quiz') {
    return (
      <Quiz
        quizTitle={quizData.title}
        questions={quizData.questions}
        userAnswers={userAnswers}
        onAnswer={(idx, answer) => setUserAnswers((prev) => ({ ...prev, [idx]: answer }))}
        onSubmit={handleQuizSubmit}
        submitting={submitting}
        submitError={submitError}
        onClearSubmitError={() => setSubmitError('')}
        resumed={resumed}
        onRestart={handleRestart}
      />
    );
  }

  if (step === 'results' && resultData) {
    return (
      <div className="app">
        <AppBar />
        <Results
          playerName={resultData.playerName}
          title={resultData.title}
          score={resultData.score}
          total={resultData.total}
          correction={resultData.correction}
          onRetake={quizData.singleAttempt === false ? handleRetake : null}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <AppBar />
      <main className="app-main">
        <Welcome
          quizTitle={quizData.title}
          questionCount={quizData.questions.length}
          singleAttempt={quizData.singleAttempt !== false}
          onSubmit={(name) => {
            setPlayerName(name);
            setStep('quiz');
          }}
        />
      </main>
    </div>
  );
}

export default QuizPage;
