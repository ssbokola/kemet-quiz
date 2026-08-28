/**
 * Fusion des deux familles de correspondance de la saisie assistée.
 *
 * Isolée dans son propre fichier sur le précédent de name-key.js et ids.js :
 * db.js et db-memory.js doivent ordonner et plafonner EXACTEMENT pareil, sans
 * quoi la liste changerait sous les yeux de l'apprenant selon le store actif.
 */

// Trois places au maximum pour les correspondances en TÊTE de nom.
//
// Sans ce quota, la fonctionnalité s'annulerait dans le cas précis qui la
// motive : cinq fiches commençant par « aya » satureraient les cinq places et
// « Kouassi Aya » ne sortirait JAMAIS sur « aya ». Le quota n'ôte rien quand
// les correspondances en milieu de nom sont absentes — l'étape 3 rend alors
// leurs places aux préfixes.
const QUOTA_PREFIXE = 3;

/**
 * `prefixes` : les noms dont la CLÉ commence par la saisie.
 * `mots` : ceux dont un mot NON INITIAL commence par la saisie.
 * Les deux listes sont déjà triées et bornées par l'appelant ; celui-ci
 * garantit aussi qu'elles sont disjointes.
 *
 * Ordre rendu : préfixes (au plus QUOTA_PREFIXE), puis milieux de nom, puis le
 * reste des préfixes en comblement. La tête de nom reste la correspondance la
 * plus probable, elle passe donc devant — mais elle ne peut plus tout prendre.
 */
function fusionnerSuggestions(prefixes, mots, limite) {
  const max = Number.isInteger(limite) && limite > 0 ? limite : 5;
  const retenus = [];
  const vus = new Set();

  // Déduplication par displayName et non par identifiant : c'est une liste de
  // chaînes qui sort d'ici (contrat de la route publique), et deux fiches
  // homonymes affichées deux fois seraient un défaut visible.
  const pousser = (nom) => {
    if (retenus.length >= max || vus.has(nom)) return;
    vus.add(nom);
    retenus.push(nom);
  };

  for (const nom of prefixes.slice(0, QUOTA_PREFIXE)) pousser(nom);
  for (const nom of mots) pousser(nom);
  for (const nom of prefixes) pousser(nom);

  return retenus;
}

module.exports = { QUOTA_PREFIXE, fusionnerSuggestions };
