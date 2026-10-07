# T02 - Débrancher l'ancien module de stockage

Tier: mécanique (agent mecanique)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

Backlog P0 point 2. Constat vérifié : `src/common/storage.controller.ts` (`GET /storage/download-url`) signe n'importe quelle clé pour tout utilisateur connecté, sans contrôle d'accès. Le module est importé dans `src/app.module.ts` (import ligne 17 `LegacyStorageModule`, et entrée `LegacyStorageModule,` dans le tableau `imports` vers la ligne 105). Aucun consommateur : ni dans le back (le `StorageService` métier vient de `src/storage/`), ni dans le front (aucun appel à `/storage/upload-url` ou `/storage/download-url`, vérifié par l'orchestrateur).

À faire, uniquement dans `src/app.module.ts` :
1. Commenter la ligne `import { StorageModule as LegacyStorageModule } from './common/storage.module';` (ne pas la supprimer) et commenter l'entrée `LegacyStorageModule,` du tableau `imports`.
2. Au-dessus de chacune, un commentaire français expliquant : module débranché (backlog P0 point 2) car `GET /storage/download-url` signe n'importe quelle clé pour tout utilisateur connecté sans contrôle d'accès ; code conservé dans `src/common/storage.*` ; le stockage actif est `src/storage/` (R2, contrôle d'accès par `FileAccessService`) ; ne pas rebrancher sans contrôle de propriété.
3. Ne supprimer aucun fichier, ne pas toucher `src/common/storage.*`.
Attention : ne pas écrire de tiret cadratin ni demi-cadratin dans les lignes ajoutées (le commentaire existant ligne 16 en contient un, ne pas le recopier).

## Contraintes

Faire uniquement ce qui est demandé. Commentaires en français. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas committer.

## Done when

- `grep -n "^\s*LegacyStorageModule," src/app.module.ts` : aucun résultat ; `ls src/common/storage.controller.ts src/common/storage.module.ts` : présents.
- `npx --no-install tsc --noEmit` : 0 erreur ; `npx --no-install eslint src/app.module.ts` : 0 erreur.
- `npx --no-install jest src/app.module.spec.ts` : vert.

## Return

Chemin du fichier modifié + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-06 | mécanique | ok | eslint signalait 2 erreurs prettier préexistantes (fin de fichier) ; corrigées par eslint --fix (D05)

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc --noEmit | 0 erreur
eslint src/app.module.ts | 0 erreur
jest src/app.module.spec.ts | 2/2 verts ; npm test 34/34 verts
hash : voir le commit « fix(securite): débranche l'ancien module de stockage » sur orch/p0-securite
