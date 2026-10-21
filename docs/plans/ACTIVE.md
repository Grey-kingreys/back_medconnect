# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-21-lot4 | Branche: orch/lot4-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-21-lot4/ (lot 4 côté back, robustesse vue sur le déploiement de dev Render ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 3). Runs précédents à archiver : docs/plans/runs/2026-10-20-lot1/ (B1 à B3), docs/plans/runs/2026-10-20-lot2/ (B4 = f605421, B5 = a8c245c), docs/plans/runs/2026-10-21-lot3/ (B6 = 05e6b5b, B7 = 3a28867)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B9 | Journaux HTTP minimisés : ni en-têtes ni IP, URL sans query, niveau par statut, sondage en debug (tasks/B9-journaux-http-minimises.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B8 | Redis en rediss:// pour BullMQ ; échec d'email sans 500 ni état à moitié créé | e97f91e |
| B6 | TB10b qualité de position et idempotence du SOS (lot 3) | 05e6b5b |
| B7 | Réalignement AuditLog sur la migration 20260704 (lot 3) | 3a28867 |

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?
- Porteur (B4, Q04) : numéros d'urgence de Guinée (SAMU, pompiers, police) ; seul « 15 » est servi tant que Q04 n'est pas tranchée (D29).
- Orchestrateur principal (B8, D68 et D71) : le front doit lire `data.invitationEnvoyee` et afficher le message renvoyé (création de structure et de membre), et le code EMAIL_INDISPONIBLE du renvoi d'invitation.

## Dernières décisions (5 max, historique complet dans decisions.md)

- D75 Configuration pino-http dans optionsPinoHttp() (src/common/journalisation/), fonctions pures testées (révisable)
- D76 Journal de requête réduit à id, méthode, URL sans query, statut, durée, userId ; redact gardé (user)
- D77 Niveaux : 5xx error, 4xx warn, GET / et GET /notifications réussis en debug, reste info (user)
- D78 Sonde de santé GET / toujours ignorée par autoLogging (révisable)
- D79 Sérialiseur err et journaux applicatifs inchangés (révisable)
