# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-tb3-sessions | Branche: orch/tb3-sessions | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-tb3-sessions/ (lot TB3 du plan mobile, adaptations B01 et B02 ; décisions dans decisions.md)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| T01 | Modèle Prisma Session et migration | spécifié | à faire | 0 |
| T02 | Service de sessions, codes d'erreur et drapeau | spécifié | à faire | 0 |
| T03 | Connexion, inscription, démo et invitation par session d'appareil | spécifié | à faire | 0 |
| T04 | Refresh et déconnexion, web par cookie et mobile par le corps | spécifié | à faire | 0 |
| T05 | Documentation, variable d'environnement et parcours réel | spécifié | à faire | 0 |

## Faites (preuve = commit)

## Questions parquées

## Dernières décisions (5 max, historique complet dans decisions.md)

- D03 Durées Q11 : mobile patient 30 j glissants, mobile autres rôles 12 h, web 30 j inchangé (révisable)
- D05 Grâce 30 s : l'ancien refresh renvoie le refresh courant chiffré par EncryptionService (révisable)
- D07 Champ `code` ajouté par le filtre global depuis un catalogue, TB2 l'étendra (révisable)
- D12 Drapeau SESSIONS_MULTI_APPAREILS (défaut true), false = ancien refresh unique
- D16 .env.example et compose.yml (dépôt racine) modifiés par T05 sans commit de ce run (révisable)
