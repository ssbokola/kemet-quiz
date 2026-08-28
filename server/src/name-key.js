/**
 * Clé de comparaison des prénoms : « Awa », « awa » et « Awâ » désignent
 * la même personne pour la règle de tentative unique.
 *
 * Isolé dans son propre fichier parce que les deux implémentations du store
 * (db.js et db-memory.js) doivent trancher exactement pareil.
 */
function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Les mots d'une clé de nom.
 *
 * Seul l'ESPACE sépare : c'est ce que fait aussi le motif GLOB « * aya* » de
 * db.js, et les deux doivent trancher pareil. Un trait d'union n'est donc pas
 * un séparateur — « marie-claire » est un seul mot pour la suggestion.
 * Le filter(Boolean) absorbe les espaces internes multiples, que nameKey()
 * n'écrase pas encore.
 */
function motsDeCle(cle) {
  return String(cle || '').split(' ').filter(Boolean);
}

module.exports = { nameKey, motsDeCle };
