import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { MESSAGE_RESEAU } from '../api';
import { listerQuiz } from '../quiz-api';
import { chemins } from '../chemins';
import { etatDuQuiz } from '../quiz-etat';
import { formatJour } from '../dates';
import { useFocusAuMontage } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence : la recopie du montage ne change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// La recherche annonce son décompte, mais pas à chaque frappe : sans ce délai
// la région polie parlerait sur chaque lettre et couvrirait sa propre réponse.
const DELAI_ANNONCE = 500;

// Comparaison indifférente à la casse et aux accents — même intention que
// nameKey() côté serveur, sans en dépendre : ceci compare des TITRES de quiz,
// pas des identités de personnes, et les deux règles n'ont pas à évoluer
// ensemble.
function sansAccent(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * « Mes quiz » — la liste, et rien d'autre.
 *
 * Écran distinct de QuizResults, et pas une branche de plus dedans. Le
 * commentaire d'en-tête d'Apprenants.jsx désigne nommément QuizResults comme le
 * défaut à ne pas reproduire : il basculait liste et détail dans un même
 * composant, donc cliquer un quiz démontait le bouton qui portait le focus, le
 * <h1> changeait de texte sans que rien ne se monte, l'effet ne rejouait pas,
 * et le focus retombait sur <body>. Deux adresses, deux composants.
 *
 * Chaque ligne est un vrai <a> : c'est ce qui rend possible le clic du milieu,
 * le Ctrl+clic et « copier l'adresse du lien » — donc deux quiz dans deux
 * onglets, ce que le formateur a demandé.
 */
function MesQuiz() {
  const [liste, setListe] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const [recherche, setRecherche] = useState('');
  const titreRef = useRef(null);
  const minuteurRef = useRef(null);

  // Le numéro s'incrémente à CHAQUE écriture, effacement compris : deux échecs
  // identiques d'affilée doivent être annoncés deux fois.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await listerQuiz();
        if (annule) return;
        setListe(Array.isArray(data.quizzes) ? data.quizzes : []);
        setStockage(data.stockage || null);
      } catch (err) {
        if (!annule) signaler(err?.message || MESSAGE_RESEAU);
      } finally {
        if (!annule) setChargement(false);
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const filtres = useMemo(() => {
    if (!liste) return null;
    const q = sansAccent(recherche.trim());
    if (!q) return liste;
    return liste.filter((quiz) => sansAccent(quiz.title).includes(q));
  }, [liste, recherche]);

  // Le décompte de la recherche, annoncé une fois la frappe retombée.
  useEffect(() => {
    clearTimeout(minuteurRef.current);
    if (!filtres || !recherche.trim()) {
      setAnnonce('');
      return undefined;
    }
    minuteurRef.current = setTimeout(() => {
      const n = filtres.length;
      setAnnonce(n === 0 ? 'Aucun quiz ne correspond.' : `${n} quiz sur ${liste.length}.`);
    }, DELAI_ANNONCE);
    return () => clearTimeout(minuteurRef.current);
  }, [filtres, recherche, liste]);

  useEffect(() => () => clearTimeout(minuteurRef.current), []);

  // aria-label REMPLACE le contenu de la ligne : il doit donc reprendre TOUT ce
  // qu'elle montre, sans quoi la date, l'état et le nombre de réponses ne
  // seraient jamais énoncés. Même règle que decrireApprenant dans
  // ApprenantsListe.jsx.
  const decrireQuiz = (q) => {
    const etat = etatDuQuiz(q);
    const n = q.resultCount;
    const reponses = n === 0 ? 'aucune réponse' : `${n} réponse${n > 1 ? 's' : ''}`;
    return `${q.title}, créé le ${formatJour(q.createdAt)}, ${etat}, ${reponses}. Ouvrir le partage.`;
  };

  const vide = filtres && filtres.length === 0;
  const filtreActif = Boolean(recherche.trim());

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          Mes quiz
        </h1>
        <p>Ouvrez un quiz pour retrouver son lien et son QR code, ou le remettre en ligne.</p>
      </div>

      {/* Région d'alerte montée en permanence, remplie au commit suivant. */}
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

      {/* L'avertissement va là où il compte : devant les données concernées. */}
      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces quiz ne sont pas conservés.</b> Ils disparaîtront au prochain redéploiement
            de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {/* La recherche n'apparaît qu'une fois qu'il y a de quoi chercher : sur
          trois quiz elle serait du mobilier. */}
      {!chargement && liste && liste.length > 5 && (
        <div className="field">
          <label className="field-label" htmlFor="recherche-quiz">
            Rechercher un quiz
          </label>
          <input
            id="recherche-quiz"
            type="search"
            className="input"
            placeholder="Un mot du titre"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}

      {!chargement && liste && liste.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="doc" size={22} width={1.6} />
          </span>
          <h2>Aucun quiz pour l’instant</h2>
          <p>Déposez un support de formation : votre premier quiz apparaîtra ici.</p>
          <Link className="btn btn--ghost" to={chemins.creation}>
            Créer un quiz
          </Link>
        </div>
      )}

      {!chargement && vide && filtreActif && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="search" size={22} width={1.6} />
          </span>
          <h2>Aucun quiz ne correspond</h2>
          <p>Rien ne contient « {recherche.trim()} » dans son titre.</p>
          <button type="button" className="btn btn--ghost" onClick={() => setRecherche('')}>
            Effacer la recherche
          </button>
        </div>
      )}

      {!chargement && filtres && filtres.length > 0 && (
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          {filtres.map((q) => {
            const etat = etatDuQuiz(q);
            return (
              <Link
                key={q.id}
                to={chemins.partage(q.id)}
                className="recent-row"
                aria-label={decrireQuiz(q)}
              >
                <span className="recent-row-body">
                  <span className="recent-row-title">{q.title}</span>
                  <span className="recent-row-meta">{formatJour(q.createdAt)}</span>
                </span>
                <span className="tag-row">
                  {/* L'état se dit par un MOT, jamais par la seule couleur
                      (WCAG 1.4.1). « En ligne » n'est pas affiché : c'est le
                      cas nominal, et le signaler noierait les deux qui
                      demandent une action. */}
                  {etat !== 'en ligne' && (
                    <span className="tag">{etat === 'fermé' ? 'Fermé' : 'Expiré'}</span>
                  )}
                  <span className="tag">
                    {q.resultCount} réponse{q.resultCount > 1 ? 's' : ''}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MesQuiz;
