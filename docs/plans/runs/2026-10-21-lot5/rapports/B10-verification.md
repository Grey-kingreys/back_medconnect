# Vérification B10 : permissions selon le type de structure

Date : 2026-10-21 (14h58, heure locale)
Dépôt : `back_medconnect`, branche `orch/lot5-back`
Tâche : `docs/plans/runs/2026-10-21-lot5/tasks/B10-permissions-type-structure.md`

## Commandes relancées

Toutes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte`.

| Commande | Résultat |
|---|---|
| `docker compose exec -T backend npx tsc --noEmit` | Aucune erreur (code de sortie 0). |
| `docker compose exec -T backend npx eslint <5 fichiers touchés>` | 0 erreur (code de sortie 0). |
| `docker compose exec -T backend npx jest` | 54 suites passent sur 54, 610 tests passent, 3 ignorés, 0 échec. Dont `permissions-type-structure.spec.ts` et `auth.me.spec.ts`. |
| `git status --porcelain -- . ':!docs/plans'` | Exactement les 6 fichiers autorisés : `CLAUDE.md`, `src/auth/auth.service.ts`, `src/common/rbac/permissions.service.ts`, `src/auth/auth.me.spec.ts`, `src/common/rbac/permissions-type-structure.spec.ts`, `src/common/rbac/permissions-type-structure.ts`. |
| Recherche de tirets cadratin U+2014 et demi-cadratin U+2013 dans les lignes ajoutées (`git diff -U0`) | Aucune occurrence. |
| Même recherche dans les nouveaux fichiers | Aucune occurrence. |
| `grep "perms:v2:user:"` sur `permissions.service.ts` | 1 occurrence (ligne 28). |
| `grep filtrerPermissionsSelonTypeStructure` sur `permissions.service.ts` | 2 occurrences (import et appel). |
| `grep structureType` sur `auth.service.ts` | 2 occurrences (ligne 353 et 361). |
| `grep "Permissions selon le type de structure (B10)" CLAUDE.md` | 1 occurrence. |
| Recherche de `eslint-disable` et `as any` dans les ajouts | Aucune occurrence. |

## Contrôle du diff

- `permissions-type-structure.ts` : conforme à la spec (liste blanche de 10 codes, `typeStructureEffectif`, `filtrerPermissionsSelonTypeStructure`, en-tête en français).
- `permissions.service.ts` : préfixe `perms:v2:user:`, select de `structure` et `administeredStructure`, filtre appliqué avant mise en cache. Le reste de la logique est inchangé.
- `auth.service.ts` : `administeredStructure` retiré de la réponse, `structureType` ajouté. `permissions` vient toujours de `getUserPermissions`.
- `CLAUDE.md` : une seule ligne ajoutée, aucune autre modification.
- Aucun test existant supprimé ou affaibli. Aucun secret.
- Les fichiers hors liste (`roles.service.ts`, `permissions.constants.ts`, `permissions.guard.ts`, contrôleurs, `schema.prisma`) ne sont pas modifiés.
- Les modifications de `docs/plans/ACTIVE.md` et le dossier `docs/plans/runs/` existent dans l'arbre de travail mais relèvent de l'orchestrateur, exclus du périmètre par la consigne.

## Points non bloquants

- `permissions.service.ts` contient, en plus de la fonctionnalité, quatre reformatages Prettier de `logger.warn` (lignes raccourcies, sans changement de sens). Ils sont issus de `eslint --fix`, autorisé par la spec.
- Des avertissements `LF will be replaced by CRLF` apparaissent à cause de la configuration Git du poste. Ils ne concernent pas le code.

## Verdict

PASS. Les quatre commandes du « Done when » et la vérification des tirets passent. Aucun problème bloquant.
