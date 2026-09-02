# Kemet Quiz — Handoff technique

**Dernière mise à jour :** 2 septembre 2026
**Production :** https://kemet-quiz-production.up.railway.app
**Dépôt :** https://github.com/ssbokola/kemet-quiz (branche `main`, auto-deploy Railway)
**Dernier commit déployé :** `0d88f57` — *Reorganiser la navigation formateur d'apres un mockup Claude Design* (§17)
**Non encore déployé à cette mise à jour :** `dbee414` — « Mes quiz » n'est plus un tableau mais une liste de cartes (voir §17, sous-section dédiée) : le tableau dense déployé dans `0d88f57` forçait un défilement horizontal en production, l'utilisateur l'a refusé même une fois le défilement rendu visible (`6eba99e`, superseded par `dbee414`, gardé pour l'historique). Code écrit, testé et vérifié, en attente du feu vert pour le push.

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
│       ├── App.jsx           routes + mise en page formateur + AdminGate
│       ├── api.js            fetch, messages d'erreur véridiques, auth formateur
│       ├── quiz-api.js       les 4 appels « quiz » du formateur, phrases de repli comprises
│       ├── chemins.js        les adresses de l'espace formateur, en un seul endroit
│       ├── ecran.js          focus au montage (gardé) + titre de l'onglet
│       ├── quiz-etat.js      en ligne / fermé / expiré, dit d'un seul endroit
│       ├── diffusion.js      les durées de validité du lien
│       ├── nom.js            la phrase qui décrit une fusion
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
│       │   ├── DoublonsProbables.jsx formateur : groupes de fiches à réunir — PARAMÉTRÉ, réutilisé par les officines
│       │   ├── ChampAssiste.jsx     champ à suggestion + verrou, extrait de Welcome (nom ET officine)
│       │   ├── AffecterOfficines.jsx formateur : rattacher en masse les fiches sans officine
│       │   ├── OfficineHistorique.jsx formateur : résultats d'une officine, tous quiz confondus
│       │   │   (ces deux-là sont réutilisés DEPUIS OfficinesEspace.jsx — voir pages/, §17 —
│       │   │    Officines.jsx et FicheOfficine.jsx, eux, ont été retirés le 02/09/2026, remplacés)
│       │   ├── Welcome.jsx          accueil apprenant, DEUX étapes : nom, puis officine
│       │   ├── Quiz.jsx             passation, thème encre
│       │   └── Results.jsx          score, correction, export PDF
│       ├── pages/
│       │   ├── Dashboard.jsx        formateur : tableau de bord, index de l'espace formateur (§17)
│       │   ├── CreationQuiz.jsx     dépôt du PDF (enveloppe de UploadPDF), route /formateur/nouveau
│       │   ├── MesQuiz.jsx          la liste des quiz, en cartes (.quiz-list), avec recherche
│       │   ├── PartageQuiz.jsx      QR, lien, WhatsApp, remise en ligne
│       │   ├── RelectureQuiz.jsx    relecture + brouillon local des corrections
│       │   ├── OfficinesEspace.jsx  formateur : officines en maître-détail (§17), route /formateur/officines
│       │   └── QuizPage.jsx         welcome → quiz → results
│       └── assets/           hero.png, react.svg, vite.svg — AUCUN n'est référencé
└── server/
    └── src/
        ├── index.js          API complète (routes, IA, validation)
        ├── db.js             SQLite : schéma, MIGRATIONS, quiz, résultats, apprenants
        ├── db-memory.js      même interface, en mémoire — repli si db.js échoue
        ├── ids.js            newId() — identifiants de fiche, partagé par les deux stores
        ├── periode.js        jours calendaires → instants UTC (la logique la plus piégeuse)
        ├── name-key.js       normalisation des noms — décide de l'IDENTITÉ
        ├── suggestion.js     fusion des deux familles de correspondance, quota compris
        ├── similarite.js     rapprochement de fiches — PROPOSE, ne décide jamais
        ├── mots-vides-officine.js  mots à ignorer pour juger si une officine est un doublon (§14)
        └── sauvegarde.js     sauvegardes SQLite périodiques, VACUUM INTO (§16)
    scripts/
        └── migration-inverse.js  outil d'urgence, jamais lancé automatiquement
    test/
        ├── name-key.test.js  table de vérité de nameKey (les deux moitiés)
        └── parite.test.js    les deux stores exposent et rendent la même chose
```

---

## 4. Parcours

### Formateur — `/`

Depuis le 02/09/2026 (§17), tout l'espace formateur partage une **barre à 4 onglets persistants** (`AppBar`, prop `tabs`) : Tableau de bord · Nouveau quiz · Mes quiz · Officines — défilante horizontalement sous 720 px, jamais un onglet qui disparaît.

1. **Porte d'accès** (`AdminGate`) — mot de passe conservé en `sessionStorage` sous `kemet-quiz-admin-pw`, jamais en `localStorage`.
2. **Tableau de bord** (`Dashboard`, index de `/formateur` depuis §17) — un bandeau de 4 chiffres clés (`GET /api/dashboard` : score moyen global, réponses, apprenants, officines actives), un lien de dépôt, les derniers apprenants et les officines actives avec liens « Tout voir ».
4. **Dépôt** (`UploadPDF`, route `/formateur/nouveau` depuis §17) — glisser-déposer ou parcourir, en deux colonnes dès qu'un fichier est choisi (document à gauche, réglages à droite). Le PDF est lu **dans le navigateur** par pdf.js : seul le texte extrait part sur le réseau (~100 Ko au lieu de 16 Mo). Repli sur l'envoi du binaire si le PDF est scanné (moins de 200 caractères extraits).
5. **Réglages** — titre pré-rempli et modifiable · nombre de questions (5/10/15/20/30) · niveau (facile / moyen / difficile) · diffusion (1 tentative ou libre) · expiration (sans limite / 24 h / 7 jours).
6. **Génération** — trois étapes affichées : lecture du document (progression réelle des pages), rédaction, vérification. Réponse en flux NDJSON.
7. **Relecture** (`ReviewQuestions`) — chaque question est éditable ; cliquer une option la désigne comme bonne réponse ; bouton de régénération par question. Bandeau d'avertissement si des questions ont été écartées à la validation.
8. **Partage** — QR code, lien copiable, envoi WhatsApp, fermeture/réouverture du quiz.
9. **Mes quiz** (`MesQuiz`, onglet de la barre persistante) — depuis §17, une **liste de cartes** (`.quiz-list`), une par quiz : titre + état, puis officine / score / QR + action contextuelle (Copier en ligne, Réouvrir fermé, Prolonger le lien expiré) / Résultats + Ouvrir, qui s'empilent en hauteur (`flex-wrap`) plutôt que de déborder en largeur. Un **tableau dense** avait été essayé d'abord (mockup) puis abandonné le 03/09 : il forçait un défilement horizontal en production, refusé par l'utilisateur.
10. **Résultats** (`QuizResults`, un quiz à la fois) — qui a répondu, quel score, quand, la moyenne. Depuis §17, mise en page à **deux colonnes** : colonne principale (fil d'Ariane, résumé, exports, tableau des réponses avec officine sur chaque ligne), colonne latérale (« Ce qu'il faut reprendre », depuis le 28/08 §13). Deux exports : `.csv` (séparateur `;`, BOM UTF-8, colonne Officine depuis le 31/08) et depuis §17 un **récapitulatif PDF** (jsPDF, entièrement côté client, même recette que `Results.jsx`).
11. **Officines** (`OfficinesEspace`, route `/formateur/officines`, onglet de la barre persistante depuis §17) — disposition **maître-détail** : liste filtrable à gauche, détail de l'officine choisie à droite (apprenants rattachés, moyenne, dernier passage), avec accès à la fusion de doublons, l'affectation en masse et l'historique de résultats (§15) — ces trois flux sont réutilisés tels quels, pas reconstruits.
12. **Apprenants** (`Apprenants` et son aiguillage interne) — l'annuaire avec la moyenne et le nombre d'évaluations de chacun ; l'historique d'un apprenant, filtrable par **deux dates saisies** et exportable en `.csv` (la période appliquée est exportée telle quelle, colonne Officine comprise) ; l'entretien de l'annuaire : créer une fiche, corriger un nom, **sortir une fiche de quarantaine** (bascule `suggestible`), fusionner deux doublons. Depuis §17, les officines n'y vivent plus (voir point 11) — le lien qui y menait a été retiré.

> **La moyenne est la moyenne des POURCENTAGES**, pas `Σscore / Σtotal` : chaque évaluation compte pareil, un 5/5 pèse autant qu'un 25/30. C'est un choix explicite de l'utilisateur. Elle n'est jamais affichée seule, toujours avec le nombre d'évaluations — non pondérée, elle est fragile sur peu de mesures.

> Les deux écrans sont accessibles depuis l'écran de création (liens discrets à droite du titre) et depuis l'écran de partage.

### Participant — `/quiz/:id`

1. **Accueil** (`Welcome`) — titre, nombre de questions, durée estimée, puis **DEUX étapes depuis le 31/08** (§14) : le nom, puis l'officine. Chaque étape utilise le même composant `ChampAssiste` (extrait de l'ancien champ unique) : à partir de trois caractères, l'application propose les valeurs connues (noms via `/api/learners/suggest`, officines via `/api/pharmacies/suggest`), pour que les évaluations successives d'une même personne — ou d'une même officine — se rattachent à la même fiche. L'officine est **obligatoire pour démarrer, mais n'a pas besoin de correspondre à une officine déjà connue** : une saisie libre est acceptée sans confirmation.
   Ce n'est **pas** une combobox ARIA, délibérément : un champ texte ordinaire et de vrais `<button>`, parce que le focus virtuel (`aria-activedescendant`) est précisément ce que TalkBack et VoiceOver iOS tiennent le plus mal, et que la cible est le téléphone.
   **Un échec de suggestion n'est jamais une erreur pour l'apprenant** : la liste se replie, sans un mot, et il tape comme avant. Aucun appel réseau ne précède le début du quiz.
   La liste est rendue **hors du flux** : `.welcome` est en `space-between` avec un `min-height`, et une liste en flux ferait remonter le bouton d'action à chaque aller-retour réseau, sous le pouce.
   **Une étape de confirmation existe sur chaque champ**, et c'est la seule barrière anti-doublon côté public : si des valeurs sont proposées et qu'aucune n'a été retenue, le bouton n'envoie pas — il ouvre un bloc de confirmation. Sans correspondance, en revanche, l'étape avance directement : il n'y a aucune ambiguïté à lever.
   **Pourquoi deux étapes et non un seul écran à deux champs** : mesuré sur le titre de production le plus long à 375×667, verrouiller les deux champs à la fois dépasse le budget d'espace libre que `.welcome` (`space-between`) laisse au-dessus du bouton, et l'aurait déplacé — interdit par la règle « zéro pixel » de cet écran (voir l'en-tête de `Welcome.jsx`). L'officine reste **facultative côté serveur** (`POST /submit`) : une session commencée avant ce déploiement n'est jamais passée par cette étape, et `QuizPage` saute `Welcome` à la reprise — un 400 sur `pharmacyName` manquant aurait enfermé ces apprenants avec leurs réponses déjà en cours.
2. **Passation** (`Quiz`) — thème encre (`document.body` reçoit la classe `theme-ink`), une question par écran, **pas d'auto-avance**. Barre segmentée cliquable, feuille « toutes les questions », écran de récapitulatif final qui nomme les questions manquantes, modale de confirmation avant envoi.
   Raccourcis clavier : `A`–`F` ou `1`–`6` pour répondre (le nombre d'options va de 2 à 6 ; A–D est le cas nominal, pas le contrat), `←` `→` `Entrée` pour naviguer, `Escape` pour fermer.
3. **Résultats** (`Results`) — score animé dans un anneau, confettis au-delà de 80 %, export PDF, partage WhatsApp (déjà tous les deux en place avant §17, non reconstruits), bouton « Refaire » si le quiz autorise plusieurs tentatives. Depuis §17, le détail question par question est **replié par défaut** derrière « Afficher le détail question par question » (bouton, `aria-expanded`), les erreurs mises en avant en premier — auparavant tout était montré d'un bloc.

---

## 5. API

| Route | Auth | Rôle |
| --- | :---: | --- |
| `POST /api/admin/check` | mdp | Valide le mot de passe formateur |
| `POST /api/upload-pdf` | ✅ | Génère le quiz. Réponse **NDJSON** en flux : `progress` / `ping` / `done` / `error` |
| `GET /api/quiz/:id/full` | ✅ | Quiz **avec** les réponses, pour la relecture |
| `PATCH /api/quiz/:id` | ✅ | `{ title?, questions?, closed?, expiresInHours?, singleAttempt? }` |
| `POST /api/quiz/:id/regenerate/:index` | ✅ | Régénère une seule question |
| `GET /api/quizzes` | ✅ | Liste des quiz, du plus récent au plus ancien, avec le nombre de réponses. Depuis §17, enrichie de `avgPercent`/`topPharmacyName`/`pharmacyCount` pour la liste de cartes de « Mes quiz » |
| `GET /api/dashboard` | ✅ | Depuis §17. `{ avgPercent, totalResponses, totalLearners, activePharmacies }`, tous quiz confondus — alimente le tableau de bord |
| `GET /api/quiz/:id/results` | ✅ | Scores enregistrés pour un quiz |
| `GET /api/learners` | ✅ | Annuaire : chaque apprenant avec `attempts`, `avgPercent`, `lastSubmittedAt`. Période optionnelle |
| `GET /api/learners/:id/history` | ✅ | Historique borné par dates + moyenne de la période |
| `POST /api/learners` | ✅ | Le formateur crée une fiche. `409` avec la fiche existante en cas de doublon |
| `PATCH /api/learners/:id` | ✅ | `{ displayName?, suggestible?, pharmacyId? }`. `pharmacyId` doit exister (`404` sinon) ; ne touche à aucune ligne de `results` |
| `POST /api/learners/:id/merge` | ✅ | `{ intoId }` — déplace les évaluations puis supprime la fiche source |
| `GET /api/learners/doublons` | ✅ | Groupes de fiches désignant probablement la même personne. **Lecture seule : elle propose, le formateur tranche.** ⚠️ Déclarée AVANT `/api/learners/:id/history` — « doublons » est un segment littéral qu'un `:id` capterait |
| `GET /api/learners/suggest` | — | **Publique.** `?q=&quizId=` → `{ suggestions: [...] }`, un tableau de **chaînes seules** — ni id, ni date, ni compteur |
| `GET /api/pharmacies` | ✅ | Annuaire des officines, avec le nombre d'apprenants rattachés à chacune |
| `POST /api/pharmacies` | ✅ | Le formateur crée une officine. `409` avec l'officine existante en cas de doublon |
| `PATCH /api/pharmacies/:id` | ✅ | `{ displayName? }` |
| `POST /api/pharmacies/:id/merge` | ✅ | `{ intoId }` — déplace apprenants **et** participations, transactionnel |
| `GET /api/pharmacies/doublons` | ✅ | Groupes d'officines probablement identiques. ⚠️ Déclarée avant tout `/api/pharmacies/:id` |
| `GET /api/pharmacies/suggest` | — | **Publique.** `?q=` → `{ suggestions: [...] }`. Autorise les **chiffres** (`des 2 Plateaux`), à la différence de `/learners/suggest` — voir §14 |
| `GET /api/quiz/:id` | — | Quiz **sans** les réponses. `410` si fermé ou expiré |
| `POST /api/quiz/:id/submit` | — | Corrige et enregistre. `400` si `nameKey()` du nom est vide (espaces ou ponctuation seuls — garde-fou contre une fiche à `name_key` vide qui adopterait toutes les saisies vides), `409` si tentative unique déjà utilisée, `410` si fermé. `pharmacyName` est **facultatif** (§14) |
| `GET {*splat}` | — | Repli SPA. ⚠️ **Toute route d'API doit être déclarée AVANT lui**, sinon elle renvoie `index.html` à la place du JSON |

**La route de suggestion est publique et c'est un arbitrage assumé.** Elle exige au moins 3 caractères, plafonne à 5 résultats, n'accepte qu'un préfixe strict sur une liste blanche de caractères (`/^[a-z][a-z '-]*$/`, condition de sûreté du `GLOB` qui n'a pas de clause `ESCAPE`), exclut les fiches en quarantaine, exige un `quizId` dont le quiz soit **ouvert et non expiré**, et applique une limitation de débit par IP. Elle reste néanmoins **énumérable** par qui détient un lien de quiz vivant : c'est le prix de la fonctionnalité, voir §8.

`/api/pharmacies/suggest` partage la même fabrique de route (`routeSuggestion`) et donc **le même seau anti-abus par IP** que `/api/learners/suggest` — les dupliquer aurait doublé le budget de sondage en silence. Sa liste blanche autorise les chiffres (`/^[a-z0-9][a-z0-9 ]*$/`) : une officine peut légitimement s'appeler « Pharmacie des 2 Plateaux », alors qu'un nom de personne n'en a jamais besoin et que les refuser y limite l'énumération. `SEAU_CAPACITE` est passé de 20 à 30 en conséquence (deux champs assistés par apprenant, une salle entière derrière la même IP).

**Verrou de confidentialité.** Les cinq routes `/api/learners*` protégées répondent **503** quand `ADMIN_PASSWORD` est vide, plutôt que de laisser `requireAdmin` ouvrir l'annuaire à tous. Le quiz continue de fonctionner ; seul l'annuaire est scellé.

**Authentification :** mot de passe partagé `ADMIN_PASSWORD`, transmis dans l'en-tête `x-admin-password` par `client/src/api.js`.

> ⚠️ **Si `ADMIN_PASSWORD` n'est pas définie, `requireAdmin` laisse passer tout le monde** (`server/src/index.js:20`). C'est voulu pour le confort en développement — mais en production, l'oublier revient à ouvrir la génération de quiz, et donc la consommation des crédits IA, à n'importe quel visiteur.

### Le flux NDJSON

`POST /api/upload-pdf` ne renvoie pas un JSON unique mais une ligne JSON par événement. Un `ping` est émis toutes les 10 secondes pour empêcher le proxy Railway de couper une génération longue. Le client lit le flux avec `res.body.getReader()`.

Motif historique : les gros PDF provoquaient des `502` (`Request aborted` dans multer) parce que l'upload dépassait le délai du proxy. Deux correctifs cumulés — extraction du texte côté navigateur, puis flux NDJSON — ont réglé le problème.

### Stockage

Tout passe par `server/src/db.js`, qui expose **36 fonctions** — les quiz et les résultats, l'annuaire d'apprenants, le détail des réponses (§13 : `listQuestionStats`, `listResultAnswers`), l'annuaire des officines (§14 : `suggestPharmacies`, `resolvePharmacy`, `ensurePharmacy`, `createPharmacy`, `updatePharmacy`, `getPharmacy`, `listPharmacies`, `mergePharmacies`, `listDuplicatePharmacyCandidates`, `setLearnerPharmacy`), les résultats d'une officine tous quiz confondus (§15 : `listPharmacyHistory`) et depuis le 02/09 les chiffres du tableau de bord (§17 : `getDashboardStats`). `index.js` n'écrit **jamais** en SQL directement, et `server/src/db-memory.js` expose les mêmes 36 fonctions, **dans le même ordre** — c'est `parite.test.js` qui le garantit à chaque ajout. `server/src/sauvegarde.js` (§16) fait délibérément EXCEPTION à ce compte : il n'ajoute rien aux exports de l'un ou l'autre store, précisément pour ne courir aucun risque sur cette parité.

Cinq tables :

| Table | Contenu |
| --- | --- |
| `quizzes` | un quiz par ligne ; les questions sont sérialisées en JSON dans une colonne (elles sont toujours lues et écrites en bloc) |
| `results` | une ligne par participation, liée au quiz par `ON DELETE CASCADE`, à l'apprenant par `learner_id` (`ON DELETE SET NULL`) et à l'officine par `pharmacy_id` (`ON DELETE SET NULL`) ; porte aussi `pharmacy_name`, la graphie figée du jour |
| `learners` | une fiche par apprenant : `display_name`, `name_key` (unique), `created_by` (`learner` / `trainer` / `import`), `suggestible`, `pharmacy_id` (l'officine ACTUELLE de la fiche) |
| `pharmacies` | une officine par ligne, mêmes 6 colonnes que `learners` (`display_name`, `name_key` unique, `created_at`, `created_by`, `suggestible`) |
| `answers` | le détail par question d'une participation — voir §13 |

Index : `idx_results_quiz`, `idx_results_name`, `idx_learners_key` (UNIQUE), `idx_results_learner_date`, `idx_pharmacies_key` (UNIQUE), `idx_results_pharmacy`, `idx_learners_pharmacy` et `idx_results_pharmacy_date` (§15).

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

#### `migrerClesDeNom()` — la migration de DONNÉES du 28/08/2026

`nameKey()` a été réécrite ; les clés déjà stockées ne correspondaient plus. La reprise vit dans `migrate()`, **entre `CREATE INDEX idx_results_learner_date` et `backfillLearners()`** — et cet ordre compte : le backfill regroupe les orphelins par `player_key`, renormaliser d'abord lui fait produire directement les bonnes fiches.

| Point | Choix, et pourquoi |
| --- | --- |
| Marqueur | **`PRAGMA user_version`** (0 → 2). Zéro octet de schéma, **transactionnel** — vérifié sur Node 22.23.2 : il repart au `ROLLBACK`. `PRAGMA table_info` ne sait détecter qu'un changement de STRUCTURE, il est aveugle à une migration de données déjà jouée. |
| `results.player_key` | Réécriture **intégrale**. Aucune contrainte d'unicité sur cette colonne : rien ne peut entrer en collision. |
| `learners.name_key` | Réécriture **là où la clé cible est libre**, en deux passes par clé temporaire — réécrire dans l'ordre buterait sur l'index UNIQUE dès qu'une fiche prend une clé qu'une autre n'a pas encore libérée. |
| Les collisions | **NE SONT PAS FUSIONNÉES.** Elles gardent leur ancienne clé et sont journalisées au démarrage ; l'écran « Doublons probables » les montre, le formateur tranche. `mergeLearners` supprime la source **sans conserver la provenance** : une fusion à tort ne se défait pas, même la sauvegarde en main. |
| Idempotence | Par **construction**, pas seulement par le marqueur : la clé est toujours recalculée depuis `player_name`/`display_name`, jamais dérivée de la clé stockée, et `nameKey(nameKey(x)) === nameKey(x)`. |
| Durée | Une transaction, un `fsync`. Sur la base de production (13 quiz, 10 participations, 10 fiches) : imperceptible. |

⛔ **NE PAS RENDRE CET ÉCHEC NON FATAL.** La tentation est réelle et documentée dans le code : « la réécriture est cosmétique, un ROLLBACK laisse l'application debout ». C'est **faux**, et dangereusement : le code et les données sont livrés ensemble, donc après un ROLLBACK la base porte des clés d'ancien format pendant que le code en calcule de nouveau format. Le serveur tournerait en cassant la tentative unique et en fabriquant des doublons à chaque envoi, sans un mot. Mourir est ici le comportement sûr.

⚠️ **`mergeLearners()` est inappelable depuis `migrate()`** : elle ouvre sa propre transaction (SQLite n'en imbrique pas) et surtout elle lit `stmt`, un `const` initialisé **après** l'appel de `migrate()` — la lire lèverait dans sa zone morte temporelle. Toutes les requêtes de la migration sont préparées **localement**, comme le fait déjà `backfillLearners`.

**Éprouvé le 28/08/2026 sur une COPIE de la base de production**, prise à chaud par `VACUUM INTO` : 3 participations et 3 fiches réécrites, 1 collision laissée en l'état et journalisée, `integrity_check` ok, aucun résultat perdu, aucun orphelin créé, et **second passage strictement no-op**. Aller-retour avec `migration-inverse.js` : clés **identiques à l'original**.

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

`engines.node` vaut `>=22.13.0` et un `.nvmrc` fige le majeur sur `22`. Ce n'est pas cosmétique : en dessous de 22.13, `node:sqlite` n'existe pas et l'application démarrerait en mode dégradé sans persistance. Railway tourne actuellement sur **`node@22.23.2`** (relevé le 28/08/2026 dans les logs de build ; le poste de développement est en `24.14.0`).

**Pour vérifier sur le vrai Node de Railway sans l'installer**, le canal SSH suffit :

```bash
railway ssh node --version
railway volume files --volume quiz-data upload <script-local> /sonde.js
railway ssh node /data/sonde.js
```

⚠️ Sous Git Bash, poser `MSYS_NO_PATHCONV=1` avant toute commande `railway` qui prend un chemin distant : sans cela `/sonde.js` est réécrit en `C:/Program Files/Git/sonde.js`. Et le quoting ne survit pas à `railway ssh node -e "…"` : passer par un fichier téléversé.

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

### ✅ Sauvegardes automatiques — ajoutées le 31/08/2026, à activer aussi côté Railway

Voir §16. Deux couches, pas redondantes :

1. **Sauvegarde native du volume Railway** (Settings du service → Backups) : snapshot du volume entier, capture `.db` et `.db-wal` ensemble dans un état cohérent, protège contre la perte totale du volume. **Doit être activée à la main dans le tableau de bord** — aucune CLI ni API ne l'expose, ce n'est pas automatisable depuis ce dépôt.
2. **`server/src/sauvegarde.js`** : un fichier `.db` autonome écrit périodiquement sur le même volume via `VACUUM INTO`, pratique pour une copie qu'un formateur peut retrouver et télécharger sans passer par les sauvegardes de Railway. Ne protège PAS contre la perte du volume — c'est le rôle de la couche 1.

### ✅ Le détail des réponses est conservé — corrigé le 28/08/2026

Voir §13. Une table `answers` garde, pour chaque participation, la réponse donnée et la bonne réponse question par question. « Ce qu'il faut reprendre » (écran Résultats) et le détail dépliable de l'historique d'un apprenant en découlent. Les participations antérieures à cette date n'ont pas de détail et n'en auront jamais — l'écran le dit plutôt que d'afficher un vide qu'on prendrait pour un bug.

### Un léger mouvement du bouton « Commencer » à 320 px de large (iPhone SE)

Trouvé le 31/08/2026 en testant l'écran d'accueil pour le chantier des officines (§14), **pas causé par lui** : verrouiller le champ **nom seul**, sur la version À UN SEUL CHAMP déjà en production avant ce chantier, déplace déjà le bouton de 45 px à cette largeur précise (budget d'espace libre à 7 px avant verrouillage, contre ~125 px à 375 px de large, la largeur normalement vérifiée). Confirmé par lecture du code déployé, qui partage la même structure de bloc « nom retenu » que la version actuelle. **Non corrigé** : hors périmètre du chantier qui l'a trouvé, à traiter pour lui-même si un écran plus étroit que 375 px doit être garanti.

### La suggestion trouve désormais N'IMPORTE QUEL mot du nom

« Kouassi Aya » sort sur « aya », ce qui n'était pas le cas : la requête ne portait que sur le **début** de la clé, et c'est la cause de doublon la plus fréquente observée en production. Deux requêtes préparées (`suggestLearners`, `suggestLearnersMot`), fusionnées par `server/src/suggestion.js` — module partagé, pour que les deux stores ne puissent pas diverger.

**Le quota de 3 places pour les correspondances en tête de nom n'est pas décoratif** : sans lui, cinq fiches en « Aya… » satureraient les cinq places et « Kouassi Aya » ne sortirait jamais sur « aya » — la fonctionnalité s'annulerait dans le cas précis qui la motive.

Le motif à joker initial (`'* aya*'`) **n'utilise aucun index** et balaie la table. Assumé : quelques centaines de fiches tiennent en trois pages déjà en cache, et le `LIMIT` arrête au cinquième. **À revoir au-delà de ~20 000 fiches, pas avant.**

### La suggestion publique est énumérable

Qui détient un lien de quiz **ouvert** peut parcourir l'espace des préfixes de 3 lettres — quelques milliers de requêtes — et reconstituer l'essentiel de l'annuaire. La limitation de débit renchérit l'attaque, elle ne l'empêche pas. Les seuls remèdes réels seraient d'authentifier l'apprenant, ou de ne pas avoir d'annuaire.

**La suggestion par mot élargit la surface, et il faut le dire :** le **coût d'un sondage exhaustif est inchangé** — c'est le nombre de requêtes qui le fixe, pas leur rendement, et un sondage exhaustif récupérait déjà tout. Ce qui change, c'est le rendement d'un sondage **partiel** : il double environ, une fiche étant désormais atteignable par son prénom **ou** son patronyme (~2 mots par fiche). La normalisation des traits d'union y ajoute un peu.

Levier disponible si l'on veut compenser : porter le minimum de la seule famille « milieu de nom » à 4 caractères. **Non retenu** — l'exemple canonique du chantier (« aya ») fait trois lettres.

Évolution qui le réglerait : rattacher l'annuaire à une **promotion** et ne suggérer que parmi les apprenants de la session du quiz. La surface passerait de « tout l'annuaire » à « une classe ».

### La suggestion ne fonctionne que par le DÉBUT du nom

Une fiche « Kouassi Aya » ne sortira jamais sur « aya ». Le formateur doit tenir une convention de saisie stable — prénom d'abord ou nom d'abord, mais toujours la même. À dire à l'utilisateur, ce n'est pas devinable.

### ✅ `nameKey()` normalise désormais espaces, traits d'union et apostrophes — corrigé le 28/08/2026

« Aya  Koffi » = « Aya Koffi », « Marie-Claire » = « Marie Claire », « N'Guessan » = « Nguessan » (toutes graphies d'apostrophe comprises). La migration `migrerClesDeNom()` a réécrit `results.player_key` et `learners.name_key` en conséquence — voir §5.

**Ce qui reste vrai et ne doit pas être oublié :** toute nouvelle modification de `server/src/name-key.js` exige sa propre migration, dans le même commit. La livrer seule casserait la tentative unique en silence sur tout l'historique.

**Ce qui n'est volontairement PAS fusionné :** l'ordre des mots (« Yao Koffi » ≠ « Koffi Yao » — noms de jour akan), les chiffres (« Aya Koffi 2 »), une lettre de différence. Le rapprochement de ces cas-là vit dans `server/src/similarite.js`, qui **propose** au formateur, et jamais dans `nameKey()`, qui **tranche**. La recherche et l'identité ne partagent jamais la même fonction.

### Le retour arrière applicatif est devenu DÉGRADANT — et il ne l'était pas

La promesse d'origine — « une base migrée reste lisible par l'ancienne version applicative » — tient encore sur le schéma, qui est inchangé : l'ancienne version démarre, lit tout, **ne perd aucune donnée**. Ce qui ne tient plus, c'est la sémantique : elle recalculerait des clés d'ancien format sur une base de nouveau format.

**Mesuré sur la base de production du 28/08/2026 : 3 noms sur 8** verraient la tentative unique devenir muette, et `ensureLearner` leur recréerait une fiche en double. En silence.

Deux parades, dans cet ordre :

1. **`server/scripts/migration-inverse.js`** — écrit en même temps que la migration directe, versionné, jamais exécuté automatiquement. Il remet les clés en ancien format et `user_version` à 1. Éprouvé en aller-retour sur une copie de production : les clés reviennent **identiques à l'original**, sans perte. Il est préférable à la restauration — il ne perd aucune participation postérieure à la sauvegarde. Lancer d'abord sans `--appliquer` (essai à blanc).
2. La restauration de la sauvegarde binaire, qui perd tout ce qui est arrivé depuis.

### Quelques tests automatisés, enfin — mais le minimum

`npm test` (soit `node --test`) fait tourner `server/test/` : `node:test` + `node:assert`, **zéro dépendance ajoutée** — capital sur un projet qu'un binaire natif a déjà mis à terre.

| Fichier | Ce qu'il ferme |
| --- | --- |
| `name-key.test.js` | La table de vérité de `nameKey`. **La moitié négative est la plus importante** : réunir deux graphies d'une personne se rattrape à la main, fusionner deux personnes ne se défait pas. Y figurent aussi l'impossibilité des métacaractères GLOB et l'idempotence, dont dépend la migration. |
| `parite.test.js` | Les deux stores exposent les mêmes fonctions, dans le même ordre, et rendent la même chose sur la suggestion et les doublons. C'est le risque numéro un du dépôt : une fonction ajoutée d'un seul côté ne se voit qu'en mode dégradé, sous forme d'un 500 que le client traduit en message générique. |

⚠️ Chaque test pose `process.env.DATA_DIR` sur un dossier temporaire **avant** le `require` : `db.js` crée son fichier de base au chargement du module, et sans cette ligne les tests écriraient dans `data/kemet-quiz.db`.

Refusé délibérément, pour que ça ne devienne pas un chantier : pas de framework, pas de CI, pas de couverture, pas de tests de composants React (il faudrait jsdom + testing-library, donc une seconde pile à entretenir). **L'accessibilité de ce projet se vérifie au lecteur d'écran, pas par une assertion.**

Restent à écrire quand l'occasion se présentera : un différentiel complet des 22 fonctions de store, un harnais de migration versionné, et un parcours HTTP de bout en bout.

### Divers

- Les polices sont chargées depuis Google Fonts — à auto-héberger pour un fonctionnement hors ligne.
- `client/public/kemet-logo.svg` n'est plus référencé (remplacé par le PNG recadré), il peut être supprimé.
- `client/public/icons.svg` et `client/src/assets/` (`react.svg`, `vite.svg`) sont des restes du gabarit Vite, inutilisés.
- Non suivis par git à la racine, et à arbitrer : l'archive `Amélioration UXUI appli quiz.zip` (son contenu est intégré, elle peut disparaître), ainsi que `design-systems/`, `taste/` et `tokens/`.

---

## 9. État des vérifications

### Détail des réponses et officines — vérifiés le 28 et le 31/08/2026, EN PRODUCTION

Contrairement au lot « annuaire d'apprenants » ci-dessous, ces deux chantiers ont été vérifiés **après** leur déploiement, pas seulement en local.

| Point | Méthode | Résultat |
| --- | --- | --- |
| Détail des réponses | Quiz réel repassé en production, historique déplié | ✅ détail correct, question par question |
| Migration officines sur base réelle | Copie de production (`VACUUM INTO`), démarrage sur la copie | ✅ schéma créé, `user_version` inchangé, second démarrage no-op |
| Déploiement officines | `railway status` / `railway logs` juste après le push | ✅ `Online`, commit attendu, démarrage sans `MIGRATION_FAILED` |
| Route publique `/api/pharmacies/suggest` | `curl` en production après déploiement | ✅ `200`, pas de `404` |
| Bundle servi | Hash du fichier JS dans le HTML de production comparé au build local | ✅ identique (`index-DRlHEbgg.js`) |
| Regroupement par officine, recherche, CSV (Lot 4) | Script Node autonome rejouant la logique sur les vraies données de développement (pas de navigateur — écran protégé par mot de passe) | ✅ tous les cas limites (0, 1, 2+ officines) |
| Écran Welcome à deux étapes | Navigateur, 375×667, quiz réel du titre le plus long | ✅ **0 px** de déplacement du bouton dans les 4 combinaisons nom/officine verrouillés ou non |
| Continuité du service pendant le déploiement | Logs de production pendant le déploiement | ✅ un apprenant réel a continué de passer des quiz sans interruption visible |

⚠️ **Non vérifié en navigateur réel sur la production** : les écrans Officines / Fiche officine / Affecter en masse (protégés par mot de passe formateur — l'assistant ne saisit jamais de mot de passe, même de test). Vérifiés en local dans le navigateur et par le script ci-dessus ; à confirmer par le formateur à l'usage.

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

## 10. Prochain chantier

**Rien n'est décidé pour l'instant.** Tout ce qui a été demandé jusqu'ici est fait : conserver le détail des réponses (§13), rattacher chaque apprenant à une officine (§14), naviguer depuis une officine vers tous ses résultats (§15), sauvegardes automatiques (§16), réorganisation de la navigation formateur d'après un mockup Claude Design (§17 — voir l'en-tête du document pour l'état exact du déploiement à la date de cette mise à jour). Piocher dans §11 « Autres pistes » à la prochaine demande, ou attendre la prochaine remontée du terrain.

### Pièges déjà payés sur ce projet, à ne pas repayer

- **`AVG(score * 100.0 / total)`** — sans le `.0`, `INTEGER/INTEGER` est une division entière en SQLite et toute moyenne sort à zéro.
- **Filtre de dates dans le `ON` d'une `LEFT JOIN`**, jamais dans le `WHERE` : dans le `WHERE`, il annule la jointure externe et fait disparaître les lignes sans correspondance.
- **Bornes de période** : `>= from AND < toExclusive`, où `toExclusive` est minuit du lendemain. `<= '2026-03-31'` perd toute la journée du 31.
- **Écrire le CSS APRÈS le JSX**, en lisant le code réel. Trois fois sur ce projet, un agent a nommé une classe qu'un autre n'a pas écrite, et la dernière fois c'est parti en production.
- **Ne jamais `git add .`** quand deux chantiers cohabitent dans l'arbre de travail.
- **Sur ce poste Windows, l'édition de fichier repasse le fichier en CRLF**, et peut ponctuellement corrompre un caractère en octet NUL au milieu d'une chaîne. Le dépôt est en LF. Avant tout commit, repasser les fichiers touchés en LF et vérifier l'absence d'octet NUL — un script Node de quelques lignes suffit (`buf[i] === 0`, `\r\n` → `\n`). Trouvé pour la première fois le 31/08/2026 sur `QuizResults.jsx` : un octet NUL introduit dans une clé React, sans effet visible, mais un fichier binaire-sale ne devrait jamais partir en commit.

---

## 11. Autres pistes

| Chantier | Intérêt | Effort |
| --- | --- | --- |
| Rattacher l'annuaire à une promotion | Referme l'énumération de la route publique (§8) | Moyen |
| Tableau de bord par officine | Explicitement écarté pour l'instant par l'utilisateur (§14) — à reproposer si le besoin change | Moyen |
| Tests automatisés côté client | Aucun aujourd'hui ; l'accessibilité se vérifie au lecteur d'écran, pas par une assertion | Moyen |
| Auto-hébergement des polices | Performance, hors ligne | Faible |
| Mode révision (réponse dévoilée à chaque question) | Usage entraînement | Faible |

> Les chantiers « tableau de bord des résultats », « liste des quiz du formateur », « export CSV », « détail des réponses », « rattacher une officine », « sauvegarde périodique de la base » et « normaliser espaces et traits d'union dans `nameKey` » de la version précédente de ce document sont **faits** — voir §5, §8, §13, §14, §15 et §16.

---

## 12. Les quatre lots du 28 août 2026

Livrés dans cet ordre, du moins risqué au plus risqué. **Non commités à la date de cette mise à jour.**

### Lot 0 — Reconnaissance (aucun code)

Premier acte, et il manquait : personne n'avait regardé ce que l'annuaire avait produit en production depuis son déploiement du 26/08.

- Volume `quiz-data` bien monté sur `/data`, API confirmant `{"persistant":true}`.
- **10 fiches pour 10 participations — dont 4 fiches pour UNE SEULE personne**, portant 5 des 10 évaluations : « Flore Sidonie », « Flore Sidonie  N'guessan » (double espace), « Flore Sidonie N'guessan », « Sidonie N'guessan flore » (ordre inversé). Le diagnostic du chantier, en vrai.
- ⚠️ **Le `.db` fait 4 Ko, le `-wal` 824 Ko.** Copier le seul `.db` aurait donné une base **vide**. D'où `VACUUM INTO`, jamais `cp`.
- Sauvegarde binaire prise, rapatriée et **vérifiée localement** : `data/prod-20260828-1420.db`, 217 Ko, `integrity_check: ok`. Une copie qu'on n'a pas ouverte n'est pas une sauvegarde.
- Une sauvegarde logique JSON complète l'ensemble. `data/` est gitignoré — ces fichiers contiennent des noms d'apprenants et ne doivent jamais partir sur le dépôt public.

### Lot 1 — Prévention des doublons

**Le nom retenu se fige.** Cliquer une suggestion ne faisait que recopier son texte : un caractère retouché derrière rouvrait une fiche neuve. Le champ passe en `readOnly` — **jamais `disabled`**, qui le sortirait de la tabulation et de l'annonce alors que le focus lui est justement rendu — avec une sortie explicite « Ce n'est pas moi » à 44 px, qui conserve et **sélectionne** le texte.
Mesuré : **0 px de déplacement du bouton « Commencer »** dans les trois états.
Corrigé au passage : `.field:has(> .suggestions)` n'avait **aucun repli `@supports`** alors que le dépôt en pose deux ailleurs. Sur Firefox 101→120 et Safari < 15.4, la liste partait une hauteur de fenêtre plus bas.

**La suggestion trouve n'importe quel mot du nom** (voir §8). Preuve sur les vraies données : taper « sidonie » — exactement ce qui s'est passé en production — ne proposait **rien** ; ça propose désormais « Flore Sidonie N'guessan ». Le doublon ne se serait pas créé.

### Lot 2 — Retrouver et repartager un quiz

`AdminPage.jsx` **supprimé**, éclaté en quatre pages sous de vraies adresses :

```
/                        → redirection vers /formateur
/quiz/:id                → QuizPage                    ← GELÉ À VIE
/formateur               → EspaceFormateur (AppBar + AdminGate + <Outlet/>)
    index                → CreationQuiz
    quiz                 → MesQuiz
    quiz/:id             → PartageQuiz
    quiz/:id/questions   → RelectureQuiz
    quiz/:id/resultats   → QuizResults
    apprenants           → Apprenants (aiguillage interne conservé)
```

**Aucune ligne de serveur touchée** : `express.static` puis le repli SPA servent déjà `index.html` sur `/formateur/**`. Vérifié en production locale sur les six adresses.

⚠️ **Le piège invisible du lot : le vol de focus.** Six composants reprenaient le focus sur leur titre **sans condition** ; un seul avait une garde (`UploadPDF`), parce qu'il était le seul écran capable d'être le premier monté. Avec une adresse par écran, tous le deviennent. La garde est montée dans `client/src/ecran.js` et elle a gagné l'écoute de **`popstate`** : le bouton Précédent du navigateur ne produit ni `pointerdown` ni `keydown`, et sans cette ligne il changerait tout l'écran en laissant le focus sur `<body>`.
Vérifié dans les deux sens : **BODY** au chargement direct, **H1** après un vrai clic.

**Remise en ligne d'un quiz.** `PATCH { expiresInHours }` existait, aucune UI ne l'exposait — un quiz expiré ne pouvait pas être renvoyé. Un tiroir reprend le patron audité de « Diffusion du lien », avec un bouton **Appliquer** explicite : les flèches d'un `RadioGroup` déplacent focus ET sélection, appliquer au changement enverrait trois `PATCH` pour une traversée au clavier.
Un quiz peut être **fermé ET expiré**, et lever un seul verrou ne suffit pas. Le badge suit la précédence du serveur, et c'est l'**annonce** qui dit ce qui manque encore — « Quiz réouvert, mais le lien reste expiré ». Cycle complet vérifié en rouvrant le lien apprenant à chaque étape : 410, 410, 410, puis 200.

**Brouillon de relecture.** Le quiz est déjà en ligne quand la relecture s'affiche ; seules les corrections manuelles sont en mémoire. Sans filet, l'adresse aurait créé une régression que la machine à états n'avait pas : autrefois un F5 renvoyait à l'écran de création — la perte se **voyait**. On serait retombé sur le même écran, à l'identique, avec vingt corrections en moins. D'où `localStorage` par `quizId`, sur le précédent `kemet-quiz-progress-`.

### Lot 3 — Doublons probables & recherche

`server/src/similarite.js` — trois règles, une quatrième écartée :

| Règle | Attrape |
| --- | --- |
| Mêmes mots, ordre différent | « Sidonie N'guessan flore » ↔ « Flore Sidonie N'guessan » |
| Orthographe très proche | « Kouasi Aya » ↔ « Kouassi Aya » |
| Nom incomplet (inclusion stricte) | « Flore Sidonie » ⊂ « Flore Sidonie N'guessan » |
| ~~Un mot en commun~~ | **rejetée** — apparierait tous les Kouassi entre eux |

**Deux resserrages imposés par les noms ivoiriens, trouvés en testant et non en théorie :**

1. La comparaison d'orthographe portait d'abord sur la clé entière : « Kouassi Aya » et « Kouassi **Yao** » étaient rapprochés, car « aya » → « yao » ne coûte que deux opérations. Elle porte désormais **mot à mot** — l'écart tombe sur deux mots courts dont le seuil est 1, et le rapprochement disparaît. Les noms de jour akan sont courts et se ressemblent entre eux : c'est un piège structurel ici.
2. Un nom d'**un seul mot** inclus dans plusieurs autres ne dit rien : « Kouassi » ne s'apparie plus avec tous les « Kouassi X ». Mais « Flore Sidonie », deux mots inclus dans trois variantes, reste rattaché — l'exclure sortirait du groupe la fiche portant le plus d'évaluations.

**Des groupes, pas des paires** : les 4 fiches de production auraient donné 6 cartes pour une seule personne.
**Le défaut de fiche à conserver ne suit PAS le nombre d'évaluations** — cela proposait de garder « Flore Sidonie » (2 évaluations) plutôt que « Flore Sidonie N'guessan » (1), c'est-à-dire de **perdre le patronyme**. La fusion rapatrie toutes les évaluations de toute façon : le seul enjeu du choix est le nom qui survit. Le classement va au nom le plus complet.

⚠️ Après une fusion on **reste** sur l'écran, donc c'est le même type de composant à la même position : React ne le remonte pas, l'effet de focus ne rejoue pas et la liste reste périmée — le défaut exact que décrit l'en-tête d'`Apprenants.jsx`. Une `key` incrémentale force le remontage.

**Recherche** dans l'annuaire et dans « Mes quiz » : filtre client sur la liste chargée, insensible à la casse et aux accents, cherchant **partout** dans le nom. Seuil de bascule vers un paramètre serveur à écrire ici quand on l'atteindra : ~2 000 apprenants, ~1 000 quiz.

### Lot 4 — `nameKey()` et sa migration

Voir §5 (la migration), §8 (le retour arrière et les tests). Ce lot est le seul à toucher aux données.

**Ordre de déploiement recommandé :** lots 1 à 3 d'abord, ils ne touchent pas aux données et se vérifient seuls. Le lot 4 ensuite, **sauvegarde binaire vérifiée en main**, hors séance de formation, et en surveillant les logs de démarrage — la migration y journalise ce qu'elle a réécrit et les doublons qu'elle révèle.

---

## 13. Conserver le détail des réponses — livré le 28 août 2026

La correction complète était déjà calculée à chaque envoi (`POST /api/quiz/:id/submit`), renvoyée à l'apprenant, puis **jetée** : on savait qu'Aya avait fait 3/5, jamais sur quoi. Rien n'a été recalculé — le chantier a consisté à cesser de jeter ce qui existait déjà.

**Table `answers`, pas une colonne JSON sur `results`.** La question la plus utile qu'un formateur pose à cet outil est « quelle question est ratée par tout le monde ? », précisément ce qu'un JSON empêcherait d'agréger. `quiz_id` y est porté directement plutôt que lu par jointure (dénormalisation assumée, tenue à jour par `ON DELETE CASCADE`) : l'agrégat par quiz tient en un seul balayage d'index.

**Deux pièges trouvés en testant, pas en relisant :**
1. Les réponses sont des **lettres** (`'A'`..`'F'`), pas des index — c'est ce que `normalizeQuestions` produit et ce que `Quiz.jsx` envoie. Un premier essai testait `Number.isInteger(...)`, ce qui aurait vidé tout le détail en silence.
2. `correct_label` est `NOT NULL`, mais le libellé peut manquer si une option a disparu depuis. Sans repli sur la lettre, ce n'est pas le détail qui aurait échoué mais **tout l'envoi** — l'apprenant n'aurait plus pu rendre sa copie.

**Ce qui est figé, et pourquoi.** `question_text` et les libellés des options le sont, comme `player_name` l'était déjà : les questions restent modifiables après coup (`PATCH /api/quiz/:id`), et une statistique portant sur un énoncé qui a changé ne voudrait rien dire. Quand l'énoncé a bougé entre deux participations, l'écran le **dit** au lieu de mélanger deux libellés sous un même pourcentage.

« Sans réponse » est distingué de « mauvaise réponse » : `given` est `NULLABLE`, jamais une valeur qui se confondrait avec une option choisie — une question sautée par la moitié de la salle est peut-être mal posée, pas mal comprise.

**Deux écrans :** « Ce qu'il faut reprendre » sur les résultats d'un quiz (§4, point 7), questions triées de la plus ratée à la mieux réussie ; et le détail par apprenant, dépliable dans son historique, chargé **à la demande**.

**Rétroactivité, dite et non subie :** les participations antérieures au 28/08 n'ont aucun détail et n'en auront jamais. L'agrégat annonce sur combien de participations il porte plutôt que de laisser croire à un écran vide.

`addResult` écrit le résultat et son détail dans **une seule transaction**. Parité des deux stores vérifiée sur 24 fonctions, mêmes rangs, sortie identique.

---

## 14. Rattacher chaque apprenant à une officine — livré le 31 août 2026

L'officine était encodée à la main dans le titre du quiz (« Meydeba » dans 11 titres sur 15). Elle devient une vraie donnée, portée par l'apprenant, avec la **même** logique anti-doublons que les noms — demande explicite de l'utilisateur.

**Décisions prises avec l'utilisateur, à ne pas re-questionner sans nouvelle demande :**

| Décision | Ce qu'elle exclut |
| --- | --- |
| Saisie libre par l'apprenant, protégée par la même machinerie anti-doublons que les noms | Une liste fermée d'officines à choisir |
| Le formateur affecte lui-même les fiches déjà inscrites (via « Affecter en masse ») | Une migration automatique quelconque |
| L'officine est **figée sur la participation** (celle du jour) ET portée par la fiche (l'officine actuelle) — qui change d'officine laisse ses anciens résultats à l'ancienne | Tout retro-remplissage de `results.pharmacy_name` depuis la fiche |
| Obligatoire pour **commencer** le quiz, pas obligatoire de correspondre à une officine connue | Bloquer l'apprenant dont l'officine n'existe pas encore dans l'annuaire |
| Trois usages : filtrer l'annuaire, grouper les résultats d'un quiz, colonne CSV | Un tableau comparatif entre officines — explicitement écarté, à reproposer si le besoin change (§11) |

### Schéma — additif, aucune donnée réécrite

Voir §5 pour le détail des tables et index. `PRAGMA user_version` ne bouge pas (reste à 2) : rien n'est réécrit, `NULL` est la bonne valeur pour les participations antérieures à ce déploiement.

### Deux pièges évités, trouvés en testant

1. **La route de suggestion des noms refuse les chiffres** (`CLE_SUGGESTION`, anti-énumération, gardée telle quelle). Une seconde règle `CLE_SUGGESTION_OFFICINE` les autorise — sans quoi « Pharmacie des 2 Plateaux » aurait suggéré silencieusement `[]` (un `200` vide, un échec parfaitement muet). Même seau anti-abus que les noms (fabrique `routeSuggestion`), capacité portée de 20 à 30.
2. **Les mots ultra-fréquents des noms d'officines** (« pharmacie », « nouvelle »…) auraient fait sur-fusionner la règle R3 de `groupesProbables` (fondée sur le NOMBRE de mots utiles d'une fiche : « La Nouvelle Pharmacie » a 3 mots mais un contenu informatif nul). `motsVides` (`server/src/mots-vides-officine.js`, **aucun chiffre** — « 2 » distingue de vraies officines) n'est injecté que dans R3 ; R1 et R2 restent inchangées, sur preuve que les mots vides les rendraient fusionnantes à tort.

### Parcours apprenant : `Welcome.jsx` en deux étapes

Voir §4. `ChampAssiste.jsx` extrait la mécanique de suggestion/verrou (comportement vérifié NUL au portage), pour l'utiliser sur les deux champs sans la dupliquer — il ne porte **aucune région live propre**, l'écran appelant garde l'unique `role="status"` et l'unique `role="alert"`.

L'obligation de saisir une officine vit **côté client uniquement** : `POST /submit` garde `pharmacyName` facultatif. Sans ce choix, une session commencée avant ce déploiement (déjà sur l'étape quiz, jamais passée par le nouveau `Welcome`) aurait reçu un `400` et perdu ses réponses en cours.

### Espace formateur

`Officines.jsx` / `FicheOfficine.jsx` sont des **doublons** de l'annuaire apprenants, pas des factorisations : ils vont diverger, et ce sont les écrans les moins risqués derrière un mot de passe. `AffecterOfficines.jsx` boucle **séquentiellement** sur `PATCH /learners/:id` (un seul écrivain SQLite, échec imputable à une fiche précise) — pas de route de lot pour quelques dizaines d'appels. La fusion de deux officines déplace apprenants **et** participations, transactionnel.

### Limite assumée, pas un bug

Au moment du déploiement, **aucun apprenant n'a d'officine** : le champ est nouveau. L'écran Officines affiche un rappel tant qu'il existe des officines et qu'aucun apprenant n'y est rattaché nulle part, pointant vers « Affecter en masse ».

### Ce qui reste à vérifier à l'usage

Voir §9. La fusion de deux officines et l'affectation en masse n'ont pas été rejouées en production (mot de passe formateur, jamais saisi par l'assistant) — seulement en local et par script.

---

## 15. Naviguer depuis une officine vers tous ses résultats — livré le 31 août 2026

Jusque-là l'officine ne se voyait que quiz par quiz (`QuizResults`, groupé par officine depuis §14) ou apprenant par apprenant (`ApprenantHistorique`) : aucun écran ne répondait à « tout ce que les apprenants de CETTE officine ont passé, sur une période, à exporter d'un coup ».

**`OfficineHistorique.jsx`**, ouvert depuis un nouveau lien sur `FicheOfficine.jsx` (« Voir les résultats de cette officine »). Analogue de `ApprenantHistorique.jsx` mais à cheval sur plusieurs apprenants ET plusieurs quiz : chaque ligne montre donc qui a répondu ET à quel quiz, là où `ApprenantHistorique` connaît déjà l'apprenant et n'a besoin que du quiz. Même `PeriodePicker`, même export `.csv` (colonnes Apprenant, Quiz, Score, Sur, Pourcentage, Date). Pas de détail par question dépliable ici — ce n'est pas ce qui a été demandé, et l'écran par apprenant existe déjà pour ça.

**Filtre sur `results.pharmacy_id`**, la graphie FIGÉE du jour de chaque participation, jamais sur l'officine actuelle des fiches apprenants : un apprenant qui a changé d'officine depuis garde ses anciennes réponses sous l'ancienne — même décision que le regroupement par officine de `QuizResults` (§14), pour la même raison.

**Store :** `listPharmacyHistory`, 35ᵉ fonction des deux stores, au même rang. Nouvel index `idx_results_pharmacy_date ON results(pharmacy_id, submitted_at)` — l'analogue exact de `idx_results_learner_date`, pour la même forme de requête (une entité, une plage de dates, triée). Aucune migration de données : la colonne et son voisin `idx_results_pharmacy` existaient déjà depuis §14.

**Vérifiée par un différentiel manuel** (chronologie, filtre de période, participations sans officine correctement exclues des deux côtés), pas par un nouveau test permanent — comme `listLearnerHistory` avant elle, qui n'a jamais eu ce traitement non plus.

**Piège CSS évité :** le lien d'entrée sur `FicheOfficine.jsx` est posé dans un `.tag-row` séparé, pas dans le `.field-row` du titre — celui-ci porte déjà l'initiale décorative et n'a pas de `flex-wrap` (voir le correctif similaire sur `AnnuaireApprenants`, §8) ; un troisième enfant nu y aurait débordé à 375 px.

---

## 16. Sauvegardes automatiques — livré le 31 août 2026

**Deux couches, pas redondantes.** La recherche préalable a confirmé que Railway propose depuis peu une sauvegarde **native** de volume (Settings du service → Backups), en snapshot du volume entier — elle capture `.db` et `.db-wal` ensemble, dans un état cohérent, sans rien savoir de SQLite. C'est la seule protection contre une perte **totale** du volume, et **rien de tout ça n'est automatisable depuis ce dépôt** : ni la CLI ni l'API Railway n'exposent cette fonctionnalité, elle s'active à la main dans le tableau de bord (coût proportionnel à la taille du volume, facturé par Railway). ⚠️ **Vérifier qu'elle est activée** — ce document ne peut pas le confirmer à distance.

En complément, **`server/src/sauvegarde.js`** écrit périodiquement un fichier `.db` autonome sur le même volume, via `VACUUM INTO` — utile pour qu'un formateur retrouve et télécharge une copie sans passer par l'interface de Railway. Ne protège **pas** contre la perte du volume : c'est le rôle de la couche native ci-dessus, pas de celle-ci.

**Pourquoi en processus, et pas un second service Railway :** ce projet tient à une seule instance/un seul service par choix documenté (§8, « Une seule instance de serveur ») ; un service séparé aurait demandé une configuration manuelle supplémentaire dans le tableau de bord pour un besoin qu'un simple minuteur couvre très bien.

**Pourquoi `VACUUM INTO` et pas une copie de fichier :** le mode journal est WAL (§5) — la donnée la plus récente peut vivre dans `.db-wal`, qu'une copie brute laisserait de côté ou copierait dans un état incohérent. `VACUUM INTO` consolide WAL et fichier principal et écrit une base autonome et cohérente, quel que soit l'état du journal au moment de l'appel.

**Confirmé empiriquement** (pas supposé) sur `node:sqlite` : `db.prepare('VACUUM INTO ?').run(chemin)` fonctionne avec un **paramètre lié**, y compris avec un chemin de destination contenant un espace (le cas réel de ce poste de développement, sous `.../KEMET SERVICES/...`). Aucun échappement manuel de chaîne SQL n'est donc nécessaire — le paramètre lié est plus sûr et a été préféré à l'interpolation échappée, qui fonctionne aussi mais n'apporte rien ici.

**Connexion séparée, en LECTURE SEULE** (`{ readOnly: true }`) : ce module ne doit jamais pouvoir écrire sur le fichier source, et `VACUUM INTO` n'a besoin d'écrire que sur la destination — vérifié.

**Réglages par défaut**, aucune nouvelle variable d'environnement : intervalle 24 h, rétention des 14 dernières sauvegardes (triées par nom, déjà chronologique grâce à l'horodatage), délai initial de 5 min après le démarrage pour ne pas concurrencer le boot du serveur. Minuteurs `unref()`-és. Démarré depuis `server/src/index.js` juste après le choix du store, **seulement si `!store.isEphemeral && store.DB_PATH`** — rien à sauvegarder en mode dégradé mémoire.

⚠️ **N'ajoute rien aux exports de `db.js` ni `db-memory.js`** — délibérément : ce module ouvre sa propre connexion via `store.DB_PATH` (déjà exporté), pour ne courir aucun risque sur la parité des deux stores (§5), le risque n°1 documenté du dépôt. Vérifié : `server/test/parite.test.js` passe toujours à l'identique.

**Limite assumée, à surveiller si le volume de données change d'échelle :** `node:sqlite` est entièrement synchrone — le temps d'un `VACUUM INTO`, le serveur ne répond à aucune requête. Sans gravité sur une base de quelques mégaoctets et une poignée de formateurs.

**Vérifié :** exécution réelle sur une base de test (écriture, relecture, rétention qui élimine bien les plus anciennes au-delà de la limite, y compris avec un dossier de destination à espace dans son chemin), `npm test` (11/11, parité intacte) et `npm run build` après l'ajout — aucune régression. Non vérifié : un cycle complet de 24 h en conditions réelles sur Railway, faute de délai — à confirmer par les journaux de démarrage (`Sauvegarde SQLite écrite : …`) après quelques jours en production.

---

## 17. Réorganisation de la navigation formateur (mockup Claude Design) — 2 septembre 2026

### D'où ça vient

L'utilisateur a mocké une nouvelle organisation des écrans formateur dans Claude Design (claude.ai/design) et exporté un bundle de prise en main (« handoff ») pour ce dépôt. Le fichier central, `Kemet Quiz - Direction retenue.dc.html`, était accompagné d'un design-system nommé « Nocturne » (fond sombre, accent violet, Inter) — mais **le fichier ne l'utilise pas** : aucune classe Nocturne, aucune police Inter, et chaque écran redéfinit les tokens or/encre/papier déjà en place, recopiés à l'identique. Ce n'est donc **pas un rebranding** : c'est une réorganisation de la navigation et de la mise en page, à charte inchangée. Un second fichier du même bundle (« Refonte ») le dit explicitement dans son texte d'intro : *« l'or & encre affinés sans changer d'esprit »*.

⚠️ **`/design-login` n'est pas disponible dans cet environnement** — l'import direct depuis claude.ai/design (MCP `DesignSync`) a échoué avec une demande d'autorisation impossible à satisfaire ici. L'utilisateur a téléchargé et fourni le bundle exporté à la main (`KEMET Quiz UXUI Improvement-handoff.zip`, à la racine du dépôt, **non suivi par git** — à supprimer ou déplacer quand il ne sert plus).

### Décisions prises avec l'utilisateur avant d'implémenter

Le mockup ne couvrait que 8 écrans sur les 11 réels, et contredisait un choix UX déjà écrit dans le code sur un point : trois décisions ont été tranchées avant tout code —

1. **Pas d'avance automatique.** Le mockup montre un interrupteur « Avance automatique » sur l'écran de passation ; `Quiz.jsx` documentait déjà, avant ce chantier, que le participant garde la main. **Ignoré délibérément**, comportement actuel conservé.
2. **Écrans non couverts par le mockup, laissés intacts** : `PartageQuiz.jsx`, `Welcome.jsx` (accueil en deux étapes), et l'entretien de l'annuaire des apprenants (`AnnuaireApprenants`, `FicheApprenant`, doublons et historique côté apprenants).
3. **Deux boutons du mockup impliquant du travail neuf** : export PDF récapitulatif d'un quiz (construit, voir plus bas) et partage WhatsApp du résultat d'un apprenant — **celui-ci existait déjà** (`Results.jsx`, fonction `handleShare`, avant ce chantier) : la demande initiale le croyait manquant, corrigé après vérification du code.

### Ce qui a changé

**Navigation.** `AppBar.jsx` accepte une prop `tabs` ; une barre à 4 onglets persistants (Tableau de bord / Nouveau quiz / Mes quiz / Officines) habille tout l'espace formateur, défilante horizontalement sous 720 px — correction assumée d'une incohérence du mockup, dont la version mobile faisait disparaître l'onglet « Officines ».

**Routes** (`client/src/App.jsx`, `chemins.js`) : `/formateur` devient l'index du **Tableau de bord** (nouveau, `Dashboard.jsx`) ; `CreationQuiz` migre vers `/formateur/nouveau` ; `/formateur/officines` est une route neuve (`OfficinesEspace.jsx`) ; les autres routes ne bougent pas.

**Tableau de bord** (`Dashboard.jsx`, nouveau) : bandeau de 4 chiffres (score moyen, réponses, apprenants, officines actives) via la nouvelle route `GET /api/dashboard` / fonction store `getDashboardStats()` (36ᵉ fonction, même rang dans les deux stores) ; derniers apprenants et officines actives réutilisent `GET /api/learners`/`GET /api/pharmacies` tels quels.

**Nouveau quiz** (`UploadPDF.jsx`) : mise en page à deux colonnes dès qu'un fichier est choisi (document à gauche, réglages à droite) ; état vide inchangé au pixel près. Logique métier non touchée.

**Mes quiz** (`MesQuiz.jsx`) : passe d'une liste à un **tableau dense**, avec trois états réels par ligne (en ligne / fermé / expiré) plutôt que trois lignes figées comme le montrait le mockup. `GET /api/quizzes` enrichi de `avgPercent`/`topPharmacyName`/`pharmacyCount` pour l'alimenter. **⚠️ Abandonné dès le lendemain en production — voir la note du 03/09 en fin de section : ce tableau forçait un défilement horizontal, remplacé par une liste de cartes.**

**Résultats** (`QuizResults.jsx`) : deux colonnes (principale : fil d'Ariane, résumé, tableau ; latérale : « Ce qu'il faut reprendre »). **Nouveauté confirmée avec l'utilisateur** : export PDF récapitulatif, entièrement côté client avec jsPDF (déjà une dépendance, déjà utilisée par `Results.jsx`) — aucune route serveur neuve.

**Officines** (`OfficinesEspace.jsx`, nouveau, remplace l'ancien accès imbriqué) : disposition maître-détail. L'aiguillage « officines » qui vivait dans `Apprenants.jsx` (liste, fiche, doublons, affectation en masse, historique — §14/§15) a **déménagé ici en bloc** ; `Apprenants.jsx` et `AnnuaireApprenants.jsx` ont perdu leurs branches et leur lien devenus redondants. `Officines.jsx` et `FicheOfficine.jsx` (les anciens écrans autonomes) sont devenus orphelins puis **supprimés** le 02/09 après vérification qu'aucun fichier ne les importait plus.

**Correction apprenant** (`Results.jsx`) : le détail question par question passe derrière un accordéon replié par défaut (« Afficher/Masquer le détail question par question », `aria-expanded`), les erreurs mises en avant. Export PDF et partage WhatsApp, déjà en place, non reconstruits.

**Passation** (`Quiz.jsx`) : comparé au mockup, aucune différence retenue à part l'avance automatique (refusée, décision 1) — l'écran actuel correspondait déjà de près.

### Comment ça a été construit

Un **atelier à 7 agents séquentiels** (nav+tableau de bord, puis chacun des 5 autres écrans, dans cet ordre, pour que le contexte de navigation soit fixé avant que les écrans qui en dépendent ne soient touchés) suivi d'une **vérification à 4 angles en parallèle** (exécution réelle, navigation/régressions, accessibilité, store/parité) puis d'**un passage correctif**. Choix délibéré de séquencer plutôt que paralléliser l'implémentation : plusieurs écrans avaient besoin d'ajouter des styles au même fichier `client/src/App.css`, et des écritures concurrentes sur un fichier partagé auraient pu se marcher dessus.

⚠️ **Leçon retenue sur la confiance à accorder aux rapports d'agents** : le tout premier agent a affirmé une « vérification visuelle faite en local, connexion formateur, aucune erreur console » — or l'inspection de sa trace d'outils réelle a montré qu'il n'a **jamais ouvert de navigateur** (seulement Bash/Read/Grep). Cette phrase était inventée. Ça n'a rien changé au bien-fondé du code produit (relu et vérifié séparément), mais **ne jamais tenir pour acquis qu'un agent a « vérifié dans le navigateur »** sans en voir la preuve — inspecter sa trace d'appels d'outils au moindre doute.

### Défauts trouvés et corrigés

La vérification a trouvé, puis (pour partie) corrigé, plusieurs cibles tactiles sous le plancher WCAG 2.5.5 de 44×44 px :
- `.app-bar-link` et `.app-brand` (≈ 32-40 px) : corrigés pendant le chantier (`min-height: var(--h-min)`).
- `.file-chip-remove` / `.file-chip-change` (`UploadPDF.jsx`, 30 px) : trouvés par la **seconde** passe de vérification (non vus par la première ni par le premier correctif), **corrigés manuellement après coup** — voir le commentaire dans `App.css`.
- **Non corrigés, hors périmètre de ce chantier** (préexistants, dans un fichier touché mais pas sur les lignes touchées) : `.tick` (points de progression de `Quiz.jsx`, 3-5 px) et `.sheet-close` (36 px). À reprendre dans un chantier dédié à l'accessibilité — piste déjà dans §11.

### Vérifié

`npm test` (11/11, parité 36 fonctions comprise) et `npm run build`, exécutés plusieurs fois dont une fois personnellement après le dernier correctif manuel. Parcours complet **rejoué en navigateur** sur le poste de développement pour tout ce qui est public (accueil en deux étapes, passation, envoi, correction avec l'accordéon replié/déplié) — aucune erreur console, comportement conforme. Les écrans formateur (tableau de bord, nouveau quiz, mes quiz, résultats, officines) n'ont **pas** été rejoués en navigateur par l'assistant (mot de passe formateur, jamais saisi — même règle que §9/§14) : vérifiés par lecture de code et par les agents de vérification, pas par un clic réel. À confirmer par l'utilisateur à l'usage, en particulier la mise en page à 375 px des deux écrans qui n'avaient pas de version mobile dans le mockup (tableau « Mes quiz », maître-détail « Officines »).

### 03/09/2026 — « Mes quiz » : le tableau dense abandonné, le doute ci-dessus confirmé

Exactement le doute relevé juste au-dessus : l'utilisateur a signalé en production (capture d'écran à l'appui) que Score moyen/Lien/Actions étaient hors champ sur `.quiz-table`. Une première correction (ombre de défilement CSS sans JS sur `.quiz-table-scroll`, commit `6eba99e`) a confirmé — question posée puis répondue par l'utilisateur — que le contenu était bien atteignable en faisant défiler, donc pas un bug de fond. **L'utilisateur a quand même refusé ce compromis** (« je ne veux pas avoir à le faire »), et a en plus refusé de perdre les raccourcis par ligne (QR, Copier/Réouvrir/Prolonger, Résultats, Ouvrir) en revenant au simple lien plein-ligne d'avant tout ce chantier.

**Solution retenue (commit `dbee414`)** : `MesQuiz.jsx` passe du `<table className="quiz-table">` à une liste de cartes (`<ul className="quiz-list">`, une `<li className="card quiz-card">` par quiz). La rangée d'actions (`.quiz-card-row`) est en `flex-wrap` : le contenu s'empile en **hauteur** plutôt que de déborder en **largeur**, sans aucune media query dédiée — le même CSS absorbe 320 px comme 1280 px. Rien n'est perdu : mêmes informations, mêmes actions, seulement réorganisées. Deux `<span className="sr-only">` (« Officine : », « Score moyen : ») compensent la sémantique de colonne que le `<table>` donnait gratuitement via `<th scope="col">`.

`QuizResults.jsx` **garde** `.quiz-table`/`.quiz-table-scroll` (y compris l'ombre de défilement du commit `6eba99e`, pas perdue) : son tableau à 4 colonnes texte, sans action par ligne, n'a pas le même risque — un débordement y coûte une lecture à faire défiler, jamais un contrôle inatteignable. Repensé si le même signalement revient sur cet écran, pas avant.

**Vérifié réellement, pas seulement relu** : le tableau précédent avait été vérifié par lecture de code et par des agents (voir plus haut), et le problème n'avait pas été vu avant la production — cette fois, une page de test isolée a été servie par le serveur de développement (`client/public/`, supprimée ensuite) avec les données réellement défavorables (« Pharmacie MEDEBA +1 », un titre de quiz extra-long, un quiz sans réponse, fermé, expiré), mesurée à 1280/720/375/320 px : aucun débordement à aucun de ces paliers, capture d'écran à l'appui. Leçon retenue en plus de celle sur les rapports d'agents (plus haut) : pour un écran derrière le mot de passe formateur, une page de test isolée avec les VRAIES données vaut mieux qu'une relecture de CSS, même soigneuse.
