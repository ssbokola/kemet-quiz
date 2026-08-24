/**
 * Fabrique d'identifiants aleatoires.
 *
 * Isole dans son propre fichier, sur le precedent de name-key.js, parce que les
 * deux implementations du store (db.js et db-memory.js) doivent fabriquer leurs
 * identifiants exactement pareil : un module minuscule et partage vaut mieux
 * qu'une duplication qui derive.
 *
 * Six octets par defaut, la ou un identifiant de quiz se contente de quatre.
 * Un identifiant d'apprenant est frappe une seule fois par personne, et une
 * collision de cle primaire provoquerait un 500 au moment de l'envoi des
 * reponses, c'est-a-dire au pire moment possible. Quatre octets collisionnent
 * statistiquement vers 77 000 fiches, six octets vers 20 millions.
 */
const crypto = require('node:crypto');

function newId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { newId };
