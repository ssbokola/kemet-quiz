import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { adminFetchOuReseau, messageErreur, MESSAGE_RESEAU } from '../api';
import { formatJour } from '../dates';
import { useFocusAuMontage } from '../ecran';

// Aucune erreur. Partagé par les deux états pour qu'ils démarrent sur la MÊME
// référence, comme dans QuizResults : la recopie du montage ne change alors rien.
const AUCUNE_ERREUR = { texte: '', n: 0 };

/** Accord au pluriel du mot « évaluation », employé partout sur cet écran. */
function evaluations(n) {
  return `${n} évaluation${n > 1 ? 's' : ''}`;
}

/**
 * Moyenne arrondie, ou `null` quand il n'y a rien à montrer.
 *
 * Le serveur renvoie `avgPercent: null` — jamais 0 — quand `attempts` vaut 0 :
 * une absence de données n'est pas une note de zéro, et l'afficher « 0 % »
 * accuserait un apprenant qui n'a simplement rien passé. Les deux champs sont
 * vérifiés, pas seulement l'un des deux : un `avgPercent` manquant sur une fiche
 * qui compte des participations reste une absence de moyenne, et il vaut mieux
 * le dire que de rendre « NaN % ».
 */
function moyenneArrondie(apprenant) {
  if (!(apprenant.attempts > 0)) return null;
  const v = apprenant.avgPercent;
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Date au format court, ou chaîne vide si elle est absente ou illisible. */
function jour(iso) {
  return iso ? formatJour(iso) || '' : '';
}

/**
 * Tout ce qu'une ligne doit dire, calculé en un seul endroit : la pastille, la
 * ligne de contexte, l'étiquette de droite et le nom accessible du bouton.
 *
 * Le nom accessible est posé en `aria-label` : il REMPLACE le contenu textuel de
 * la ligne pour un lecteur d'écran, il doit donc reprendre tout ce que l'œil y
 * lit — le nom, le nombre d'évaluations, la moyenne et la mise en quarantaine —
 * sinon ces informations disparaîtraient pour qui n'a pas l'écran.
 */
function decrireApprenant(apprenant) {
  const nom = String(apprenant.displayName || '').trim();
  // Array.from et non charAt : sur un prénom commençant par un caractère hors
  // du plan multilingue de base, charAt couperait la paire de substitution en
  // deux et rendrait un losange noir.
  const initiale = (Array.from(nom)[0] || '?').toUpperCase();

  const attempts = Number.isFinite(apprenant.attempts) ? apprenant.attempts : 0;
  const moyenne = moyenneArrondie(apprenant);
  const enQuarantaine = apprenant.suggestible === false;

  // Ligne de contexte. Sans participation, la date de dernière évaluation
  // n'existe pas : on donne celle de création de la fiche, qui est la seule
  // information vraie dont on dispose.
  const derniere = jour(apprenant.lastSubmittedAt);
  const creation = jour(apprenant.createdAt);
  const meta =
    attempts === 0
      ? creation
        ? `Fiche créée le ${creation}`
        : 'Aucune participation enregistrée'
      : [evaluations(attempts), derniere ? `dernière le ${derniere}` : '']
          .filter(Boolean)
          .join(' · ');

  // Étiquette de droite. Trois cas distincts, jamais confondus : pas encore
  // d'évaluation, une moyenne, ou une moyenne que le serveur n'a pas donnée.
  const tag =
    attempts === 0 ? 'Aucune évaluation' : moyenne !== null ? `${moyenne} %` : 'Moyenne indisponible';

  // Un aria-label REMPLACE tout le contenu de la ligne : ce qu'il omet
  // disparaît purement et simplement pour qui n'a pas l'écran. La ligne de
  // contexte — date de dernière évaluation, ou date de création — est affichée
  // à l'œil : elle doit donc figurer ici aussi, sans quoi deux apprenants au
  // même score seraient indiscernables au clavier.
  const parties = [nom || 'Apprenant sans nom'];
  if (attempts === 0) {
    parties.push('aucune évaluation');
  } else {
    parties.push(evaluations(attempts));
    parties.push(moyenne !== null ? `moyenne ${moyenne} %` : 'moyenne indisponible');
  }
  // On n'ajoute QUE la partie datée de la ligne de contexte : le nombre
  // d'évaluations y figure déjà, et reprendre `meta` en entier le dirait deux
  // fois. Sans cette date, deux apprenants au même score seraient pourtant
  // indiscernables au clavier, alors qu'ils se distinguent à l'œil.
  if (attempts === 0 && creation) parties.push(`fiche créée le ${creation}`);
  if (attempts > 0 && derniere) parties.push(`dernière le ${derniere}`);
  if (enQuarantaine) parties.push('fiche non suggérée');

  return { initiale, meta, tag, enQuarantaine, aria: parties.join(', ') };
}

/**
 * Écran « Apprenants » — espace formateur uniquement.
 *
 * Il liste tous les apprenants connus avec leur moyenne et leur nombre
 * d'évaluations ; on clique un nom pour ouvrir son historique détaillé, qui
 * porte lui le filtre par période. C'est pourquoi cet appel-ci se fait SANS
 * `from`/`to` : cette liste montre tout l'historique, sans quoi la moyenne
 * affichée ici et celle de l'écran suivant ne parleraient pas de la même chose.
 *
 * On dit « apprenant » et non « stagiaire » : la même officine forme des
 * stagiaires, des auxiliaires embauchés et parfois des pharmaciens.
 */
function ApprenantsListe({ onOuvrir, onAnnuaire, onBack }) {
  const [liste, setListe] = useState(null);
  const [stockage, setStockage] = useState(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(AUCUNE_ERREUR);
  const [annoncee, setAnnoncee] = useState(AUCUNE_ERREUR);
  const [annonce, setAnnonce] = useState('');
  const [recherche, setRecherche] = useState('');
  const titreRef = useRef(null);

  // Le numéro d'occurrence s'incrémente à CHAQUE écriture, effacement compris :
  // deux échecs identiques d'affilée doivent être annoncés deux fois. Ne jamais
  // appeler setErreur directement.
  const signaler = (texte) => setErreur((prec) => ({ texte, n: prec.n + 1 }));

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre au montage. L'écran précédent est démonté avec l'élément focalisé.
  // Le focus va au TITRE, jamais au message d'erreur : celui-ci vit dans une
  // région role="alert" et serait sinon annoncé deux fois.
  //
  // Garde partagée depuis que /formateur/apprenants existe : cette vue est
  // celle qui s'ouvre par défaut, elle peut donc être la première montée au
  // chargement du document — et prendre le focus alors serait le voler.
  useFocusAuMontage(titreRef);

  // Aucun message n'est rendu dans le commit qui monte sa région : une région
  // live qui naît AVEC son texte n'est pas annoncée de façon fiable.
  useEffect(() => {
    setAnnoncee(erreur);
  }, [erreur]);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      try {
        // Sans période : voir l'en-tête du composant.
        const res = await adminFetchOuReseau('/api/learners');
        // Le statut est contrôlé AVANT toute lecture du corps : `messageErreur`
        // consomme la réponse et un corps ne se lit qu'une fois. C'est aussi ce
        // qui évite l'erreur d'analyse JSON quand l'API est arrêtée — le proxy
        // renvoie alors une page d'erreur qui n'est pas du JSON.
        if (!res.ok) {
          throw new Error(
            await messageErreur(res, 'La liste des apprenants n’a pas pu être chargée.')
          );
        }
        const data = await res.json().catch(() => null);
        if (annule) return;
        if (!data || !Array.isArray(data.learners)) {
          throw new Error('Le serveur a renvoyé une réponse inattendue.');
        }
        // Le serveur rend déjà la liste triée : la retrier ici ferait diverger
        // l'ordre affiché de l'ordre voulu par le serveur, sans que rien ne le
        // signale.
        setListe(data.learners);
        setStockage(data.stockage || null);
        const n = data.learners.length;
        setAnnonce(
          n === 0
            ? 'Aucun apprenant pour l’instant.'
            : `${n} apprenant${n > 1 ? 's' : ''} affiché${n > 1 ? 's' : ''}.`
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
  }, []);

  // Sous-titre. Tant que la liste n'est pas chargée on ne peut pas annoncer un
  // nombre : on dit ce que fait l'écran plutôt que d'écrire « 0 apprenant »,
  // qui serait faux pendant tout le chargement. Une liste vide garde la même
  // phrase : c'est l'état vide, plus bas, qui l'explique.
  // Filtre CÔTÉ CLIENT, sur la liste déjà chargée. Un paramètre serveur
  // imposerait une validation, une branche SQL (et GLOB n'a pas de clause
  // ESCAPE), un anti-rebond, un état de chargement et un chemin d'erreur à
  // chaque frappe — pour quelques centaines de fiches déjà en mémoire.
  // À revoir au-delà de ~2 000 apprenants, pas avant.
  //
  // La comparaison ignore la casse et les accents, comme nameKey côté serveur,
  // SANS en dépendre : ceci filtre un affichage, cela décide d'une identité.
  // Et elle cherche partout dans le nom, pas seulement au début : « kone »
  // doit trouver « Bintou Kone ».
  const sansAccent = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  const q = sansAccent(recherche.trim());
  // NE PAS retrier : le serveur rend déjà la liste triée, et retrier ici ferait
  // diverger cet écran de tous les autres.
  const filtree = liste && q ? liste.filter((a) => sansAccent(a.displayName).includes(q)) : liste;
  const filtreActif = Boolean(q);

  const sousTitre =
    liste && liste.length > 0
      ? filtreActif
        ? `${filtree.length} apprenant${filtree.length > 1 ? 's' : ''} sur ${liste.length}`
        : `${liste.length} apprenant${liste.length > 1 ? 's' : ''} · moyenne et historique de chacun`
      : 'La moyenne et l’historique de chaque personne qui a passé un quiz.';

  return (
    <div className="stack">
      <div className="page-head">
        {/* .field-row aligne le titre et l'accès secondaire sur la même ligne de
            base. L'accès à l'annuaire est volontairement DISCRET : le geste
            principal de l'écran est d'ouvrir un apprenant, pas d'administrer
            les fiches. */}
        <div className="field-row">
          {/* tabIndex={-1} : cible de la reprise de focus au changement d'écran,
              hors de l'ordre de tabulation. */}
          <h1 ref={titreRef} tabIndex={-1}>
            Apprenants
          </h1>
          <button type="button" className="app-bar-link" onClick={onAnnuaire}>
            <Icon name="edit" size={15} width={1.7} />
            Gérer l’annuaire
          </button>
        </div>
        <p>{sousTitre}</p>
      </div>

      {/* Une région d'alerte, montée en permanence, remplie au commit suivant.
          Garder la forme ternaire : `{annoncee.texte && …}` avec une chaîne vide
          laisserait un nœud texte et casserait .error-slot:empty, qui sort la
          région du flux. La `key` porte le numéro d'occurrence : à échec
          identique répété, elle change, React remplace le <p>, et la région —
          elle, toujours montée — voit bien son contenu muter. */}
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

      {/* L'avertissement va là où il compte : devant les données concernées, et
          non dans les journaux de démarrage que personne ne lit. */}
      {stockage && stockage.persistant === false && (
        <p className="notice">
          <Icon name="info" size={15} width={1.8} />
          <span>
            <b>Ces fiches ne sont pas conservées.</b> Elles disparaîtront au prochain
            redéploiement de l’application{stockage.raison ? ` — ${stockage.raison}` : ''}, avec
            les moyennes qu’elles portent.
          </span>
        </p>
      )}

      {chargement && (
        <div className="loading-screen">
          <span className="spinner" aria-hidden="true" />
          <span>Chargement…</span>
        </div>
      )}

      {!chargement && liste && liste.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="chart" size={22} width={1.6} />
          </span>
          <h2>Aucun apprenant pour l’instant</h2>
          <p>
            Une fiche se crée toute seule dès que quelqu’un passe un quiz et donne son nom.
            Partagez un lien ou faites scanner un QR code, puis revenez sur cet écran.
          </p>
        </div>
      )}

      {/* La recherche n'apparaît qu'une fois qu'il y a de quoi chercher : sur
          cinq fiches elle serait du mobilier. */}
      {!chargement && liste && liste.length > 5 && (
        <div className="field">
          <label className="field-label" htmlFor="recherche-apprenant">
            Rechercher un apprenant
          </label>
          <input
            id="recherche-apprenant"
            type="search"
            className="input"
            placeholder="Prénom ou nom"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            autoComplete="off"
          />
        </div>
      )}

      {!chargement && filtreActif && filtree && filtree.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">
            <Icon name="search" size={22} width={1.6} />
          </span>
          <h2>Aucun apprenant ne correspond</h2>
          <p>Rien ne contient « {recherche.trim()} ».</p>
          <button type="button" className="btn btn--ghost" onClick={() => setRecherche('')}>
            Effacer la recherche
          </button>
        </div>
      )}

      {!chargement && filtree && filtree.length > 0 && (
        <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
          {filtree.map((a) => {
            const { initiale, meta, tag, enQuarantaine, aria } = decrireApprenant(a);
            return (
              <button
                key={a.id}
                type="button"
                className="recent-row"
                // Le nom accessible est donné en entier : il doit permettre de
                // savoir où l'on va sans voir l'écran.
                aria-label={aria}
                onClick={() => onOuvrir({ id: a.id, displayName: a.displayName })}
              >
                {/* Décorative : le nom est juste à côté, et une initiale seule
                    n'apprend rien à qui ne voit pas la ligne. */}
                <span className="app-mark" aria-hidden="true">
                  {initiale}
                </span>
                {/* NOTE POUR LE CSS : .recent-row est en space-between et cette
                    ligne a TROIS enfants, là où les lignes de quiz n'en ont que
                    deux. Sans `flex: 1` sur le corps (par exemple
                    `.app-mark + .recent-row-body { flex: 1; }`), l'espace libre
                    se répartirait entre la pastille et le nom, qui flotterait au
                    milieu de la ligne. */}
                <span className="recent-row-body">
                  <span className="recent-row-title">{a.displayName}</span>
                  <span className="recent-row-meta">{meta}</span>
                </span>
                <span className="tag-row">
                  {/* Fiche en quarantaine : elle vient de la reprise de
                      l'historique — un nom saisi librement au moment de passer un
                      quiz, avant que l'annuaire n'existe. Elle compte ses
                      résultats et s'ouvre normalement, mais n'apparaît PAS dans
                      les suggestions de noms de l'accueil, tant que le formateur
                      ne l'a pas reconnue depuis l'annuaire : on évite ainsi de
                      proposer aux apprenants les fautes de frappe et les doublons
                      hérités. */}
                  {enQuarantaine && <span className="tag">Non suggérée</span>}
                  <span className="tag">{tag}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Rendu sans condition, y compris pendant le chargement : c'est la seule
          sortie de l'écran, et une requête qui n'aboutit jamais y enfermerait
          sinon l'utilisateur, au clavier comme à la souris. */}
      <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>
        <Icon name="arrowLeft" size={16} width={1.7} />
        Retour
      </button>
    </div>
  );
}

export default ApprenantsListe;
