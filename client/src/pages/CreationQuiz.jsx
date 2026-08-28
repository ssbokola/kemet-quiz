import { useNavigate } from 'react-router-dom';
import UploadPDF from '../components/UploadPDF';
import { chemins } from '../chemins';

/**
 * L'écran de création, branché sur les adresses.
 *
 * Le quiz est DÉJÀ écrit en base quand la génération se termine
 * (server/src/index.js, fin de /api/upload-pdf) : `data.quizId` désigne donc un
 * quiz existant et déjà servi. On peut naviguer vers son adresse de relecture
 * sans rien porter d'autre que le nombre de questions écartées, que
 * RelectureQuiz relira dans location.state — le quiz lui-même, il le recharge.
 */
function CreationQuiz() {
  const navigate = useNavigate();

  return (
    <UploadPDF
      lienMesQuiz={chemins.mesQuiz}
      lienApprenants={chemins.apprenants}
      onQuizGenerated={(data) =>
        navigate(chemins.relecture(data.quizId), { state: { dropped: data.dropped || 0 } })
      }
    />
  );
}

export default CreationQuiz;
