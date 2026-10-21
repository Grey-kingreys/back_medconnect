# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-21-lot5 | Branche: orch/lot5-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-21-lot5/ (lot 5 côté back, branche créée depuis orch/lot4-back ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 4 (D79)). Runs précédents à archiver : docs/plans/runs/2026-10-20-lot1/ (B1 à B3), docs/plans/runs/2026-10-20-lot2/ (B4 = f605421, B5 = a8c245c), docs/plans/runs/2026-10-21-lot3/ (B6 = 05e6b5b, B7 = 3a28867), docs/plans/runs/2026-10-21-lot4/ (B8 = e97f91e, B9 = 0d7ffff)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B10 | Permissions selon le type de structure : pharmacie sans dossier médical, structureType dans /auth/me (tasks/B10-permissions-type-structure.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B9 | Journaux HTTP minimisés (lot 4) | 0d7ffff |
| B8 | Redis en rediss:// pour BullMQ ; échec d'email sans 500 ni état à moitié créé (lot 4) | e97f91e |
| B6 | TB10b qualité de position et idempotence du SOS (lot 3) | 05e6b5b |
| B7 | Réalignement AuditLog sur la migration 20260704 (lot 3) | 3a28867 |

## Questions parquées

- Porteur (reprise TB3) : retour arrière SESSIONS_MULTI_APPAREILS=false après une période à true réactive les anciens refresh encore valides dans User.refreshToken ; vider la colonne au premier démarrage avec le drapeau actif ?
- Porteur (reprise TB3) : durées Q11 et invalidation unique des sessions web au déploiement, à annoncer aux utilisateurs.
- Porteur (B2, D18) : Redis arrêté, l'email et le SMS au proche d'un SOS sont perdus (journalisés seulement) ; ajouter un envoi direct de secours ?
- Porteur (B4, Q04) : numéros d'urgence de Guinée (SAMU, pompiers, police) ; seul « 15 » est servi tant que Q04 n'est pas tranchée (D29).
- Orchestrateur principal (B8, D68 et D71) : le front doit lire `data.invitationEnvoyee` et afficher le message renvoyé (création de structure et de membre), et le code EMAIL_INDISPONIBLE du renvoi d'invitation.
- Orchestrateur principal (B10, D84 et D87) : l'éditeur de rôles d'une pharmacie (GET /roles/permissions) liste encore les permissions cliniques, inopérantes ; filtrer le catalogue côté front avec `structureType`, ou côté back dans un lot suivant ? « Ordonnances adressées à une pharmacie » n'existe pas : fonctionnalité à spécifier ?

## Dernières décisions (5 max, historique complet dans decisions.md)

- D81 Pharmacie : liste blanche (stock, catalogue, structure, membres, rôles, chat:structure), tout le reste retiré (révisable)
- D82 Filtre dans PermissionsService.getUserPermissions, fonctions pures dans src/common/rbac/permissions-type-structure.ts (révisable)
- D84 Rôles personnalisés intacts en base, permission clinique inopérante en pharmacie (révisable)
- D85 Cache des permissions en perms:v2:user: (révisable)
- D86 /auth/me renvoie data.structureType et les permissions filtrées (user)
