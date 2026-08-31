import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import PeriodePicker from './PeriodePicker';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { chargerReponses } from '../quiz-api';
import { formatJourHeure, libellePeriode } from '../dates';

// Aucune erreur. Partagée par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme dans QuizResults et UploadPDF : la recopie du montage ne
// change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Excel en configuration française lit un .csv en ANSI par défaut : sans cette
// marque d'ordre des octets, « août » ressortirait en « aoÃ»t ». Écrite en
// séquence échappée et non en caractère littéral, qui serait invisible dans la
// source et se perdrait à la première normalisation de fichier.
const BOM_UTF8 = '\u{FEFF}';

/**
 * Historique d'un apprenant — espace formateur uniquement.
 *
 * On dit « apprenant » et non « stagiaire » : la même officine forme des
 * stagiaires, des auxiliaires embauchés et parfois des pharmaciens.
 *
 * L'écran s'ouvre SANS période : deux champs vides, donc tout l'historique. Une
 * période pré-remplie (le mois en cours, les trente derniers jours) masquerait
 * des évaluations dès le premier écran, et c'est un piège pour quelqu'un qui
 * n'est pas informaticien : il croirait l'apprenant inactif alors qu'il lit une
 * fenêtre qu'il n'a pas choisie.
 */
function ApprenantHistorique({ apprenant, onRetour }) {
  // La charge utile du serveur, telle quelle : learner, periode, evaluations,
  // resume. Nulle tant que rien n'a été chargé, et remise à zéro avant chaque
  // requête pour qu'un échec n'affiche jamais les chiffres de la période
  // précédente sous le message d'erreur de la nouvelle.
  const [historique, setHistorique] = useState(null);
  // Le bandeau de stockage survit aux échecs : c'est une propriété du serveur,
  // pas de la requête. On ne le retire donc que si le serveur cesse de l'envoyer.
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  // Le détail dépliable d'une évaluation : { [resultId]: 'chargement' | [] }.
  // Chargé À LA DEMANDE — un historique de vingt évaluations ne doit pas tirer
  // vingt requêtes pour un détail que le formateur ne regardera peut-être pas.
  const [details, setDetails] = useState({});
  const [ouverte, setOuverte] = useState(null);
  const titreRef = useRef(null);

  // Numéro de la demande en cours. Le sélecteur de période permet d'enchaîner
  // les requêtes (une période, puis « tout l'historique » aussitôt après) : si
  // la première répond APRÈS la seconde, elle écraserait la plus récente et
  // l'écran mentirait. Seule la réponse qui porte le numéro courant est retenue.
  // Le démontage remet le compteur à 0, numéro qu'aucune demande ne porte : les
  // réponses encore en vol sont alors toutes ignorées.
  const demandeRef = useRef(0);

  // Seule porte d'écriture de l'erreur : le numéro d'occurrence s'incrémente à
  // CHAQUE appel, effacement compris. Deux échecs identiques d'affilée — deux
  // périodes appliquées coup sur coup, serveur toujours muet — doivent être
  // annoncés deux fois. Ne jamais appeler setErreur directement.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre au montage. L'écran précédent (la liste des apprenants) est démonté
  // avec l'élément qui portait le focus ; sans reprise, le focus retombe sur
  // <body>. Le focus va au TITRE, jamais au message d'erreur : celui-ci vit dans
  // une région role="alert" et serait annoncé deux fois.
  useEffect(() => {
    titreRef.current?.focus();
  }, []);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  /**
   * Charge l'historique. `bornes` vaut null pour tout l'historique, ou
   * { du, au } — deux dates AAAA-MM-JJ saisies par le formateur, dont l'une
   * peut être vide si le sélecteur n'en donne qu'une (« depuis le 1er mars »).
   */
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
      // tzOffset = minutes à l'est de UTC. Envoyé dès qu'une borne existe, et
      // seulement là : c'est lui qui fait tomber « le 3 mars » sur la journée du
      // formateur et non sur celle d'UTC — sans quoi une évaluation de 23 h
      // basculerait la veille et disparaîtrait de la période demandée. Le test
      // porte sur les paramètres DÉJÀ posés, donc sur la présence d'une borne.
      if (params.toString()) {
        params.set('tzOffset', String(-new Date().getTimezoneOffset()));
      }
      const requete = params.toString();
      const res = await adminFetchOuReseau(
        `/api/learners/${encodeURIComponent(apprenant.id)}/history${requete ? `?${requete}` : ''}`
      );
      // Le statut se teste AVANT toute lecture du corps : messageErreur consomme
      // la réponse et un corps ne se lit qu'une fois. C'est aussi ce qui évite
      // l'erreur d'analyse JSON quand l'API est arrêtée et que le proxy renvoie
      // une page HTML. Un 503 (mot de passe formateur non configuré) ressort
      // avec la phrase du serveur, telle quelle.
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'L’historique n’a pas pu être chargé.'));
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
          ? `Aucune évaluation — ${libelle}.`
          : `${total} évaluation${total > 1 ? 's' : ''} affichée${total > 1 ? 's' : ''} — ${libelle}.`
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

  // Export tableur. Le point-virgule est le séparateur attendu par Excel en
  // configuration française ; les guillemets se protègent en les doublant ; les
  // lignes se terminent par \r\n. Le fichier porte EXACTEMENT ce qui est à
  // l'écran, période appliquée comprise : un formateur qui exporte après avoir
  // filtré s'attend au contenu filtré.
  /**
   * Déplie une évaluation, et charge son détail à la PREMIÈRE ouverture
   * seulement — ensuite il est en mémoire, replier puis rouvrir ne coûte rien.
   *
   * Un échec ne remonte PAS dans la région d'alerte de l'écran : le formateur
   * a demandé un complément, pas une opération. On déplie sur un détail vide,
   * qui dit lui-même qu'il n'y a rien à montrer.
   */
  const basculerDetail = async (resultId) => {
    if (ouverte === resultId) {
      setOuverte(null);
      return;
    }
    setOuverte(resultId);
    if (details[resultId] !== undefined && details[resultId] !== 'chargement') return;
    setDetails((prec) => ({ ...prec, [resultId]: 'chargement' }));
    try {
      const data = await chargerReponses(resultId);
      setDetails((prec) => ({
        ...prec,
        [resultId]: Array.isArray(data.reponses) ? data.reponses : [],
      }));
    } catch {
      setDetails((prec) => ({ ...prec, [resultId]: [] }));
    }
  };

  const exporter = () => {
    if (!historique || historique.evaluations.length === 0) return;
    const echappe = (v) => `"${String(v).replace(/"/g, '""')}"`;
    // Officine : la graphie du JOUR, figée sur chaque évaluation — voir
    // pharmacyName dans listLearnerHistory. Deux lignes du même apprenant
    // peuvent donc montrer deux officines différentes s'il en a changé entre
    // temps ; c'est voulu, pas une incohérence à corriger.
    const lignes = [
      ['Quiz', 'Officine', 'Score', 'Sur', 'Pourcentage', 'Date'].map(echappe).join(';'),
      ...historique.evaluations.map((ev) =>
        [
          ev.quizTitle,
          ev.pharmacyName || '',
          ev.score,
          ev.total,
          `${Math.round(ev.percent)}%`,
          formatJourHeure(ev.submittedAt),
        ]
          .map(echappe)
          .join(';')
      ),
    ].join('\r\n');

    const nom = `historique-${String(apprenant.displayName)
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
  // Une période est réellement en vigueur dès qu'une borne a été retenue par le
  // serveur : c'est ce qui distingue « cet apprenant n'a jamais rien passé » de
  // « la fenêtre demandée est vide », deux phrases qui ne se répondent pas.
  const bornee = !!(historique?.periode && (historique.periode.from || historique.periode.to));

  return (
    <div className="stack">
      <div className="page-head">
        <span className="eyebrow">Apprenant</span>
        {/* Le nom vient de la prop et non de la réponse : il est déjà exact, et
            un titre qui changerait après le chargement serait ré-annoncé alors
            qu'il porte le focus. */}
        <h1 ref={titreRef} tabIndex={-1}>
          {apprenant.displayName}
        </h1>
        <p>Ses évaluations, de la plus ancienne à la plus récente.</p>
      </div>

      {/* Une région d'alerte, montée en permanence, remplie au commit suivant.
          Garder la forme ternaire : `{annoncee.texte && …}` avec une chaîne vide
          laisserait un nœud texte et casserait .error-slot:empty. La `key` porte
          le numéro d'occurrence, sans quoi un refus identique répété ne muterait
          pas le DOM et ne serait annoncé nulle part. */}
      <div className="error-slot" role="alert" aria-atomic="true">
        {annoncee.texte ? (
          <p className="error-msg" key={annoncee.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{annoncee.texte}</span>
          </p>
        ) : null}
      </div>

      {/* Unique région polie de l'écran : chargements et export. Le sélecteur de
          période n'en a pas — il remonte ses refus par onRefuser, qui les écrit
          dans la région d'alerte ci-dessus. Deux régions live sur un écran se
          couvrent l'une l'autre. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {/* L'avertissement va là où il compte : devant les données concernées, et
          non dans les journaux de démarrage que personne ne lit. */}
      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Cet historique n’est pas conservé.</b> Il disparaîtra au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
            Exportez ce qui compte avant d’en dépendre.
          </span>
        </p>
      )}

      {/* PeriodePicker remonte DEUX arguments positionnels — voir sa signature
          en en-tête : « @param onAppliquer (du, au) ». Les déstructurer comme
          un objet rendait `du` et `au` indéfinis, et le bouton « Afficher la
          période » ne filtrait alors jamais rien. */}
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
          {/* Le nombre d'évaluations ne quitte JAMAIS la moyenne. Celle-ci est
              la moyenne des pourcentages, non pondérée : chaque évaluation y
              pèse pareil, un 0/3 autant qu'un 0/30. Elle est donc fragile sur
              peu d'évaluations, et l'afficher seule laisserait croire à une
              tendance là où il n'y a qu'un ou deux résultats. */}
          <div className="meta-row">
            <span>{libelle}</span>
            <span className="meta-row-sep" />
            <span>
              {historique.resume.attempts} évaluation{historique.resume.attempts > 1 ? 's' : ''}
            </span>
            {/* avgPercent vaut null — jamais 0 — quand il n'y a aucune
                participation : sans évaluation il n'y a pas de moyenne nulle,
                il n'y a pas de moyenne. */}
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
                {/* Ne jamais dire « aucune évaluation » tout court : le
                    formateur qui a mal saisi une date doit comprendre en une
                    seconde que ses données sont intactes, et pouvoir revenir à
                    tout l'historique sans retraverser l'écran. */}
                <p>
                  {libelle} ne contient aucune évaluation de {apprenant.displayName}. Rien n’est
                  perdu : ses autres évaluations sont toujours enregistrées.
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
                <h2>Aucune évaluation pour l’instant</h2>
                <p>
                  Dès que {apprenant.displayName} aura répondu à un quiz, ses résultats
                  apparaîtront ici.
                </p>
              </div>
            )
          ) : (
            <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
              {evaluations.map((ev, i) => {
                const pourcent = Math.round(ev.percent);
                const id = ev.resultId;
                const estOuverte = ouverte === id;
                const detail = details[id];
                return (
                  <div key={i}>
                    {/* La ligne est désormais CLIQUABLE : il existe enfin
                        quelque chose derrière une évaluation — le détail des
                        réponses, question par question. Elle ne l'était pas
                        tant que ce détail était jeté. */}
                    <button
                      type="button"
                      className="apprenant-ligne apprenant-ligne--depliable"
                      aria-expanded={estOuverte}
                      aria-controls={`detail-${id}`}
                      onClick={() => basculerDetail(id)}
                    >
                      <span className="recent-row-body">
                        <span className="recent-row-title">{ev.quizTitle}</span>
                        <span className="recent-row-meta">{formatJourHeure(ev.submittedAt)}</span>
                      </span>
                      {/* Barre DÉCORATIVE : elle ne dit rien que .apprenant-note
                          ne dise déjà en toutes lettres, d'où aria-hidden — sans
                          quoi le même score serait lu deux fois. Aucune couleur
                          introduite ici : .bar-fill porte la sienne, documentée à
                          3,46:1 contre la piste .bar (WCAG 1.4.11). */}
                      <span className="bar" aria-hidden="true">
                        <span className="bar-fill" style={{ width: `${pourcent}%` }} />
                      </span>
                      <span className="apprenant-note">
                        {ev.score} / {ev.total} · {pourcent} %
                      </span>
                      {/* Chevron PROPRE à cette ligne, et non .disclosure-chevron :
                          celui-là se place en grid-column 2 / grid-row 1 span 2,
                          ce qui le mettrait sur la note. */}
                      <Icon name="chevronDown" size={16} className="apprenant-chevron" />
                    </button>

                    {/* Toujours rendu, seul `hidden` bascule : aria-controls doit
                        désigner un élément existant dans les deux états. Même
                        motif que le tiroir « Diffusion du lien ». */}
                    <div id={`detail-${id}`} className="apprenant-detail" hidden={!estOuverte}>
                      {detail === 'chargement' && (
                        <p className="question-stat-meta">Chargement du détail…</p>
                      )}
                      {Array.isArray(detail) && detail.length === 0 && (
                        <p className="question-stat-meta">
                          Le détail n’a pas été conservé pour cette évaluation : elle est
                          antérieure à la mise en place de cette fonction. Seul le score existe.
                        </p>
                      )}
                      {Array.isArray(detail) &&
                        detail.map((r) => (
                          <div key={r.questionIndex} className="reponse-ligne">
                            <span
                              className={`reponse-verdict reponse-verdict--${
                                r.isCorrect ? 'juste' : 'faux'
                              }`}
                            >
                              <Icon
                                name={r.isCorrect ? 'check' : 'close'}
                                size={15}
                                width={2.4}
                              />
                              {/* Le verdict est aussi ÉCRIT, pas seulement
                                  porté par une icône et une couleur. */}
                              <span className="sr-only">
                                {r.isCorrect ? 'Juste :' : 'Faux :'}
                              </span>
                            </span>
                            <span className="reponse-corps">
                              <span className="reponse-question">
                                Q{r.questionIndex + 1}. {r.questionText}
                              </span>
                              {!r.isCorrect && (
                                <span className="question-stat-meta">
                                  {r.given
                                    ? `A répondu : ${r.givenLabel || r.given}`
                                    : 'N’a pas répondu'}
                                  {' — '}
                                  attendu : {r.correctLabel || r.correctAnswer}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <div className="split-actions">
        <button type="button" className="btn btn--ghost" onClick={onRetour}>
          <Icon name="arrowLeft" size={16} width={1.7} />
          Tous les apprenants
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

export default ApprenantHistorique;
