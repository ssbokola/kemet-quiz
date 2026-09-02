import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { adminJson, MESSAGE_RESEAU } from '../api';
import { chemins } from '../chemins';
import { useFocusAuMontage } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme partout ailleurs dans l'espace formateur : la recopie du
// montage ne change alors rien et n'entraîne aucun rendu supplémentaire.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Combien de lignes montrer dans chacun des deux aperçus : assez pour donner
// un coup d'œil utile, assez peu pour rester un RÉSUMÉ — le détail complet est
// à un clic, sur « Tout voir ».
const APERCU_MAX = 4;

/** Array.from et non charAt : une initiale hors du plan multilingue de base
 * (émoji, certains prénoms) ne doit pas couper une paire de substitution en
 * deux et rendre un losange noir. Même précaution que decrireApprenant. */
function initiale(nom) {
  const n = String(nom || '').trim();
  return (Array.from(n)[0] || '?').toUpperCase();
}

/** Moyenne arrondie, ou null — jamais 0 ni NaN. Même garde que moyenneArrondie
 * dans ApprenantsListe.jsx : un pourcentage manquant n'est pas une note de zéro. */
function pourcentArrondi(valeur) {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? Math.round(valeur) : null;
}

/**
 * Tableau de bord — nouvel index de l'espace formateur.
 *
 * Trois appels indépendants (Promise.all) : les chiffres clés (nouvelle route
 * dédiée), et les deux annuaires déjà exposés pour leurs propres écrans
 * (/api/learners, /api/pharmacies), triés et limités ICI plutôt que d'ouvrir
 * une route de plus pour ce qui n'est qu'un aperçu des mêmes données.
 *
 * « Derniers apprenants » : les fiches ayant DÉJÀ une participation, les plus
 * récentes d'abord — une fiche jamais évaluée n'a rien à montrer ici, et
 * apparaîtrait avec une date fantôme.
 * « Officines actives » : celles qui comptent au moins un apprenant rattaché,
 * les plus fournies d'abord — la barre se lit contre la plus grande valeur
 * affichée, pas contre un total abstrait qui n'aurait aucun sens à l'œil.
 */
function Dashboard() {
  const [stats, setStats] = useState(null);
  const [apprenants, setApprenants] = useState(null);
  const [officines, setOfficines] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const titreRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      try {
        const [dash, learnersData, pharmaciesData] = await Promise.all([
          adminJson('/api/dashboard', {
            repli: 'Les chiffres du tableau de bord n’ont pas pu être chargés.',
          }),
          adminJson('/api/learners', {
            repli: 'La liste des apprenants n’a pas pu être chargée.',
          }),
          adminJson('/api/pharmacies', {
            repli: 'La liste des officines n’a pas pu être chargée.',
          }),
        ]);
        if (annule) return;
        setStats(dash);
        setApprenants(Array.isArray(learnersData.learners) ? learnersData.learners : []);
        setOfficines(Array.isArray(pharmaciesData.pharmacies) ? pharmaciesData.pharmacies : []);
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

  // Valeurs DÉRIVÉES, recalculées à chaque rendu : pas d'état à synchroniser,
  // pas d'effet superflu. Même choix que UploadPDF pour resumeDiffusion.
  const derniersApprenants = apprenants
    ? [...apprenants]
        .filter((a) => a.lastSubmittedAt)
        .sort((a, b) => String(b.lastSubmittedAt).localeCompare(String(a.lastSubmittedAt)))
        .slice(0, APERCU_MAX)
    : null;

  const officinesActives = officines
    ? [...officines]
        .filter((p) => (p.attempts || 0) > 0)
        .sort((a, b) => (b.attempts || 0) - (a.attempts || 0))
        .slice(0, APERCU_MAX)
    : null;

  const maxEffectif = officinesActives
    ? officinesActives.reduce((m, p) => Math.max(m, p.attempts || 0), 0)
    : 0;

  const scoreMoyen = stats ? pourcentArrondi(stats.avgPercent) : null;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          Tableau de bord
        </h1>
        <p>Vue d’ensemble de vos quiz, de vos apprenants et de vos officines.</p>
      </div>

      {/* Région d'alerte montée en permanence, remplie au commit suivant —
          même séquence que partout ailleurs dans l'espace formateur. */}
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

      {!chargement && stats && (
        <div className="dash-stats">
          <div className="dash-stat">
            <span className="dash-stat-label">Score moyen</span>
            <span className="dash-stat-value dash-stat-value--accent">
              {scoreMoyen !== null ? `${scoreMoyen} %` : '—'}
            </span>
            <span className="dash-stat-note">tous quiz confondus</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-label">Réponses</span>
            <span className="dash-stat-value">{stats.totalResponses || 0}</span>
            <span className="dash-stat-note">participations enregistrées</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-label">Apprenants</span>
            <span className="dash-stat-value">{stats.totalLearners || 0}</span>
            <span className="dash-stat-note">fiches dans l’annuaire</span>
          </div>
          <div className="dash-stat">
            <span className="dash-stat-label">Officines</span>
            <span className="dash-stat-value">{stats.activePharmacies || 0}</span>
            <span className="dash-stat-note">rattachées à un apprenant</span>
          </div>
        </div>
      )}

      {!chargement && (
        <>
          {/* Zone de dépôt : même motif visuel que UploadPDF (.dropzone), mais
              en simple LIEN vers la création — dupliquer ici la logique de
              dépôt, d'extraction et de fabrication du quiz aurait porté deux
              fois le même état pour la même action. */}
          <Link to={chemins.nouveau} className="dropzone">
            <Icon name="doc" size={34} stroke="var(--gold)" width={1.4} />
            <span className="dropzone-title">Glissez un PDF ici pour créer un quiz</span>
            <span className="dropzone-alt">PDF texte ou scanné · 20 Mo max</span>
            <span className="dropzone-meta">Vous relirez les questions avant publication</span>
          </Link>

          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="field-row">
              <h2 className="eyebrow">Derniers apprenants</h2>
              <Link className="app-bar-link" to={chemins.apprenants}>
                Tout voir
              </Link>
            </div>

            {derniersApprenants && derniersApprenants.length > 0 ? (
              <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
                {derniersApprenants.map((a) => {
                  const moyenne = pourcentArrondi(a.avgPercent);
                  return (
                    <div key={a.id} className="recent-row recent-row--static">
                      <span className="app-mark" aria-hidden="true">
                        {initiale(a.displayName)}
                      </span>
                      <span className="recent-row-body">
                        <span className="recent-row-title">{a.displayName}</span>
                        <span className="recent-row-meta">
                          {a.pharmacyName || 'Sans officine'}
                        </span>
                      </span>
                      <span className="apprenant-note">
                        {moyenne !== null ? `${moyenne} %` : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="subtle">Aucune participation enregistrée pour l’instant.</p>
            )}
          </div>

          <div className="card stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="field-row">
              <h2 className="eyebrow">Officines actives</h2>
              <Link className="app-bar-link" to={chemins.officines}>
                Tout voir
              </Link>
            </div>

            {officinesActives && officinesActives.length > 0 ? (
              <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
                {officinesActives.map((p) => {
                  const n = p.attempts || 0;
                  const pct = maxEffectif > 0 ? Math.max(6, Math.round((n / maxEffectif) * 100)) : 0;
                  return (
                    <div key={p.id} className="recent-row recent-row--static">
                      <span className="recent-row-title dash-pharmacy-name">{p.displayName}</span>
                      <span className="bar dash-pharmacy-bar" aria-hidden="true">
                        <span className="bar-fill" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="dash-pharmacy-count">
                        {n} apprenant{n > 1 ? 's' : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="subtle">Aucun apprenant rattaché à une officine pour l’instant.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Dashboard;
