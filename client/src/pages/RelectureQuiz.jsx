import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import ReviewQuestions from '../components/ReviewQuestions';
import { MESSAGE_RESEAU } from '../api';
import { chargerQuizComplet, modifierQuiz } from '../quiz-api';
import { chemins } from '../chemins';
import { useFocusAuMontage, useTitreDocument } from '../ecran';

const AUCUNE_ERREUR = { texte: '', n: 0 };

// Même famille de clé que le brouillon de l'apprenant (`kemet-quiz-progress-`),
// pour qu'un coup d'œil au stockage de session dise à qui appartient quoi.
const cleBrouillon = (id) => `kemet-quiz-brouillon-${id}`;

function lireBrouillon(id) {
  try {
    const brut = localStorage.getItem(cleBrouillon(id));
    if (!brut) return null;
    const items = JSON.parse(brut);
    return Array.isArray(items) && items.length > 0 ? items : null;
  } catch {
    // Stockage refusé (navigation privée), JSON corrompu : on repart du
    // serveur, sans un mot. Un brouillon illisible n'est pas une panne.
    return null;
  }
}

/**
 * Relecture des questions avant partage, à son adresse propre.
 *
 * ⚠️ LE QUIZ EST DÉJÀ EN LIGNE quand cet écran s'affiche : /api/upload-pdf
 * l'écrit en base avant d'émettre `done`, et /api/quiz/:id ne teste aucun
 * drapeau « publié ». Cet écran ne retient donc pas un quiz non publié — il
 * retient les CORRECTIONS MANUELLES du formateur, qui ne partent qu'au clic
 * sur « Publier ». (La régénération d'une question, elle, écrit immédiatement.)
 *
 * D'où le brouillon local. Sans lui, l'adresse créerait une régression que
 * l'ancienne machine à états n'avait pas : autrefois un F5 renvoyait à l'écran
 * de création — le formateur voyait qu'il repartait de zéro. Ici il retomberait
 * sur le MÊME écran, visuellement identique, avec vingt corrections en moins et
 * aucun moyen de le savoir. On troquerait une perte visible contre une perte
 * invisible.
 */
function RelectureQuiz() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [quiz, setQuiz] = useState(null);
  const [questionsInitiales, setQuestionsInitiales] = useState(null);
  const [brouillonRepris, setBrouillonRepris] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [nonEnregistre, setNonEnregistre] = useState(false);

  const titreRef = useRef(null);
  // Les questions telles que le SERVEUR les a rendues. C'est contre elles qu'on
  // mesure « non enregistré », et non contre le brouillon repris — sinon un
  // brouillon restauré paraîtrait à jour alors qu'il ne l'est pas.
  const serveurRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);
  useTitreDocument(quiz?.title);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await chargerQuizComplet(id);
        if (annule) return;
        setQuiz(data);
        serveurRef.current = JSON.stringify(data.questions);
        const brouillon = lireBrouillon(id);
        // Un brouillon ne se reprend que s'il diffère vraiment du serveur :
        // sinon on annoncerait une reprise qui n'apporte rien.
        if (brouillon && JSON.stringify(brouillon) !== serveurRef.current) {
          setQuestionsInitiales(brouillon);
          setBrouillonRepris(true);
          setNonEnregistre(true);
        } else {
          setQuestionsInitiales(data.questions);
        }
      } catch (err) {
        if (!annule) signaler(err?.message || MESSAGE_RESEAU);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, [id]);

  // ReviewQuestions garde `items` chez lui ; il nous les remonte à chaque
  // changement, uniquement pour les mettre de côté.
  const surBrouillon = useCallback(
    (items) => {
      const serialise = JSON.stringify(items);
      const different = serialise !== serveurRef.current;
      setNonEnregistre(different);
      try {
        if (different) localStorage.setItem(cleBrouillon(id), serialise);
        else localStorage.removeItem(cleBrouillon(id));
      } catch {
        // Stockage refusé : le brouillon ne survivra pas au rafraîchissement,
        // mais l'écran continue de fonctionner. Rien à dire au formateur.
      }
    },
    [id]
  );

  const publier = async (questions) => {
    if (publishing) return;
    setPublishing(true);
    setPublishError('');
    try {
      await modifierQuiz(
        id,
        { questions },
        'Les questions n’ont pas pu être enregistrées.'
      );
      try {
        localStorage.removeItem(cleBrouillon(id));
      } catch {}
      // Sans `replace` : revenir sur la relecture par le bouton Précédent est
      // un geste légitime.
      navigate(chemins.partage(id));
    } catch (err) {
      setPublishError(err?.message || 'Les questions n’ont pas pu être enregistrées.');
    } finally {
      setPublishing(false);
    }
  };

  // Pendant le chargement, un <h1> AU MÊME LIBELLÉ que celui de
  // ReviewQuestions. Le focus se déplace donc d'un titre vers un titre
  // identique : un lecteur d'écran répète la même phrase, ce qui se lit « on
  // est toujours là ». Jamais de focus retombé sur <body>.
  if (chargement || !questionsInitiales) {
    return (
      <div className="stack">
        <div className="review-head">
          <h1 ref={titreRef} tabIndex={-1}>
            Relire avant de partager
          </h1>
        </div>
        <div className="error-slot" role="alert" aria-atomic="true">
          {annoncee.texte ? (
            <p className="error-msg" key={annoncee.n}>
              <Icon name="info" size={16} width={1.8} />
              <span>{annoncee.texte}</span>
            </p>
          ) : null}
        </div>
        {chargement && (
          <div className="loading-screen">
            <span className="spinner" aria-hidden="true" />
            <span>Chargement…</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <ReviewQuestions
      quizId={id}
      title={quiz.title}
      questions={questionsInitiales}
      dropped={location.state?.dropped || 0}
      brouillonRepris={brouillonRepris}
      nonEnregistre={nonEnregistre}
      onBrouillon={surBrouillon}
      onPublish={publier}
      publishing={publishing}
      publishError={publishError}
    />
  );
}

export default RelectureQuiz;
