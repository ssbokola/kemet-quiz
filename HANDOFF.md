# Kemet Quiz — Handoff technique

**Dernière mise à jour :** 26 août 2026
**Production :** https://kemet-quiz-production.up.railway.app
**Dépôt :** https://github.com/ssbokola/kemet-quiz (branche `main`, auto-deploy Railway)
**Dernier commit :** `24d8c62` — *Saisie assistée du nom sur l'accueil de l'apprenant*

---

## 1. À quoi sert l'application

Un formateur dépose un support de formation en PDF. L'IA en tire un questionnaire à choix multiples. Le formateur relit et corrige les questions, puis publie : il obtient un lien et un QR code à diffuser. Chaque participant saisit son prénom, répond, et voit immédiatement son score avec la correction commentée, exportable en PDF et partageable sur WhatsApp.

**Deux publics, deux ambiances assumées :**

| | Formateur | Participant |
| --- | --- | --- |
| Support | Desktop surtout | Mobile, arrive par QR code |
| Ambiance | Papier clair, dense, orienté formulaire | Encre & or, une question par écran, mode focus |
| Accès | Protégé par mot de passe | Lien public |

---

## 2. Stack

| Couche | Technologie |
| --- | --- |
| Front | React 19, Vite 8, react-router-dom 7 |
| Back | Node.js, Express 5 |
| Stockage | SQLite **intégré à Node** (`node:sqlite`), fichier sur volume Railway |
| IA | Claude (primaire) → Gemini (repli automatique) |
| PDF entrant | `pdfjs-dist` — extraction **côté navigateur** |
| PDF sortant | `jspdf` |
| QR code | `qrcode.react` |
| Hébergement | Railway (build + run depuis le même service) |

Aucune bibliothèque d'état : `useState` local et remontée de props.

---

## 3. Arborescence

```
kemet-quizz/
├── package.json              scripts racine (dev / build / start / postinstall)
├── .env                      secrets locaux — gitignored
├── client/
│   ├── index.html            meta Open Graph + theme-color
│   └── src/
│       ├── main.jsx          point d'entrée React (createRoot, StrictMode)
│       ├── index.css         reset + design tokens + polices
│       ├── App.css           toute la feuille de style
│       ├── App.jsx           routes
│       ├── api.js            fetch, messages d'erreur véridiques, auth formateur
│       ├── dates.js          formatage français des dates et des périodes
│       ├── components/
│       │   ├── AdminGate.jsx        porte d'accès mot de passe
│       │   ├── AppBar.jsx           barre d'application
│       │   ├── Icon.jsx             jeu d'icônes SVG maison
│       │   ├── RadioGroup.jsx       radiogroup ARIA complet, réutilisable
│       │   ├── UploadPDF.jsx        dépôt + réglages + écran de génération
│       │   ├── ReviewQuestions.jsx  relecture / édition avant publication
│       │   ├── QuizResults.jsx      formateur : réponses reçues par quiz
│       │   ├── Apprenants.jsx       formateur : aiguillage des 4 vues apprenants
│       │   ├── ApprenantsListe.jsx  formateur : annuaire avec moyennes
│       │   ├── ApprenantHistorique.jsx  formateur : historique + période
│       │   ├── PeriodePicker.jsx    sélecteur de période (deux dates)
│       │   ├── AnnuaireApprenants.jsx   formateur : entretien de l'annuaire
│       │   ├── FicheApprenant.jsx   formateur : renommer, (dé)suggérer, fusionner
│       │   ├── Welcome.jsx          accueil apprenant + saisie assistée du nom
│       │   ├── Quiz.jsx             passation, thème encre
│       │   └── Results.jsx          score, correction, export PDF
│       ├── pages/
│       │   ├── AdminPage.jsx        upload → review → share (+ results, apprenants)
│       │   └── QuizPage.jsx         welcome → quiz → results
│       └── assets/           hero.png, react.svg, vite.svg — AUCUN n'est référencé
└── server/
    └── src/
        ├── index.js          API complète (routes, IA, validation)
        ├── db.js             SQLite : schéma, MIGRATIONS, quiz, résultats, apprenants
        ├── db-memory.js      même interface, en mémoire — repli si db.js échoue
        ├── ids.js            newId() — identifiants de fiche, partagé par les deux stores
        ├── periode.js        jours calendaires → instants UTC (la logique la plus piégeuse)
        └── name-key.js       normalisation des noms, partagée par les deux stores
```

---

## 4. Parcours

### Formateur — `/`

1. **Porte d'accès** (`AdminGate`) — mot de passe conservé en `sessionStorage` sous `kemet-quiz-admin-pw`, jamais en `localStorage`.
2. **Dépôt** (`UploadPDF`) — glisser-déposer ou parcourir. Le PDF est lu **dans le navigateur** par pdf.js : seul le texte extrait part sur le réseau (~100 Ko au lieu de 16 Mo). Repli sur l'envoi du binaire si le PDF est scanné (moins de 200 caractères extraits).
3. **Réglages** — titre pré-rempli et modifiable · nombre de questions (5/10/15/20/30) · niveau (facile / moyen / difficile) · diffusion (1 tentative ou libre) · expiration (sans limite / 24 h / 7 jours).
4. **Génération** — trois étapes affichées : lecture du document (progression réelle des pages), rédaction, vérification. Réponse en flux NDJSON.
5. **Relecture** (`ReviewQuestions`) — chaque question est éditable ; cliquer une option la désigne comme bonne réponse ; bouton de régénération par question. Bandeau d'avertissement si des questions ont été écartées à la validation.
6. **Partage** — QR code, lien copiable, envoi WhatsApp, fermeture/réouverture du quiz.
7. **Résultats** (`QuizResults`) — la liste des quiz avec leur nombre de réponses ; pour chacun, qui a répondu, quel score, quand, la moyenne, et un export `.csv` (séparateur `;` et BOM UTF-8, pour qu'Excel en configuration française lise les accents).
8. **Apprenants** (`Apprenants` et ses quatre vues) — l'annuaire avec la moyenne et le nombre d'évaluations de chacun ; l'historique d'un apprenant, filtrable par **deux dates saisies** et exportable en `.csv` (la période appliquée est exportée telle quelle) ; et l'entretien de l'annuaire : créer une fiche, corriger un nom, **sortir une fiche de quarantaine** (bascule `suggestible`), fusionner deux doublons.

> **La moyenne est la moyenne des POURCENTAGES**, pas `Σscore / Σtotal` : chaque évaluation compte pareil, un 5/5 pèse autant qu'un 25/30. C'est un choix explicite de l'utilisateur. Elle n'est jamais affichée seule, toujours avec le nombre d'évaluations — non pondérée, elle est fragile sur peu de mesures.

> Les deux écrans sont accessibles depuis l'écran de création (liens discrets à droite du titre) et depuis l'écran de partage.

### Participant — `/quiz/:id`

1. **Accueil** (`Welcome`) — titre, nombre de questions, durée estimée, **saisie assistée du nom** : à partir de trois caractères, l'application propose les noms connus de l'annuaire, pour que les évaluations successives d'une même personne se rattachent à la même fiche.
   Ce n'est **pas** une combobox ARIA, délibérément : un champ texte ordinaire et de vrais `<button>`, parce que le focus virtuel (`aria-activedescendant`) est précisément ce que TalkBack et VoiceOver iOS tiennent le plus mal, et que la cible est le téléphone.
   **Un échec de suggestion n'est jamais une erreur pour l'apprenant** : la liste se replie, sans un mot, et il tape son nom comme avant. Aucun appel réseau ne précède le début du quiz.
   La liste est rendue **hors du flux** : `.welcome` est en `space-between` avec un `min-height`, et une liste en flux ferait remonter le bouton « Commencer » à chaque aller-retour réseau, sous le pouce.
   **Une étape de confirmation existe sur le chemin critique**, et c'est la seule barrière anti-doublon côté public : si des noms sont proposés et qu'aucun n'a été retenu, « Commencer » n'envoie pas — il ouvre un bloc « Aucun de ces noms n'est le vôtre ? » avec « Corriger » / « Oui, c'est mon nom ». Sans correspondance, en revanche, le quiz démarre directement : il n'y a aucune ambiguïté à lever.
2. **Passation** (`Quiz`) — thème encre (`document.body` reçoit la classe `theme-ink`), une question par écran, **pas d'auto-avance**. Barre segmentée cliquable, feuille « toutes les questions », écran de récapitulatif final qui nomme les questions manquantes, modale de confirmation avant envoi.
   Raccourcis clavier : `A`–`F` ou `1`–`6` pour répondre (le nombre d'options va de 2 à 6 ; A–D est le cas nominal, pas le contrat), `←` `→` `Entrée` pour naviguer, `Escape` pour fermer.
3. **Résultats** (`Results`) — score animé dans un anneau, confettis au-delà de 80 %, correction question par question avec explication, export PDF, partage WhatsApp, bouton « Refaire » si le quiz autorise plusieurs tentatives.

---

## 5. API

| Route | Auth | Rôle |
| --- | :---: | --- |
| `POST /api/admin/check` | mdp | Valide le mot de passe formateur |
| `POST /api/upload-pdf` | ✅ | Génère le quiz. Réponse **NDJSON** en flux : `progress` / `ping` / `done` / `error` |
| `GET /api/quiz/:id/full` | ✅ | Quiz **avec** les réponses, pour la relecture |
| `PATCH /api/quiz/:id` | ✅ | `{ title?, questions?, closed?, expiresInHours?, singleAttempt? }` |
| `POST /api/quiz/:id/regenerate/:index` | ✅ | Régénère une seule question |
| `GET /api/quizzes` | ✅ | Liste des quiz, du plus récent au plus ancien, avec le nombre de réponses |
| `GET /api/quiz/:id/results` | ✅ | Scores enregistrés pour un quiz |
| `GET /api/learners` | ✅ | Annuaire : chaque apprenant avec `attempts`, `avgPercent`, `lastSubmittedAt`. Période optionnelle |
| `GET /api/learners/:id/history` | ✅ | Historique borné par dates + moyenne de la période |
| `POST /api/learners` | ✅ | Le formateur crée une fiche. `409` avec la fiche existante en cas de doublon |
| `PATCH /api/learners/:id` | ✅ | `{ displayName?, suggestible? }`. Ne touche à aucune ligne de `results` |
| `POST /api/learners/:id/merge` | ✅ | `{ intoId }` — déplace les évaluations puis supprime la fiche source |
| `GET /api/learners/suggest` | — | **Publique.** `?q=&quizId=` → `{ suggestions: [...] }`, un tableau de **chaînes seules** — ni id, ni date, ni compteur |
| `GET /api/quiz/:id` | — | Quiz **sans** les réponses. `410` si fermé ou expiré |
| `POST /api/quiz/:id/submit` | — | Corrige et enregistre. `400` si `nameKey()` du nom est vide (espaces ou ponctuation seuls — garde-fou contre une fiche à `name_key` vide qui adopterait toutes les saisies vides), `409` si tentative unique déjà utilisée, `410` si fermé |
| `GET {*splat}` | — | Repli SPA. ⚠️ **Toute route d'API doit être déclarée AVANT lui**, sinon elle renvoie `index.html` à la place du JSON |

**La route de suggestion est publique et c'est un arbitrage assumé.** Elle exige au moins 3 caractères, plafonne à 5 résultats, n'accepte qu'un préfixe strict sur une liste blanche de caractères (`/^[a-z][a-z '-]*$/`, condition de sûreté du `GLOB` qui n'a pas de clause `ESCAPE`), exclut les fiches en quarantaine, exige un `quizId` dont le quiz soit **ouvert et non expiré**, et applique une limitation de débit par IP. Elle reste néanmoins **énumérable** par qui détient un lien de quiz vivant : c'est le prix de la fonctionnalité, voir §8.

**Verrou de confidentialité.** Les cinq routes `/api/learners*` protégées répondent **503** quand `ADMIN_PASSWORD` est vide, plutôt que de laisser `requireAdmin` ouvrir l'annuaire à tous. Le quiz continue de fonctionner ; seul l'annuaire est scellé.

**Authentification :** mot de passe partagé `ADMIN_PASSWORD`, transmis dans l'en-tête `x-admin-password` par `client/src/api.js`.

> ⚠️ **Si `ADMIN_PASSWORD` n'est pas définie, `requireAdmin` laisse passer tout le monde** (`server/src/index.js:20`). C'est voulu pour le confort en développement — mais en production, l'oublier revient à ouvrir la génération de quiz, et donc la consommation des crédits IA, à n'importe quel visiteur.

### Le flux NDJSON

`POST /api/upload-pdf` ne renvoie pas un JSON unique mais une ligne JSON par événement. Un `ping` est émis toutes les 10 secondes pour empêcher le proxy Railway de couper une génération longue. Le client lit le flux avec `res.body.getReader()`.

Motif historique : les gros PDF provoquaient des `502` (`Request aborted` dans multer) parce que l'upload dépassait le délai du proxy. Deux correctifs cumulés — extraction du texte côté navigateur, puis flux NDJSON — ont réglé le problème.

### Stockage

Tout passe par `server/src/db.js`, qui expose **21 fonctions** — les quiz et les résultats, puis l'annuaire d'apprenants (`listQuizzes`, `suggestLearners`, `resolveLearner`, `ensureLearner`, `createLearner`, `updateLearner`, `getLearner`, `listLearners`, `listLearnerHistory`, `findResultByLearner`, `mergeLearners`). `index.js` n'écrit **jamais** en SQL directement, et `server/src/db-memory.js` expose les mêmes 21 fonctions, dans le même ordre.

Trois tables :

| Table | Contenu |
| --- | --- |
| `quizzes` | un quiz par ligne ; les questions sont sérialisées en JSON dans une colonne (elles sont toujours lues et écrites en bloc) |
| `results` | une ligne par participation, liée au quiz par `ON DELETE CASCADE`, et à l'apprenant par `learner_id` (`ON DELETE SET NULL`) |
| `learners` | une fiche par apprenant : `display_name`, `name_key` (unique), `created_by` (`learner` / `trainer` / `import`), `suggestible` |

Index : `idx_results_quiz`, `idx_results_name`, `idx_learners_key` (UNIQUE) et `idx_results_learner_date` — ce dernier sert l'historique d'un apprenant sur une plage de dates, en fournissant à la fois le filtre et l'ordre.

`node:sqlite` (`DatabaseSync`) est **synchrone**. `POST /api/quiz/:id/submit` est resté synchrone de bout en bout — c'est ce qui compte : son cycle lecture → vérification → écriture (la règle de tentative unique) ne peut pas être entrelacé avec une autre requête, aucune transaction n'y est donc nécessaire. Deux gestionnaires sont néanmoins `async` (`upload-pdf` et `regenerate`, qui attendent le modèle), et `db.js` porte **deux transactions explicites** en `BEGIN IMMEDIATE` / `COMMIT` avec `ROLLBACK` : le backfill de migration et la fusion de deux fiches.

#### ⛔ Ne pas revenir à `better-sqlite3`

Le premier essai de persistance utilisait `better-sqlite3`. Il a **mis la production à terre** le 30/07/2026 : son binaire natif provoquait un `Segmentation fault` au démarrage sur l'image Nixpacks de Railway. Un segfault n'est pas rattrapable par `try/catch` — le serveur mourait en boucle, sans message exploitable.

`node:sqlite` est livré **dans le binaire Node**. Aucun composant compilé à télécharger, à sélectionner selon la plateforme, ni à lier : la classe de panne est supprimée, pas contournée. Même moteur SQLite, même format de fichier.

**Le prix à payer**, à connaître avant de toucher à `db.js` :

- **`db.pragma()` n'existe pas.** Les pragmas passent par `db.exec('PRAGMA …')`.
- **`busy_timeout` vaut 0 par défaut** (contre 5 s chez `better-sqlite3`) — d'où le `PRAGMA busy_timeout = 5000` explicite. Ne pas utiliser l'option `{ timeout }` du constructeur : elle n'existe qu'à partir de Node 22.16, le pragma marche dès 22.13.
- **Un paramètre nommé manquant est lié à `NULL` en silence**, là où `better-sqlite3` levait une erreur. Le code actuel fournit toujours tous ses paramètres, et les `NOT NULL` du schéma servent de second garde-fou — mais c'est le piège à surveiller pour toute évolution.
- **Les lignes renvoyées ont un prototype nul** : `row.champ` et `JSON.stringify` marchent, `row.hasOwnProperty()` lève. Sans effet ici, `rowToQuiz`/`rowToResult` reconstruisent des objets normaux.
- **`db.prepare()` n'exécute que la première instruction** d'un SQL multi-instructions, sans erreur. Le schéma passe par `exec()`.
- Un `ExperimentalWarning: SQLite is an experimental feature` s'affiche à chaque démarrage. **Non bloquant, ne pas s'en alarmer dans les logs Railway.**

**Node ≥ 22.13 est donc obligatoire** — d'où `engines.node` à `>=22.13.0` et le `.nvmrc`. Sur Node 20, `node:sqlite` n'existe pas.

### ⚠️ Les migrations de schéma — à lire AVANT de toucher aux tables

Le schéma reposait à l'origine sur `CREATE TABLE IF NOT EXISTS`, qui **n'altère jamais une table existante**. Une colonne ajoutée dans ce bloc n'aurait jamais été créée en production, **en silence**.

Depuis l'annuaire d'apprenants, `server/src/db.js` porte une fonction `migrate()`, **placée entre le bloc `db.exec()` et l'objet `stmt`** — et nulle part ailleurs : `stmt` est préparé au chargement du module et lèverait s'il citait une colonne pas encore créée.

| Opération | Base neuve | Base existante |
| --- | :---: | :---: |
| `CREATE TABLE IF NOT EXISTS` | ✅ | ✅ |
| `CREATE INDEX IF NOT EXISTS` | ✅ | ✅ (table peuplée comprise) |
| Colonne ajoutée au bloc `CREATE TABLE` | ✅ | ❌ **jamais appliquée** |
| `ALTER TABLE … ADD COLUMN` | ✅ | ✅ (purement métadonnée, O(1)) |

**Toute nouvelle colonne passe donc par `ALTER TABLE` dans `migrate()`**, avec détection par `PRAGMA table_info`.

Un échec de migration marque `err.code = 'MIGRATION_FAILED'` et relance. `index.js` **doit** relancer sur ce code au lieu de basculer sur `db-memory` : sans cette discrimination, une migration ratée ne tue pas le serveur, elle fait **perdre silencieusement la persistance** en production, avec pour seule trace deux lignes de console.

La migration est **sûre à interrompre** : chaque DDL est atomique, le backfill est encadré par `BEGIN IMMEDIATE`/`COMMIT`, et l'état intermédiaire laisse l'application pleinement fonctionnelle. Une base migrée reste par ailleurs **lisible par l'ancienne version applicative** — un retour arrière de déploiement ne demande aucun retour arrière de schéma.

### Les fiches d'apprenants reprises de l'historique sont en quarantaine

Le backfill crée une fiche par `player_key` distinct, avec `created_by = 'import'` et `suggestible = 0`. L'historique est intégralement préservé côté formateur, mais **rien de cet import n'apparaît dans les suggestions publiques** : les prénoms de recette ne deviennent pas un annuaire exposé.

Une fiche sort de quarantaine de deux façons : le formateur la valide (`PATCH { suggestible: true }`), ou une vraie personne la **réclame** en passant un quiz — `ensureLearner()` résout par `name_key`, retrouve la fiche et la promeut. Grâce à l'unicité de `name_key`, c'est une **adoption**, pas un doublon : l'historique se recolle tout seul.

### Le repli en mémoire

`index.js` charge le store dans un `try/catch`. Si `db.js` refuse de se charger, il bascule sur `server/src/db-memory.js`, qui expose exactement la même interface derrière des `Map`.

Conséquence : le pire scénario devient « le site tourne, les données ne survivent pas au redémarrage » au lieu de « le site est inaccessible ». Le démarrage annonce alors la vraie cause, et non un diagnostic générique.

`nameKey()` — la normalisation des prénoms — vit dans `server/src/name-key.js`, partagé par les deux stores : ils doivent trancher identiquement, sans quoi la règle de tentative unique changerait de sens en mode dégradé.

### Validation de la sortie du modèle

`normalizeQuestions()` (`server/src/index.js`, vers la ligne 173) s'exécute **à la création et à chaque écriture**. Elle :

- retire le préfixe `A)` des options puis les renumérote proprement — entre 2 et 6 options ;
- accepte la bonne réponse sous trois formes : lettre (`"B"`), index 1-based (`"2"`), ou texte exact de l'option ;
- **écarte** toute question inexploitable et la comptabilise dans `dropped`, remonté jusqu'au bandeau d'avertissement de l'écran de relecture ;
- lève une erreur explicite si rien n'est exploitable.

C'est le garde-fou contre les sorties LLM malformées. Ne pas le contourner en écrivant directement en base.

**Tentative unique :** les noms sont comparés sans accents ni casse. La normalisation (`nameKey()`, `server/src/name-key.js`, importée par les deux stores) est stockée dans la colonne `results.player_key` : « Awa », « awa » et « Awâ » sont la même personne, et la comparaison se fait en SQL sur un index.

---

## 6. Design system

Tokens déclarés dans `client/src/index.css` sous `:root`, consommés partout via `var(--…)`.

| Token | Valeur | Usage |
| --- | --- | --- |
| `--gold` | `#c8a45a` | Fond des boutons d'action, progression |
| `--gold-deep` | `#7a6528` | **Tout texte or** et liens (5,4:1 sur blanc) |
| `--gold-soft` | `#f6eedc` | Fonds d'accentuation |
| `--ink` | `#1f1d24` | Titres, **texte sur bouton or** |
| `--ink-deep` | `#17161a` | Fond de l'écran de quiz |
| `--paper` | `#fbfaf8` | Fond des écrans clairs |
| `--text-3` / `--text-3-weak` | `#6b6459` / `#797263` | Métadonnées, micro-copie. L'ancien `--text-4` a été **fusionné** dans `--text-3` ; `--text-3-weak` a un contrat précis (plancher 4,58:1 sur `--paper`) |
| `--ok` / `--err` / `--wa` | `#2e7d5b` / `#c0453b` / `#1f7a4c` | Juste / faux / WhatsApp |

**Typographie :** Instrument Serif pour les titres (poids 400 uniquement), Instrument Sans pour l'interface, importées depuis Google Fonts en tête de `index.css`.

**Règles à tenir :**

- Les contrastes ont été vérifiés au ratio **WCAG AA**. Ne pas éclaircir les gris, ne pas remettre du texte blanc sur fond or.
- Cibles **primaires** jamais sous 44 px ; options de quiz à 60 px, boutons d'action à 52–56 px. Deux exceptions assumées : `.tool-btn` à 32 px (outils par question de la relecture) et `--h-chip` à 36 px (contrôle secondaire du thème encre).
- Deux points de rupture : **720 px** (partout) et **480 px** (uniquement `.periode-champs`, qui passe à deux colonnes).
- `@media (prefers-reduced-motion: reduce)` neutralise animations et transitions.
- Icônes : `Icon.jsx` uniquement, pas d'emoji. Noms disponibles : `doc` `check` `close` `arrowRight` `arrowLeft` `chevronRight` `chevronLeft` `copy` `send` `download` `refresh` `list` `info` `edit` `search` `chart` `chevronDown`.
  **La flèche circulaire (`refresh`) est réservée à « régénérer / refaire ». Le partage utilise `send`.**
- ⚠️ Si la charte évolue, basculer `--gold` / `--gold-hover` / `--gold-deep` **ne suffit PAS** : dix autres tokens or sont des littéraux indépendants (`--gold-deep-hover`, `--gold-soft`, `--gold-border`, `--gold-light`, `--gold-ink`, `--gold-track`, `--gold-line`, `--gold-line-ink`, `--gold-fill-soft`, `--gold-halo`). Le découplage est **volontaire** et documenté dans `index.css` — un token de contour n'a pas le même contrat de contraste qu'un token de remplissage. Il faut les reprendre un par un, en recalculant les ratios.

Le logo Kemet est vert, l'interface est or — choix assumé et validé : le vert reste sur le logo, l'or porte l'action.

---

## 7. Configuration

### Variables d'environnement

| Variable | Où | Rôle |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Railway + `.env` local | Claude, générateur principal |
| `GEMINI_API_KEY` | Railway + `.env` local | Repli automatique |
| `ADMIN_PASSWORD` | Railway + `.env` local | Protège l'espace formateur |
| `PORT` | Railway (auto) | Défaut `3001` |
| `RAILWAY_VOLUME_MOUNT_PATH` | Railway (auto, si un volume est attaché) | Emplacement de la base SQLite |
| `DATA_DIR` | Optionnel | Force l'emplacement de la base. Sert surtout aux tests |

**Emplacement de la base**, par ordre de priorité : `DATA_DIR` → `RAILWAY_VOLUME_MOUNT_PATH` → `<racine>/data` (gitignoré, pour le développement local).

> ⚠️ **Le volume Railway n'est pas optionnel.** Sans volume attaché au service, la base est écrite dans le système de fichiers du conteneur et disparaît à chaque déploiement — exactement le comportement d'avant. Pour éviter que ce soit silencieux, le serveur détecte le cas au démarrage et écrit un avertissement dans les *Deploy Logs* :
>
> ```
> ⚠️  Données NON persistées : aucun volume Railway monté — attachez un Volume au service, puis redéployez
> ```
>
> Le volume `quiz-data` est en place depuis le 30/07/2026, monté sur `/data`. Railway injecte `RAILWAY_VOLUME_MOUNT_PATH` tout seul, aucune variable à saisir à la main.
>
> **Pour le recréer** : la création passe par la palette `Ctrl+K` ou un clic droit sur le canvas du projet — **pas** par un onglet du service. Le changement est d'abord *staged* : il faut ensuite le déployer pour qu'il prenne effet.

### Version de Node

`engines.node` vaut `>=22.13.0` et un `.nvmrc` fige le majeur sur `22`. Ce n'est pas cosmétique : en dessous de 22.13, `node:sqlite` n'existe pas et l'application démarrerait en mode dégradé sans persistance. Railway tourne actuellement sur `node@22.23.1`.

Le `.env` local est dans `.gitignore`.

> 🔐 **Ne jamais faire transiter une clé API par un chat, un ticket ou un document partagé.** Une clé Anthropic a déjà dû être révoquée pour cette raison. Anthropic n'affiche la valeur complète d'une clé **qu'une seule fois, à sa création** : une clé perdue ou compromise ne se récupère pas, il faut en créer une autre et refaire la configuration partout.

### Scripts

```bash
npm run dev     # client + serveur en parallèle (client sur 5173, API sur 3001)
npm run build   # build du client
npm start       # serveur seul, sert client/dist
```

En développement, Vite relaie `/api` vers `http://localhost:3001` (`client/vite.config.js`).

### Déploiement

Push sur `main` → Railway lance `postinstall` (installe serveur + client, build le client) puis `npm start`. Compter environ deux minutes.

---

## 8. Limitations connues

### Une seule instance de serveur

SQLite est un fichier posé sur un volume, et un volume Railway ne se monte que sur **une** instance. Passer le service à plusieurs répliques corromprait la base. Si la charge l'exigeait un jour, il faudrait basculer sur Postgres — le point de bascule est petit, tout l'accès aux données est déjà isolé dans `db.js`.

### Les sauvegardes sont manuelles

Aucune sauvegarde automatique du fichier `.db`. Pour une copie de sûreté, passer par la CLI Railway ou un montage temporaire.

### ⛔ Le détail des réponses n'est PAS conservé

C'est la limitation la plus importante aujourd'hui, et le prochain chantier (§10).

`results` garde `quiz_id`, `player_name`, `player_key`, `learner_id`, `score`, `total` et `submitted_at` — mais **aucun détail par question**. On sait qu'Aya a fait 3/5 ; on ne sait **jamais** sur quelles questions elle s'est trompée. Le serveur calcule pourtant la correction complète à chaque envoi (`index.js`, dans le gestionnaire de `submit`) et la renvoie à l'apprenant — puis la jette.

Conséquence pédagogique : impossible de répondre à « quelle question est ratée par tout le monde ? », qui est probablement la question la plus utile qu'un formateur puisse poser à cet outil.

### La suggestion publique est énumérable

Qui détient un lien de quiz **ouvert** peut parcourir l'espace des préfixes de 3 lettres — quelques milliers de requêtes — et reconstituer l'essentiel de l'annuaire. La limitation de débit renchérit l'attaque, elle ne l'empêche pas. Les seuls remèdes réels seraient d'authentifier l'apprenant, ou de ne pas avoir d'annuaire.

Évolution qui le réglerait : rattacher l'annuaire à une **promotion** et ne suggérer que parmi les apprenants de la session du quiz. La surface passerait de « tout l'annuaire » à « une classe ».

### La suggestion ne fonctionne que par le DÉBUT du nom

Une fiche « Kouassi Aya » ne sortira jamais sur « aya ». Le formateur doit tenir une convention de saisie stable — prénom d'abord ou nom d'abord, mais toujours la même. À dire à l'utilisateur, ce n'est pas devinable.

### ⚠️ `nameKey()` ne normalise ni les espaces internes ni les traits d'union

« Aya  Koffi » (double espace) et « Aya Koffi » sont deux personnes, avec deux fiches, deux historiques et deux tentatives uniques. « Marie-Claire » ≠ « Marie Claire ».

**Ne PAS corriger `server/src/name-key.js` sans migration dédiée.** Les `results.player_key` déjà stockés cesseraient de correspondre à ce que la fonction renvoie : la règle de tentative unique casserait en silence sur tout l'historique, et le regroupement du backfill divergerait de la résolution. C'est un chantier à part, avec sa propre réécriture de `player_key`.

### Aucun test automatisé

Ni script `test`, ni répertoire de tests. Toute la vérification est manuelle. C'est le point faible de fond du projet.

### Divers

- Les polices sont chargées depuis Google Fonts — à auto-héberger pour un fonctionnement hors ligne.
- `client/public/kemet-logo.svg` n'est plus référencé (remplacé par le PNG recadré), il peut être supprimé.
- `client/public/icons.svg` et `client/src/assets/` (`react.svg`, `vite.svg`) sont des restes du gabarit Vite, inutilisés.
- Non suivis par git à la racine, et à arbitrer : l'archive `Amélioration UXUI appli quiz.zip` (son contenu est intégré, elle peut disparaître), ainsi que `design-systems/`, `taste/` et `tokens/`.

---

## 9. État des vérifications

### ⚠️ Le lot « annuaire d'apprenants » n'a PAS été éprouvé en production

Livré les 24 et 26/08/2026 (`1ed0c86`, `c8a39c3`, `24d8c62`). Tout ce qui suit dans cette section date des 29 et 30/07 et lui est **antérieur** : ne lisez pas ces tableaux comme une validation de l'annuaire.

**Ce qui a bien été vérifié, mais en local :**

| Point | Méthode | Résultat |
| --- | --- | --- |
| Migration sur base de forme production | Base reconstruite avec l'**ancien** code (3 quiz, 11 participations, graphies incohérentes, lignes à clé vide), puis migrée sur des copies | ✅ schéma créé, backfill correct, **non-rejeu** au second démarrage, interruption entre l'`ALTER` et le `COMMIT` sans fiche partielle |
| Retour arrière possible | Base migrée relue par l'ancienne version applicative | ✅ aucun retour arrière de schéma nécessaire |
| Route publique de suggestion | `curl` : `q=*`, `q=[a-z]`, `%00`, pleines chasses unicode, 60 requêtes rapides | ✅ liste vide partout, plafond de 5 tenu, `429` au-delà du seau |
| Bornes de période | « au 3 août » sur une participation de 18h35 ce jour-là | ✅ incluse ; « au 2 août » l'exclut ; 31 février et fin < début refusés |
| Moyenne | 1/2 et 9/10 | ✅ 70 %, et non 83,3 % qu'aurait donné `SUM/SUM` |
| Parité des deux stores | Harnais différentiel sur les 9 fonctions d'annuaire | ✅ après correction de trois écarts (tri inversé, préfixe vide qui déversait l'annuaire, repli du `limit`) |
| Saisie assistée | Parcours complet dans le navigateur : quiz passé sous un nom neuf, puis nom suggéré ; flèches, Échap, confirmation, champ vide | ✅ et **0 px** de déplacement du bouton « Commencer » à l'apparition de la liste |

**Ce qui n'a PAS été vérifié et devrait l'être en premier :**

- La migration **sur la vraie base de production** (elle a tourné sur des copies et sur la base de développement, pas sur Railway).
- Le comportement de l'annuaire **à plusieurs dizaines de fiches** — le plafond de 5 suggestions n'a été éprouvé que sur un jeu minuscule.
- La fusion de deux fiches **en production**.
- Le volume Railway toujours attaché après ce déploiement : l'écran Apprenants affiche un bandeau explicite si ce n'est plus le cas.

---

**Vérifié en production le 29/07/2026 :**

| Point | Méthode | Résultat |
| --- | --- | --- |
| Nouveau front déployé | `curl` sur `/` | ✅ `theme-color #1f1d24`, logo PNG |
| Espace formateur protégé | `POST /api/admin/check` sans mot de passe | ✅ `401` |
| Participants non bloqués | `GET /api/quiz/<id bidon>` | ✅ `404` (et non `401`) |

### ⚠️ La leçon du 30/07/2026 : tester sur le Node de Railway, pas sur celui du poste

La première tentative de persistance a été validée sur le poste de développement (Windows, Node 24) et déclarée bonne. Elle a mis la production à terre pendant une dizaine de minutes : `better-sqlite3` embarque un binaire compilé, et ce binaire segfaultait sur l'image Linux de Railway. **Un test « ça marche chez moi » ne dit rien dès qu'un composant compilé ou une version de runtime entre en jeu.**

Depuis, la vérification se fait avec le **binaire Node de la version exacte de Railway** (`node-v22.23.1`), et pas seulement avec le Node du poste. C'est ce qui a permis de valider le portage vers `node:sqlite` sans second incident.

**Vérifié le 30/07/2026 sur Node 22.23.1 — la version exacte de Railway :**

| Épreuve | Portée | Résultat |
| --- | --- | --- |
| `node:sqlite` sans drapeau | `require('node:sqlite').DatabaseSync` | ✅ disponible |
| Contrat du store SQLite | 17 vérifications sur `db.js` | ✅ toutes |
| Contrat du store de repli | 15 vérifications sur `db-memory.js` | ✅ toutes — interfaces interchangeables |
| Parcours HTTP complet | 12 vérifications sur le serveur réel | ✅ toutes |
| **Après redémarrage du serveur** | 10 vérifications rejouées | ✅ titre, état, résultats et tentative unique retrouvés |
| Repli en mode dégradé | stockage rendu volontairement impossible | ✅ serveur debout, cause exacte annoncée |
| Les trois messages de démarrage | volume OK / volume absent / SQLite indisponible | ✅ chacun dit la vérité |
| **Correctif du modèle Claude** | vraie génération (4 questions) + régénération d'une question | ✅ `Success with Claude`, 6 s et 3 s, aucune fuite de balise de raisonnement |

**Vérifié en local le 30/07/2026, lors de la première tentative** (serveur sur un port de test, base isolée, quiz injecté directement dans le store pour éviter un appel IA) :

| Point | Méthode | Résultat |
| --- | --- | --- |
| Quiz servi sans les réponses | `GET /api/quiz/:id` | ✅ aucune clé `answer` |
| Correction et score | `POST /submit` | ✅ `1/2`, explications incluses |
| Tentative unique, accents et casse | « Éric » puis « eric » | ✅ `409` |
| Écriture formateur | `PATCH` titre + fermeture | ✅ `200`, puis `410` côté participant |
| Réouverture | `PATCH closed:false` | ✅ `200` |
| Expiration | `PATCH expiresInHours` | ✅ date posée, `-1` remet à « sans limite » |
| Questions invalides refusées | `PATCH` avec 1 seule option | ✅ `400`, base inchangée |
| Quiz inconnu / index hors bornes | `GET`, `POST /regenerate/9` | ✅ `404`, `400` |
| **Survie au redémarrage** | arrêt du serveur, relance sur la même base | ✅ titre modifié, état d'ouverture et **3 résultats** retrouvés ; le `409` s'applique toujours |
| Avertissement sans volume | démarrage avec `RAILWAY_ENVIRONMENT`, sans `DATA_DIR` | ✅ message d'alerte émis |
| **Création réelle d'un quiz** | `POST /api/upload-pdf` avec un vrai texte, 3 questions | ✅ flux NDJSON complet, quiz écrit en base, `sourceText` conservé — mais généré par Gemini (voir plus bas) |

Non rejoué depuis le passage à SQLite : les parcours dans le navigateur. Ils ne touchent pas au stockage, mais restent à refaire une fois en production.

**Vérifié en local avant l'intégration UX/UI :** parcours formateur complet (dépôt → réglages → génération → relecture → publication), parcours participant complet (accueil → passation → résultats → correction), régénération d'une question, édition du titre, fermeture d'un quiz (`410`), tentative unique (`409`), reprise après rafraîchissement.

### ✅ Le modèle Claude mort — corrigé le 30/07/2026

Pendant plusieurs semaines, **tous les quiz ont été produits par Gemini** sans que rien ne le signale : le modèle `claude-sonnet-4-20250514` n'était plus servi, et le repli automatique masquait la panne.

```
Claude failed: 404 {"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}
Falling back to Gemini...
Success with Gemini gemini-2.5-flash
```

La clé Anthropic était valide : un `404 not_found_error` désigne le **modèle**, pas la clé. Le diagnostic de la version précédente de ce document (« `401` → clé mal enregistrée dans Railway ») était faux.

**Ce qui a changé** — l'identifiant vit désormais dans une seule constante en tête de `server/src/index.js` :

```js
const MODEL = 'claude-sonnet-5';
const EFFORT = 'medium';
```

Sur ce modèle, le raisonnement est **actif par défaut** et puise dans le même budget que la réponse. Deux conséquences dans le code :

- `max_tokens` a été relevé (16 000, ou 32 000 au-delà de 15 questions ; 8 192 pour la régénération d'une question). Ce n'est qu'un plafond : seuls les tokens réellement produits sont facturés.
- La régénération ne concatène plus que les blocs de type `text`. Les blocs de raisonnement n'ont pas de champ `text` et pollueraient le JSON attendu.

`EFFORT` règle la profondeur de raisonnement (`low` → `max`). `medium` est l'équilibre coût/qualité ; le monter améliore les distracteurs des questions difficiles, au prix de tokens supplémentaires.

> ⚠️ **Le repli sur Gemini rend toute panne de Claude invisible.** C'est ce qui a laissé passer celle-ci. Après tout changement touchant l'IA, vérifier dans les *Deploy Logs* que la ligne est bien `Success with Claude` et non `Falling back to Gemini`.

---

## 10. Prochain chantier — conserver le détail des réponses

**C'est le chantier demandé par l'utilisateur, à ouvrir en priorité.**

### Le besoin, dans ses mots

> « On sait qu'Aya a fait 3/5, jamais sur quelles questions elle s'est trompée. »

Et derrière, la question qu'un formateur d'officine veut vraiment poser : **quelle question est ratée par tout le monde ?** C'est elle qui dit quoi reprendre en formation.

### Ce qui existe déjà, et qu'il suffit de ne plus jeter

`server/src/index.js`, gestionnaire de `POST /api/quiz/:id/submit` : la correction complète est **déjà calculée** — pour chaque question, la réponse donnée, la bonne réponse, et si elle était juste. Elle part dans la réponse HTTP, puis disparaît. Rien n'est à recalculer, tout est à persister.

### Les décisions à prendre avec l'utilisateur, avant d'écrire

1. **Grain de stockage.** Une table `answers(result_id, question_index, given, correct)` — normalisée, interrogeable, permet « la question 3 est ratée par 80 % » d'une requête. Ou une colonne JSON sur `results` — plus simple, mais rend toute statistique agrégée pénible. **Recommandation : la table.** C'est précisément ce que le JSON empêcherait de faire.
2. **Le texte de la question.** Les questions d'un quiz sont modifiables après coup (`PATCH /api/quiz/:id`). Faut-il figer l'énoncé au moment de la réponse, comme `player_name` l'est déjà, ou toujours relire le quiz courant ? Ce n'est pas un détail : sans figeage, une statistique portera sur un énoncé qui a changé.
3. **Ce qu'on montre, et à qui.** Une vue « questions les plus ratées » par quiz ? Le détail par apprenant dans son historique ? Les deux ? L'apprenant voit déjà sa correction à l'envoi — la question porte sur le formateur.
4. **Rétroactivité.** Les évaluations déjà enregistrées n'ont aucun détail et n'en auront jamais. L'écran doit le dire, plutôt que d'afficher un vide qu'on prendra pour un bug.

### Le chemin technique

- **Migration obligatoire** — relire §5, la section sur `migrate()`. Une nouvelle table passe par `CREATE TABLE IF NOT EXISTS` dans `migrate()`, et **la parité de `server/src/db-memory.js` doit suivre dans le même lot** : 21 exports identiques, dans le même ordre.
- Index à prévoir : `(result_id)` pour le détail d'une participation, `(quiz_id, question_index)` pour l'agrégat « les plus ratées » — ce dernier suppose de porter `quiz_id` sur la table, ou une jointure par `results`.
- Volume : 30 questions × N participations. Sur un usage d'officine, c'est négligeable.
- Le corps de `POST /submit` ne change pas. Seul l'enregistrement s'enrichit.

### Pièges déjà payés sur ce projet, à ne pas repayer

- **`AVG(score * 100.0 / total)`** — sans le `.0`, `INTEGER/INTEGER` est une division entière en SQLite et toute moyenne sort à zéro.
- **Filtre de dates dans le `ON` d'une `LEFT JOIN`**, jamais dans le `WHERE` : dans le `WHERE`, il annule la jointure externe et fait disparaître les lignes sans correspondance.
- **Bornes de période** : `>= from AND < toExclusive`, où `toExclusive` est minuit du lendemain. `<= '2026-03-31'` perd toute la journée du 31.
- **Écrire le CSS APRÈS le JSX**, en lisant le code réel. Trois fois sur ce projet, un agent a nommé une classe qu'un autre n'a pas écrite, et la dernière fois c'est parti en production.
- **Ne jamais `git add .`** quand deux chantiers cohabitent dans l'arbre de travail.

---

## 11. Autres pistes

| Chantier | Intérêt | Effort |
| --- | --- | --- |
| **Détail des réponses** (§10) | La vraie valeur pédagogique : quoi reprendre en formation | Moyen |
| Rattacher l'annuaire à une promotion | Referme l'énumération de la route publique (§8) | Moyen |
| Normaliser espaces et traits d'union dans `nameKey` | Corrige un vrai défaut — **exige sa propre migration** (§8) | Moyen |
| Tests automatisés | Aucun aujourd'hui ; tout repose sur la vérification manuelle | Moyen |
| Auto-hébergement des polices | Performance, hors ligne | Faible |
| Sauvegarde périodique de la base | Filet de sécurité | Faible |
| Mode révision (réponse dévoilée à chaque question) | Usage entraînement | Faible |

> Les chantiers « tableau de bord des résultats », « liste des quiz du formateur » et « export CSV » de la version précédente de ce document sont **faits** — voir §5 et §8.
