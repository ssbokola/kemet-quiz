const KEY = 'kemet-quiz-admin-pw';

export function getAdminPassword() {
  try {
    return sessionStorage.getItem(KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminPassword(pw) {
  try {
    if (pw) sessionStorage.setItem(KEY, pw);
    else sessionStorage.removeItem(KEY);
  } catch {}
}

/**
 * Message affiché quand la requête n'a pas abouti du tout : rien n'a répondu,
 * pas même une erreur. Ce n'est jamais un problème de mot de passe, c'est
 * l'application qui n'est pas en marche de l'autre côté.
 */
export const MESSAGE_RESEAU =
  'Impossible de joindre le serveur du quiz : il n’est probablement pas démarré. Démarrez-le, puis réessayez.';

// Signes qu'une phrase s'adresse bien à un francophone : un accent, ou l'un des
// mots outils les plus courants. Volontairement grossier.
const SIGNE_DE_FRANCAIS =
  /[àâçèéêëîïôùûü]|\b(aucun|aucune|le|la|les|un|une|des|du|est|sont|ne|pas|trop|doit)\b/i;

/**
 * Ne laisse passer un texte que s'il ressemble à une phrase destinée à un
 * humain. Le serveur relaie parfois, tel quel, le message d'une exception
 * interne — « Unexpected token … is not valid JSON », « Connection error. » —
 * qui n'apprend rien au formateur et le renvoie à de l'anglais technique.
 */
export function messagePourFormateur(texte, repli) {
  const phrase = typeof texte === 'string' ? texte.trim() : '';
  if (!phrase) return repli;
  // Accolades, chevrons, antislash, URL : un fragment de code ou de JSON, pas
  // une phrase.
  if (/[{}<>\\]|https?:\/\//.test(phrase)) return repli;
  return SIGNE_DE_FRANCAIS.test(phrase) ? phrase : repli;
}

/**
 * Message d'erreur envoyé par le serveur, s'il en a envoyé un d'exploitable.
 * On lit une COPIE de la réponse : l'appelant garde le droit de lire le corps
 * lui-même. Un corps qui n'est pas du JSON (le HTML d'une passerelle en 502),
 * un corps vide ou déjà consommé ne doit jamais faire échouer cette lecture,
 * sinon l'exception remplacerait le vrai message.
 *
 * Le texte est filtré : un message présentable ressort tel quel, une trace
 * technique ressort vide — et l'appelant retombe alors sur sa propre phrase.
 */
async function messageDuServeur(res) {
  try {
    const copie = typeof res.clone === 'function' ? res.clone() : res;
    const data = await copie.json();
    const texte = data && (data.error || data.message);
    return messagePourFormateur(texte, '');
  } catch {
    return '';
  }
}

/** Colle le code numérique en fin de phrase, sans doubler la ponctuation. */
function avecCode(texte, statut) {
  return `${texte.replace(/\s*[.!…]+$/, '')} (code ${statut}).`;
}

/**
 * Message lisible pour une réponse HTTP en échec.
 * Règle cardinale : on ne parle du mot de passe QUE lorsque le serveur a
 * réellement refusé l'identification. Un serveur arrêté, une passerelle muette
 * ou un plantage ne doivent jamais être présentés comme un mot de passe faux.
 */
export async function messageErreur(res, repli = 'Une erreur est survenue.') {
  const statut = (res && res.status) || 0;
  const duServeur = await messageDuServeur(res);

  // Refus d'identification : le seul cas où le mot de passe est en cause.
  if (statut === 401 || statut === 403) {
    return duServeur || 'Mot de passe incorrect';
  }

  // Passerelle qui ne joint personne (502/503/504) ou plantage (500) : le
  // serveur ne répond pas ou a échoué, point. Mais seulement s'il n'a rien dit
  // d'exploitable — un 5xx peut porter un vrai message métier, et le remplacer
  // par une phrase générique reviendrait à accuser la mauvaise cause.
  if (!duServeur && (statut === 500 || statut === 502 || statut === 503 || statut === 504)) {
    return avecCode(
      'Le serveur du quiz ne répond pas ou a échoué. Vérifiez qu’il est bien démarré, puis réessayez',
      statut
    );
  }

  if (duServeur) return duServeur;
  return statut ? avecCode(repli, statut) : repli;
}

/** fetch avec le mot de passe formateur en en-tête. */
export function adminFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const pw = getAdminPassword();
  if (pw) headers['x-admin-password'] = pw;
  return fetch(url, { ...options, headers });
}

/**
 * fetch qui distingue « le serveur a répondu une erreur » de « rien n'a
 * répondu » : une promesse rejetée devient une Error portant MESSAGE_RESEAU,
 * au lieu du « Failed to fetch » du navigateur. Rend la réponse telle quelle
 * sinon : c'est à l'appelant de tester res.ok.
 */
export async function fetchOuReseau(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error(MESSAGE_RESEAU);
  }
}

/** adminFetch, avec la même conversion de l'échec réseau en message lisible. */
export async function adminFetchOuReseau(url, options = {}) {
  try {
    return await adminFetch(url, options);
  } catch {
    throw new Error(MESSAGE_RESEAU);
  }
}

export async function checkAdminPassword(pw) {
  const res = await fetchOuReseau('/api/admin/check', {
    method: 'POST',
    headers: { 'x-admin-password': pw },
  });
  if (!res.ok) {
    // Un vrai refus (401) dit toujours « Mot de passe incorrect » ; un serveur
    // en panne dit qu'il est en panne, plus jamais que le mot de passe est faux.
    throw new Error(await messageErreur(res, 'Vérification impossible.'));
  }
  // Le corps d'un succès n'est pas le message : s'il n'est pas lisible, on n'en
  // fait pas un échec d'identification.
  return res.json().catch(() => ({}));
}
