import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import Icon from '../components/Icon';
import RadioGroup from '../components/RadioGroup';
import { MESSAGE_RESEAU } from '../api';
import { listerQuiz, modifierQuiz } from '../quiz-api';
import { chemins, lienPublic } from '../chemins';
import { etatDuQuiz } from '../quiz-etat';
import { formatJour } from '../dates';
import { useFocusAuMontage } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence : la recopie du montage ne change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// La recherche annonce son décompte, mais pas à chaque frappe : sans ce délai
// la région polie parlerait sur chaque lettre et couvrirait sa propre réponse.
const DELAI_ANNONCE = 500;

// Le filtre d'état, dans l'ordre où le mockup « Direction retenue » (03 · Mes
// quiz) les montre. « Fermés » couvre les DEUX étiquettes grises de la
// colonne Quiz (fermé ET expiré) : ce sont les deux états où le lien ne
// répond plus, et c'est ce distinguo-là — répond / ne répond pas — qui motive
// un filtre, pas la raison technique du silence.
const FILTRES_ETAT = [
  { value: 'tous', label: 'Tous' },
  { value: 'en-ligne', label: 'En ligne' },
  { value: 'fermes', label: 'Fermés' },
];

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

/** Moyenne arrondie, ou `null` — jamais 0 ni NaN. Même garde que
 * moyenneArrondie (ApprenantsListe.jsx) et pourcentArrondi (Dashboard.jsx) :
 * un pourcentage manquant n'est pas une note de zéro. */
function pourcentArrondi(valeur) {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? Math.round(valeur) : null;
}

/**
 * « Mes quiz » — la liste, en tableau dense sur desktop.
 *
 * Écran distinct de QuizResults, et pas une branche de plus dedans. Le
 * commentaire d'en-tête d'Apprenants.jsx désigne nommément QuizResults comme le
 * défaut à ne pas reproduire : il basculait liste et détail dans un même
 * composant, donc cliquer un quiz démontait le bouton qui portait le focus, le
 * <h1> changeait de texte sans que rien ne se monte, l'effet ne rejouait pas,
 * et le focus retombait sur <body>. Deux adresses, deux composants.
 *
 * ⚠️ La ligne n'est PLUS un unique <a> plein cadre comme avant ce lot. Le
 * tableau dense (colonnes Officine / Score moyen / Lien / Actions) a PLUSIEURS
 * commandes distinctes par ligne — QR, Copier/Réouvrir/Prolonger, Résultats,
 * Ouvrir — et un <a> ne peut pas contenir un <button> de façon accessible.
 * Le geste « clic du milieu / Ctrl+clic pour ouvrir dans un nouvel onglet »
 * que l'ancien <a> rendait possible reste disponible : c'est désormais le
 * TITRE du quiz, en <Link>, qui le porte.
 */
function MesQuiz() {
  const [liste, setListe] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const [recherche, setRecherche] = useState('');
  const [filtreEtat, setFiltreEtat] = useState('tous');
  // Id du quiz dont le lien vient d'être copié / est en cours de réouverture —
  // un seul à la fois, comme .btn-copy dans PartageQuiz : copier une seconde
  // ligne remplace simplement l'indicateur de la première.
  const [copiedId, setCopiedId] = useState(null);
  const [reouvertureId, setReouvertureId] = useState(null);
  const titreRef = useRef(null);
  const minuteurRef = useRef(null);
  const copyTimerRef = useRef(null);

  // Le numéro s'incrémente à CHAQUE écriture, effacement compris : deux échecs
  // identiques d'affilée doivent être annoncés deux fois.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

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

  const parRecherche = useMemo(() => {
    if (!liste) return null;
    const q = sansAccent(recherche.trim());
    if (!q) return liste;
    return liste.filter((quiz) => sansAccent(quiz.title).includes(q));
  }, [liste, recherche]);

  const resultat = useMemo(() => {
    if (!parRecherche) return null;
    if (filtreEtat === 'tous') return parRecherche;
    return parRecherche.filter((quiz) =>
      filtreEtat === 'en-ligne' ? etatDuQuiz(quiz) === 'en ligne' : etatDuQuiz(quiz) !== 'en ligne'
    );
  }, [parRecherche, filtreEtat]);

  const filtreActif = Boolean(recherche.trim()) || filtreEtat !== 'tous';

  // Le décompte de la recherche ET du filtre d'état, annoncé une fois la
  // frappe (ou le clic) retombés.
  //
  // ⚠️ Dépend UNIQUEMENT de `recherche` et `filtreEtat`, pas de `resultat` ni
  // de `liste` : réouvrir un quiz depuis cette même liste (voir `reouvrir`
  // ci-dessous) modifie `liste`, et si cet effet en dépendait il se
  // redéclencherait à cet instant, retomberait dans la branche « aucun filtre
  // actif » et effacerait — juste après qu'elle vient d'être posée — l'annonce
  // de réouverture. En ne réagissant qu'aux DEUX actions qui ouvrent ou
  // ferment un filtre, cette course ne peut pas se produire.
  useEffect(() => {
    clearTimeout(minuteurRef.current);
    if (!liste) return undefined;
    if (!recherche.trim() && filtreEtat === 'tous') {
      setAnnonce('');
      return undefined;
    }
    minuteurRef.current = setTimeout(() => {
      const n = resultat ? resultat.length : 0;
      setAnnonce(n === 0 ? 'Aucun quiz ne correspond.' : `${n} quiz sur ${liste.length}.`);
    }, DELAI_ANNONCE);
    return () => clearTimeout(minuteurRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recherche, filtreEtat]);

  const copierLien = async (quiz) => {
    clearTimeout(copyTimerRef.current);
    signaler('');
    setAnnonce('');
    try {
      await navigator.clipboard.writeText(lienPublic(quiz.id));
      setCopiedId(quiz.id);
      setAnnonce(`Lien de « ${quiz.title} » copié dans le presse-papiers.`);
      copyTimerRef.current = setTimeout(() => {
        setCopiedId(null);
        setAnnonce('');
      }, 2000);
    } catch {
      setCopiedId(null);
      signaler('La copie a échoué. Ouvrez le quiz pour copier son lien à la main.');
    }
  };

  // Réouvre DEPUIS la liste, sans passer par l'écran de partage. Même logique
  // que toggleClosed (PartageQuiz.jsx) mais sans son tiroir de durée : un quiz
  // fermé ET expiré redevient ici « expiré » (etatDuQuiz teste `closed` avant
  // l'expiration, comme partout ailleurs) et sa ligne affiche alors
  // « Prolonger le lien », qui renvoie vers l'écran de partage pour la
  // vraie prolongation — cette liste n'a pas besoin de dupliquer ce tiroir.
  const reouvrir = async (quiz) => {
    if (reouvertureId) return;
    setReouvertureId(quiz.id);
    signaler('');
    setAnnonce('');
    try {
      const data = await modifierQuiz(
        quiz.id,
        { closed: false },
        'Le quiz n’a pas pu être réouvert.'
      );
      // L'état RETENU par le serveur met à jour la ligne, jamais la valeur
      // demandée — même règle que toggleClosed (PartageQuiz.jsx). La fusion se
      // fait sur l'item COURANT de la liste (`item`), pas sur `quiz` (capturé
      // à l'ouverture de cette fonction) : si un autre champ avait changé
      // entre-temps, ce serait lui qui l'emporterait, jamais une valeur figée.
      // `suivant` ne porte que les deux champs qu'etatDuQuiz lit : il n'a pas
      // besoin d'attendre le prochain rendu pour dire le nouvel état.
      const suivant = { closed: data.closed, expiresAt: data.expiresAt };
      setListe((prec) =>
        prec ? prec.map((item) => (item.id === quiz.id ? { ...item, ...suivant } : item)) : prec
      );
      setAnnonce(
        etatDuQuiz(suivant) === 'expiré'
          ? `« ${quiz.title} » réouvert, mais son lien reste expiré : ouvrez-le pour prolonger sa durée.`
          : `« ${quiz.title} » réouvert : son lien fonctionne à nouveau.`
      );
    } catch (err) {
      signaler(err?.message || 'Le quiz n’a pas pu être réouvert.');
    } finally {
      setReouvertureId(null);
    }
  };

  const totalReponses = liste ? liste.reduce((somme, q) => somme + (q.resultCount || 0), 0) : 0;
  const sousTitre =
    liste && liste.length > 0
      ? filtreActif
        ? `${resultat.length} quiz sur ${liste.length}`
        : `${liste.length} quiz · ${totalReponses} réponse${totalReponses > 1 ? 's' : ''} reçue${
            totalReponses > 1 ? 's' : ''
          }`
      : 'Ouvrez un quiz pour retrouver son lien et son QR code, ou le remettre en ligne.';

  const reinitialiserFiltres = () => {
    setRecherche('');
    setFiltreEtat('tous');
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          Mes quiz
        </h1>
        <p>{sousTitre}</p>
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

      {/* La recherche et le filtre d'état n'apparaissent qu'une fois qu'il y a
          de quoi filtrer : sur trois quiz ils seraient du mobilier — même
          seuil que la recherche avant ce lot. */}
      {!chargement && liste && liste.length > 5 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-6)', alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 220px', minWidth: 0 }}>
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
          <RadioGroup
            className="tag-row"
            label="Filtrer les quiz par état"
            options={FILTRES_ETAT}
            value={filtreEtat}
            onChange={setFiltreEtat}
            optionClassName={(opt, checked) => `segment segment--text${checked ? ' is-active' : ''}`}
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
          <Link className="btn btn--ghost" to={chemins.nouveau}>
            Créer un quiz
          </Link>
        </div>
      )}

      {!chargement && liste && liste.length > 0 && resultat && resultat.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="search" size={22} width={1.6} />
          </span>
          <h2>Aucun quiz ne correspond</h2>
          <p>
            {recherche.trim()
              ? `Rien ne contient « ${recherche.trim()} » dans son titre.`
              : 'Aucun quiz n’a cet état pour l’instant.'}
          </p>
          <button type="button" className="btn btn--ghost" onClick={reinitialiserFiltres}>
            Réinitialiser les filtres
          </button>
        </div>
      )}

      {!chargement && resultat && resultat.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="quiz-table-scroll">
            <table className="quiz-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="eyebrow">Quiz</span>
                  </th>
                  <th scope="col">
                    <span className="eyebrow">Officine</span>
                  </th>
                  <th scope="col">
                    <span className="eyebrow">Score moyen</span>
                  </th>
                  <th scope="col">
                    <span className="eyebrow">Lien</span>
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resultat.map((q) => {
                  const etat = etatDuQuiz(q);
                  const lien = lienPublic(q.id);
                  const moyenne = pourcentArrondi(q.avgPercent);
                  const aOfficine = q.pharmacyCount > 0;

                  return (
                    <tr key={q.id}>
                      {/* Quiz : titre (lien vers le partage) + étiquette
                          d'état + méta. L'état se dit par un MOT, jamais par
                          la seule couleur (WCAG 1.4.1) : « en ligne » n'a pas
                          d'étiquette, c'est le cas nominal, et le signaler
                          noierait les deux qui demandent une action. */}
                      <td>
                        <div className="recent-row-body">
                          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', minWidth: 0 }}>
                            <Link to={chemins.partage(q.id)} className="recent-row-title" style={{ minWidth: 0 }}>
                              {q.title}
                            </Link>
                            {etat !== 'en ligne' && (
                              <span className="tag">{etat === 'fermé' ? 'Fermé' : 'Expiré'}</span>
                            )}
                          </span>
                          <span className="recent-row-meta">
                            {formatJour(q.createdAt)} · {q.resultCount} réponse
                            {q.resultCount > 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>

                      {/* Officine : la plus fréquente, puis le nombre
                          d'autres officines distinctes s'il y en a. */}
                      <td>
                        {aOfficine ? (
                          <span>
                            {q.topPharmacyName}
                            {q.pharmacyCount > 1 && (
                              <span className="quiz-table-pharmacy-extra"> +{q.pharmacyCount - 1}</span>
                            )}
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>

                      {/* Score moyen : la barre est décorative, le
                          pourcentage — seul porteur réel de l'information —
                          est à côté en toutes lettres. */}
                      <td>
                        {moyenne !== null ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                            <span className="bar" style={{ flex: 1, minWidth: 40 }} aria-hidden="true">
                              <span className="bar-fill" style={{ width: `${moyenne}%` }} />
                            </span>
                            <span className="apprenant-note">{moyenne} %</span>
                          </span>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>

                      {/* Lien : miniature de QR (décorative) + l'action qui
                          correspond à l'état RÉEL de ce quiz précis — jamais
                          trois lignes figées, un seul rendu conditionnel. */}
                      <td>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
                          {etat !== 'expiré' && (
                            <span
                              className="quiz-table-qr"
                              aria-hidden="true"
                              style={etat === 'fermé' ? { opacity: 0.4 } : undefined}
                            >
                              <QRCodeSVG value={lien} size={36} bgColor="#ffffff" fgColor="#1f1d24" level="M" />
                            </span>
                          )}
                          {etat === 'en ligne' && (
                            <button
                              type="button"
                              className="quiz-table-link-action"
                              onClick={() => copierLien(q)}
                            >
                              {copiedId === q.id ? 'Copié' : 'Copier'}
                            </button>
                          )}
                          {etat === 'fermé' && (
                            <button
                              type="button"
                              className="quiz-table-link-action"
                              onClick={() => reouvrir(q)}
                              aria-busy={reouvertureId === q.id}
                            >
                              {reouvertureId === q.id ? 'Patientez…' : 'Réouvrir'}
                            </button>
                          )}
                          {etat === 'expiré' && (
                            <Link className="quiz-table-link-action" to={chemins.partage(q.id)}>
                              Prolonger le lien
                            </Link>
                          )}
                        </span>
                      </td>

                      {/* Actions : Résultats (seulement s'il y a quelque
                          chose à montrer) et Ouvrir. ≥52px de cible tactile
                          (.btn--icon), au-dessus des 40px du mockup source et
                          largement au-dessus du plancher WCAG 2.5.5 (44px). */}
                      <td>
                        <span style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
                          {q.resultCount > 0 && (
                            <Link
                              className="btn btn--icon btn--ghost"
                              to={chemins.resultats(q.id)}
                              aria-label={`Résultats de ${q.title}`}
                            >
                              <Icon name="chart" size={18} width={1.7} />
                            </Link>
                          )}
                          <Link
                            className="btn btn--icon btn--ghost"
                            to={chemins.partage(q.id)}
                            aria-label={`Ouvrir ${q.title}`}
                          >
                            <Icon name="chevronRight" size={18} width={1.7} />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default MesQuiz;
