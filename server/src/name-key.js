/**
 * Clé de comparaison des noms : deux graphies qui donnent la même clé
 * désignent la même personne pour la règle de tentative unique et pour
 * l'annuaire.
 *
 * ⛔ RÈGLE CARDINALE : LA RECHERCHE ET L'IDENTITÉ NE PARTAGENT JAMAIS LA MÊME
 * FONCTION. Cette fonction décide d'une IDENTITÉ. Il est tentant, en voyant que
 * la suggestion trouve « Kouassi Aya » sur « aya », de rendre la clé
 * insensible à l'ordre des mots. Il ne faut surtout pas : en onomastique akan,
 * Yao, Koffi, Kouassi, Kouamé, Aya, Adjoua sont des NOMS DE JOUR, employés
 * indifféremment comme prénom et comme patronyme. « Yao Koffi » et « Koffi
 * Yao » peuvent être deux personnes, et une clé triée les fusionnerait
 * définitivement, historiques compris. Le rapprochement par ordre des mots vit
 * dans server/src/similarite.js, qui PROPOSE à un humain ; ici on TRANCHE.
 *
 * Isolé dans son propre fichier parce que les deux implémentations du store
 * (db.js et db-memory.js) doivent trancher exactement pareil.
 *
 * ⚠️ TOUTE MODIFICATION DE CETTE FONCTION EXIGE SA MIGRATION, dans le même
 * commit : results.player_key et learners.name_key stockent ce qu'elle
 * renvoyait au moment de l'écriture. La livrer seule casserait la règle de
 * tentative unique EN SILENCE sur tout l'historique et remettrait ensureLearner
 * à créer des doublons. Voir migrerClesDeNom() dans db.js.
 */

// Toutes les graphies de l'apostrophe. Elles sont SUPPRIMÉES, et non remplacées
// par un espace : « N'Guessan » doit donner « nguessan », un seul mot, pour
// rejoindre la graphie sans apostrophe qui est très courante. En faire deux
// mots (« n guessan ») produirait un mot d'une lettre qui polluerait la
// suggestion par mot et la détection de doublons.
//
// C'est l'inverse du trait d'union, qui devient un espace parce que
// « Marie-Claire » est bien deux mots. Deux règles opposées pour deux
// caractères : contre-intuitif, et c'est pour cela que c'est écrit ici.
//
// U+02BC est de catégorie Lm — une LETTRE modificative : sans cette ligne, le
// balayage de ponctuation ci-dessous la conserverait.
const APOSTROPHES = /['’‘`´ʼ′]/g;

function nameKey(name) {
  return (
    String(name || '')
      // 1. Décomposer AVANT tout : « é » devient « e » + U+0301.
      .normalize('NFD')
      // 2. Retirer les diacritiques latins (bloc Combining Diacritical Marks),
      //    et lui seul. PAS \p{M} en général : les matras devanagari et les
      //    harakat arabes sont sémantiques, les retirer changerait le nom.
      .replace(/[̀-ͯ]/g, '')
      // 3. Minuscules APRÈS le retrait des marques et AVANT le balayage : sans
      //    cet ordre, « É » — que le balayage ne connaît pas — deviendrait un
      //    espace au lieu d'un « e ».
      .toLowerCase()
      // 4. Apostrophes supprimées (voir plus haut).
      .replace(APOSTROPHES, '')
      // 5. Tout ce qui n'est ni lettre, ni chiffre, ni marque devient UN espace.
      //    Le quantificateur « + » écrase du même coup les espaces internes
      //    multiples : aucun second passage n'est nécessaire.
      //    Traits d'union, points, virgules, tabulations, espaces insécables,
      //    soulignés : tous des séparateurs. \p{M} est ADMIS pour ne pas faire
      //    éclater un mot arabe voyellisé en quatre.
      //
      //    Effet de bord capital : les métacaractères GLOB (* ? [ ]) sont tous
      //    hors de \p{L} ∪ \p{N} ∪ \p{M}. Aucune clé ne peut donc en contenir,
      //    et la sûreté du GLOB sans clause ESCAPE (db.js) ne repose plus sur
      //    la liste blanche d'index.js mais sur la CONSTRUCTION de la clé, en
      //    un endroit unique partagé par les deux stores.
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
      .trim()
  );
  // Chiffres CONSERVÉS : les retirer ferait fusionner « Aya Koffi 2 » avec
  // « Aya Koffi ». Fusionner deux personnes distinctes est bien pire que ne pas
  // réunir deux fiches d'une même personne — la fusion est irréversible, la
  // non-fusion se rattrape à la main depuis l'écran des doublons probables.
  //
  // Lettres NON LATINES conservées (\p{L} et non [a-z]) : sinon « علي »
  // donnerait une clé vide et submit répondrait 400 « Entrez votre nom », une
  // régression par rapport à aujourd'hui où ces noms passent.
  //
  // NFD et non NFKD : NFKD replierait les pleines chasses et les ligatures,
  // mais aussi « № » → « No » et « ½ » → « 1⁄2 ». Sur-normalisation inutile
  // pour l'usage réel ; on ne change qu'une chose à la fois.
}

/**
 * Les mots d'une clé de nom.
 *
 * Seul l'ESPACE sépare, et depuis la réécriture de nameKey c'est un espace
 * SIMPLE et unique : le motif GLOB « * aya* » de db.js et ce découpage
 * tranchent donc identiquement. Un trait d'union n'est pas un séparateur ici
 * puisqu'il n'en reste aucun dans une clé.
 */
function motsDeCle(cle) {
  return String(cle || '').split(' ').filter(Boolean);
}

module.exports = { nameKey, motsDeCle };
