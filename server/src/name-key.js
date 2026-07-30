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

module.exports = { nameKey };
