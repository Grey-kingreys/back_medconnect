# B3 - Vérification (verificateur Haiku)

Date : 2026-10-20
Dépôt : `back_medconnect`, branche `orch/lot1-back` (arbre principal, rien commité)
Tâche : `docs/plans/runs/2026-10-20-lot1/tasks/B3-codes-erreur-controles.md`

## Commandes (relancées par le vérificateur, depuis `medconnecte`)

1. `docker compose exec -T backend npx tsc --noEmit` : sortie vide, code 0.
2. `docker compose exec -T backend npx eslint <11 fichiers de la tâche>` : 0 erreur, 1 avertissement (`no-floating-promises` ligne 89 de `src/main.ts`, préexistant et toléré). Code 0.
3. `docker compose exec -T backend npx jest` : 37 suites passées sur 37, 419 tests passés, 3 ignorés (référence avant tâche : 35 suites, 396 passés). Code 0.
4. `docker compose exec -T backend npx jest src/common/filters src/carnet-sante` : 11 suites, 105 tests passés. Code 0. Les suites `erreur-validation.spec.ts` et `carnet-sante.controller.spec.ts` existent et passent.
5. `git diff --name-only` et `git status --short` : fichiers modifiés conformes au point 5 (CLAUDE.md, carnet-sante.controller.ts, carnet-sante.service.ts, carnet-sante.service.spec.ts, carnet-sante.urgence.spec.ts, all-exceptions.filter.ts, all-exceptions.filter.spec.ts, codes-erreur.ts, main.ts). Nouveaux fichiers : erreur-validation.ts, erreur-validation.spec.ts, carnet-sante.controller.spec.ts. Les modifications de `docs/plans/ACTIVE.md` et `docs/plans/runs/2026-10-20-lot1/decisions.md` viennent de l'orchestrateur et ne comptent pas.
6. `grep -nP "[\x{2013}\x{2014}]"` sur les fichiers touchés : des correspondances existent, toutes dans des lignes NON modifiées (en-têtes et commentaires préexistants : CLAUDE.md lignes 1, 66, 88, 91, 132, 144, 146, 152 ; carnet-sante.controller.ts ligne 97 ; carnet-sante.service.ts lignes 79, 81 ; carnet-sante.service.spec.ts lignes 16, 24). Vérification des seules lignes ajoutées (`git diff -U0` et nouveaux fichiers, préfixe `+`) : aucun tiret cadratin ni demi-cadratin. Code retour 1 sur les lignes ajoutées.

## Relecture du diff

- Catalogue `codes-erreur.ts` : les 9 codes dans l'ordre imposé, commentaires en français, en-tête remplacé. Conforme.
- `erreur-validation.ts` : `champsFautifs` et `fabriquerErreurValidation` conformes ; la valeur (`value`) et `target` ne sont jamais lus ; `messagesValidation` ne sert qu'à `message`. Conforme.
- `main.ts` : seul ajout `exceptionFactory: fabriquerErreurValidation` et son import. Conforme.
- Filtre : `PERMISSION_REFUSEE` pour 403 sans code, `champs` assaini (`assainirChamps`, aucune clé autre que `champ` et `contraintes`), liste blanche `DONNEES_AUTORISEES` pour `donnees`. Conforme.
- Contrôleur SOS : garde `req.user.role !== 'PATIENT'` avant l'appel au service, code `SOS_ROLE_INTERDIT`, `@ApiResponse` 403 et 409 ajoutés. Conforme.
- Service : `code: 'SOS_DEJA_ACTIF'` ajouté au 409 anti-relance, `TRANSITION_INTERDITE` pour TERMINE, REFUSE, ANNULE côté patient, placé après le contrôle `status !== 'ANNULE'` existant. La branche soignant n'est pas modifiée. Conforme.
- Tests : couverture des points 8 a) à e). Le test existant `PERMISSION_REFUSEE` est mis à jour. Aucun test supprimé ni affaibli (les assertions existantes sont conservées, elles sont seulement complétées). Aucun secret.
- `CLAUDE.md` : puce remplacée par le texte exact du point 9. Conforme.
- Hors périmètre : aucune modification de front, de `src/auth/client.ts`, ni d'autres `ForbiddenException`. Aucune nouvelle dépendance.

## Verdict

PASS. Les critères « Done when » 1 à 5 sont satisfaits. Le critère 6 est satisfait pour les lignes ajoutées (intention de la tâche) ; sa lettre (« aucune ligne » dans les fichiers touchés) n'est pas tenue à cause de tirets préexistants dans des lignes non modifiées. Ce point est signalé, il ne bloque pas.

## Problèmes

- Aucun problème bloquant.
- Note (non bloquante) : le critère 6 littéral échoue sur des lignes préexistantes non modifiées. Si l'orchestrateur veut un contrôle strict, il faut le limiter aux lignes ajoutées (`git diff`), ou corriger les tirets préexistants dans un lot séparé. Hors périmètre de B3.
- Note (non bloquante) : l'avertissement `no-floating-promises` de `src/main.ts` (ligne 89) est préexistant et toléré par la tâche.
