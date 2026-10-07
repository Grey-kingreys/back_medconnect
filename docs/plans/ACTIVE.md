
# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-06-p0-securite | Branche: orch/p0-securite | Parallélisme: 5 (1 seul sur l'arbre principal, les autres en worktree) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-06-p0-securite/ (backlog P0 : points 1, 2, 3, 4 ; le point 6 est dans le dépôt parent, branche orch/p0-securite)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|

## Faites (preuve = commit)

- T02 Débrancher l'ancien module de stockage : validé (481548c)
- T01 Chat : accès limité aux participants : validé (3c5d164, merge 16d2c49)
- T03 Statut de RDV : permission, propriété, DTO validé : validé (c3387be, merge 4e79d05)
- T04 Audit des créations : lire response.data.id : validé (a3ade27, merge eac400a)
- T05 compose.yml parent : R2_* et SUPER_ADMIN_* : validé (dépôt parent 28189e0)

## Questions parquées

## Dernières décisions (5 max, historique complet dans decisions.md)

- D05 Fichiers touchés propres à eslint, dette préexistante comprise
- D06 Jamais de git stash dans un worktree de tâche
- D07 Reprise par un orchestrateur unique, sans sous-agent
- D08 Tiret cadratin d'une ligne reformatée remplacé par une ponctuation neutre (révisable)
- D09 T01, T03, T04 mergés sans conflit, suite complète verte
