# Kemet Quiz — Handoff technique

**Dernière mise à jour :** 30 juillet 2026
**Production :** https://kemet-quiz-production.up.railway.app
**Dépôt :** https://github.com/ssbokola/kemet-quiz (branche `main`, auto-deploy Railway)
**Dernier commit :** `17656c1` — *Integrate UX/UI refonte: ink & gold quiz, review step, access gate*

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
| Stockage | SQLite (`better-sqlite3`), fichier sur volume Railway |
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
│       ├── index.css         reset + design tokens + polices
│       ├── App.css           toute la feuille de style
│       ├── App.jsx           routes
│       ├── api.js            helper d'authentification formateur
│       ├── components/
│       │   ├── AdminGate.jsx        porte d'accès mot de passe
│       │   ├── AppBar.jsx           barre d'application
│       │   ├── Icon.jsx             jeu d'icônes SVG maison
│       │   ├── UploadPDF.jsx        dépôt + réglages + écran de génération
│       │   ├── ReviewQuestions.jsx  relecture / édition avant publication
│       │   ├── Welcome.jsx          accueil participant
│       │   ├── Quiz.jsx             passation, thème encre
│       │   └── Results.jsx          score, correction, export PDF
│       └── pages/
│           ├── AdminPage.jsx        upload → review → share
│           └── QuizPage.jsx         welcome → quiz → results
└── server/
    └── src/
        ├── index.js          API complète (routes, IA, validation)
        └── db.js             base SQLite : schéma + accès aux quiz et résultats
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

### Participant — `/quiz/:id`

1. **Accueil** (`Welcome`) — titre, nombre de questions, durée estimée, saisie du prénom.
2. **Passation** (`Quiz`) — thème encre (`document.body` reçoit la classe `theme-ink`), une question par écran, **pas d'auto-avance**. Barre segmentée cliquable, feuille « toutes les questions », écran de récapitulatif final qui nomme les questions manquantes, modale de confirmation avant envoi.
   Raccourcis clavier : `A`–`D` ou `1`–`4` pour répondre, `←` `→` `Entrée` pour naviguer, `Escape` pour fermer.
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
| `GET /api/quiz/:id/results` | ✅ | Scores enregistrés — **aucune UI ne les consomme** |
| `GET /api/quiz/:id` | — | Quiz **sans** les réponses. `410` si fermé ou expiré |
| `POST /api/quiz/:id/submit` | — | Corrige et enregistre. `409` si tentative unique déjà utilisée, `410` si fermé |

**Authentification :** mot de passe partagé `ADMIN_PASSWORD`, transmis dans l'en-tête `x-admin-password` par `client/src/api.js`.

> ⚠️ **Si `ADMIN_PASSWORD` n'est pas définie, `requireAdmin` laisse passer tout le monde** (`server/src/index.js:20`). C'est voulu pour le confort en développement — mais en production, l'oublier revient à ouvrir la génération de quiz, et donc la consommation des crédits IA, à n'importe quel visiteur.

### Le flux NDJSON

`POST /api/upload-pdf` ne renvoie pas un JSON unique mais une ligne JSON par événement. Un `ping` est émis toutes les 10 secondes pour empêcher le proxy Railway de couper une génération longue. Le client lit le flux avec `res.body.getReader()`.

Motif historique : les gros PDF provoquaient des `502` (`Request aborted` dans multer) parce que l'upload dépassait le délai du proxy. Deux correctifs cumulés — extraction du texte côté navigateur, puis flux NDJSON — ont réglé le problème.

### Stockage

Tout passe par `server/src/db.js`, qui expose une petite API (`createQuiz`, `getQuiz`, `updateQuiz`, `addResult`, `findResultByName`, `listResults`, `countResults`). `index.js` n'écrit jamais en SQL directement.

Deux tables :

| Table | Contenu |
| --- | --- |
| `quizzes` | un quiz par ligne ; les questions sont sérialisées en JSON dans une colonne (elles sont toujours lues et écrites en bloc) |
| `results` | une ligne par participation, liée au quiz par `ON DELETE CASCADE` |

`better-sqlite3` est **synchrone** : les gestionnaires de routes sont restés synchrones, et un cycle lecture → vérification → écriture (la règle de tentative unique, par exemple) ne peut pas être entrelacé avec une autre requête. Aucune transaction explicite n'est donc nécessaire.

### Validation de la sortie du modèle

`normalizeQuestions()` (`server/src/index.js:133`) s'exécute **à la création et à chaque écriture**. Elle :

- retire le préfixe `A)` des options puis les renumérote proprement — entre 2 et 6 options ;
- accepte la bonne réponse sous trois formes : lettre (`"B"`), index 1-based (`"2"`), ou texte exact de l'option ;
- **écarte** toute question inexploitable et la comptabilise dans `dropped`, remonté jusqu'au bandeau d'avertissement de l'écran de relecture ;
- lève une erreur explicite si rien n'est exploitable.

C'est le garde-fou contre les sorties LLM malformées. Ne pas le contourner en écrivant directement en base.

**Tentative unique :** les prénoms sont comparés sans accents ni casse. La normalisation (`nameKey()`, `server/src/db.js`) est stockée dans la colonne `results.player_key` : « Awa », « awa » et « Awâ » sont la même personne, et la comparaison se fait en SQL sur un index.

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
| `--text-3` / `--text-4` | `#6b6459` / `#78716a` | Métadonnées, micro-copie |
| `--ok` / `--err` / `--wa` | `#2e7d5b` / `#c0453b` / `#1f7a4c` | Juste / faux / WhatsApp |

**Typographie :** Instrument Serif pour les titres (poids 400 uniquement), Instrument Sans pour l'interface, importées depuis Google Fonts en tête de `index.css`.

**Règles à tenir :**

- Les contrastes ont été vérifiés au ratio **WCAG AA**. Ne pas éclaircir les gris, ne pas remettre du texte blanc sur fond or.
- Cibles tactiles **jamais sous 44 px** ; options de quiz à 60 px, boutons d'action à 52–56 px.
- Un seul point de rupture : **720 px**.
- `@media (prefers-reduced-motion: reduce)` neutralise animations et transitions.
- Icônes : `Icon.jsx` uniquement, pas d'emoji. Noms disponibles : `doc` `check` `close` `arrowRight` `arrowLeft` `chevronRight` `chevronLeft` `copy` `send` `download` `refresh` `list` `info` `edit` `search` `chart`.
  **La flèche circulaire (`refresh`) est réservée à « régénérer / refaire ». Le partage utilise `send`.**
- Si la charte évolue, basculer `--gold` / `--gold-hover` / `--gold-deep` suffit : aucune couleur d'action n'est codée en dur ailleurs.

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
> ⚠️  Aucun volume Railway monté : la base vit dans le conteneur et sera EFFACÉE au prochain déploiement.
> ```
>
> **À faire une fois** dans Railway : service → onglet *Volumes* → *Add Volume*, puis redéployer. Railway injecte alors `RAILWAY_VOLUME_MOUNT_PATH` tout seul, aucune variable à saisir à la main.

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

### Les résultats ne sont visibles nulle part

`GET /api/quiz/:id/results` renvoie les participants et leurs scores, mais aucune interface ne l'affiche. Participants, moyenne et questions les plus ratées sont pourtant la valeur pédagogique de l'outil. Maintenant que les données survivent, c'est le chantier qui a le meilleur rapport valeur/effort.

### Le formateur n'a aucune liste de ses quiz

Les quiz persistent, mais il n'existe aucune route pour les énumérer : un formateur qui perd son lien perd son quiz, alors qu'il est toujours en base. Un `GET /api/quizzes` protégé par mot de passe réglerait le cas.

### Divers

- Les polices sont chargées depuis Google Fonts — à auto-héberger pour un fonctionnement hors ligne.
- `client/public/kemet-logo.svg` n'est plus référencé (remplacé par le PNG recadré), il peut être supprimé.
- `client/public/icons.svg` et `client/src/assets/` (`react.svg`, `vite.svg`) sont des restes du gabarit Vite, inutilisés.
- L'archive `Amélioration UXUI appli quiz.zip` à la racine n'est pas suivie par git : son contenu est intégré, elle peut être supprimée.

---

## 9. État des vérifications

**Vérifié en production le 29/07/2026 :**

| Point | Méthode | Résultat |
| --- | --- | --- |
| Nouveau front déployé | `curl` sur `/` | ✅ `theme-color #1f1d24`, logo PNG |
| Espace formateur protégé | `POST /api/admin/check` sans mot de passe | ✅ `401` |
| Participants non bloqués | `GET /api/quiz/<id bidon>` | ✅ `404` (et non `401`) |

**Vérifié en local le 30/07/2026, après le passage à SQLite** (serveur sur un port de test, base isolée, quiz injecté directement dans le store pour éviter un appel IA) :

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

### 🔴 Claude ne génère plus rien — l'identifiant de modèle est mort

Constaté en local le 30/07/2026 en générant un vrai quiz. La clé Anthropic **est valide** : ce n'est pas un `401`.

```
Claude failed: 404 {"type":"not_found_error","message":"model: claude-sonnet-4-20250514"}
Falling back to Gemini...
Success with Gemini gemini-2.5-flash
```

Le modèle `claude-sonnet-4-20250514`, codé en dur à **deux endroits** (`server/src/index.js`, génération complète et régénération d'une question), n'est plus servi. Conséquence : **tous les quiz sont produits par Gemini**, sans que rien ne le signale à l'écran. Le repli fait son travail — c'est justement ce qui rend la panne invisible.

Correctif : remplacer l'identifiant par un modèle courant aux deux endroits. Rien d'autre à changer, l'appel est identique.

> Le diagnostic donné par la version précédente de ce document (« `401` → la clé n'est pas enregistrée dans Railway ») était faux. Un `404 not_found_error` désigne le modèle, pas la clé.

---

## 10. Pistes pour la suite

| Chantier | Intérêt | Effort |
| --- | --- | --- |
| **Tableau de bord des résultats** | Valeur pédagogique de l'outil ; la route existe déjà, il manque l'écran | Moyen |
| **Liste des quiz du formateur** | Le formateur ne perd plus ses liens ; les quiz sont en base, il manque `GET /api/quizzes` | Faible |
| Export CSV/Excel des scores | Suivi administratif | Faible |
| Mode révision (réponse dévoilée à chaque question) | Usage entraînement | Faible |
| Auto-hébergement des polices | Performance, hors ligne | Faible |
| Sauvegarde périodique de la base | Filet de sécurité | Faible |

> La persistance (chantier n° 1 de la version précédente de ce document) est faite : SQLite sur volume Railway, voir §5 et §7. Elle débloque les quatre premières lignes ci-dessus.
