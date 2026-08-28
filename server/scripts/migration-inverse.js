#!/usr/bin/env node
/**
 * MIGRATION INVERSE — outil d'urgence. Écrit en même temps que la migration
 * directe, versionné, et JAMAIS EXÉCUTÉ automatiquement.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  À QUOI ÇA SERT
 * ══════════════════════════════════════════════════════════════════════════
 *
 * migrerClesDeNom() (server/src/db.js) a renormalisé results.player_key et
 * learners.name_key avec la nouvelle nameKey(). Si l'on redéploie une version
 * applicative ANTÉRIEURE sur cette base, l'ancien code recalcule des clés
 * d'ancien format alors que la base en porte de nouveau format.
 *
 * Mesuré sur la base de production du 28/08/2026 : 3 noms sur 8 concernés.
 * Aucune donnée n'est perdue — le schéma est inchangé, toutes les lignes
 * survivent — mais pour ces noms-là :
 *   · la règle de tentative unique ne répond plus (on peut repasser le quiz) ;
 *   · ensureLearner ne retrouve plus la fiche et en recrée une en double.
 * Le tout EN SILENCE.
 *
 * Ce script remet les clés dans l'ancien format. Il est PRÉFÉRABLE à la
 * restauration de la sauvegarde : il ne perd aucune participation enregistrée
 * depuis que la sauvegarde a été prise.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  MODE D'EMPLOI
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   1. ARRÊTER LE SERVICE d'abord. Deux écrivains sur un fichier SQLite
 *      pendant une réparation, c'est comme ça qu'on fabrique le problème
 *      suivant. (Railway : mettre les répliques à 0, ou mettre en pause.)
 *   2. railway ssh
 *   3. node /data/migration-inverse.js            (essai à blanc, n'écrit rien)
 *   4. node /data/migration-inverse.js --appliquer
 *   5. Redémarrer le service, puis VÉRIFIER : envoyer deux fois les réponses
 *      sous un nom à apostrophe ou à trait d'union — le 409 doit revenir.
 *
 * Le script s'envoie sur le volume avec :
 *   railway volume files --volume quiz-data upload server/scripts/migration-inverse.js /migration-inverse.js
 */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// L'ANCIENNE règle, recopiée ici telle qu'elle était avant le lot 4. Elle est
// FIGÉE : ce fichier ne doit jamais importer name-key.js, qui porte la
// nouvelle. C'est tout l'objet du script.
function cleAncienne(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const APPLIQUER = process.argv.includes('--appliquer');
const DATA_DIR =
  process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'kemet-quiz.db');

console.log(`Base    : ${DB_PATH}`);
console.log(`Mode    : ${APPLIQUER ? 'APPLICATION RÉELLE' : 'essai à blanc (rien ne sera écrit)'}`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 10000');

const version = db.prepare('PRAGMA user_version').get().user_version;
console.log(`Version : ${version}`);
if (version < 2) {
  console.log('\nCette base n’a pas été migrée (user_version < 2). Rien à faire.');
  process.exit(0);
}

const resultats = db.prepare('SELECT id, player_name, player_key FROM results').all();
const fiches = db.prepare('SELECT id, display_name, name_key FROM learners').all();

const resAChanger = resultats.filter((r) => cleAncienne(r.player_name) !== r.player_key);
const fichesAChanger = fiches.filter((l) => cleAncienne(l.display_name) !== l.name_key);

console.log('');
console.log(`${resAChanger.length} participation(s) à remettre en ancien format :`);
for (const r of resAChanger.slice(0, 20)) {
  console.log(`   « ${r.player_name} » : ${JSON.stringify(r.player_key)} → ${JSON.stringify(cleAncienne(r.player_name))}`);
}
console.log(`${fichesAChanger.length} fiche(s) à remettre en ancien format :`);
for (const l of fichesAChanger) {
  console.log(`   « ${l.display_name} » : ${JSON.stringify(l.name_key)} → ${JSON.stringify(cleAncienne(l.display_name))}`);
}

// Les fusions faites depuis l'écran « Doublons probables » ne se défont PAS :
// mergeLearners supprime la fiche source sans conserver la provenance. Ce
// script ne prétend rétablir que les CLÉS.
const collisions = new Map();
for (const l of fiches) {
  const cible = cleAncienne(l.display_name);
  if (!collisions.has(cible)) collisions.set(cible, []);
  collisions.get(cible).push(l.display_name);
}
const bloquantes = [...collisions.entries()].filter(([c, v]) => c && v.length > 1);
if (bloquantes.length) {
  console.log('');
  console.log('⚠️  Collisions en ancien format — ces fiches ne pourront pas toutes reprendre leur clé :');
  for (const [c, v] of bloquantes) console.log(`   ${JSON.stringify(c)} ← ${v.join(' + ')}`);
  console.log('   (la première nommée garde la clé, les autres restent en l’état)');
}

if (!APPLIQUER) {
  console.log('');
  console.log('Essai à blanc terminé. Relancer avec --appliquer pour écrire.');
  process.exit(0);
}

const majRes = db.prepare('UPDATE results SET player_key = @cle WHERE id = @id');
const majFiche = db.prepare('UPDATE learners SET name_key = @cle WHERE id = @id');

db.exec('BEGIN IMMEDIATE');
try {
  for (const r of resAChanger) majRes.run({ cle: cleAncienne(r.player_name), id: r.id });

  // Deux passes, comme à l'aller : réécrire dans l'ordre buterait sur l'index
  // UNIQUE dès qu'une fiche prend une clé qu'une autre n'a pas encore libérée.
  const pris = new Set();
  const retenues = [];
  for (const l of fichesAChanger) {
    const cible = cleAncienne(l.display_name);
    if (!cible || pris.has(cible)) continue;
    pris.add(cible);
    retenues.push({ id: l.id, cible });
  }
  for (const f of retenues) majFiche.run({ cle: ` inverse-${f.id}`, id: f.id });
  for (const f of retenues) majFiche.run({ cle: f.cible, id: f.id });

  db.exec('PRAGMA user_version = 1');
  db.exec('COMMIT');
  console.log('');
  console.log(`Fait : ${resAChanger.length} participation(s), ${retenues.length} fiche(s). user_version remis à 1.`);
  console.log('Redémarrez le service, puis vérifiez qu’un second envoi sous le même nom renvoie bien 409.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('ÉCHEC — rien n’a été écrit :', err.message);
  process.exit(1);
}
