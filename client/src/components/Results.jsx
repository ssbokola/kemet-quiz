import { useState, useEffect } from 'react';
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
  const wrongCount = correction.filter((c) => !c.isCorrect).length;

  useEffect(() => {
    document.body.classList.remove('theme-ink');
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
        <span className="score-who">
          {playerName} · {title}
        </span>
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
          <span className="review-bar-title">Correction</span>
          {wrongCount > 0 && (
            <span className="review-bar-count">
              {wrongCount} à revoir
            </span>
          )}
        </div>

        {correction.map((item, idx) => (
          <div key={idx} className={`r-card ${item.isCorrect ? '' : 'is-wrong'}`}>
            <div className="r-card-head">
              <span className={`r-badge ${item.isCorrect ? '' : 'is-wrong'}`}>
                <Icon name={item.isCorrect ? 'check' : 'close'} size={11} width={2.6} />
              </span>
              <span className="r-card-num">QUESTION {idx + 1}</span>
            </div>
            <p className="r-question">{item.question}</p>
            {!item.isCorrect && (
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
            )}
            {item.explanation && (
              <div className="r-explain">
                <Icon name="info" size={15} width={1.8} />
                <span>{item.explanation}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Results;
