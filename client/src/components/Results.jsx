import { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import Icon from './Icon';

const CONFETTI_COLORS = ['#c8a45a', '#f1d89a', '#1f1d24', '#2e7d5b', '#f6eedc'];

function getOptionText(options, letter) {
  const idx = String(letter || '').charCodeAt(0) - 65;
  if (idx >= 0 && idx < options.length) return options[idx].replace(/^[A-F]\)\s*/, '');
  return letter || '—';
}

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function Results({ playerName, title, score, total, correction, onRetake }) {
  const percentage = Math.round((score / total) * 100);
  const [displayScore, setDisplayScore] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [detailOuvert, setDetailOuvert] = useState(false);
  const headingRef = useRef(null);

  // Les erreurs d'abord : on sépare une bonne fois les deux groupes (en
  // gardant l'index d'origine pour le numéro « QUESTION n ») plutôt que de
  // les retrouver à chaque rendu. Les ratées restent toujours visibles ; les
  // bonnes réponses se replient derrière .r-toggle, ce qui évite de noyer les
  // 1 à 3 erreurs typiques au milieu de 10 à 30 cartes vertes identiques.
  const wrongItems = [];
  const goodItems = [];
  correction.forEach((item, idx) => (item.isCorrect ? goodItems : wrongItems).push({ item, idx }));
  const wrongCount = wrongItems.length;
  const goodCount = goodItems.length;

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre principal à son montage. Le passage passation → résultats est un
  // changement d'écran sans navigation : Quiz est démonté avec l'élément qui
  // portait le focus, et son piège à focus refuse volontairement de le rendre à
  // un déclencheur disparu. Sans cette reprise, le focus retombe sur <body> et
  // la tabulation repart du haut du document — au moment précis où le
  // participant veut connaître son score.
  // Aucun risque de vol de focus au premier rendu de l'application : QuizPage
  // démarre à l'étape « welcome » et ne rend Results qu'une fois les réponses
  // envoyées, cet écran n'est donc jamais le tout premier monté.
  useEffect(() => {
    document.body.classList.remove('theme-ink');
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let raf;
    const duration = 900;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplayScore(Math.round(score * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  useEffect(() => {
    if (percentage >= 80) {
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [percentage]);

  const grade =
    percentage >= 80
      ? { label: 'Très bon score', color: '#2e7d5b' }
      : percentage >= 60
      ? { label: 'Bien', color: '#c8a45a' }
      : percentage >= 40
      ? { label: 'Passable', color: '#b77a22' }
      : { label: 'À revoir', color: '#c0453b' };

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    doc.setFillColor(31, 29, 36);
    doc.rect(0, 0, pageWidth, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('KEMET QUIZ', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(241, 216, 154);
    doc.text(doc.splitTextToSize(title, pageWidth - 40), pageWidth / 2, 30, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(new Date().toLocaleDateString('fr-FR'), pageWidth / 2, 40, { align: 'center' });

    y = 60;
    doc.setTextColor(31, 29, 36);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text(`Candidat : ${playerName}`, margin, y);
    y += 12;

    doc.setFillColor(246, 238, 220);
    doc.roundedRect(margin, y, contentWidth, 32, 3, 3, 'F');
    const [r, g, b] = hexToRgb(grade.color);
    doc.setTextColor(r, g, b);
    doc.setFontSize(26);
    doc.text(`${score} / ${total}`, margin + 12, y + 21);
    doc.setFontSize(13);
    doc.text(`${percentage}% — ${grade.label}`, margin + 70, y + 21);
    y += 44;

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(31, 29, 36);
    doc.text('Détail des réponses', margin, y);
    y += 10;

    correction.forEach((item, idx) => {
      if (y > 258) {
        doc.addPage();
        y = 20;
      }
      const [cr, cg, cb] = item.isCorrect ? [46, 125, 91] : [192, 69, 59];
      doc.setDrawColor(cr, cg, cb);
      doc.setLineWidth(0.8);
      doc.line(margin, y - 2, margin, y + 5);

      doc.setFontSize(8.5);
      doc.setTextColor(cr, cg, cb);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `${item.isCorrect ? 'CORRECT' : 'INCORRECT'} - Question ${idx + 1}`,
        margin + 4,
        y + 3
      );
      y += 9;

      doc.setTextColor(31, 29, 36);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const qLines = doc.splitTextToSize(item.question, contentWidth - 6);
      doc.text(qLines, margin + 4, y);
      y += qLines.length * 5 + 3;

      if (!item.isCorrect) {
        doc.setFontSize(9);
        doc.setTextColor(192, 69, 59);
        const mine = doc.splitTextToSize(
          `Votre réponse : ${getOptionText(item.options, item.userAnswer)}`,
          contentWidth - 6
        );
        doc.text(mine, margin + 4, y);
        y += mine.length * 4.4 + 2;
        doc.setTextColor(46, 125, 91);
        const good = doc.splitTextToSize(
          `Bonne réponse : ${getOptionText(item.options, item.correctAnswer)}`,
          contentWidth - 6
        );
        doc.text(good, margin + 4, y);
        y += good.length * 4.4 + 2;
      }

      if (item.explanation) {
        doc.setFontSize(9);
        doc.setTextColor(110, 110, 110);
        doc.setFont('helvetica', 'italic');
        const exp = doc.splitTextToSize(`Explication : ${item.explanation}`, contentWidth - 6);
        doc.text(exp, margin + 4, y);
        y += exp.length * 4.4 + 2;
        doc.setFont('helvetica', 'normal');
      }
      y += 7;
    });

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Généré par Kemet Quiz - Kemet Services', pageWidth / 2, 290, { align: 'center' });
    return doc;
  };

  const handleDownloadPDF = () => generatePDF().save(`kemet-quiz-${playerName}.pdf`);

  const handleShare = () => {
    const doc = generatePDF();
    const blob = doc.output('blob');
    if (navigator.share && navigator.canShare) {
      const file = new File([blob], `kemet-quiz-${playerName}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          title: `Résultats — ${playerName}`,
          text: `${playerName} a obtenu ${score}/${total} (${percentage}%) au quiz « ${title} ».`,
          files: [file],
        });
        return;
      }
    }
    doc.save(`kemet-quiz-${playerName}.pdf`);
    const message = encodeURIComponent(
      `Bonjour,\nVoici mes résultats au quiz « ${title} » :\n` +
        `Candidat : ${playerName}\nScore : ${score}/${total} (${percentage}%) — ${grade.label}\n\n` +
        `Le PDF est en pièce jointe.`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  return (
    <div className="results">
      {showConfetti && (
        <div className="confetti" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              style={{
                left: `${(i * 4.2) % 100}%`,
                background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                animationDelay: `${(i % 8) * 0.15}s`,
                animationDuration: `${2 + (i % 5) * 0.3}s`,
              }}
            />
          ))}
        </div>
      )}

      <div className="score-hero">
        {/* Titre de l'écran de résultats — seul h1 de la vue (l'app-bar n'en porte
            aucun). Il nomme la COPIE (qui, sur quel quiz), pas le score : celui-ci
            est énoncé juste en dessous, dans l'anneau puis dans .score-grade, et
            l'ajouter au nom accessible le ferait lire deux fois. Le chiffre visible
            est de surcroît animé (displayScore), donc un nom enrichi figerait une
            valeur en désaccord avec les pixels pendant les 900 premières ms.
            La CLASSE est conservée, seule la BALISE change : .score-who fixe
            font-size, font-weight, color, letter-spacing et text-transform — qui
            écrasent les valeurs par défaut du h1 — le reset global (* { margin: 0 })
            annule sa marge, et .score-hero étant un conteneur flex, <span> comme
            <h1> sont blockifiés à l'identique. Rendu strictement inchangé. */}
        {/* tabIndex={-1} : cible de la reprise de focus au changement d'écran,
            hors de l'ordre de tabulation. Le focus est PROGRAMMATIQUE et le
            seul anneau de l'application est le :focus-visible global
            d'index.css — App.css ne pose de :focus que sur des champs de
            saisie (.input, .q-card-input, .q-option-input) et rien sur
            .score-who ni .score-hero. Aucun anneau n'apparaît donc au montage,
            et .score-hero n'a pas d'overflow qui le rognerait si un lecteur au
            clavier venait à en déclencher un. */}
        <h1 className="score-who" ref={headingRef} tabIndex={-1}>
          {playerName} · {title}
        </h1>
        {/* Le conic-gradient de l'anneau est purement décoratif : il ne fait que
            redessiner le pourcentage déjà écrit en toutes lettres dans
            .score-grade. Ce <div> ne porte donc NI role="img" + aria-label — ce
            serait une seconde énonciation du même chiffre — NI aria-hidden, qui
            masquerait le score lui-même, porté par le texte de .score-ring-inner.
            Un <div> sans rôle ni nom accessible n'expose que son contenu : le
            score est lu une fois, le dégradé n'est pas lu. */}
        <div
          className="score-ring"
          style={{
            background: `conic-gradient(${grade.color} 0% ${percentage}%, rgba(255,255,255,0.12) ${percentage}% 100%)`,
          }}
        >
          <div className="score-ring-inner">
            <span className="score-value">{displayScore}</span>
            <span className="score-total">sur {total}</span>
          </div>
        </div>
        <span className="score-grade" style={{ color: grade.color === '#1f1d24' ? '#fff' : grade.color }}>
          {grade.label} · {percentage}%
        </span>
      </div>

      <div className="results-body">
        <div className="results-actions">
          <button className="btn btn--ghost" onClick={handleDownloadPDF}>
            <Icon name="download" size={15} width={1.7} />
            PDF
          </button>
          <button className="btn btn--wa" onClick={handleShare}>
            <Icon name="send" size={15} width={1.7} />
            Partager
          </button>
          {onRetake && (
            <button
              className="btn btn--ghost btn--icon"
              onClick={onRetake}
              aria-label="Refaire le quiz"
              title="Refaire le quiz"
            >
              <Icon name="refresh" size={16} width={1.7} />
            </button>
          )}
        </div>

        <div className="review-bar">
          {/* Niveau 2 sous le h1 du bandeau de score : la liste de correction,
              qui compte 10 à 30 cartes, devient atteignable d'un seul appui en
              navigation par titres. Aucun h3 en dessous — « QUESTION n » reste un
              <span> dans .r-card-head, tout comme .r-toggle plus bas : une seule
              section est ouverte par ce h2, un niveau 3 n'y ajouterait aucune
              structure et créerait 10 à 30 titres bruyants. Le document va donc
              h1 → h2, sans saut ni orphelin, dans les DEUX cas (avec ou sans
              erreur) puisque ce h2 est toujours rendu.
              Comme pour le h1, seule la BALISE change : .review-bar-title fixe
              font-size, font-weight et color, .review-bar est un conteneur flex
              (le h2 y est un item comme l'était le span) et le reset global annule
              la marge par défaut. Rendu strictement inchangé. */}
          <h2 className="review-bar-title">
            {wrongCount > 0 ? 'Ce que vous avez manqué' : 'Détail des réponses'}
          </h2>
          {wrongCount > 0 && (
            <span className="review-bar-count">
              {wrongCount} erreur{wrongCount > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Les erreurs d'abord, toujours dépliées : ce sont elles qui
            intéressent l'apprenant juste après son score, et il y en a
            rarement plus de 2 ou 3 sur un quiz de 10 questions. */}
        {wrongItems.map(({ item, idx }) => (
          <div key={idx} className="r-card is-wrong">
            <div className="r-card-head">
              <span className="r-badge is-wrong">
                <Icon name="close" size={11} width={2.6} />
              </span>
              <span className="r-card-num">QUESTION {idx + 1}</span>
            </div>
            <p className="r-question">{item.question}</p>
            <div className="r-answers">
              <div className="r-answer r-answer--mine">
                <b>Vous</b>
                <span>{getOptionText(item.options, item.userAnswer)}</span>
              </div>
              <div className="r-answer r-answer--good">
                <b>Réponse</b>
                <span>{getOptionText(item.options, item.correctAnswer)}</span>
              </div>
            </div>
            {item.explanation && (
              <div className="r-explain">
                <Icon name="info" size={15} width={1.8} />
                <span>{item.explanation}</span>
              </div>
            )}
          </div>
        ))}

        {/* Les bonnes réponses se replient derrière ce déclencheur — même
            convention que .apprenant-ligne--depliable (ApprenantHistorique) :
            <button> toujours rendu avec aria-expanded, région ciblée par
            aria-controls et toujours montée dans le DOM, seul `hidden`
            bascule. .recent-row porte déjà le fond, la bordure et le
            padding qu'il faut ; .r-badge (déjà utilisé dans chaque carte
            ci-dessus) donne la pastille verte sans introduire de nouvelle
            combinaison de couleur. */}
        {goodCount > 0 && (
          <>
            <button
              type="button"
              className="recent-row"
              aria-expanded={detailOuvert}
              aria-controls="r-detail-bonnes"
              onClick={() => setDetailOuvert((v) => !v)}
            >
              <span className="r-badge" aria-hidden="true">
                <Icon name="check" size={11} width={2.6} />
              </span>
              <span className="recent-row-body">
                <span className="recent-row-title">
                  {goodCount} bonne{goodCount > 1 ? 's' : ''} réponse{goodCount > 1 ? 's' : ''}
                </span>
                <span className="recent-row-meta">
                  {detailOuvert
                    ? 'Masquer le détail question par question'
                    : 'Afficher le détail question par question'}
                </span>
              </span>
              <Icon name="chevronDown" size={16} width={1.7} className="r-toggle-chevron" />
            </button>

            <div id="r-detail-bonnes" hidden={!detailOuvert} className="r-detail-bonnes">
              {goodItems.map(({ item, idx }) => (
                <div key={idx} className="r-card">
                  <div className="r-card-head">
                    <span className="r-badge">
                      <Icon name="check" size={11} width={2.6} />
                    </span>
                    <span className="r-card-num">QUESTION {idx + 1}</span>
                  </div>
                  <p className="r-question">{item.question}</p>
                  {item.explanation && (
                    <div className="r-explain">
                      <Icon name="info" size={15} width={1.8} />
                      <span>{item.explanation}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Results;
