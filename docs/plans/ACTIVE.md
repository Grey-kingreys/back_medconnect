# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-20-lot1 | Branche: orch/lot1-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-20-lot1/ (lot 1 du plan mobile côté back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md). Run précédent archivé : docs/plans/archive/2026-10-20-tb3-sessions/

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B1 | TB4 révocation des sessions, compte désactivé, socket sessionRevoquee, purge | spécifié | validé par le chef d'équipe back (rapports/B1-chef.md) | 1 |
| B2 | TB1 limiteur par utilisateur, stockage Redis, SOS permissif si Redis tombe | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?

## Dernières décisions (5 max, historique complet dans decisions.md)

- D14 Limiteur compté par utilisateur (jeton Bearer vérifié dans la garde globale), sinon par IP (révisable)
- D15 register, login, forgot-password, reset-password restent comptés par IP (révisable)
- D16 Stockage Redis maison (Lua atomique) pour toutes les routes limitées (révisable)
- D17 Redis absent ou lent : SOS laissé passer, autres routes comptées en mémoire locale (révisable)
- D18 File email et SMS du SOS bornée à 2 s, erreur journalisée sans faire échouer le SOS (révisable)
