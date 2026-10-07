# T08 - Point 13 (CI back) : GitHub Actions minimale

Tier: spécifié (agent implementeur-specifie)
Audience: dev
Visuel: n/a
Background-safe: oui

## Spec

Constat : aucun dossier `.github/` dans ce dépôt, donc aucune CI.

À faire : créer `.github/workflows/ci.yml` :
- déclencheurs : `push` sur `master` et `orch/**`, `pull_request` vers `master` ;
- un job `verification` sur `ubuntu-latest`, Node : lire la version utilisée par le `Dockerfile` de ce dépôt (image `node:<version>`) et l'utiliser dans `actions/setup-node@v4` avec `cache: npm` ;
- étapes : `npm ci --no-audit --no-fund`, `npx --no-install prisma generate`, `npx --no-install tsc --noEmit`, `npm test` ;
- variables d'environnement factices au niveau du job pour ce que `prisma generate` et les tests exigent (au minimum `DATABASE_URL: postgresql://ci:ci@localhost:5432/ci`) ; **aucun vrai secret**, valeurs visiblement factices ; commentaire en français expliquant qu'elles ne servent qu'à la compilation et aux tests unitaires (aucune base n'est démarrée) ;
- pas de lint global (dette d'environ 2 000 erreurs, backlog point 22) : commentaire en français qui le dit ;
- `concurrency` pour annuler les exécutions obsolètes d'une même branche ; `permissions: contents: read`.

Vérifier localement que la séquence passe **sans variables d'environnement du poste** : dans ce worktree, lancer `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL=postgresql://ci:ci@localhost:5432/ci npx --no-install prisma generate` puis `env -i PATH="$PATH" HOME="$HOME" DATABASE_URL=... npm test` (adapter si Windows l'exige), et ajouter au YAML toute variable factice réellement nécessaire.

Vérifier la syntaxe YAML avec Node (par exemple `node -e "require('js-yaml')..."` si `js-yaml` est présent dans `node_modules`, sinon un autre analyseur YAML déjà installé ; ne rien installer).

## Contraintes

Faire uniquement ce qui est demandé. Commentaires en français, aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell. Ne pas commiter, ne rien pousser : l'orchestrateur commite. Ne jamais lire ni afficher un fichier `.env*`.

## Done when

- `.github/workflows/ci.yml` existe et s'analyse sans erreur (commande et résultat donnés).
- La séquence prisma generate + `npm test` passe localement avec seulement les variables factices du YAML (preuve en une ligne).

## Return

Fichier créé + preuves (commandes lancées, résultat en une ligne chacune). Ou un bloc BLOCKED. Pas de prose.

## Historique

2026-10-07 | orchestrateur (reprise, D08) | succès | Node 22 (image node:22-slim) ; seule `DATABASE_URL` factice nécessaire

## Validation

js-yaml load ; `env -i ... DATABASE_URL=factice` prisma generate puis npm test | YAML OK, job verification, 6 étapes ; client généré, 9 suites, 65 tests verts | edebc60, merge d77ae60
