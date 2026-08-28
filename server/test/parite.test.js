const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Parité des deux stores.
 *
 * db.js et db-memory.js doivent exposer LES MÊMES fonctions, DANS LE MÊME
 * ORDRE. C'est le risque numéro un du dépôt : une fonction ajoutée d'un seul
 * côté ne se voit qu'en mode dégradé — `store.X is not a function` devient un
 * 500, que messagePourFormateur (client/src/api.js) filtre en message générique
 * parce qu'il ne ressemble pas à du français. Le formateur lit « n'a pas pu
 * être chargé » et n'a aucune chance de comprendre. Panne muette.
 *
 * ⚠️ DATA_DIR est posé AVANT le require : db.js crée son fichier de base au
 * chargement du module. Sans cette ligne, lancer les tests écrirait dans
 * data/kemet-quiz.db, la base de développement.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kemet-test-'));

const sqlite = require('../src/db');
const memoire = require('../src/db-memory');

test('les deux stores exposent les mêmes fonctions, dans le même ordre', () => {
  assert.deepStrictEqual(Object.keys(sqlite), Object.keys(memoire));
});

test('chaque fonction d’un store est une fonction dans l’autre', () => {
  // On ne compare QUE les fonctions. Les trois valeurs exportées — DB_PATH,
  // isEphemeral, ephemeralReason — diffèrent légitimement : le store SQLite
  // rend `null` comme raison quand il persiste, celui en mémoire dit toujours
  // pourquoi il ne persiste pas. C'est le contrat, pas un écart.
  for (const [nom, valeur] of Object.entries(sqlite)) {
    if (typeof valeur !== 'function') continue;
    assert.strictEqual(
      typeof memoire[nom],
      'function',
      `${nom} est une fonction dans db.js mais pas dans db-memory.js`
    );
  }
  for (const [nom, valeur] of Object.entries(memoire)) {
    if (typeof valeur !== 'function') continue;
    assert.strictEqual(
      typeof sqlite[nom],
      'function',
      `${nom} est une fonction dans db-memory.js mais pas dans db.js`
    );
  }
});

test('les deux stores suggèrent exactement la même chose', () => {
  const noms = ['Kouassi Aya', 'Aya Koffi', 'Ayala Diarra', 'Bintou Kone', 'Yao Konan'];
  for (const store of [sqlite, memoire]) {
    for (const n of noms) store.createLearner(n);
  }
  // « aya » est le cas qui a motivé la suggestion par mot : « Kouassi Aya » doit
  // sortir alors qu'il ne commence pas par « aya ».
  for (const requete of ['aya', 'kon', 'koffi', 'zzz', 'kouassi']) {
    assert.deepStrictEqual(
      sqlite.suggestLearners(requete, 5),
      memoire.suggestLearners(requete, 5),
      `divergence sur « ${requete} »`
    );
  }
  assert.ok(
    sqlite.suggestLearners('aya', 5).includes('Kouassi Aya'),
    '« Kouassi Aya » doit sortir sur « aya » — c’est tout l’objet de la suggestion par mot'
  );
});

test('les deux stores voient les mêmes doublons probables', () => {
  const doublons = ['Flore Sidonie', "Flore Sidonie N'guessan", "Sidonie N'guessan flore"];
  for (const store of [sqlite, memoire]) {
    for (const n of doublons) store.createLearner(n);
  }
  const a = sqlite.listDuplicateCandidates().map((g) => g.fiches.map((f) => f.displayName));
  const b = memoire.listDuplicateCandidates().map((g) => g.fiches.map((f) => f.displayName));
  assert.deepStrictEqual(a, b);
  assert.ok(a.length > 0, 'les trois graphies de la même personne doivent être rapprochées');
});
