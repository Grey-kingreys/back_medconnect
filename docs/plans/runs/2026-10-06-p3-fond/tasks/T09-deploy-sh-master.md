# T09 - deploy.sh du dépôt parent : annoncer la branche réellement suivie

Tier: mécanique (agent mecanique)
Audience: dev (script d'exploitation)
Visuel: n/a
Background-safe: oui

Worktree de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/parent-p3` (dépôt **parent**, branche `orch/p3-fond`). Ne travaille que là. Ne commite pas : l'orchestrateur commite.

## Spec

Point 25 partiel. `deploy.sh` dit tirer « le dernier main » des sous-modules, alors que `.gitmodules` déclare `branch = master` pour `back_medconnect` et `front_medconnect` (et `git submodule update --remote` suit cette branche). Rendre le script exact, sans changer son comportement :
1. Commentaire d'en-tête : remplacer « dernier main » par la branche réellement suivie, en précisant qu'elle est définie par `branch =` dans `.gitmodules` (actuellement `master`).
2. Message `echo` de l'étape submodules : afficher la branche lue dynamiquement depuis `.gitmodules` plutôt qu'en dur, par exemple `git config -f .gitmodules submodule.back_medconnect.branch` et idem pour le front, avec repli sur `master` si vide. Garder `git submodule update --remote --merge` et la commande docker inchangés.
3. Ne rien toucher d'autre (ni `.gitmodules`, ni `compose*.yml`). Garder `set -euo pipefail`.

## Contraintes

Aucune initiative. Commentaires et messages en français. Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées (les points de suspension « … » déjà présents peuvent rester). Écrire uniquement avec Write et Edit.

## Done when

- `bash -n deploy.sh` : syntaxe valide.
- `grep -n "main" deploy.sh` : plus aucune mention de la branche « main ».
- Exécution à blanc de l'expression de lecture de branche : `git config -f .gitmodules submodule.back_medconnect.branch` renvoie `master`.
- `git status --porcelain` : seulement `deploy.sh`.

## Return

Fichier modifié + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
