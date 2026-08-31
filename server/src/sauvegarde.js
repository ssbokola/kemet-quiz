/**
 * Sauvegardes périodiques du fichier SQLite, EN PROCESSUS.
 *
 * Pourquoi en processus et pas un second service Railway : ce projet tient à
 * une seule instance/un seul service par choix documenté (HANDOFF.md, section
 * 8, « Une seule instance de serveur ») — un service séparé demanderait une
 * configuration manuelle dans le tableau de bord Railway que personne n'a
 * demandée, pour un besoin qu'un simple minuteur couvre très bien.
 *
 * Pourquoi VACUUM INTO et pas une copie de fichier (fs.copyFile) : le mode
 * journal est WAL (voir db.js) — la donnée la plus récente peut vivre dans un
 * fichier .db-wal à côté du .db, que copier laisserait de côté ou copierait
 * dans un état incohérent avec le .db au même instant. VACUUM INTO, lui,
 * s'exécute au niveau de SQLite : il consolide WAL et fichier principal et
 * écrit une base autonome et cohérente, quel que soit l'état du journal au
 * moment de l'appel.
 *
 * Pourquoi une connexion SÉPARÉE en LECTURE SEULE : ce module ne doit jamais
 * pouvoir écrire sur le fichier source — une sauvegarde n'est pas censée
 * pouvoir corrompre ce qu'elle sauvegarde. { readOnly: true } fait respecter
 * cette promesse par SQLite lui-même plutôt que par une simple discipline de
 * code. Vérifié : VACUUM INTO fonctionne depuis une connexion en lecture
 * seule, puisqu'il n'écrit que sur le fichier de DESTINATION.
 *
 * Limite connue, assumée pour cette première version : les sauvegardes sont
 * écrites SUR LE MÊME VOLUME que la base (un sous-dossier « backups » à côté
 * du .db). Cela protège contre une casse applicative ou une mauvaise
 * manipulation dans l'appli, PAS contre la perte du volume entier — pour ça,
 * voir la sauvegarde native de volume proposée par Railway (Settings >
 * Backups), qui est hors du périmètre de ce fichier.
 *
 * Autre limite assumée : node:sqlite est entièrement SYNCHRONE. Le temps d'un
 * VACUUM INTO, le serveur ne répond à aucune requête. Sans gravité à l'échelle
 * de cette base (quelques mégaoctets, une poignée de formateurs) ; à
 * surveiller si le volume de données change d'ordre de grandeur un jour.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const UNE_HEURE_MS = 60 * 60 * 1000;
const INTERVALLE_PAR_DEFAUT_MS = 24 * UNE_HEURE_MS;
const RETENTION_PAR_DEFAUT = 14;
// Quelques minutes : le temps que le serveur finisse de démarrer (migration,
// premières requêtes) avant de rivaliser avec lui pour le disque et le CPU.
const DELAI_INITIAL_PAR_DEFAUT_MS = 5 * 60 * 1000;

// Sert à la fois à nommer les fichiers et à les reconnaître au nettoyage —
// une seule définition, jamais deux motifs qui pourraient diverger.
const PREFIXE = 'kemet-quiz-';
const SUFFIXE = '.db';

/**
 * Un horodatage utilisable dans un nom de fichier sur tous les systèmes visés
 * (Windows en local, Linux en production) : ni ':' ni '.', qui posent
 * problème sur Windows ou prêtent à confusion avec l'extension. Précision à
 * la seconde — largement suffisant vu l'intervalle par défaut (24 h), et ça
 * garde les noms lisibles à l'œil pour le formateur qui irait fouiller le
 * dossier.
 */
function horodatageFichier(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
}

/**
 * Une sauvegarde, maintenant. Fonction isolée et testable : tout ce dont elle
 * dépend arrive en paramètre, rien n'est lu d'une variable globale.
 *
 * Crée `dossierDest` s'il n'existe pas, écrit un fichier .db autonome et
 * cohérent dedans, et renvoie le chemin écrit.
 *
 * `maintenant` est injectable (Date), pour des tests déterministes sans
 * dépendre de l'horloge système.
 */
function sauvegarderMaintenant(dbPath, dossierDest, maintenant = new Date()) {
  fs.mkdirSync(dossierDest, { recursive: true });

  const nomFichier = `${PREFIXE}${horodatageFichier(maintenant)}${SUFFIXE}`;
  const cheminDest = path.join(dossierDest, nomFichier);

  // Lecture seule : cette connexion ne doit jamais pouvoir modifier la base
  // qu'elle sauvegarde, même par erreur de programmation future dans ce fichier.
  const source = new DatabaseSync(dbPath, { readOnly: true });
  try {
    // Paramètre lié plutôt qu'interpolation dans le SQL : pas d'échappement
    // manuel à maintenir, et ça fonctionne aussi bien avec les espaces d'un
    // chemin Windows local qu'avec un futur chemin Linux.
    source.prepare('VACUUM INTO ?').run(cheminDest);
  } finally {
    source.close();
  }

  return cheminDest;
}

/**
 * Ne garde que les `retention` sauvegardes les plus récentes dans
 * `dossierDest`. Le tri se fait sur le NOM du fichier, déjà chronologique
 * grâce à l'horodatage ISO-like — pas besoin de relire une date de
 * modification sur le disque, qui pourrait avoir été altérée par une copie.
 *
 * Filtre sur le motif de nommage : un dossier de sauvegardes ne doit contenir
 * que ce que ce module y a écrit, mais rien n'empêche qu'un fichier étranger
 * s'y glisse un jour — autant ne jamais risquer de le supprimer.
 */
function nettoyerSauvegardes(dossierDest, retention) {
  let fichiers;
  try {
    fichiers = fs.readdirSync(dossierDest);
  } catch {
    return; // Dossier absent : rien à nettoyer.
  }

  const sauvegardes = fichiers.filter((nom) => nom.startsWith(PREFIXE) && nom.endsWith(SUFFIXE)).sort();

  const enTrop = sauvegardes.length - retention;
  if (enTrop <= 0) return;

  for (const nom of sauvegardes.slice(0, enTrop)) {
    try {
      fs.unlinkSync(path.join(dossierDest, nom));
    } catch (err) {
      // Une suppression ratée (permission, fichier déjà parti) n'est pas une
      // raison de faire échouer le cycle de sauvegarde qui vient de réussir.
      console.warn(`Sauvegarde : impossible de supprimer ${nom} :`, err.message);
    }
  }
}

/**
 * Une tentative de sauvegarde complète : écrire, puis nettoyer. Toute erreur
 * est rattrapée ICI et journalisée — jamais renvoyée à l'appelant. Une
 * sauvegarde ratée n'est pas une raison d'arrêter le site, exactement comme
 * un échec de suggestion n'est pas une erreur pour l'apprenant ailleurs dans
 * ce dépôt.
 */
function tenterSauvegarde(dbPath, dossierDest, retention) {
  try {
    const chemin = sauvegarderMaintenant(dbPath, dossierDest);
    console.log(`Sauvegarde SQLite écrite : ${chemin}`);
    nettoyerSauvegardes(dossierDest, retention);
  } catch (err) {
    console.error('Sauvegarde SQLite ratée (le serveur continue) :', err.message);
  }
}

/**
 * Démarre le cycle de sauvegardes automatiques. Un premier délai avant la
 * toute première sauvegarde, puis un rythme régulier ensuite.
 *
 * Options, toutes facultatives — aucune nouvelle variable d'environnement
 * n'est nécessaire pour cette version :
 *   - dbPath        : chemin du fichier SQLite source (obligatoire en pratique,
 *                      mais reste un paramètre explicite plutôt qu'une lecture
 *                      cachée de store.DB_PATH — ce module ignore tout de db.js).
 *   - dossierDest    : par défaut, un sous-dossier « backups » à côté de dbPath —
 *                      donc dans DATA_DIR, sur le même volume Railway qui
 *                      persiste déjà. JAMAIS un chemin en dehors, sans quoi les
 *                      sauvegardes ne survivraient pas à un redéploiement.
 *   - intervalleMs   : 24 h par défaut.
 *   - retention      : 14 par défaut (deux semaines à raison d'une par jour).
 *   - delaiInitialMs : 5 minutes par défaut, pour laisser le serveur démarrer
 *                      tranquillement avant de lui disputer le disque.
 *
 * Renvoie un handle avec `arreter()`, utile aux tests pour ne laisser aucun
 * minuteur actif derrière eux. Les minuteurs sont `unref()`-és : un serveur
 * Express qui écoute garde déjà le processus vivant tout seul, il est inutile
 * que ces minuteurs l'empêchent en plus de s'arrêter proprement le cas échéant.
 */
function demarrerSauvegardesAutomatiques({
  dbPath,
  dossierDest = path.join(path.dirname(dbPath), 'backups'),
  intervalleMs = INTERVALLE_PAR_DEFAUT_MS,
  retention = RETENTION_PAR_DEFAUT,
  delaiInitialMs = DELAI_INITIAL_PAR_DEFAUT_MS,
} = {}) {
  const declencher = () => tenterSauvegarde(dbPath, dossierDest, retention);

  let intervalle = null;
  const delai = setTimeout(() => {
    declencher();
    intervalle = setInterval(declencher, intervalleMs);
    intervalle.unref();
  }, delaiInitialMs);
  delai.unref();

  return {
    arreter() {
      clearTimeout(delai);
      if (intervalle) clearInterval(intervalle);
    },
  };
}

module.exports = {
  sauvegarderMaintenant,
  nettoyerSauvegardes,
  demarrerSauvegardesAutomatiques,
};
