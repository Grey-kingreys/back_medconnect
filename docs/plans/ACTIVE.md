# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p3-fond | Branche: orch/p3-fond | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p3-fond/ (niveau P3 du BACKLOG-PRIORISE racine : F4 spec, 20 tests, 21 typage back parqué, 25 partiel). Volet front : run homonyme dans front_medconnect. Volet parent (deploy.sh) : T09 ci-dessous, commit dans le dépôt parent.

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T02 | Tests unitaires auth.service (nouveau fichier) | spécifié | dispatché | 1 |
| T03 | Tests unitaires checkAccess du carnet (nouveau fichier) | spécifié | dispatché | 1 |
| T04 | Code mort : en-têtes jwt.strategy, roles.guard, roles.decorator | mécanique | à faire | 0 |
| T09 | deploy.sh du parent : annoncer master (branche suivie) | mécanique | à faire | 0 |
| T10 | Mode strict du back (point 21) | - | parqué | 0 |

## Faites (preuve = commit)

- T01 spécification F4 (commit « docs(f4) »)

## Questions parquées

- T10 : passage en mode strict du back, diff trop transverse pendant que P0, P1, P2 modifient le code. Recommandation dans decisions.md (D03).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D01 : tests de checkAccess sur le comportement actuel, sans modifier le service (P1 le corrige).
- D02 : spec F4 rangée dans back_medconnect/docs/specs/ (modèle de données et API au back).
- D03 : mode strict du back parqué, recommandation notée.
