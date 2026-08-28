const test = require('node:test');
const assert = require('node:assert');

const { nameKey, motsDeCle } = require('../src/name-key');

/**
 * Table de vérité de nameKey().
 *
 * LA MOITIÉ NÉGATIVE EST LA PLUS IMPORTANTE. Réunir deux graphies d'une même
 * personne se rattrape à la main ; fusionner deux personnes distinctes est
 * irréversible — mergeLearners ne conserve aucune provenance. Chaque cas
 * « ne doit PAS » ci-dessous garde une porte fermée.
 */

const DOIVENT_SE_REJOINDRE = [
  ['Aya Koffi', 'Aya  Koffi', 'espace interne double'],
  ['Aya Koffi', ' Aya Koffi ', 'espaces de bord'],
  ['Marie-Claire', 'Marie Claire', 'trait d’union contre espace'],
  ["N'Guessan", 'Nguessan', 'apostroph e droite supprimée'],
  ["N'Guessan", 'N’Guessan', 'apostrophe typographique'],
  ["N'Guessan", 'NʼGuessan', 'apostrophe modificative U+02BC'],
  ['Awa', 'Awâ', 'accent circonflexe'],
  ['Awa', 'AWA', 'casse'],
  ['Traoré M.', 'Traore M', 'point final d’initiale'],
  ['Aya Koffi', 'Aya Koffi', 'espace insécable'],
];

const NE_DOIVENT_PAS = [
  ['Yao Koffi', 'Koffi Yao', 'noms de jour akan : l’ordre des mots fait l’identité'],
  ['Aya', 'Aya Koffi', 'un nom incomplet n’est pas le nom complet'],
  ['Aya Koffi 2', 'Aya Koffi', 'le chiffre distingue deux homonymes'],
  ['Kouassi', 'Kouasi', 'une lettre en moins reste un autre nom pour l’identité'],
  ['Aya Koffi', 'Ava Koffi', 'une lettre différente'],
];

test('graphies qui doivent désigner la même personne', () => {
  for (const [a, b, pourquoi] of DOIVENT_SE_REJOINDRE) {
    assert.strictEqual(nameKey(a), nameKey(b), `${pourquoi} : ${a} / ${b}`);
  }
});

test('graphies qui doivent rester DISTINCTES', () => {
  for (const [a, b, pourquoi] of NE_DOIVENT_PAS) {
    assert.notStrictEqual(nameKey(a), nameKey(b), `${pourquoi} : ${a} / ${b}`);
  }
});

test('aucune clé ne peut contenir de métacaractère GLOB', () => {
  // C'est ce qui autorise db.js à employer GLOB sans clause ESCAPE.
  for (const saisie of ['*', '?', '[a-z]', 'a*b', 'a?b', '%00', 'Aya**Koffi', '[]']) {
    assert.ok(
      !/[*?[\]]/.test(nameKey(saisie)),
      `« ${saisie} » a produit une clé contenant un métacaractère : ${nameKey(saisie)}`
    );
  }
});

test('idempotence — indispensable à la migration', () => {
  // migrerClesDeNom recalcule toujours depuis display_name, mais un rejeu ne
  // doit jamais dériver : nameKey(nameKey(x)) === nameKey(x).
  for (const x of ['Marie-Claire', "N'Guessan Aya", 'Aya  Koffi', 'علي', 'Ayâ 2', '']) {
    assert.strictEqual(nameKey(nameKey(x)), nameKey(x), `non idempotent : ${JSON.stringify(x)}`);
  }
});

test('les lettres non latines sont conservées', () => {
  // Les retirer donnerait une clé vide, et submit répondrait 400 « Entrez votre
  // nom » à quelqu'un qui a bien saisi le sien.
  assert.strictEqual(nameKey('علي'), 'علي');
});

test('une saisie sans lettre ni chiffre donne une clé vide', () => {
  // C'est ce que teste le garde-fou de POST /api/quiz/:id/submit.
  for (const vide of ['', '   ', '...', '---', "'''", null, undefined]) {
    assert.strictEqual(nameKey(vide), '', `devrait être vide : ${JSON.stringify(vide)}`);
  }
});

test('motsDeCle découpe sur l’espace simple et rien d’autre', () => {
  assert.deepStrictEqual(motsDeCle(nameKey('Flore Sidonie N’guessan')), [
    'flore',
    'sidonie',
    'nguessan',
  ]);
  assert.deepStrictEqual(motsDeCle(nameKey('Marie-Claire')), ['marie', 'claire']);
  assert.deepStrictEqual(motsDeCle(''), []);
});
