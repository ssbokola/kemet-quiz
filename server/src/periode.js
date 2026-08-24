/**
 * Période de consultation de l'historique d'un apprenant : deux dates
 * calendaires saisies par le formateur (AAAA-MM-JJ, bornes incluses pour lui)
 * traduites en un intervalle d'instants directement utilisable :
 *
 *   submitted_at >= from  ET  submitted_at < toExclusive
 *
 * Une borne nulle est une borne ouverte : on omet simplement la condition
 * correspondante. Les deux nulles = tout l'historique, ce qui est le cas
 * normal du premier affichage.
 *
 * Isolé dans son propre fichier, sur le précédent de name-key.js, parce que
 * c'est la logique la plus facile à rater du chantier : une borne de fin mal
 * posée fait disparaître une journée entière de résultats sans rien casser
 * de visible.
 *
 * DEUX FORMES À NE JAMAIS RÉINTRODUIRE, quelle que soit la tentation :
 *
 *   submitted_at <= '2026-03-31'
 *     Faux. Les dates stockées sont des instants ISO complets
 *     ('2026-03-31T09:12:03.000Z'), et cette chaîne est lexicographiquement
 *     PLUS GRANDE que '2026-03-31'. Toute la journée du 31 disparaît.
 *
 *   submitted_at <= '2026-03-31T23:59:59.999Z'
 *     Faux aussi. L'intervalle entre 23:59:59.999 et minuit est ignoré, et la
 *     borne devient carrément fausse le jour où la précision du format change
 *     (microsecondes, suppression des millisecondes...).
 *
 * La seule forme correcte est la borne de fin EXCLUE, calée sur minuit du
 * lendemain : elle est juste quelle que soit la précision des instants.
 */

// 14 h, l'avance maximale réellement utilisée sur Terre (Kiribati, Samoa).
const TZ_OFFSET_MAX = 840;

// Format attendu des deux dates. Le contrôle de forme ne suffit pas : il
// laisse passer le 31 février, d'où l'aller-retour plus bas.
const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

// Entier signé, sans notation hexadécimale ni exponentielle : Number('0x10')
// vaut 16 et Number('1e3') vaut 1000, ce que l'on ne veut pas accepter.
const FORMAT_ENTIER = /^[+-]?\d+$/;

function deuxChiffres(n) {
  return String(n).padStart(2, '0');
}

/**
 * Lit une borne. Absente ou vide -> borne ouverte (null), ce n'est pas une
 * erreur. Présente -> elle doit exister au calendrier.
 */
function lireJour(valeur, libelle) {
  if (valeur === undefined || valeur === null) return { ok: true, jour: null };

  const brut = String(valeur).trim();
  if (brut === '') return { ok: true, jour: null };

  if (!FORMAT_JOUR.test(brut)) {
    return { ok: false, error: `La ${libelle} « ${brut} » doit être écrite au format AAAA-MM-JJ.` };
  }

  const [y, m, d] = brut.split('-').map(Number);
  const instant = new Date(Date.UTC(y, m - 1, d));

  if (Number.isNaN(instant.getTime())) {
    return { ok: false, error: `La ${libelle} « ${brut} » n’existe pas.` };
  }

  // Aller-retour. Date.UTC NORMALISE EN SILENCE : Date.UTC(2026, 1, 31) rend
  // le 3 mars 2026 sans se plaindre. On reconstruit la chaîne à partir de
  // l'instant obtenu ; si elle diffère de la saisie, la date n'existait pas.
  // Ce contrôle rattrape au passage les années sur deux chiffres, que
  // Date.UTC décale de 1900 (0099 deviendrait 1999).
  const reconstruite = [
    String(instant.getUTCFullYear()).padStart(4, '0'),
    deuxChiffres(instant.getUTCMonth() + 1),
    deuxChiffres(instant.getUTCDate()),
  ].join('-');

  if (reconstruite !== brut) {
    return {
      ok: false,
      error: `La ${libelle} « ${brut} » n’existe pas au calendrier (elle se lirait ${reconstruite}).`,
    };
  }

  return { ok: true, jour: brut };
}

/**
 * Décalage du navigateur, en MINUTES À L'EST DE UTC, selon la convention
 * -new Date().getTimezoneOffset(). Abidjan (UTC+0) -> 0, Paris en été -> 120,
 * Montréal en hiver -> -300. Absent -> 0, c'est-à-dire un raisonnement en UTC.
 */
function lireTzOffset(valeur) {
  if (valeur === undefined || valeur === null) return { ok: true, tzOffset: 0 };

  const brut = String(valeur).trim();
  if (brut === '') return { ok: true, tzOffset: 0 };

  if (!FORMAT_ENTIER.test(brut)) {
    return { ok: false, error: `Le décalage horaire « ${brut} » doit être un nombre entier de minutes.` };
  }

  const minutes = Number(brut);
  if (minutes < -TZ_OFFSET_MAX || minutes > TZ_OFFSET_MAX) {
    return {
      ok: false,
      error: `Le décalage horaire ${minutes} sort des bornes admises (de -${TZ_OFFSET_MAX} à ${TZ_OFFSET_MAX} minutes).`,
    };
  }

  return { ok: true, tzOffset: minutes };
}

/**
 * Jour calendaire LOCAL -> instant UTC. plusJours vaut 0 pour le début de la
 * journée, 1 pour minuit du lendemain. Date.UTC absorbe gratuitement les
 * débordements de fin de mois et les années bissextiles : le 31 mars + 1 jour
 * donne le 1er avril, le 28 février 2028 + 1 jour donne le 29.
 */
function jourVersInstant(jour, plusJours, tzOffset) {
  const [y, m, d] = jour.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + plusJours) - tzOffset * 60000).toISOString();
}

/**
 * @param {{ from?: string, to?: string, tzOffset?: string|number }} query
 * @returns {{ ok: true, from: string|null, toExclusive: string|null,
 *             fromDay: string|null, toDay: string|null, tzOffset: number }
 *          | { ok: false, error: string }}
 */
function parsePeriode(query) {
  const q = query || {};

  const decalage = lireTzOffset(q.tzOffset);
  if (!decalage.ok) return { ok: false, error: decalage.error };

  const debut = lireJour(q.from, 'date de début');
  if (!debut.ok) return { ok: false, error: debut.error };

  const fin = lireJour(q.to, 'date de fin');
  if (!fin.ok) return { ok: false, error: fin.error };

  // Comparaison de chaînes légitime ici : AAAA-MM-JJ est de largeur fixe et
  // rembourré de zéros, donc l'ordre lexicographique est l'ordre chronologique.
  if (debut.jour && fin.jour && debut.jour > fin.jour) {
    return {
      ok: false,
      error: `La date de début (${debut.jour}) est postérieure à la date de fin (${fin.jour}) : la période est vide.`,
    };
  }

  return {
    ok: true,
    // Borne de début INCLUSE : minuit local du premier jour.
    from: debut.jour ? jourVersInstant(debut.jour, 0, decalage.tzOffset) : null,
    // Borne de fin EXCLUE : minuit local du LENDEMAIN du dernier jour, pour
    // que « du 1er au 31 mars » contienne toute la journée du 31.
    toExclusive: fin.jour ? jourVersInstant(fin.jour, 1, decalage.tzOffset) : null,
    // Les jours tels que saisis, à réafficher au formateur sans retraduction.
    fromDay: debut.jour,
    toDay: fin.jour,
    tzOffset: decalage.tzOffset,
  };
}

module.exports = { parsePeriode };
