# Vérification U1 : structure de rattachement (lot7b, back)

Date : 2026-10-22 (07:31)
Dépôt : `D:\tmp\wt-back-lot7b`, branche `orch/lot7b-back`. Gate locale uniquement, aucun `docker compose`, aucun commit.

## Commandes relancées

| Commande | Résultat |
|---|---|
| `npx --no-install tsc --noEmit` | OK, code 0, aucune erreur |
| `npx --no-install eslint <7 fichiers touchés>` | OK, sortie vide, code 0 |
| `npx --no-install jest src/user` | OK, 3 suites, 20 tests verts (dont les nouveaux specs 5a, 5b, 5c) |
| `npx --no-install jest` (suite complète) | OK, 58 suites, 648 tests verts, 3 ignorés (préexistants) |
| `env -u DATABASE_URL npm run structures:rattachements` | Conforme, affiche « DATABASE_URL n'est pas définie. », code 1 |
| `git status --porcelain` | Fichiers attendus seulement (+ `docs/plans/` tenu par l'orchestrateur) |
| `git diff --quiet -- package-lock.json prisma src/pharmacie src/common/rbac` | OK, code 0, rien modifié |
| Recherche de tirets cadratin et demi-cadratin (octets UTF-8, dans les lignes ajoutées et les 4 fichiers nouveaux) | OK, aucune occurrence |

Note : la commande `grep -P` prévue par la tâche échoue sur cette machine (locale), la recherche a donc été faite sur les octets. Résultat identique.

## Revue du diff

Conforme à la spec, sans réserve :
- `user.service.ts` : `avecStructureResolue`, `administeredStructure` ajouté dans les deux `select`, `structureId` brut conservé, autres méthodes intactes.
- `user.controller.ts` : non modifié.
- `package.json` : une seule ligne ajoutée, `package-lock.json` intact.
- `CLAUDE.md` : une puce ajoutée après TB17, rien d'autre.
- Script `scripts/structures-rattachements.ts` : requête paramétrée, `BEGIN READ ONLY` puis `ROLLBACK`, libellés conformes, aucun secret.
- `src/user/rattachements-structure.ts` : quatre catégories exclusives conformes à la Spec 4a.
- `user.service.spec.ts` : ajout seul (101 lignes), tests existants non modifiés.
- Tests nouveaux : présents et verts, `user.controller.spec.ts` couvre la non-régression D201.

## Verdict

**ECHEC (pass = false)** : la commande de vérification passe, mais le diff de `src/user/dto/user.dto.ts` contient un reformatage hors périmètre que la spec interdit.

## Problèmes (actionnables)

1. **`src/user/dto/user.dto.ts` : indentation réécrite sur tout le fichier.** La spec demande « indentation existante à 4 espaces, la conserver » et « ne rien changer d'autre ». Dans HEAD, le fichier compte 114 lignes indentées à 4 espaces et 0 à 2 espaces ; dans le worktree, 4 et 124. Le diff brut fait 276 lignes modifiées, alors que le changement réel tient en 24 lignes. Corriger : rétablir l'indentation à 4 espaces de tout le fichier, puis réappliquer uniquement l'ajout de `UserStructureDto` et de la propriété `structure` dans `UserResponseDto`.
2. **`src/user/dto/user.dto.ts` : reformatages hors sujet.** Deux `@Matches({ message: ... })` ont été reflowés (`CreateUserByAdminDto.password` et `ChangeUserPasswordDto.newPassword`) et une ligne vide avant `// Rôles que l'admin peut créer` a été supprimée. Les rétablir à l'identique de HEAD.
3. Après correction, relancer `tsc`, `eslint` sur le fichier, et `jest` complet, puis vérifier que `git diff --stat -- src/user/dto/user.dto.ts` ne montre que les lignes ajoutées de la spec (ordre de grandeur : une vingtaine de lignes).

## Remarques sans action requise

- Avertissements git `LF will be replaced by CRLF` : réglage `core.autocrlf` de la machine, sans incidence sur le contenu (aucun CR dans HEAD ni dans le worktree).
- `docs/plans/ACTIVE.md` est modifié : toléré, dossier réservé à l'orchestrateur.
