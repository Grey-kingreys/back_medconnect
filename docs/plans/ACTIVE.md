# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p3-fond | Branche: orch/p3-fond | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p3-fond/ (niveau P3 du BACKLOG-PRIORISE racine : F4 spec, 20 tests, 21 typage back parqué, 25 partiel). Volet front : run homonyme dans front_medconnect. Volet parent (deploy.sh) : T09 ci-dessous, commit dans le dépôt parent.

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T09 | deploy.sh du parent : annoncer master (branche suivie) | mécanique | dispatché | 1 |
| T10 | Mode strict du back (point 21) | - | parqué | 0 |

## Faites (preuve = commit)

- T01 spécification F4 (606b093)
- T02 tests AuthService, 19 tests (cf2b977, merge 9b52cbd)
- T03 tests checkAccess, 12 tests (6df19f8, merge fd2ed4d)
- T04 code mort documenté (commit « docs(code-mort) »)

## Questions parquées

- T10 : passage en mode strict du back, diff trop transverse pendant que P0, P1, P2 modifient le code. Recommandation dans decisions.md (D03).

## Dernières décisions (5 max, historique complet dans decisions.md)

- D03 : mode strict du back parqué, recommandation notée.
- D04 : code mort documenté par un en-tête, sans suppression.
- D05 : deploy.sh suivi ici, commit dans le dépôt parent.
- D06 : lint préexistant du code mort neutralisé par eslint-disable justifié (révisable).
