# PD01 - Squelette Electron et embarquement standalone

Tier: dur (codeur Sonnet, vérificateur Sonnet ; fiche détaillée, décisions prises)
Audience: dev pour la structure ; non-dev pour l'écran d'attente et les messages d'erreur de démarrage
Visuel: minimal (écran d'attente) ; toutes les pages restent celles du web
Background-safe: oui, sauf le lancement de l'application (fenêtre)
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: back et front fusionnés vers `dev` (fait) ; `DESKTOP_ORIGINS` renseignée dans le `.env` racine (fait par le chef, voir Prérequis)

## Spec

### Objectif

Une application Electron lance le front standalone sur `127.0.0.1` et affiche le site web tel quel : connexion en ligne, navigation, refresh par cookie. Aucune donnée locale, aucun hors ligne. Mémoire mesurée. Build web et Docker inchangés.

Décisions : D438, D440, D733 à D736, D749. Plan 4.1, 4.2, 4.8. Doc lue : `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`.

### Contexte vérifié (ne pas re-découvrir)

- Poste de dev : Windows 11, Node 24.21, npm 11.19, 31 Go de mémoire, mode développeur actif, Visual Studio 2022 présent **sans les outils C++** : aucune compilation native possible ici, aucune n'est requise.
- `electron@45.2.2` embarque Node 24.22.2 et Chrome 156. Windows 10 minimum, x64 et arm64 seulement : **pas de 32 bits**.
- `better-sqlite3@13.0.3` est en Node-API : `prebuilds/win32-x64.node` est dans le paquet npm, aucun script d'installation, même binaire sous Node et sous Electron. `@electron/rebuild` est abandonné (D734).
- `next build` copie `.env` et `.env.production` de la racine du front dans `.next/standalone` (`node_modules/next/dist/build/index.js`, `writeStandaloneDirectory`). Ces deux fichiers existent dans `front_medconnect/`. Ils ne doivent **jamais** partir dans l'application (D735).
- `next build` lit ces fichiers aussi : une variable déjà présente dans l'environnement du processus a priorité, c'est pourquoi le script la passe explicitement.
- Le standalone ne copie ni `public` ni `.next/static` (à copier à la main, doc). `PORT` et `HOSTNAME` sont lus par `server.js`.
- `.next` local n'est pas celui du conteneur (`frontend_next:/app/.next` dans `compose.override.yml`) : pas de collision avec le serveur de dev.
- Cookie de refresh : en dev `SameSite=Strict`, sans `Secure` (`back_medconnect/src/auth/sessions.service.ts:511`). Depuis `http://127.0.0.1:47613`, une API sur `localhost:3101` est un autre site : le cookie ne partirait pas. **La preuve de dev se fait avec `NEXT_PUBLIC_API_URL=http://127.0.0.1:3101`** (D736).
- `tsconfig.json` inclut `**/*.ts` : `desktop` doit en être exclu, sinon `next build` et le pre-commit le typent. `vitest.config.mts` ne prend que `src/**`, rien à changer. `eslint.config.mjs` : ajouter `desktop/**` à `globalIgnores`.
- `src/components/ServiceWorkerRegistration.tsx` enregistre `/sw.js` : inutile en desktop.

### Prérequis (chef, pas le codeur)

Le `.env` racine n'a pas de `DESKTOP_ORIGINS` renseignée : le chef reporte la valeur de `.env.example`, recrée le conteneur (`docker compose up -d backend`) et le dit au porteur. Le codeur ne lit ni n'édite aucun `.env`. La connexion écrit une ligne `Session` sur la base de dev du porteur : le chef le dit aussi.

### 1. Web : changements minimaux

`next.config.ts` : ajouter, dans `nextConfig`, seulement si `process.env.NEXT_OUTPUT === "standalone"` : `output: "standalone"`, `outputFileTracingRoot: process.cwd()`, `outputFileTracingExcludes: { "/*": ["desktop/**"] }`. Rien d'autre (CSP et en-têtes identiques).

`tsconfig.json` : `"exclude": ["node_modules", "desktop"]`. `eslint.config.mjs` : `"desktop/**"` dans `globalIgnores`. `.dockerignore` : ligne `desktop`. `.gitignore` : `/desktop/node_modules`, `/desktop/dist`, `/desktop/dist-front`, `/desktop/sortie`, `/desktop/sonde-resultat.json`.

`ServiceWorkerRegistration.tsx` : `if (window.medconnecteDesktop) return;` en tête de l'effet.

`src/lib/caisse/contrat_desktop.ts` (nouveau, types seuls pour l'instant) :

```ts
/** Pont exposé par le préchargement Electron. Absent sur le web : c'est le seul test de mode (D438). */
export interface PontDesktop {
  version: string;
}
declare global {
  interface Window {
    medconnecteDesktop?: PontDesktop;
  }
}
export function pontDesktop(): PontDesktop | null {
  return typeof window !== "undefined" && window.medconnecteDesktop ? window.medconnecteDesktop : null;
}
```

Test `src/lib/caisse/contrat_desktop.test.ts` : `pontDesktop()` vaut null sans pont, renvoie le pont s'il existe.

### 2. `desktop/package.json`

`name` `medconnecte-caisse`, `productName` `MedConnecte Caisse`, `version` `0.1.0`, `private`, `main` `dist/main.cjs`. Versions **exactes** : `dependencies` : `better-sqlite3@13.0.3` ; `devDependencies` : `electron@45.2.2`, `esbuild@0.28.2`, `typescript` (celle du front), `vitest` (celle du front). Repli autorisé si, et seulement si, PD01 échoue avec 45 : `electron@44.10.2` (même Node), à signaler.

Scripts : `construire:front` (`node scripts/construire-front.mjs`), `construire` (`node scripts/construire-electron.mjs`), `demarrer` (`npm run construire && electron .`), `test` (`vitest run`), `types` (`tsc --noEmit`).

`desktop/tsconfig.json` : `strict`, `target` ES2022, `module` esnext, `moduleResolution` bundler, `lib` `["ES2022","DOM"]`, `skipLibCheck`, `noEmit`, `paths` `{"@/*":["../src/*"]}`, `include` `["electron","coeur","scripts"]`.

`scripts/construire-electron.mjs` : esbuild de `electron/main.ts` vers `dist/main.cjs` (`platform: node`, `format: cjs`, `external: ["electron","better-sqlite3"]`) et `electron/preload.ts` vers `dist/preload.cjs` (`external: ["electron"]`, sandbox : un seul fichier CommonJS) ; copie `electron/attente.html` et `public/icons/icon-192x192.png` dans `dist/`.

### 3. `desktop/scripts/construire-front.mjs`

1. Exige `NEXT_PUBLIC_API_URL` dans l'environnement du processus, au format `http(s)://...`, sinon s'arrête en code 1 avec « Indiquez NEXT_PUBLIC_API_URL : l'adresse de l'API que cette caisse doit appeler. » ; jamais de repli sur `localhost`, jamais la valeur dans les journaux.
2. Lance `npx next build` dans la racine du front, avec `NEXT_OUTPUT=standalone`, `NEXT_PUBLIC_BASE_URL=http://127.0.0.1:47613`, `NEXT_TELEMETRY_DISABLED=1`.
3. Vide `desktop/dist-front/serveur`, y copie `.next/standalone` (`fs.cpSync` avec `recursive` et `dereference: true`, Turbopack crée des liens symboliques), puis `.next/static` vers `.next/static` et `public` vers `public`.
4. Supprime tout fichier `.env*` de la copie, puis parcourt la copie et s'arrête en code 1 s'il en reste un.
5. S'arrête en code 1 si `server.js` n'est pas à la racine de la copie (racine de traçage fausse).
6. Affiche la taille totale en Mo.

Si le serveur ne démarre pas avec la sortie Turbopack (modules introuvables), passer `--webpack` à `next build` et le signaler : le web reste en Turbopack.

### 4. `desktop/electron/`

`serveur-next.ts` :
- `choisirPort()` : essaie d'écouter 47613, 47614, 47615 sur `127.0.0.1` par `net.createServer`, referme, renvoie le premier libre. Aucun libre : boîte d'erreur « MedConnecte Caisse ne peut pas démarrer : les ports nécessaires sont occupés. Redémarrez l'ordinateur. » Ne jamais se connecter à un serveur déjà présent sur le port : ce pourrait être un autre programme.
- `lancerServeur(port)` : `utilityProcess.fork(cheminServer, [], { cwd, serviceName: "serveur-next", stdio: "pipe", env: { ...process.env, PORT, HOSTNAME: "127.0.0.1", NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" } })`. Chemin : `path.join(app.isPackaged ? process.resourcesPath : <desktop>, "dist-front/serveur/server.js")`. Pas de `ELECTRON_RUN_AS_NODE`.
- Attend `GET http://127.0.0.1:<port>/auth/login` en 200 (toutes les 200 ms, 45 s au plus : PC lents). Échec : boîte d'erreur en français, sortie.
- Tue le processus à `will-quit`. Arrêt imprévu : une relance, puis boîte d'erreur.

`main.ts` :
- `app.requestSingleInstanceLock()` ; seconde instance : ramène la fenêtre existante.
- `Menu.setApplicationMenu(null)`.
- Fenêtre créée tout de suite sur `attente.html` (logo existant, « Démarrage de MedConnecte Caisse... », fond et police simples), puis `loadURL("http://127.0.0.1:<port>/dashboard")` quand le serveur répond (le proxy renvoie à la connexion sans cookie témoin).
- `webPreferences` : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `devTools: !app.isPackaged`, `preload: dist/preload.cjs`.
- `will-navigate` et `setWindowOpenHandler` : même origine permise ; `https:` ouvert par `shell.openExternal` puis refus ; tout le reste refusé.
- `session.defaultSession.setPermissionRequestHandler` : tout refusé.
- Aucun jeton ni corps de requête dans les journaux.

`preload.ts` : `contextBridge.exposeInMainWorld("medconnecteDesktop", { version })`, version passée par `additionalArguments` (`--mc-version=`).

`memoire.ts` : si `process.env.MC_MESURE_MEMOIRE === "1"`, toutes les 30 s, ajoute à `app.getPath("userData")/mesure-memoire.csv` une ligne par processus de `app.getAppMetrics()` : horodatage, `type`, `name`, `memory.workingSetSize`, `memory.privateBytes`.

`sonde.ts` : seulement si `process.env.MC_SONDE === "1"` et `!app.isPackaged`. Sans interface, par `webContents.executeJavaScript`, écrit `desktop/sonde-resultat.json` puis quitte :
1. versions (`process.versions.electron`, `node`, `chrome`, `modules`) ;
2. `better-sqlite3` : `new Database(":memory:")`, `select 1`, `true`/`false` (`require` depuis le processus principal) ;
3. `process.platform`, `process.arch`, `pid` du serveur Next, type du processus dans `getAppMetrics` (`Utility`) ;
4. connexion : clic sur le bouton du compte de démonstration de la Pharmacie de Kaloum (`ComptesDemo`), URL finale sous `/dashboard`. Bouton introuvable : `connexion: "indisponible"`, sans échec masqué ; le chef demande alors au porteur une connexion à la main ;
5. cookie : `session.defaultSession.cookies.get({ name: "refresh_token" })` : présent et `httpOnly` (booléens seuls, jamais la valeur) ;
6. navigation : `/dashboard/vente`, `/dashboard/caisse`, `/dashboard/ventes` ; aucune redirection vers la connexion ;
7. refresh : remplace `access_token` de `localStorage` par une valeur invalide, recharge `/dashboard/vente`, vérifie que le jeton a changé et que l'utilisateur reste connecté (booléen seul) ;
8. origine et CORS : aucun message de console contenant `CORS` ou `Content Security Policy` ;
9. `window.medconnecteDesktop.version` lue dans la page, `window.require` absent, `process` absent.

### 5. Mémoire

Scénario, `MC_MESURE_MEMOIRE=1` et `MC_SONDE=1` dans un seul lancement avec 90 s d'attente sur `/dashboard/vente` avant de quitter. Rapport : somme de `workingSetSize` et de `privateBytes` par type de processus, au pic et en fin de scénario.

La première estimation du plan (350 Mo) oublie le processus GPU et le service réseau : s'attendre à un chiffre plus haut. Seuil : **500 Mo de somme des `workingSetSize`**.

Au-dessus, et dans cet ordre, en remesurant à chaque étape et en notant le gain : (a) `app.disableHardwareAcceleration()` ; (b) `execArgv: ["--max-old-space-size=128"]` sur le serveur Next ; (c) `app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256")`. Toujours au-dessus : **s'arrêter et rendre les chiffres**, le repli du plan 6.3 point 1 revient au porteur. Ce poste a 31 Go : la mesure n'est pas celle d'un PC de 4 Go, le dire dans le rapport.

## Fichiers autorisés

`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `.dockerignore`, `.gitignore`, `src/components/ServiceWorkerRegistration.tsx`, `src/lib/caisse/contrat_desktop.ts`, `src/lib/caisse/contrat_desktop.test.ts`, et tout sous `desktop/`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée, lue ou copiée.
- Pas de tiret cadratin ni demi-cadratin, français (textes, commentaires, journaux).
- `npm run build` du front en local, jamais dans le conteneur.
- Réutiliser le design existant, aucune refonte.
- Le web reste en ligne et ne change pas de comportement.
- Rien sur la base de dev du porteur sans le dire : la sonde se connecte et écrit une session, le chef a prévenu.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.
- Dans `desktop/`, `npm install` seulement, jamais à la racine du front.

## Preuves à rendre

1. `npm run build` sans `NEXT_OUTPUT` à la racine du front : réussit, **pas de `.next/standalone`** ; `git status` ne montre que les fichiers autorisés (signaler si `next build` réécrit `tsconfig.json`).
2. `docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, eslint des fichiers touchés.
3. Dans `desktop/` : `npm run types`, `npm run construire`, et `NEXT_PUBLIC_API_URL=http://127.0.0.1:3101 npm run construire:front` : réussi, taille affichée, aucun `.env*` dans la copie.
4. `sonde-resultat.json` complet (sans valeur sensible) et lignes du CSV de mémoire résumées.
5. `npm run test` du `desktop/` : passe à vide (`passWithNoTests`).

## Test à la main (porteur, facultatif à cette étape)

`npm run demarrer` : se connecter, ouvrir vente, caisse, ventes, reçu, thème clair et sombre.

## Done when

- [ ] Web inchangé, standalone seulement sous `NEXT_OUTPUT`
- [ ] Aucun `.env*` dans la sortie, contrôlé par le script
- [ ] Serveur Next par `utilityProcess` sur `127.0.0.1`, port fixe et replis
- [ ] Connexion, navigation et refresh par cookie prouvés
- [ ] `better-sqlite3` chargé sous Electron sans compilation
- [ ] Mémoire mesurée, seuil respecté ou arrêt avec chiffres

## Return

Fichiers touchés, sorties des gates, contenu de `sonde-resultat.json`, tableau mémoire, sortie Turbopack ou webpack, taille de la sortie, tout écart à la fiche.

## Historique

## Validation
