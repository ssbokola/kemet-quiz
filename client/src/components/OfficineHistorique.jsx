import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import PeriodePicker from './PeriodePicker';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { formatJourHeure, libellePeriode } from '../dates';

const AUCUNE_ERREUR = { texte: '', n: 0 };

// Excel en configuration française lit un .csv en ANSI par défaut : sans cette
// marque d'ordre des octets, « août » ressortirait en « aoÃ»t ».
const BOM_UTF8 = '\u{FEFF}';

/**
 * Résultats d'une officine, tous quiz confondus — espace formateur uniquement.
 *
 * Analogue de ApprenantHistorique.jsx, mais À CHEVAL sur plusieurs apprenants
 * et plusieurs quiz : chaque ligne montre donc QUI a répondu ET à quel quiz,
 * là où ApprenantHistorique connaît déjà l'apprenant et n'a besoin que du
 * quiz. Pas de détail par question dépliable ici : ce n'est pas ce qui a été
 * demandé, et l'écran par apprenant existe déjà pour ça.
 *
 * Filtre sur `results.pharmacy_id` — la graphie FIGÉE du jour de chaque
 * participation — jamais sur l'officine ACTUELLE des fiches apprenants : qui
 * a changé d'officine depuis garde ses anciennes réponses ici. Même décision
 * que le regroupement par officine de QuizResults.
 */
function OfficineHistorique({ officine, onRetour }) {
  const [historique, setHistorique] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const titreRef = useRef(null);

  // Voir ApprenantHistorique : seule la réponse portant le numéro courant est
  // retenue, pour ne pas laisser une requête périmée écraser la plus récente.
  const demandeRef = useRef(0);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  const charger = async (bornes) => {
    const n = ++demandeRef.current;
    setHistorique(null);
    setChargement(true);
    signaler('');
    setAnnonce('');
    try {
      const params = new URLSearchParams();
      if (bornes?.du) params.set('from', bornes.du);
      if (bornes?.au) params.set('to', bornes.au);
      if (params.toString()) {
        params.set('tzOffset', String(-new Date().getTimezoneOffset()));
      }
      const requete = params.toString();
      const res = await adminFetchOuReseau(
        `/api/pharmacies/${encodeURIComponent(officine.id)}/history${requete ? `?${requete}` : ''}`
      );
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'Les résultats n’ont pas pu être chargés.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !Array.isArray(data.evaluations) || !data.resume) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      if (n !== demandeRef.current) return;
      setHistorique(data);
      if (data.stockage) setStockage(data.stockage);
      const total = data.evaluations.length;
      const libelle = libellePeriode(data.periode?.from, data.periode?.to);
      setAnnonce(
        total === 0
          ? `Aucune réponse — ${libelle}.`
          : `${total} réponse${total > 1 ? 's' : ''} affichée${total > 1 ? 's' : ''} — ${libelle}.`
      );
    } catch (err) {
      if (n !== demandeRef.current) return;
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      if (n === demandeRef.current) setChargement(false);
    }
  };

  useEffect(() => {
    charger(null);
    return () => {
      demandeRef.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Export tableur. Le fichier porte EXACTEMENT ce qui est à l'écran, période
  // appliquée comprise : un formateur qui exporte après avoir filtré s'attend
  // au contenu filtré.
  const exporter = () => {
    if (!historique || historique.evaluations.length === 0) return;
    const echappe = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const lignes = [
      ['Apprenant', 'Quiz', 'Score', 'Sur', 'Pourcentage', 'Date'].map(echappe).join(';'),
      ...historique.evaluations.map((ev) =>
        [
          ev.playerName,
          ev.quizTitle,
          ev.score,
          ev.total,
          `${Math.round(ev.percent)}%`,
          formatJourHeure(ev.submittedAt),
        ]
          .map(echappe)
          .join(';')
      ),
    ].join('\r\n');

    const nom = `resultats-${String(officine.displayName)
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

  const evaluations = historique ? historique.evaluations : [];
  const libelle = historique
    ? libellePeriode(historique.periode?.from, historique.periode?.to)
    : '';
  // Une période est réellement en vigueur dès qu'une borne a été retenue par
  // le serveur — distingue « cette officine n'a jamais rien passé » de « la
  // fenêtre demandée est vide ».
  const bornee = !!(historique?.periode && (historique.periode.from || historique.periode.to));

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Officine</span>
        <h1 ref={titreRef} tabIndex={-1}>
          {officine.displayName}
        </h1>
        <p>Tous les quiz passés par ses apprenants, de la plus ancienne réponse à la plus récente.</p>
      </div>

      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces résultats ne sont pas conservés.</b> Ils disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}. Exportez
            ce qui compte avant d’en dépendre.
          </span>
        </p>
      )}

      <PeriodePicker
        onAppliquer={(du, au) => charger({ du, au })}
        onTout={() => charger(null)}
        onRefuser={(texte) => signaler(texte)}
      />

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && historique && (
        <>
          <div className="meta-row">
            <span>{libelle}</span>
            <span className="meta-row-sep" />
            <span>
              {historique.resume.attempts} réponse{historique.resume.attempts > 1 ? 's' : ''}
            </span>
            {historique.resume.avgPercent !== null && (
              <>
                <span className="meta-row-sep" />
                <span>Moyenne {Math.round(historique.resume.avgPercent)} %</span>
              </>
            )}
          </div>

          {evaluations.length === 0 ? (
            bornee ? (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">
                  <Icon name="search" size={22} width={1.6} />
                </span>
                <h2>Rien sur cette période</h2>
                <p>
                  {libelle} ne contient aucune réponse des apprenants de {officine.displayName}.
                  Rien n’est perdu : les autres périodes restent enregistrées.
                </p>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => charger(null)}
                >
                  Tout l’historique
                </button>
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">
                  <Icon name="info" size={22} width={1.6} />
                </span>
                <h2>Aucune réponse pour l’instant</h2>
                <p>
                  Dès qu’un apprenant de {officine.displayName} aura répondu à un quiz, ses
                  résultats apparaîtront ici.
                </p>
              </div>
            )
          ) : (
            <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
              {evaluations.map((ev) => (
                <div key={ev.resultId} className="recent-row recent-row--static">
                  <span className="recent-row-body">
                    <span className="recent-row-title">{ev.quizTitle}</span>
                    <span className="recent-row-meta">
                      {ev.playerName} · {formatJourHeure(ev.submittedAt)}
                    </span>
                  </span>
                  <span className="tag">
                    {ev.score} / {ev.total}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="split-actions">
        <button type="button" className="btn btn--ghost" onClick={onRetour}>
          <Icon name="arrowLeft" size={16} width={1.7} />
          Retour aux officines
        </button>
        {evaluations.length > 0 && (
          <button type="button" className="btn btn--ghost" onClick={exporter}>
            <Icon name="download" size={16} width={1.7} />
            Exporter (.csv)
          </button>
        )}
      </div>
    </div>
  );
}

export default OfficineHistorique;
