
# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p0-securite | Branche: orch/p0-securite | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p0-securite/ (backlog P0 : points 1, 2, 3, 4 ; le point 6 est dans le dépôt parent, branche orch/p0-securite)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T01 | Chat : accès limité aux participants (REST, WebSocket, CORS gateway) | spécifié | échoué (lint fichiers touchés, D05) | 1 |
| T03 | Statut de RDV : permission, propriété, DTO validé | spécifié | échoué (lint fichiers touchés, D05) | 1 |
| T04 | Audit des créations : lire response.data.id | spécifié | échoué (lint fichiers touchés, D05) | 1 |
| T05 | compose.yml parent : R2_* et SUPER_ADMIN_* (dépôt parent) | mécanique | dispatché | 1 |

## Faites (preuve = commit)

- T02 Débrancher l'ancien module de stockage : validé (commit de cette tâche)

## Questions parquées

## Dernières décisions (5 max, historique complet dans decisions.md)
