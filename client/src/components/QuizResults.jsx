import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from './Icon';
import { MESSAGE_RESEAU } from '../api';
import { chargerResultats } from '../quiz-api';
import { chemins } from '../chemins';
import { useFocusAuMontage, useTitreDocument } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme dans UploadPDF : la recopie du montage ne change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Excel en configuration française lit un .csv en ANSI par défaut : sans cette
// marque d'ordre des octets, « août » ressortirait en « aoÃ»t ». Écrite en
// séquence échappée et non en caractère littéral, qui serait invisible dans la
// source et se perdrait à la première normalisation de fichier.
const BOM_UTF8 = '\u{FEFF}';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Écran « Résultats » d'UN quiz — espace formateur uniquement.
 *
 * Les scores étaient enregistrés depuis toujours, mais aucun écran ne les
 * affichait : la route /api/quiz/:id/results existait sans appelant. Cet écran
 * la branche enfin.
 *
 * Il ne liste plus les quiz : cette moitié-là est partie dans MesQuiz, à sa
 * propre adresse. C'est aussi ce que réclamait le commentaire d'en-tête
 * d'Apprenants.jsx, qui désigne nommément l'ancien QuizResults comme le défaut
 * à ne pas reproduire — liste et détail dans un même composant, donc un clic
 * qui démonte le bouton focalisé sans rien remonter, et le focus sur <body>.
 *
 * On dit « apprenant » et non « stagiaire » : la même officine forme des
 * stagiaires, des auxiliaires embauchés et parfois des pharmaciens.
 */
function QuizResults() {
  const { id } = useParams();
  const [stockage, setStockage] = useState(null);
  const [detail, setDetail] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const titreRef = useRef(null);

  // Le numéro d'occurrence s'incrémente à CHAQUE écriture, effacement compris :
  // deux échecs identiques d'affilée doivent être annoncés deux fois.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre au montage — SAUF au chargement du document. Depuis que cet écran a
  // une adresse, il peut être le tout premier monté (F5, favori, lien collé) :
  // prendre le focus alors serait le voler.
  useFocusAuMontage(titreRef);
  // Deux onglets ouverts sur les résultats de deux quiz différents seraient
  // sinon indiscernables dans la barre d'onglets.
  useTitreDocument(detail?.title);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    (async () => {
      try {
        const data = await chargerResultats(id);
        if (annule) return;
        if (!Array.isArray(data.results)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        setDetail(data);
        if (data.stockage) setStockage(data.stockage);
        const n = data.results.length;
        setAnnonce(
          n === 0
            ? 'Aucune réponse pour ce quiz.'
            : `${n} réponse${n > 1 ? 's' : ''} affichée${n > 1 ? 's' : ''}.`
        );
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

  // Export tableur. Le point-virgule est le séparateur attendu par Excel en
  // configuration française ; le BOM lui fait lire l'UTF-8 sans quoi les accents
  // ressortent en mojibake.
  const exporter = () => {
    if (!detail || detail.results.length === 0) return;
    const echappe = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lignes = [
      ['Apprenant', 'Score', 'Sur', 'Pourcentage', 'Date'].map(echappe).join(';'),
      ...detail.results.map((r) =>
        [
          r.playerName,
          r.score,
          r.total,
          `${Math.round((r.score / r.total) * 100)}%`,
          formatDate(r.submittedAt),
        ]
          .map(echappe)
          .join(';')
      ),
    ].join('\r\n');

    const nom = `resultats-${String(detail.title)
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase()}.csv`;
    const url = URL.createObjectURL(
      new Blob([BOM_UTF8 + lignes], { type: 'text/csv;charset=utf-8' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
    setAnnonce(`Fichier ${nom} téléchargé.`);
  };

  const moyenne =
    detail && detail.results.length > 0
      ? Math.round(
          (detail.results.reduce((s, r) => s + r.score / r.total, 0) / detail.results.length) * 100
        )
      : null;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          {detail ? detail.title : 'Résultats'}
        </h1>
        <p>Les scores de vos apprenants pour ce quiz.</p>
      </div>

      {/* Une région d'alerte, montée en permanence, remplie au commit suivant. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      {/* Une seule région polie sur l'écran, comme partout ailleurs. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {/* L'avertissement va là où il compte : devant les données concernées,
          et non dans les journaux de démarrage que personne ne lit. */}
      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces résultats ne sont pas conservés.</b> Ils disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
            Exportez ce qui compte avant d’en dépendre.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && detail && (
        <>
          <div className="meta-row">
            <span>
              {detail.results.length} réponse{detail.results.length > 1 ? 's' : ''}
            </span>
            {moyenne !== null && (
              <>
                <span className="meta-row-sep" />
                <span>Moyenne {moyenne} %</span>
              </>
            )}
          </div>

          {detail.results.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">
                <Icon name="info" size={22} width={1.6} />
              </span>
              <h2>Personne n’a encore répondu</h2>
              <p>Partagez le lien ou faites scanner le QR code, puis revenez sur cet écran.</p>
            </div>
          ) : (
            <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
              {detail.results.map((r, i) => (
                <div key={i} className="recent-row recent-row--static">
                  <span className="recent-row-body">
                    <span className="recent-row-title">{r.playerName}</span>
                    <span className="recent-row-meta">{formatDate(r.submittedAt)}</span>
                  </span>
                  <span className="tag">
                    {r.score} / {r.total}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="split-actions">
            <Link className="btn btn--ghost" to={chemins.mesQuiz}>
              <Icon name="arrowLeft" size={16} width={1.7} />
              Mes quiz
            </Link>
            {/* Referme la boucle : depuis les scores, on repart diffuser. La
                flèche circulaire (`refresh`) est réservée à « régénérer /
                refaire » — le partage utilise `send`. */}
            <Link className="btn btn--ghost" to={chemins.partage(id)}>
              <Icon name="send" size={16} width={1.7} />
              Partager ce quiz
            </Link>
            {detail.results.length > 0 && (
              <button type="button" className="btn btn--ghost" onClick={exporter}>
                <Icon name="download" size={16} width={1.7} />
                Exporter (.csv)
              </button>
            )}
          </div>
        </>
      )}

      {/* Le quiz existe mais n'a pas pu être chargé : on garde une sortie. */}
      {!chargement && !detail && (
        <div className="split-actions">
          <Link className="btn btn--ghost" to={chemins.mesQuiz}>
            <Icon name="arrowLeft" size={16} width={1.7} />
            Mes quiz
          </Link>
        </div>
      )}
    </div>
  );
}

export default QuizResults;
