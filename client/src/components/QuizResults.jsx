import { useEffect, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { Link, useParams } from 'react-router-dom';
import Icon from './Icon';
import { MESSAGE_RESEAU } from '../api';
import { chargerResultats, chargerStats } from '../quiz-api';
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

// Couleurs jsPDF du bandeau et des indicateurs, converties une fois en RGB
// littéral : jsPDF ne lit pas les variables CSS. Mêmes tokens et mêmes
// triplets que le PDF individuel (Results.jsx, generatePDF) — --ink, --ok,
// --err, --gold-light — pour que les deux PDF de ce dépôt se ressemblent.
const RGB_INK = [31, 29, 36];
const RGB_GOLD_LIGHT = [241, 216, 154];
const RGB_OK = [46, 125, 91];
const RGB_ERR = [192, 69, 59];
const RGB_TEXT_2 = [79, 74, 65];
const RGB_TEXT_3 = [107, 100, 89];

// Seuil du point vert/rouge de la colonne Score : la MAJORITÉ des réponses
// correctes, la ligne de partage la plus simple à expliquer à un formateur.
// Purement décoratif — le score exact est toujours écrit en toutes lettres à
// côté (WCAG 1.4.1) — donc aucun autre seuil (le barème à 4 paliers de
// Results.jsx, pensé pour un mot comme « Très bon score ») n'a lieu d'être
// repris ici : il ne s'agit que de distinguer réussite et échec d'un coup d'œil
// dans une liste.
function reussite(r) {
  return r.total > 0 && r.score / r.total >= 0.5;
}

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

// Même transformation de titre en nom de fichier, partagée par le .csv et le
// PDF récapitulatif — auparavant écrite deux fois (ici et dans
// OfficineHistorique.jsx, chacune pour son propre export).
function nomFichier(prefixe, titre) {
  return `${prefixe}-${String(titre)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()}`;
}

// Question triée du plus raté au mieux réussi : le haut de la liste est
// l'ordre du jour de la prochaine séance. Partagée par l'écran (liste
// complète) et le PDF (les cinq premières) — un seul calcul, deux usages.
function questionsParEchec(stats) {
  return [...stats.questions].sort(
    (a, b) =>
      b.ratees / (b.reponses || 1) - a.ratees / (a.reponses || 1) || a.questionIndex - b.questionIndex
  );
}

function phraseQuestion(q) {
  // Le verbe s'accorde AUSSI, pas seulement le participe : « 1 sur 3 se sont
  // trompé » est fautif.
  const base =
    q.ratees === 0
      ? `Tout le monde a trouvé (${q.reponses} réponse${q.reponses > 1 ? 's' : ''}).`
      : q.ratees === 1
        ? `1 sur ${q.reponses} s’est trompé.`
        : `${q.ratees} sur ${q.reponses} se sont trompés.`;
  return q.sansReponse > 0 ? `${base} Dont ${q.sansReponse} sans réponse.` : base;
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
 * Mise en page à deux colonnes (mockup « Direction retenue », 04 · Résultats) :
 * la colonne principale garde le fil d'Ariane, le titre, le résumé chiffré,
 * les deux exports et le tableau des réponses ; la colonne latérale garde
 * « Ce qu'il faut reprendre » (déplacée telle quelle, aucune de ses règles n'a
 * bougé) puis un aperçu décoratif du PDF récapitulatif. Sous 720px les deux
 * colonnes s'empilent dans cet ordre (.results-layout, App.css) : la latérale
 * après la principale, jamais avant.
 *
 * Le tableau REMPLACE l'ancien regroupement par officine (groupesOfficine) :
 * le mockup demande une colonne Officine sur CHAQUE ligne plutôt qu'un
 * sous-titre par groupe — cela répond au même besoin (distinguer les
 * officines) sans dépendre du nombre d'officines distinctes.
 *
 * On dit « apprenant » et non « stagiaire » : la même officine forme des
 * stagiaires, des auxiliaires embauchés et parfois des pharmaciens.
 */
function QuizResults() {
  const { id } = useParams();
  const [stockage, setStockage] = useState(null);
  const [detail, setDetail] = useState(null);
  const [stats, setStats] = useState(null);
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
        // Les deux en parallèle : l'agrégat des questions ne doit pas retarder
        // l'affichage des scores, et son échec ne doit pas l'empêcher.
        const [data, sts] = await Promise.all([
          chargerResultats(id),
          chargerStats(id).catch(() => null),
        ]);
        if (annule) return;
        setStats(sts);
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

  const moyenne =
    detail && detail.results.length > 0
      ? Math.round(
          (detail.results.reduce((s, r) => s + r.score / r.total, 0) / detail.results.length) * 100
        )
      : null;

  // Nombre d'officines distinctes — sert au résumé chiffré ET au PDF. Une
  // réponse sans officine ne compte pas comme une officine « distincte » : ce
  // n'est l'absence d'aucune, pas une troisième officine appelée « ».
  const officinesDistinctes = detail
    ? new Set(detail.results.map((r) => r.pharmacyName).filter(Boolean)).size
    : 0;

  // Export tableur. Le point-virgule est le séparateur attendu par Excel en
  // configuration française ; le BOM lui fait lire l'UTF-8 sans quoi les accents
  // ressortent en mojibake.
  const exporter = () => {
    if (!detail || detail.results.length === 0) return;
    const echappe = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lignes = [
      ['Apprenant', 'Officine', 'Score', 'Sur', 'Pourcentage', 'Date'].map(echappe).join(';'),
      ...detail.results.map((r) =>
        [
          r.playerName,
          r.pharmacyName || '',
          r.score,
          r.total,
          `${Math.round((r.score / r.total) * 100)}%`,
          formatDate(r.submittedAt),
        ]
          .map(echappe)
          .join(';')
      ),
    ].join('\r\n');

    const nom = `${nomFichier('resultats', detail.title)}.csv`;
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

  // Récapitulatif PDF — entièrement côté client, comme le PDF individuel de
  // Results.jsx (même dépendance, même absence de route serveur dédiée). Pas
  // de jspdf-autotable (pas une dépendance du dépôt et on n'en ajoute pas) :
  // le tableau est dessiné ligne par ligne, comme le détail des réponses de
  // Results.jsx — même parti pris, suivi manuel de `y` et `addPage()` compris.
  const exporterPDF = () => {
    if (!detail || detail.results.length === 0) return;
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;
    const contentWidth = pageWidth - margin * 2;
    let y;

    // Bandeau d'en-tête — même recette que Results.jsx (fond --ink plein,
    // titre en --gold-light) : les deux PDF de ce dépôt doivent se reconnaître
    // du premier coup d'œil comme venant du même outil.
    doc.setFillColor(...RGB_INK);
    doc.rect(0, 0, pageWidth, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('KEMET QUIZ', pageWidth / 2, 17, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...RGB_GOLD_LIGHT);
    doc.text(doc.splitTextToSize(detail.title, contentWidth - 20), pageWidth / 2, 26, {
      align: 'center',
    });
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(
      `Récapitulatif généré le ${new Date().toLocaleDateString('fr-FR')}`,
      pageWidth / 2,
      35,
      { align: 'center' }
    );

    y = 54;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...RGB_INK);
    doc.text('Récapitulatif des participants', margin, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...RGB_TEXT_2);
    const resume = [
      `${detail.results.length} réponse${detail.results.length > 1 ? 's' : ''}`,
      moyenne !== null ? `moyenne ${moyenne} %` : null,
      officinesDistinctes > 0
        ? `${officinesDistinctes} officine${officinesDistinctes > 1 ? 's' : ''}`
        : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    doc.text(resume, margin, y);
    y += 12;

    // Colonnes en proportion de la largeur utile — pas de calcul de pixels,
    // seulement des fractions, comme le layout automatique de .quiz-table.
    const colonnes = [
      { label: 'Apprenant', x: margin, w: contentWidth * 0.32 },
      { label: 'Officine', x: margin + contentWidth * 0.32, w: contentWidth * 0.3 },
      { label: 'Score', x: margin + contentWidth * 0.62, w: contentWidth * 0.16 },
      { label: 'Envoyé le', x: margin + contentWidth * 0.78, w: contentWidth * 0.22 },
    ];

    // Tronque au pixel près plutôt que de laisser `text()` empiler les mots à
    // la ligne : une ligne de tableau qui grandit casserait l'alignement de
    // toutes les cellules qui la suivent sur la même rangée.
    const tronquer = (texte, largeur) => {
      let t = String(texte ?? '');
      if (doc.getTextWidth(t) <= largeur) return t;
      while (t.length > 1 && doc.getTextWidth(`${t}…`) > largeur) {
        t = t.slice(0, -1);
      }
      return `${t}…`;
    };

    const enteteTableau = () => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...RGB_TEXT_3);
      colonnes.forEach((c) => doc.text(c.label.toUpperCase(), c.x, y));
      y += 3;
      doc.setDrawColor(...RGB_TEXT_3);
      doc.setLineWidth(0.3);
      doc.line(margin, y, pageWidth - margin, y);
      y += 6.5;
    };

    enteteTableau();
    doc.setFontSize(9.5);
    detail.results.forEach((r) => {
      if (y > pageHeight - 24) {
        doc.addPage();
        y = 20;
        enteteTableau();
        doc.setFontSize(9.5);
      }
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...RGB_INK);
      doc.text(tronquer(r.playerName, colonnes[0].w - 4), colonnes[0].x, y);
      doc.setTextColor(...RGB_TEXT_2);
      doc.text(tronquer(r.pharmacyName || '—', colonnes[1].w - 4), colonnes[1].x, y);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...(reussite(r) ? RGB_OK : RGB_ERR));
      doc.text(`${r.score} / ${r.total}`, colonnes[2].x, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...RGB_TEXT_3);
      doc.text(formatDate(r.submittedAt), colonnes[3].x, y);
      y += 8;
    });

    // « Ce qu'il faut reprendre », plafonné aux cinq questions les plus
    // ratées : contrairement à l'écran, un PDF n'a pas de défilement — au-delà
    // de cinq, ce ne serait plus un récapitulatif mais une reprise du détail
    // complet, déjà disponible à l'écran.
    if (stats && stats.couvertes > 0) {
      y += 6;
      if (y > pageHeight - 40) {
        doc.addPage();
        y = 20;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(...RGB_INK);
      doc.text('Ce qu’il faut reprendre', margin, y);
      y += 8;

      questionsParEchec(stats)
        .slice(0, 5)
        .forEach((q) => {
          if (y > pageHeight - 26) {
            doc.addPage();
            y = 20;
          }
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9.5);
          doc.setTextColor(...RGB_INK);
          const ligneQ = doc.splitTextToSize(`Q${q.questionIndex + 1} · ${q.questionText}`, contentWidth);
          doc.text(ligneQ, margin, y);
          y += ligneQ.length * 4.6 + 2;
          doc.setFontSize(8.5);
          doc.setTextColor(...RGB_TEXT_3);
          doc.text(phraseQuestion(q), margin, y);
          y += 8;
        });
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Généré par Kemet Quiz — Kemet Services', pageWidth / 2, pageHeight - 10, {
      align: 'center',
    });

    const nom = `${nomFichier('recapitulatif', detail.title)}.pdf`;
    doc.save(nom);
    setAnnonce(`Fichier ${nom} téléchargé.`);
  };

  return (
    <div className="stack">
      {/* Fil d'Ariane : remplace l'ancien accès « Mes quiz » du bas d'écran ET
          l'ancien bouton « Partager ce quiz » — le second segment mène à la
          MÊME adresse (chemins.partage(id)) que ce bouton visait. Affiché dès
          le premier rendu ; le segment du milieu n'apparaît qu'une fois le
          titre du quiz connu, pour ne jamais montrer un intitulé vide. */}
      <nav className="breadcrumb" aria-label="Fil d’Ariane">
        <Link to={chemins.mesQuiz}>Mes quiz</Link>
        {detail && (
          <>
            <Icon name="chevronRight" size={13} width={1.8} />
            <Link to={chemins.partage(id)}>{detail.title}</Link>
          </>
        )}
        <Icon name="chevronRight" size={13} width={1.8} />
        <span className="breadcrumb-current" aria-current="page">
          Résultats
        </span>
      </nav>

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

      {!chargement && detail && detail.results.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="info" size={22} width={1.6} />
          </span>
          <h2>Personne n’a encore répondu</h2>
          <p>Partagez le lien ou faites scanner le QR code, puis revenez sur cet écran.</p>
        </div>
      )}

      {!chargement && detail && detail.results.length > 0 && (
        <div className="results-layout">
          {/* Colonne principale : résumé chiffré, exports, tableau. */}
          <div className="stack">
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
              {officinesDistinctes > 0 && (
                <>
                  <span className="meta-row-sep" />
                  <span>
                    {officinesDistinctes} officine{officinesDistinctes > 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--ghost" onClick={exporterPDF}>
                <Icon name="download" size={16} width={1.7} />
                Récapitulatif PDF
              </button>
              <button type="button" className="btn btn--ghost" onClick={exporter}>
                <Icon name="download" size={16} width={1.7} />
                Exporter (.csv)
              </button>
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="quiz-table-scroll">
                <table className="quiz-table">
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="eyebrow">Apprenant</span>
                      </th>
                      <th scope="col">
                        <span className="eyebrow">Officine</span>
                      </th>
                      <th scope="col">
                        <span className="eyebrow">Score</span>
                      </th>
                      <th scope="col">
                        <span className="eyebrow">Envoyé le</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.results.map((r, i) => (
                      <tr key={r.resultId ?? i}>
                        <td className="recent-row-title">{r.playerName}</td>
                        <td>{r.pharmacyName || <span className="subtle">—</span>}</td>
                        <td>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                            <span
                              className={`score-dot ${reussite(r) ? 'score-dot--ok' : 'score-dot--low'}`}
                              aria-hidden="true"
                            />
                            <span className="apprenant-note">
                              {r.score} / {r.total}
                            </span>
                          </span>
                        </td>
                        <td className="subtle">{formatDate(r.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Colonne latérale : « Ce qu'il faut reprendre » (déplacée telle
              quelle depuis l'ancien emplacement, aucune règle n'a changé) puis
              un aperçu décoratif du PDF ci-dessus. */}
          <div className="stack">
            {stats && stats.couvertes > 0 && (
              <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
                <h2 className="eyebrow">Ce qu’il faut reprendre</h2>

                {/* Les participations d'avant n'ont pas de détail et n'en auront
                    jamais. Le dire, plutôt que d'afficher un compte qu'on
                    croirait faux. */}
                {stats.sansDetail > 0 && (
                  <p className="notice">
                    <Icon name="info" size={15} width={1.8} />
                    <span>
                      Ces chiffres portent sur {stats.couvertes} participation
                      {stats.couvertes > 1 ? 's' : ''} sur {stats.participations}. Le détail
                      n’était pas conservé avant aujourd’hui : les {stats.sansDetail} plus
                      anciennes ne comptent que leur score.
                    </span>
                  </p>
                )}

                {questionsParEchec(stats).map((q) => {
                  const tauxReussite = Math.round(
                    ((q.reponses - q.ratees) / (q.reponses || 1)) * 100
                  );
                  return (
                    <div key={q.questionIndex} className="question-stat">
                      <span className="question-stat-titre">
                        <span className="tag">Q{q.questionIndex + 1}</span>
                        {q.questionText}
                      </span>
                      {/* La barre montre la proportion qui a TROUVÉ : une barre
                          courte saute aux yeux. Décorative — la phrase juste
                          en dessous porte la même information en toutes
                          lettres, et l'information ne passe donc jamais par la
                          seule couleur. */}
                      <span className="bar" aria-hidden="true">
                        <span className="bar-fill" style={{ width: `${tauxReussite}%` }} />
                      </span>
                      <span className="question-stat-meta">
                        {phraseQuestion(q)}
                        {q.enonceModifie && ' L’énoncé a été modifié depuis certaines réponses.'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Aperçu purement DÉCORATIF (aria-hidden) : le contenu réel n'est
                composé qu'au clic sur « Récapitulatif PDF », comme .doc-preview
                dans UploadPDF.jsx ne montre jamais le vrai texte du PDF source. */}
            <div className="card doc-preview">
              <div className="doc-preview-head">
                <span className="eyebrow">Aperçu du PDF</span>
              </div>
              <div className="doc-preview-body" aria-hidden="true">
                <span className="doc-preview-line doc-preview-line--head" style={{ width: '68%' }} />
                <span className="doc-preview-line" style={{ width: '100%' }} />
                <span className="doc-preview-line" style={{ width: '96%' }} />
                <span className="doc-preview-line" style={{ width: '92%' }} />
                <span className="doc-preview-line" style={{ width: '98%' }} />
                <span className="doc-preview-line" style={{ width: '60%' }} />
              </div>
            </div>
            <p className="subtle">
              Un tableau, une page : apprenant, officine, score, date. Prêt à imprimer et à
              classer.
            </p>
          </div>
        </div>
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
