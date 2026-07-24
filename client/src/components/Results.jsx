import { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';

const CONFETTI_COLORS = ['#c8a45a', '#d4b86a', '#1a1a2e', '#16a34a', '#f0e8d4'];

function Results({ playerName, title, score, total, correction, onRetake }) {
  const percentage = Math.round((score / total) * 100);
  const [displayScore, setDisplayScore] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    let raf;
    const duration = 1000;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(score * eased));
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

  const getGrade = () => {
    if (percentage >= 80) return { label: 'Excellent !', color: '#16a34a' };
    if (percentage >= 60) return { label: 'Bien !', color: '#2563eb' };
    if (percentage >= 40) return { label: 'Passable', color: '#d97706' };
    return { label: 'A revoir', color: '#dc2626' };
  };

  const grade = getGrade();

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    // Header
    doc.setFillColor(200, 164, 90);
    doc.rect(0, 0, pageWidth, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('KEMET QUIZ', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const titleLines = doc.splitTextToSize(title, pageWidth - 40);
    doc.text(titleLines, pageWidth / 2, 30, { align: 'center' });
    doc.setFontSize(10);
    doc.text(new Date().toLocaleDateString('fr-FR'), pageWidth / 2, 40, { align: 'center' });

    y = 60;

    // Player info
    doc.setTextColor(26, 26, 46);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Candidat : ${playerName}`, margin, y);
    y += 12;

    // Score box
    doc.setFillColor(248, 246, 244);
    doc.roundedRect(margin, y, contentWidth, 35, 3, 3, 'F');
    doc.setFontSize(28);
    doc.setFont('helvetica', 'bold');
    const [r, g, b] = hexToRgb(grade.color);
    doc.setTextColor(r, g, b);
    doc.text(`${score} / ${total}`, pageWidth / 2 - 20, y + 18, { align: 'center' });
    doc.setFontSize(14);
    doc.text(`${percentage}% - ${grade.label}`, pageWidth / 2 + 25, y + 18);
    y += 45;

    // Questions
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 26, 46);
    doc.text('Detail des reponses', margin, y);
    y += 10;

    correction.forEach((item, idx) => {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      const [cr, cg, cb] = item.isCorrect ? [22, 163, 74] : [220, 38, 38];
      doc.setDrawColor(cr, cg, cb);
      doc.setLineWidth(0.5);
      doc.line(margin, y, margin, y + 6);

      doc.setFontSize(9);
      doc.setTextColor(cr, cg, cb);
      doc.setFont('helvetica', 'bold');
      doc.text(`${item.isCorrect ? 'CORRECT' : 'INCORRECT'} - Question ${idx + 1}`, margin + 3, y + 4);
      y += 10;

      doc.setTextColor(26, 26, 46);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const questionLines = doc.splitTextToSize(item.question, contentWidth - 5);
      doc.text(questionLines, margin + 3, y);
      y += questionLines.length * 5 + 3;

      if (!item.isCorrect) {
        doc.setFontSize(9);
        doc.setTextColor(220, 38, 38);
        const userText = getOptionText(item.options, item.userAnswer);
        const correctText = getOptionText(item.options, item.correctAnswer);
        const answerLines = doc.splitTextToSize(`Votre réponse : ${userText}`, contentWidth - 5);
        doc.text(answerLines, margin + 3, y);
        y += answerLines.length * 4 + 2;
        doc.setTextColor(22, 163, 74);
        const correctLines = doc.splitTextToSize(`Bonne réponse : ${correctText}`, contentWidth - 5);
        doc.text(correctLines, margin + 3, y);
        y += correctLines.length * 4 + 2;
      }

      if (item.explanation) {
        doc.setFontSize(9);
        doc.setTextColor(110, 110, 110);
        doc.setFont('helvetica', 'italic');
        const expLines = doc.splitTextToSize(`Explication : ${item.explanation}`, contentWidth - 5);
        doc.text(expLines, margin + 3, y);
        y += expLines.length * 4 + 2;
        doc.setFont('helvetica', 'normal');
      }

      y += 8;
    });

    // Footer
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text('Genere par Kemet Quiz - Kemet Services', pageWidth / 2, 290, { align: 'center' });

    return doc;
  };

  const handleDownloadPDF = () => {
    const doc = generatePDF();
    doc.save(`kemet-quiz-${playerName}.pdf`);
  };

  const handleShareWhatsApp = () => {
    const doc = generatePDF();
    const pdfBlob = doc.output('blob');

    if (navigator.share && navigator.canShare) {
      const file = new File([pdfBlob], `kemet-quiz-${playerName}.pdf`, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        navigator.share({
          title: `Resultats Quiz - ${playerName}`,
          text: `${playerName} a obtenu ${score}/${total} (${percentage}%) au Kemet Quiz !`,
          files: [file],
        });
        return;
      }
    }

    doc.save(`kemet-quiz-${playerName}.pdf`);
    const message = encodeURIComponent(
      `Bonjour,\nVoici mes resultats au Kemet Quiz "${title}" :\n` +
      `Candidat : ${playerName}\n` +
      `Score : ${score}/${total} (${percentage}%) - ${grade.label}\n\n` +
      `Le PDF est en piece jointe.`
    );
    window.open(`https://wa.me/?text=${message}`, '_blank');
  };

  return (
    <div className="results-section">
      {showConfetti && (
        <div className="confetti-container" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <span
              key={i}
              className="confetti-piece"
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

      <div className="score-card" style={{ borderColor: grade.color }}>
        <p className="player-name">{playerName}</p>
        <h2 style={{ color: grade.color }}>{grade.label}</h2>
        <div className="score-circle" style={{ borderColor: grade.color }}>
          <span className="score-number">{displayScore}</span>
          <span className="score-total">/ {total}</span>
        </div>
        <p className="score-percent">{percentage}%</p>
      </div>

      <div className="action-buttons">
        <button className="btn btn-pdf" onClick={handleDownloadPDF}>
          📥 Telecharger le PDF
        </button>
        <button className="btn btn-whatsapp" onClick={handleShareWhatsApp}>
          💬 Partager sur WhatsApp
        </button>
      </div>

      {onRetake && (
        <button className="btn btn-retake" onClick={onRetake}>
          🔄 Refaire le quiz
        </button>
      )}

      <div className="review">
        <h3>Correction</h3>
        {correction.map((item, idx) => (
          <div key={idx} className={`review-card ${item.isCorrect ? 'correct' : 'incorrect'}`}>
            <div className="review-header">
              <span className={`review-icon ${item.isCorrect ? 'correct' : 'incorrect'}`}>
                {item.isCorrect ? '✓' : '✗'}
              </span>
              <span className="review-q">Question {idx + 1}</span>
            </div>
            <p className="question-text">{item.question}</p>
            {!item.isCorrect && (
              <div className="correct-answer">
                <p>Votre réponse : <strong>{getOptionText(item.options, item.userAnswer)}</strong></p>
                <p>Bonne réponse : <strong>{getOptionText(item.options, item.correctAnswer)}</strong></p>
              </div>
            )}
            {item.explanation && (
              <div className="review-explanation">
                <span className="explanation-icon">💡</span>
                <span>{item.explanation}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getOptionText(options, letter) {
  const idx = letter.charCodeAt(0) - 65;
  if (idx >= 0 && idx < options.length) {
    return options[idx].replace(/^[A-D]\)\s*/, '');
  }
  return letter;
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)]
    : [0, 0, 0];
}

export default Results;
