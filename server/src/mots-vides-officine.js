/**
 * Les mots qui ne DISTINGUENT rien dans un nom d'officine.
 *
 * Pourquoi ce fichier existe : presque toutes les officines s'appellent
 * « Pharmacie quelque chose ». Sans cette liste, la règle R3 de similarite.js
 * (inclusion stricte des mots) considérerait « La Nouvelle Pharmacie » comme le
 * « nom incomplet » de toute « La Nouvelle Pharmacie du X » — trois mots, donc
 * plafond de trois arêtes, alors que son contenu informatif est NUL. L'Union-Find
 * enchaînerait, et quatre officines distinctes atterriraient dans un seul groupe.
 *
 * ⛔ CETTE LISTE NE SERT QUE DANS R3, jamais dans R1 ni R2, et c'est délibéré :
 *   · R2 (faute de frappe) exige déjà le même nombre de mots et une seule
 *     position divergente — un mot commun n'y crée aucune arête.
 *   · R1 (mêmes mots, ordre différent) deviendrait DANGEREUSE si on lui retirait
 *     les mots vides : « Pharmacie du Plateau » et « Grande Pharmacie du
 *     Plateau » se réduiraient tous deux à { plateau }, et R1 proposerait de
 *     fusionner deux officines bel et bien distinctes.
 * Elle sert uniquement à MESURER combien d'information porte une fiche.
 *
 * ⛔ AUCUN CHIFFRE ICI. « 2 », « 220 », « 7e » sont précisément ce qui distingue
 * « Pharmacie des 2 Plateaux » de « Pharmacie du Plateau ». Les retirer
 * fusionnerait des officines différentes.
 *
 * Les entrées sont écrites comme nameKey() les rend : minuscules, sans
 * diacritiques, apostrophes supprimées, un seul espace entre les mots.
 */
const MOTS_VIDES_OFFICINE = Object.freeze(
  new Set([
    // Ce que sont ces établissements
    'pharmacie',
    'pharmacies',
    'officine',
    'depot',
    'depots',
    // Articles et liaisons — « d » et « l » viennent des apostrophes supprimées
    'la',
    'le',
    'les',
    'l',
    'du',
    'de',
    'des',
    'd',
    'au',
    'aux',
    'a',
    'et',
    // Qualificatifs d'enseigne, extrêmement fréquents et non distinctifs
    'nouvelle',
    'nouveau',
    'grande',
    'grand',
    'petite',
    'petit',
    'moderne',
    'centrale',
    'central',
    'centre',
    'principale',
    'principal',
    // Hagionymes : « Saint X » est si courant que « saint » seul ne dit rien.
    // Le NOM du saint, lui, reste distinctif et n'est pas dans la liste.
    'saint',
    'sainte',
    'st',
    'ste',
  ])
);

module.exports = { MOTS_VIDES_OFFICINE };
