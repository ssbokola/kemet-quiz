import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon';
import DoublonsProbables from '../components/DoublonsProbables';
import AffecterOfficines from '../components/AffecterOfficines';
import OfficineHistorique from '../components/OfficineHistorique';
import { adminFetchOuReseau, adminJson, messageErreur, MESSAGE_RESEAU } from '../api';
import { phraseFusionOfficine } from '../nom';
import { formatJour } from '../dates';
import { useFocusAuMontage } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme partout ailleurs dans l'espace formateur : la recopie du
// montage ne change alors rien et n'entraîne aucun rendu supplémentaire.
const AUCUNE_ERREUR = { texte: '', n: 0 };

// Comparaison indifférente à la casse et aux accents pour le filtre de la
// liste — même intention que sansAccent (MesQuiz.jsx), dupliquée plutôt
// qu'importée : ce sont deux filtres sur deux types de titres différents, qui
// n'ont pas à évoluer ensemble.
function sansAccent(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Jamais « 0 apprenant » : le cas vide a sa propre phrase, comme
 * texteApprenants dans l'ancien Officines.jsx. */
function texteEffectif(n) {
  if (!n) return 'aucun apprenant rattaché';
  return `${n} apprenant${n > 1 ? 's' : ''}`;
}

function texteParticipations(n) {
  if (!n) return 'aucune participation';
  return `${n} participation${n > 1 ? 's' : ''}`;
}

/**
 * Statistiques d'une officine, dérivées de la liste des apprenants — aucune
 * route serveur ne les calcule pour une officine précise, et en ouvrir une
 * pour ce qui reste un agrégat de quelques dizaines de lignes serait
 * disproportionné. `attempts` d'un apprenant compte ses ÉVALUATIONS (voir
 * AnnuaireApprenants.jsx) ; la moyenne de l'officine est donc pondérée par ce
 * nombre, pas une simple moyenne des moyennes — un apprenant qui a répondu dix
 * fois ne doit pas peser autant que celui qui n'a répondu qu'une fois.
 */
function statsOfficine(officineId, apprenants) {
  const siens = apprenants.filter((a) => a.pharmacyId === officineId);
  const participations = siens.reduce((s, a) => s + (a.attempts || 0), 0);
  const avecMoyenne = siens.filter(
    (a) => typeof a.avgPercent === 'number' && (a.attempts || 0) > 0
  );
  const poids = avecMoyenne.reduce((s, a) => s + a.attempts, 0);
  const moyenne =
    poids > 0
      ? Math.round(avecMoyenne.reduce((s, a) => s + a.avgPercent * a.attempts, 0) / poids)
      : null;
  return { effectif: siens.length, participations, moyenne };
}

/**
 * « Officines » — écran maître-détail, index de l'espace formateur pour tout
 * ce qui touche aux officines (mockup « Direction retenue », 05 · Officines).
 *
 * À gauche, une liste FILTRABLE de toutes les officines, la plus fournie
 * d'abord (même tri que « Officines actives » du tableau de bord) ; à droite,
 * le détail de celle qu'on a choisie — son effectif, ses participations, sa
 * moyenne, puis le tableau de ses apprenants. Une seule officine peut être
 * choisie à la fois ; cliquer une autre ligne ne remonte PAS l'écran (pas de
 * remontage, donc pas de reprise de focus intempestive à chaque clic dans la
 * liste) — seule la disparition complète de cet écran (retour au tableau de
 * bord, ou aller-retour par un des trois flux profonds ci-dessous) en démonte
 * une instance et en remonte une autre.
 *
 * Les TROIS flux profonds — fusionner un doublon, affecter en masse, consulter
 * l'historique d'une officine — existaient déjà (DoublonsProbables paramétré,
 * AffecterOfficines, OfficineHistorique) : ce lot ne les recrée pas, il se
 * contente d'y naviguer, exactement comme Apprenants.jsx le faisait avant ce
 * lot. C'est de là qu'ils ont été déplacés : voir l'en-tête d'Apprenants.jsx,
 * qui documente pourquoi chaque vue doit être un TYPE de composant distinct
 * (c'est ce qui fait rejouer l'effet de focus au montage).
 *
 * L'ancien lien « Officines » de AnnuaireApprenants.jsx a disparu : il menait
 * ici, et cet écran a désormais son propre onglet dans la barre persistante.
 *
 * Renommer une officine n'a plus d'entrée dans l'interface depuis ce lot —
 * l'ancienne fiche (FicheOfficine.jsx) portait ce geste en plus de la fusion,
 * et seule la fusion a une place dans la disposition maître-détail demandée
 * ici. FicheOfficine.jsx et Officines.jsx (l'ancienne liste) restent dans le
 * dépôt, orphelins : voir le rapport de ce lot.
 */
function OfficinesEspace() {
  const [vue, setVue] = useState('liste'); // liste | doublons | affecter | historique
  // L'officine ouverte dans OfficineHistorique : { id, displayName }. Le nom
  // voyage avec l'identifiant pour que cette vue ait un titre dès son premier
  // rendu, avant même que sa requête ait répondu — même convention que partout
  // ailleurs dans l'espace formateur.
  const [officineHistorique, setOfficineHistorique] = useState(null);
  const [messageEntrant, setMessageEntrant] = useState('');
  // Voir Apprenants.jsx : force le remontage de DoublonsProbables après une
  // fusion pour que sa liste se recharge et que son focus se reprenne.
  const [rafraichir, setRafraichir] = useState(0);

  const ouvrirHistorique = (fiche) => {
    setOfficineHistorique(fiche);
    setVue('historique');
  };

  const aller = (suivante) => () => {
    setMessageEntrant('');
    setVue(suivante);
  };

  const apresFusionDoublon = (texte) => {
    setMessageEntrant(texte || '');
    setRafraichir((n) => n + 1);
    setVue('doublons');
  };

  // `vue` et `officineHistorique` sont toujours écrits ensemble : ce repli
  // n'est qu'un filet, comme dans Apprenants.jsx.
  let vueSure = vue;
  if (!officineHistorique && vue === 'historique') vueSure = 'liste';

  if (vueSure === 'historique') {
    return <OfficineHistorique officine={officineHistorique} onRetour={aller('liste')} />;
  }

  if (vueSure === 'doublons') {
    return (
      <DoublonsProbables
        key={`doublons-officines-${rafraichir}`}
        urlGroupes="/api/pharmacies/doublons"
        urlFusion={(sourceId) => `/api/pharmacies/${sourceId}/merge`}
        titre="Officines en double"
        description="Des fiches qui désignent peut-être la même officine. Rien n’est fusionné sans vous : vérifiez, puis réunissez-les."
        texteVideTitre="Aucun doublon probable"
        texteVideDescription="Chaque officine de l’annuaire semble distincte. Revenez ici après quelques affectations."
        libelleFicheAConserver="Officine à conserver"
        libelleARattacher="À rattacher"
        libelleRetour="Retour aux officines"
        libelleChargement="Recherche des doublons…"
        libelleConfirmer="Confirmer le rattachement"
        libelleAction="Rattacher"
        compter={(n) => `${n} apprenant${n > 1 ? 's' : ''}`}
        phrase={phraseFusionOfficine}
        interpreterReponseFusion={(data, source, cible) => {
          if (!data || !Number.isFinite(data.movedLearners) || !Number.isFinite(data.movedResults)) {
            return null;
          }
          const nA = data.movedLearners;
          const nR = data.movedResults;
          return (
            `${nA} apprenant${nA > 1 ? 's' : ''} déplacé${nA > 1 ? 's' : ''} vers l’officine de ` +
            `${cible.displayName} (${nR} participation${nR > 1 ? 's' : ''}). ` +
            `L’officine de ${source.displayName} a été fusionnée.`
          );
        }}
        onRetour={aller('liste')}
        onFusion={apresFusionDoublon}
        messageEntrant={messageEntrant}
      />
    );
  }

  if (vueSure === 'affecter') {
    return (
      <AffecterOfficines
        onRetour={aller('liste')}
        onAffectees={(texte) => {
          setMessageEntrant(texte || '');
          setVue('liste');
        }}
      />
    );
  }

  return (
    <OfficinesMasterDetail
      onDoublons={aller('doublons')}
      onAffecter={aller('affecter')}
      onHistorique={ouvrirHistorique}
      messageEntrant={messageEntrant}
    />
  );
}

/**
 * La disposition maître-détail elle-même. Composant DISTINCT du reste de
 * l'aiguillage ci-dessus (voir l'en-tête du fichier) : à chaque retour depuis
 * l'un des trois flux profonds, React le remonte, ce qui recharge les
 * données et reprend le focus sur son titre.
 */
function OfficinesMasterDetail({ onDoublons, onAffecter, onHistorique, messageEntrant = '' }) {
  const [officines, setOfficines] = useState(null);
  const [apprenants, setApprenants] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState(messageEntrant);
  const [filtre, setFiltre] = useState('');
  // `null` tant qu'on n'a rien choisi soi-même : la sélection RÉELLEMENT
  // affichée (`officineActuelleId` plus bas) retombe alors sur la première de
  // la liste triée, sans code d'initialisation séparé ni effet supplémentaire.
  const [selectionId, setSelectionId] = useState(null);
  const [nomNouvelle, setNomNouvelle] = useState('');
  const [ajout, setAjout] = useState(false);
  const titreRef = useRef(null);
  const nomRef = useRef(null);

  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  useFocusAuMontage(titreRef);

  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  // Un seul point de lecture, comme lireAnnuaire dans les écrans jumeaux :
  // le montage et le retour d'un ajout affichent forcément la même chose.
  const charger = async () => {
    const [dataP, dataL] = await Promise.all([
      adminJson('/api/pharmacies', { repli: 'La liste des officines n’a pas pu être chargée.' }),
      adminJson('/api/learners', { repli: 'La liste des apprenants n’a pas pu être chargée.' }),
    ]);
    if (!Array.isArray(dataP.pharmacies) || !Array.isArray(dataL.learners)) {
      throw new Error('Le serveur a renvoyé une réponse inattendue.');
    }
    return {
      pharmacies: dataP.pharmacies,
      learners: dataL.learners,
      stockage: dataP.stockage || dataL.stockage || null,
    };
  };

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await charger();
        if (annule) return;
        setOfficines(data.pharmacies);
        setApprenants(data.learners);
        setStockage(data.stockage);
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

  // Les plus fournies d'abord — même lecture que « Officines actives » du
  // tableau de bord : c'est ce qu'un formateur veut voir en premier ici.
  const officinesTriees = useMemo(() => {
    if (!officines || !apprenants) return null;
    return [...officines].sort((a, b) => {
      const ea = statsOfficine(a.id, apprenants).effectif;
      const eb = statsOfficine(b.id, apprenants).effectif;
      if (eb !== ea) return eb - ea;
      return a.displayName.localeCompare(b.displayName, 'fr');
    });
  }, [officines, apprenants]);

  const officinesFiltrees = useMemo(() => {
    if (!officinesTriees) return null;
    const q = sansAccent(filtre.trim());
    if (!q) return officinesTriees;
    return officinesTriees.filter((o) => sansAccent(o.displayName).includes(q));
  }, [officinesTriees, filtre]);

  // Dérivé, jamais synchronisé par un effet : si `selectionId` est encore nul,
  // ou s'il désignait une officine qui a disparu depuis (fusionnée par
  // exemple), on retombe sur la première de la liste triée — dès le premier
  // rendu qui suit le chargement, sans un rendu intermédiaire « rien de
  // sélectionné ».
  const officineActuelleId =
    selectionId && officines && officines.some((o) => o.id === selectionId)
      ? selectionId
      : officinesTriees && officinesTriees[0]
        ? officinesTriees[0].id
        : null;
  const officineActuelle = officines
    ? officines.find((o) => o.id === officineActuelleId) || null
    : null;
  const statsActuelle = officineActuelle && apprenants
    ? statsOfficine(officineActuelle.id, apprenants)
    : null;
  const apprenantsActuels =
    officineActuelle && apprenants
      ? apprenants
          .filter((a) => a.pharmacyId === officineActuelle.id)
          .sort((a, b) => {
            const da = a.lastSubmittedAt || '';
            const db = b.lastSubmittedAt || '';
            if (da !== db) return da < db ? 1 : -1;
            return String(a.displayName).localeCompare(String(b.displayName), 'fr');
          })
      : [];

  const totalRattaches = apprenants ? apprenants.filter((a) => a.pharmacyId).length : 0;
  const sousTitre =
    officines && apprenants
      ? `${officines.length} officine${officines.length > 1 ? 's' : ''} · ${totalRattaches} apprenant${
          totalRattaches > 1 ? 's' : ''
        } rattaché${totalRattaches > 1 ? 's' : ''}`
      : 'Choisissez une officine pour voir ses apprenants, la fusionner avec une autre, ou consulter ses résultats.';

  const ajouterOfficine = async (event) => {
    event.preventDefault();
    if (ajout) {
      signaler('L’ajout est déjà en cours. Attendez qu’il se termine, puis réessayez.');
      return;
    }
    const propre = nomNouvelle.trim();
    setAnnonce('');
    if (!propre) {
      signaler('Saisissez le nom de l’officine avant d’ajouter la fiche.');
      nomRef.current?.focus();
      return;
    }

    setAjout(true);
    signaler('');
    try {
      const res = await adminFetchOuReseau('/api/pharmacies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: propre }),
      });
      // 409 : la fiche existe déjà. On la sélectionne directement — inutile
      // d'offrir un lien « ouvrir la fiche » comme l'ancien Officines.jsx, la
      // sélectionner ICI est déjà l'ouvrir.
      if (res.status === 409) {
        const conflit = await res.json().catch(() => null);
        if (conflit && conflit.pharmacy) setSelectionId(conflit.pharmacy.id);
        throw new Error(
          conflit && conflit.pharmacy
            ? `Une officine existe déjà sous ce nom : ${conflit.pharmacy.displayName}. La voici sélectionnée ci-dessous.`
            : 'Une officine existe déjà sous ce nom.'
        );
      }
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'L’officine n’a pas pu être créée.'));
      }
      const data = await res.json().catch(() => null);
      if (!data || !data.pharmacy) {
        throw new Error('Le serveur a renvoyé une réponse inattendue.');
      }
      setNomNouvelle('');
      setAnnonce(`Officine « ${data.pharmacy.displayName} » ajoutée à l’annuaire.`);
      const suite = await charger();
      setOfficines(suite.pharmacies);
      setApprenants(suite.learners);
      setStockage(suite.stockage);
      // La nouvelle officine est celle qu'on veut voir, pas nécessairement la
      // première de la liste triée par effectif (elle en est à 0).
      setSelectionId(data.pharmacy.id);
    } catch (err) {
      signaler(err?.message || MESSAGE_RESEAU);
    } finally {
      setAjout(false);
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1 ref={titreRef} tabIndex={-1}>
          Officines
        </h1>
        <p>{sousTitre}</p>
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

      {/* Une seule région polie sur l'écran, comme partout ailleurs. */}
      <p className="sr-only" role="status" aria-atomic="true">
        {annonce}
      </p>

      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces fiches ne sont pas conservées.</b> Elles disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && officines && (
        <>
          <form className="field" onSubmit={ajouterOfficine}>
            <label className="field-label" htmlFor="officine-nouvelle-nom">
              Nouvelle officine
            </label>
            <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
              <input
                id="officine-nouvelle-nom"
                ref={nomRef}
                type="text"
                className="input"
                style={{ flex: '1 1 220px', minWidth: 0 }}
                value={nomNouvelle}
                onChange={(e) => setNomNouvelle(e.target.value)}
                placeholder="Ex. Pharmacie Meydeba"
              />
              <button type="submit" className="btn btn--ink btn--sm" aria-busy={ajout}>
                {ajout ? 'Patientez…' : 'Ajouter'}
              </button>
            </div>
          </form>

          {officines.length === 0 && (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">
                <Icon name="list" size={22} width={1.6} />
              </span>
              <h2>Aucune officine pour l’instant</h2>
              <p>
                Ajoutez vos pharmacies clientes ci-dessus. Vous pourrez ensuite y rattacher vos
                apprenants — les nouveaux la choisiront eux-mêmes en passant un quiz.
              </p>
            </div>
          )}

          {officines.length > 0 && (
            <div className="officines-layout">
              {/* Maître : liste filtrable, la sélection courante mise en
                  valeur par une étiquette — même idiome que la sélection
                  d'AffecterOfficines.jsx, pour ne rien inventer de neuf. */}
              <div className="stack--tight">
                <div className="field">
                  <label className="field-label" htmlFor="officines-filtre">
                    Filtrer les officines
                  </label>
                  <input
                    id="officines-filtre"
                    type="search"
                    className="input"
                    value={filtre}
                    onChange={(e) => setFiltre(e.target.value)}
                    placeholder="Nom de l’officine"
                    autoComplete="off"
                  />
                </div>

                <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
                  {officinesFiltrees && officinesFiltrees.length === 0 ? (
                    <p className="subtle">Aucune officine ne correspond.</p>
                  ) : (
                    officinesFiltrees.map((o) => {
                      const stats = statsOfficine(o.id, apprenants);
                      const estActuelle = o.id === officineActuelleId;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          className="recent-row"
                          aria-current={estActuelle ? 'true' : undefined}
                          onClick={() => setSelectionId(o.id)}
                        >
                          <span className="recent-row-body">
                            <span className="recent-row-title">{o.displayName}</span>
                            <span className="recent-row-meta">
                              {stats.effectif > 0
                                ? `${texteEffectif(stats.effectif)}${
                                    stats.moyenne !== null ? ` · ${stats.moyenne} %` : ''
                                  }`
                                : texteEffectif(0)}
                            </span>
                          </span>
                          {estActuelle && <span className="tag">Sélectionnée</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Détail : l'officine choisie, puis ses apprenants. */}
              {officineActuelle && (
                <div className="stack">
                  <div className="field-row">
                    <h2 className="officine-detail-titre">{officineActuelle.displayName}</h2>
                    {onDoublons && (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={onDoublons}>
                        Fusionner un doublon…
                      </button>
                    )}
                  </div>

                  <div className="meta-row">
                    <span>{texteEffectif(statsActuelle.effectif)}</span>
                    <span className="meta-row-sep" />
                    <span>{texteParticipations(statsActuelle.participations)}</span>
                    {statsActuelle.moyenne !== null && (
                      <>
                        <span className="meta-row-sep" />
                        <span>Moyenne {statsActuelle.moyenne} %</span>
                      </>
                    )}
                  </div>

                  {(onAffecter || onHistorique) && (
                    <div className="tag-row">
                      {onAffecter && (
                        <button type="button" className="app-bar-link" onClick={onAffecter}>
                          <Icon name="edit" size={15} width={1.7} />
                          Affecter en masse
                        </button>
                      )}
                      {onHistorique && (
                        <button
                          type="button"
                          className="app-bar-link"
                          onClick={() =>
                            onHistorique({
                              id: officineActuelle.id,
                              displayName: officineActuelle.displayName,
                            })
                          }
                        >
                          <Icon name="chart" size={15} width={1.7} />
                          Voir les résultats de cette officine
                        </button>
                      )}
                    </div>
                  )}

                  {apprenantsActuels.length === 0 ? (
                    <div className="empty-state">
                      <span className="empty-state-icon" aria-hidden="true">
                        <Icon name="info" size={22} width={1.6} />
                      </span>
                      <h2>Aucun apprenant rattaché</h2>
                      <p>
                        Dès qu’un apprenant choisira {officineActuelle.displayName} en passant un
                        quiz, ou que vous l’y affecterez avec « Affecter en masse », il apparaîtra
                        ici.
                      </p>
                    </div>
                  ) : (
                    <div className="card" style={{ overflow: 'hidden' }}>
                      <div className="quiz-table-scroll">
                        <table className="quiz-table">
                          <thead>
                            <tr>
                              <th scope="col">
                                <span className="eyebrow">Apprenant</span>
                              </th>
                              <th scope="col">
                                <span className="eyebrow">Quiz passés</span>
                              </th>
                              <th scope="col">
                                <span className="eyebrow">Moyenne</span>
                              </th>
                              <th scope="col">
                                <span className="eyebrow">Dernier passage</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {apprenantsActuels.map((a) => (
                              <tr key={a.id}>
                                <td className="recent-row-title">{a.displayName}</td>
                                <td>{a.attempts || 0}</td>
                                <td>
                                  {typeof a.avgPercent === 'number' ? (
                                    <span className="apprenant-note">
                                      {Math.round(a.avgPercent)} %
                                    </span>
                                  ) : (
                                    <span className="subtle">—</span>
                                  )}
                                </td>
                                <td className="subtle">
                                  {a.lastSubmittedAt ? formatJour(a.lastSubmittedAt) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default OfficinesEspace;
