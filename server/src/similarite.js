const { motsDeCle } = require('./name-key');

/**
 * Rapprochement de fiches d'apprenants qui désignent PROBABLEMENT la même
 * personne.
 *
 * ⛔ CE MODULE NE DÉCIDE JAMAIS D'UNE IDENTITÉ. Il propose, un humain tranche,
 * et c'est mergeLearners() qui exécute. La distinction est vitale ici : une
 * fusion est irréversible ET non reconstructible — mergeLearners déplace les
 * learner_id puis supprime la source sans conserver la provenance. Ce qui sort
 * d'ici alimente un écran, jamais une écriture automatique.
 *
 * Corollaire, à ne pas perdre de vue en faisant évoluer ce fichier : la règle
 * R1 ci-dessous rapproche « Yao Koffi » et « Koffi Yao ». En onomastique akan,
 * Yao, Koffi, Kouassi, Kouamé, Aya, Adjoua sont des NOMS DE JOUR, employés
 * indifféremment comme prénom et comme patronyme : ces deux-là peuvent être
 * deux personnes distinctes. C'est précisément pour cela que R1 vit ICI, dans
 * un module de SUGGESTION, et surtout pas dans nameKey(), qui décide de
 * l'identité. La recherche et l'identité ne partagent jamais la même fonction.
 */

// Sous ce nombre de caractères, une seule substitution suffit à changer de
// personne (« Ama » / « Awa », « Aya » / « Ava ») : le seuil descend à 1.
const CLE_COURTE = 6;

// Plafond de sortie. Un annuaire pathologique produirait des centaines de
// groupes et l'écran deviendrait inutilisable : mieux vaut les plus probants.
const MAX_GROUPES = 50;

// Au-delà, une fiche à un seul mot (« Kouassi ») s'apparierait avec tous les
// « Kouassi X » de l'officine. Kouassi est un patronyme extrêmement courant en
// Côte d'Ivoire : ces arêtes-là noieraient le vrai signal, on les jette EN BLOC
// plutôt que d'en garder trois au hasard.
const MAX_PARTIELS_PAR_FICHE = 3;

const RAISONS = {
  ordre: 'mêmes mots, ordre différent',
  orthographe: 'orthographe très proche',
  incomplet: 'nom incomplet',
};

/**
 * Distance de Levenshtein BORNÉE : rend `max + 1` dès que le dépassement est
 * acquis, sans finir le tableau. C'est ce qui rend le O(n²) supportable — la
 * très grande majorité des paires sort au pré-filtre de longueur, en O(1).
 */
function distanceBornee(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let court = a;
  let long = b;
  if (court.length > long.length) {
    court = b;
    long = a;
  }
  let prec = Array.from({ length: court.length + 1 }, (_, i) => i);
  const cour = new Array(court.length + 1);
  for (let j = 1; j <= long.length; j += 1) {
    cour[0] = j;
    let minLigne = j;
    for (let i = 1; i <= court.length; i += 1) {
      const cout = court[i - 1] === long[j - 1] ? 0 : 1;
      cour[i] = Math.min(cour[i - 1] + 1, prec[i] + 1, prec[i - 1] + cout);
      if (cour[i] < minLigne) minLigne = cour[i];
    }
    // Toute une ligne au-dessus du seuil : le résultat final ne peut plus
    // redescendre. On sort.
    if (minLigne > max) return max + 1;
    prec = cour.slice();
  }
  return prec[court.length];
}

/** Union-Find, pour rassembler en GROUPES ce que les règles voient par paires. */
function creerUnion(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const trouver = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) {
      const suivant = parent[x];
      parent[x] = r;
      x = suivant;
    }
    return r;
  };
  return {
    trouver,
    unir: (a, b) => {
      const ra = trouver(a);
      const rb = trouver(b);
      if (ra !== rb) parent[rb] = ra;
    },
  };
}

/**
 * Les GROUPES de fiches qui désignent probablement la même personne.
 *
 * Des groupes et non des paires, parce que les vraies données en produisent :
 * une même personne saisie « Flore Sidonie », « Flore Sidonie N'guessan »,
 * « Flore Sidonie  N'guessan » et « Sidonie N'guessan flore » donne 6 paires
 * pour 4 fiches — six cartes à traiter pour une seule personne. Un groupe se
 * lit d'un coup.
 *
 * `fiches` : { id, displayName, nameKey, attempts, lastSubmittedAt, createdBy,
 * suggestible }.
 *
 * Rendu trié par total d'évaluations décroissant : le groupe qui porte le plus
 * d'historique est celui qu'il coûte le plus cher à laisser en l'état.
 */
function groupesProbables(fiches) {
  const liste = Array.isArray(fiches) ? fiches : [];
  const n = liste.length;
  if (n < 2) return [];

  const mots = liste.map((f) => motsDeCle(f.nameKey));
  const ensembles = mots.map((m) => new Set(m));
  const triees = mots.map((m) => [...m].sort().join(' '));
  const cles = liste.map((f) => String(f.nameKey || ''));

  const union = creerUnion(n);
  // Raisons par arête, pour dire au formateur POURQUOI on les rapproche.
  const raisonsParPaire = new Map();
  const noter = (i, j, raison) => {
    const cle = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (!raisonsParPaire.has(cle)) raisonsParPaire.set(cle, new Set());
    raisonsParPaire.get(cle).add(raison);
    union.unir(i, j);
  };

  // R1 — mêmes mots, ordre différent. O(n) par table de hachage.
  const parTriee = new Map();
  liste.forEach((_, i) => {
    if (!triees[i]) return;
    if (!parTriee.has(triees[i])) parTriee.set(triees[i], []);
    parTriee.get(triees[i]).push(i);
  });
  for (const groupe of parTriee.values()) {
    for (let a = 1; a < groupe.length; a += 1) noter(groupe[0], groupe[a], RAISONS.ordre);
  }

  // R2 — orthographe très proche. O(n²) borné, sortie anticipée.
  //
  // La comparaison se fait MOT À MOT, et non sur la clé entière. Sur la clé
  // entière, « kouassi aya » et « kouassi yao » sortent à une distance de 2
  // (retirer un « a », ajouter un « o ») et se retrouvent rapprochés — alors
  // que ce sont deux personnes. Les noms de jour akan sont courts et se
  // ressemblent entre eux : Yao, Aya, Adjoua, Koffi, Kouassi. Mot à mot, la
  // comparaison porte sur « aya » contre « yao », deux mots courts dont le
  // seuil tombe à 1 : le rapprochement ne se fait plus.
  // Ce qu'on cherche vraiment, c'est UNE faute de frappe dans UN mot.
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (!cles[i] || !cles[j]) continue;
      if (mots[i].length !== mots[j].length) continue;
      let ecart = null;
      let multiple = false;
      for (let k = 0; k < mots[i].length; k += 1) {
        if (mots[i][k] === mots[j][k]) continue;
        if (ecart) {
          multiple = true;
          break;
        }
        ecart = [mots[i][k], mots[j][k]];
      }
      if (multiple || !ecart) continue;
      const seuil = Math.min(ecart[0].length, ecart[1].length) < CLE_COURTE ? 1 : 2;
      if (distanceBornee(ecart[0], ecart[1], seuil) <= seuil) {
        noter(i, j, RAISONS.orthographe);
      }
    }
  }

  // R3 — inclusion STRICTE des mots : « Aya » ⊂ « Aya Koffi ».
  // La variante large — « un mot en commun » — est écartée : Kouassi
  // apparierait tous les Kouassi entre eux.
  const partielsPar = new Map();
  const candidatsR3 = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const petit = ensembles[i];
      const grand = ensembles[j];
      if (petit.size === 0 || petit.size >= grand.size) continue;
      let inclus = true;
      for (const mot of petit) {
        if (!grand.has(mot)) {
          inclus = false;
          break;
        }
      }
      if (!inclus) continue;
      candidatsR3.push([i, j]);
      partielsPar.set(i, (partielsPar.get(i) || 0) + 1);
    }
  }
  for (const [i, j] of candidatsR3) {
    const combien = partielsPar.get(i) || 0;
    // Un nom d'UN SEUL mot inclus dans plusieurs autres ne dit rien : « Kouassi »
    // est un patronyme très courant, il serait le sous-ensemble de tous les
    // « Kouassi X » de l'officine. On exige alors l'unicité — une seule fiche
    // plus complète, sans ambiguïté possible.
    // À deux mots ou plus, le plafond est plus large : sur les vraies données,
    // « Flore Sidonie » est inclus dans TROIS variantes de la même personne, et
    // l'exclure sortirait du groupe la fiche qui porte le plus d'évaluations.
    const plafond = ensembles[i].size === 1 ? 1 : MAX_PARTIELS_PAR_FICHE;
    if (combien > plafond) continue;
    noter(i, j, RAISONS.incomplet);
  }

  // Rassemblement.
  const parRacine = new Map();
  for (let i = 0; i < n; i += 1) {
    const r = union.trouver(i);
    if (!parRacine.has(r)) parRacine.set(r, []);
    parRacine.get(r).push(i);
  }

  const groupes = [];
  for (const indices of parRacine.values()) {
    if (indices.length < 2) continue;
    const raisons = new Set();
    for (let a = 0; a < indices.length; a += 1) {
      for (let b = a + 1; b < indices.length; b += 1) {
        const cle =
          indices[a] < indices[b]
            ? `${indices[a]}|${indices[b]}`
            : `${indices[b]}|${indices[a]}`;
        const r = raisonsParPaire.get(cle);
        if (r) for (const x of r) raisons.add(x);
      }
    }
    // La fiche proposée par défaut à la conservation.
    //
    // Le critère N'EST PAS le nombre d'évaluations, et c'est contre-intuitif :
    // la fusion rapatrie de toute façon TOUTES les évaluations sous la fiche
    // gardée. Le seul enjeu du choix est donc le NOM qui survit — et sur les
    // vraies données, trier par évaluations proposait de garder « Flore
    // Sidonie » (2 évaluations) plutôt que « Flore Sidonie N'guessan » (1),
    // c'est-à-dire de perdre le patronyme.
    //
    // On classe donc par quantité d'information, dans cet ordre :
    //  1. le nom qui porte le plus de MOTS — « Flore Sidonie N'guessan » avant
    //     « Flore Sidonie », sinon la fusion perdrait le patronyme ;
    //  2. le plus d'ÉVALUATIONS — c'est la graphie que les gens ont réellement
    //     utilisée, et elle départage une faute de frappe de son original ;
    //  3. une fiche saisie par le formateur avant une fiche née d'une saisie
    //     d'apprenant, elle-même avant une fiche d'import ;
    //  4. la graphie PROPRE avant celle qui traîne un espace double ou de bord
    //     — c'est ce qui fait perdre « Flore Sidonie  N'guessan » ;
    //  5. la plus LONGUE, à égalité : entre deux graphies également propres,
    //     celle qui a le plus de lettres est la plus complète. Trier à l'envers
    //     (le plus court d'abord) ferait gagner « Kouasi » contre « Kouassi ».
    const rang = (f) => (f.createdBy === 'trainer' ? 0 : f.createdBy === 'learner' ? 1 : 2);
    const nbMots = (f) => motsDeCle(f.nameKey).length;
    // Espace double, ou espace de début / de fin : une graphie négligée.
    const sale = (f) => (/\s{2,}|^\s|\s$/.test(String(f.displayName)) ? 1 : 0);
    const membres = indices
      .map((i) => liste[i])
      .sort(
        (a, b) =>
          nbMots(b) - nbMots(a) ||
          (b.attempts || 0) - (a.attempts || 0) ||
          rang(a) - rang(b) ||
          sale(a) - sale(b) ||
          String(b.displayName).length - String(a.displayName).length ||
          String(a.displayName).localeCompare(String(b.displayName), 'fr')
      );
    groupes.push({
      fiches: membres,
      raisons: [...raisons],
      total: membres.reduce((s, f) => s + (f.attempts || 0), 0),
    });
  }

  groupes.sort((a, b) => b.total - a.total || b.fiches.length - a.fiches.length);
  return groupes.slice(0, MAX_GROUPES);
}

module.exports = {
  groupesProbables,
  distanceBornee,
  RAISONS,
  CLE_COURTE,
  MAX_GROUPES,
  MAX_PARTIELS_PAR_FICHE,
};
