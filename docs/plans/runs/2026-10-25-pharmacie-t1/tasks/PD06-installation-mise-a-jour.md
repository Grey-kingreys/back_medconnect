# PD06 - Installation et mise à jour

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: non-dev (officine, notice d'installation) ; dev pour la construction
Visuel: non (installateur, notice en français)
Background-safe: non (installation réelle sur le poste)
Dépôt: `front_medconnect`, branche `orch/pharmacie-t1-desktop`
Dépend de: PD05 validé

**Requise pour livrer** : sans elle, aucune officine ne peut installer l'application (D733).

## Spec

### Objectif

Un installateur Windows par utilisateur, sans droits d'administrateur, avec les fusibles coupés, et une mise à jour de 0.1.0 vers 0.1.1 qui garde les ventes et n'interrompt jamais une caisse ouverte. Notice pour une officine. Non signé par défaut, sans bloquer (Q05).

Décisions : D734, D736, D747, D748. Plan 4.7, 4.8.

### 1. `desktop/electron-builder.yml`

Version exacte : `electron-builder@26.18.0`, `electron-updater@6.8.11` (dépendance), `@electron/fuses@2.1.3`.

```yaml
appId: com.medconnecte.caisse
productName: MedConnecte Caisse
directories: { output: sortie }
files: [dist/**, node_modules/better-sqlite3/**, node_modules/electron-updater/**, package.json]
asarUnpack: ["node_modules/better-sqlite3/**"]
extraResources:
  - { from: dist-front/serveur, to: dist-front/serveur, filter: ["**/*"] }
npmRebuild: false
nodeGypRebuild: false
buildDependenciesFromSource: false
win:
  target: [{ target: nsis, arch: [x64] }]
  icon: ../public/icons/icon-512x512.png
nsis:
  oneClick: true
  perMachine: false
  deleteAppDataOnUninstall: false
publish:
  provider: generic
  url: ${env.MC_MAJ_URL}
```

- **`npmRebuild: false`** : `better-sqlite3` contient un `binding.gyp`, et il n'y a pas d'outils C++ ici : une reconstruction échouerait, et elle est inutile (Node-API, D734). Lister aussi les dépendances d'`electron-updater` si le lancement les réclame : ajuster `files`, et le signaler.
- `MC_MAJ_URL` absente : `publish` retiré, l'application annonce des mises à jour manuelles dans « Ce poste », sans erreur. `https:` exigé, sauf `http://127.0.0.1` pour la preuve.
- Vérifier après construction : `resources/dist-front/serveur/server.js`, `.next/static`, `node_modules` présents ; **aucun fichier `.env*`** (`node_modules/next/dist/compiled` compris : contrôle par nom de fichier exact) ; `prebuilds/win32-x64.node` hors de l'asar. Les filtres d'`electron-builder` écartent parfois `node_modules` ou les dossiers à point : **le contrôler, ne pas le supposer**, script `scripts/controler-sortie.mjs`, code 1 en cas de manque.

Chemins du poste de build (D751) : `.next/required-server-files.json` et `server.js` de la copie portent des chemins absolus du poste (`outputFileTracingRoot`, `turbopack.root`, `configFile`, `appDir`). Inutilisés à l'exécution, la sonde tourne depuis un autre dossier, mais ils ne doivent pas partir chez une officine. `construire-front.mjs` remplace la racine du front par `.` dans ces deux fichiers après la copie, sans toucher au reste ; `controler-sortie.mjs` s'arrête si la racine du poste de build se retrouve dans un `.js` ou un `.json` hors de `node_modules`. Rejouer ensuite la sonde. Si le serveur ne démarre plus : s'arrêter et le dire au chef.

Script `dist` : `construire:front`, `construire`, `electron-builder --win`, `controler-sortie`.

### 2. Fusibles, `scripts/fusibles.cjs` (`afterPack`)

`flipFuses` : `RunAsNode: false`, `EnableCookieEncryption: true`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`.

À prouver dans cet état final : **le serveur Next démarre bien par `utilityProcess` depuis `resources/`**, hors de l'asar, et `better-sqlite3` se charge. Si l'intégrité ou `OnlyLoadAppFromAsar` l'empêche, s'arrêter et rendre l'erreur : ne pas couper un fusible sans le chef.

`EnableCookieEncryption` : un cookie de refresh chiffré se perd s'il était écrit avant l'activation : aucune installation n'existe encore, le fusible est là dès 0.1.0. Sinon, nouvelle connexion, rien de plus grave : à noter.

Limite connue, au rapport : `resources/dist-front/` et le dossier d'installation par utilisateur sont modifiables par l'utilisateur Windows, hors de la vérification d'intégrité de l'asar ; acceptable en T1 (D747).

### 3. `desktop/electron/maj.ts`

`electron-updater`, `autoDownload: true`, `autoInstallOnAppQuit: false`, vérification au démarrage (après 60 s) puis toutes les 6 heures, seulement en ligne. Paquet uniquement : rien en dev.

Règle : **installer seulement à la fermeture, ou sur demande, et jamais si une caisse est ouverte ou si la file n'est pas vide** (plan 4.7, lu par `coeur.etatLocal()`).

- `update-downloaded` : `surEtat` porte `majPrete: version`.
- `before-quit` : si `majPrete` et règle respectée : `quitAndInstall(true, false)`. Sinon : quitte sans installer, la mise à jour reste pour la prochaine fermeture.
- « Ce poste » : « Mise à jour X prête : elle s'installera à la fermeture. », bouton « Installer maintenant » ; si la règle l'interdit : désactivé, « Fermez d'abord la caisse et attendez l'envoi des ventes. ».
- Échec de téléchargement : silencieux pour le vendeur, journal local.
- Test pur dans `desktop/coeur` : `peutInstaller(etat)` : caisse ouverte, file non vide, les deux, aucune.

Le schéma SQLite migre seul au démarrage (`user_version`) : une version plus ancienne qui rencontrerait une base plus récente s'arrête avec un message, sans rien écrire (test).

### 4. Variables de construction

`NEXT_PUBLIC_API_URL` (`https` en production), `MC_MAJ_URL`. Rien d'autre, aucun secret dans l'application : le fichier `.env*` n'est jamais une entrée de ce build. Le cookie de production est `SameSite=None; Secure`, sur un site différent de `http://127.0.0.1` : **jamais prouvé en dev**.

### 5. Preuve contre une API `https`

Paquet construit vers l'API déployée, si le porteur fournit l'adresse et y a réglé `DESKTOP_ORIGINS` : connexion, refresh après suppression du jeton, vente, envoi. Sans ces deux éléments : le rapport dit **non prouvé**, c'est bloquant pour la livraison à une officine, pas pour la fiche (D736).

### 6. Preuve d'installation et de mise à jour

Sur ce poste, dossier local servi sur `http://127.0.0.1:<port libre>` par un petit script `node:http`, `MC_MAJ_URL` pointée dessus :
1. construire 0.1.0, installer sans droits d'administrateur, emplacement dans `%LOCALAPPDATA%\Programs` ;
2. lancer, connecter, charger le catalogue, faire une vente, couper le réseau, en faire une autre (journal non vide) ; contrôle des fusibles par `npx @electron/fuses read` ;
3. construire 0.1.1, la déposer avec `latest.yml` ; application en cours : téléchargement constaté ;
4. caisse ouverte et file non vide : fermer : **pas d'installation**, version 0.1.0 au redémarrage ;
5. fermer la caisse, réseau revenu, file vide : fermer : installation, redémarrage en 0.1.1 ;
6. ventes et réglages présents ; journal intact, séquence continue ;
7. désinstaller : `%APPDATA%\MedConnecte Caisse\caisse.sqlite` reste ; réinstaller : poste repris, séquence après `sequenceMaxRecue`.

Écrit sur la base de dev du porteur : le chef le dit avant. Poste désinstallé à la fin ; supprimer le dossier de test est **au porteur**, le signaler.

### 6 bis. Mesure sur 4 Go (D750, exigée avant toute livraison)

Le paquet installé, sur un PC réel ou une machine virtuelle de 4 Go (Windows 10 de préférence) : scénario de PD01 (connexion, vente, caisse, ventes, 90 s d'attente), puis une vente et un reçu. Relevés : mémoire totale utilisée par Windows, mémoire libre, `workingSetSize` et `privateBytes` par processus, temps de démarrage, délai ressenti de la vente. `memoire.ts` étant inactif en paquet, relever par le Gestionnaire des tâches ou `Get-Process`. Aucune limite de tas à réintroduire. Sans machine disponible : le rapport dit **non prouvé**, et cela bloque la livraison à une officine, pas la fiche.

### 7. Notice : `desktop/NOTICE-INSTALLATION.md`

Pour une officine, français simple, moins d'une page :
- il faut Windows 10 ou 11 en 64 bits, 4 Go de mémoire, 1 Go de disque : comment le vérifier (Paramètres, Système, Informations) ;
- télécharger, double-cliquer ;
- **avertissement Windows SmartScreen tant que l'application n'est pas signée** : « Informations complémentaires », puis « Exécuter quand même » ; pourquoi, et n'utiliser que le lien donné par MedConnecte ;
- première connexion avec internet obligatoire ;
- sans internet : ce qui marche, ce qui ne marche pas (plan 4.5) ;
- choisir l'imprimante dans « Ce poste » ;
- ne pas désinstaller ni formater avec des ventes en attente : le bandeau dit combien ;
- qui appeler : `[À COMPLÉTER]`.

Le bandeau web D694 reste tel quel tant qu'aucune adresse de téléchargement n'existe : le texte du plan 3.4 reviendra avec elle, sur décision du porteur.

### 8. Questions au porteur (défaut non bloquant, voir D748)

| Question | Défaut |
|---|---|
| Certificat de signature Windows | Non signé, SmartScreen documenté (Q05). Une mise à jour non signée n'est vérifiée que par `sha512` de `latest.yml` : l'hébergement doit être sûr |
| Hébergement des mises à jour et du téléchargement | Aucun : `MC_MAJ_URL` absente, installation manuelle. Proposition : dossier sur le R2 public existant, `https` |
| Cible Windows | Windows 10 et 11, 64 bits. Electron ne fournit **pas** de version 32 bits et ne tourne pas sous Windows 7 ou 8 |
| Parc réel des officines | À vérifier sur le terrain : version de Windows, 32 ou 64 bits, mémoire, modèle d'imprimante, avant toute livraison |

## Fichiers autorisés

`desktop/**`. Rien sous `src/` sauf l'affichage de « Ce poste » (`src/app/dashboard/poste/**`, `src/lib/caisse/contrat_desktop.ts`).

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, scripts d'édition, `prettier --write`, `eslint --fix`).
- Aucune valeur de `.env` affichée, aucun `.env*` dans le paquet, aucun secret dans le dépôt, aucun certificat.
- Pas de tiret cadratin ni demi-cadratin, français.
- `npm run build` du front en local, jamais dans le conteneur.
- Le web reste en ligne et ne change pas de comportement.
- Rien sur la base de dev du porteur sans le dire.
- Commit par le chef, ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.
- Aucune publication d'installateur sur un hébergement sans accord du porteur.

## Gates

`docker compose exec -T frontend npx tsc --noEmit`, `docker compose exec -T frontend npx vitest run`, `npm run build` local ; dans `desktop/` : `npm run types`, `npm test`, `npm run dist`, `controler-sortie`.

## Done when

- [ ] Installateur sans droits d'administrateur, taille au rapport
- [ ] Fusibles actifs, serveur et SQLite fonctionnels dans cet état
- [ ] Aucun `.env*` dans le paquet, contrôlé par script
- [ ] 0.1.0 vers 0.1.1 prouvée, pas pendant une caisse ouverte
- [ ] Ventes conservées après mise à jour et réinstallation
- [ ] Notice en français, relue pour un non-dev
- [ ] Preuve `https` faite, ou dite non faite
- [ ] Mesure sur 4 Go faite, ou dite non faite
- [ ] Aucun chemin du poste de build dans la sortie

## Return

Fichiers touchés, sorties des gates, taille de l'installateur, sortie des fusibles, chaque étape de la preuve, tout écart à la fiche.

## Historique

## Validation
