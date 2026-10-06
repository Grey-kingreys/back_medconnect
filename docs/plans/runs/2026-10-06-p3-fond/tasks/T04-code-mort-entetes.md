# T04 - Code mort : documenter jwt.strategy, roles.guard, roles.decorator

Tier: mécanique (agent mecanique)
Audience: n/a
Visuel: n/a
Background-safe: oui

Worktree de travail : `D:/souleymane/perso-archive-20260923/perso/medconnecte/.worktrees/back-p3-fond` (branche `orch/p3-fond`). Ne travaille que là. Ne commite pas : l'orchestrateur commite.

## Spec

Point 25 partiel du backlog. Trois fichiers ne sont importés nulle part (à revérifier) : `src/auth/jwt.strategy.ts`, `src/common/guards/roles.guard.ts`, `src/common/decorators/roles.decorator.ts`. Décision D04 : ne rien supprimer, ne rien changer au comportement.

1. Vérifier l'absence d'usage : `grep -rn "jwt.strategy\|JwtStrategy\|roles.guard\|RolesGuard\|roles.decorator\|decorators/roles" src test --include=*.ts` (hors le fichier lui-même et les commentaires). Si un import réel existe pour l'un d'eux, ne pas toucher ce fichier et le lister dans un bloc BLOCKED.
2. Ajouter **en tête** de chacun des trois fichiers (avant le premier import) un commentaire de bloc en français, exactement de cette forme, adaptée au fichier :

```
/**
 * CODE INUTILISÉ (constaté le 2026-10-06, point 25 du BACKLOG-PRIORISE racine).
 * Ce fichier n'est importé par aucun module : <remplacement réel, voir ci-dessous>.
 * Conservé volontairement (consigne : ne supprimer aucun code existant).
 * À retirer lors d'un nettoyage dédié, après vérification.
 */
```

   Remplacements réels : pour `jwt.strategy.ts`, l'authentification passe par `AuthGuard` (`src/common/guards/auth.guard.ts`) qui vérifie le token avec `JwtService` ; pour `roles.guard.ts` et `roles.decorator.ts`, le contrôle d'accès passe par `PermissionsGuard` (`src/common/rbac/permissions.guard.ts`). Vérifier ces deux affirmations en lisant ces fichiers avant d'écrire.
3. Rien d'autre dans ces fichiers, sauf si `npx --no-install eslint <fichier>` signale des erreurs préexistantes (le pre-commit lint les fichiers entiers) : dans ce cas, appliquer `npx --no-install prettier --write <fichier>` (formatage seul) et relancer eslint ; s'il reste des erreurs non liées au formatage, les lister dans un bloc BLOCKED sans les corriger.

## Contraintes

Aucune initiative. Aucun tiret cadratin ni demi-cadratin. Ne pas modifier docs/plans/. Écrire uniquement avec Write et Edit (prettier autorisé pour le formatage).

## Done when

- `head -3` de chacun des trois fichiers montre le commentaire « CODE INUTILISÉ ».
- `npx --no-install tsc --noEmit` : aucune erreur.
- `npx --no-install eslint src/auth/jwt.strategy.ts src/common/guards/roles.guard.ts src/common/decorators/roles.decorator.ts` : aucune erreur.
- `git status --porcelain` (hors docs/plans/) : seulement ces trois fichiers.

## Return

Fichiers modifiés + preuves (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

## Validation
