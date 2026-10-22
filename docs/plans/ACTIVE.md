# ACTIVE - MedConnecte (back_medconnect)

Index du run orchestré en cours. 150 lignes max. Protocole : docs/ORCHESTRATOR.md, section 9.
Reprise : lire ce fichier, puis seulement le fichier de la prochaine tâche.

Run: 2026-10-22-lot7 | Branche: orch/lot7-back | Parallélisme: 1 (tâches séquentielles, arbre principal) | Audience: mixte par surface (API dev ; messages d'erreur, emails, SMS et notifications non-dev)
Détails: docs/plans/runs/2026-10-22-lot7/ (lot 7 côté back : ventes en pharmacie selon SPEC-VENTES-PHARMACIE.md à la racine du monorepo ; branche créée depuis origin/dev 0fdeb4a ; rapports des sous-agents dans rapports/ ; décisions dans decisions.md, numérotation continuée depuis le lot 6 (D106)). Runs précédents à archiver : docs/plans/runs/2026-10-20-lot1/ (B1 à B3), docs/plans/runs/2026-10-20-lot2/ (B4 = f605421, B5 = a8c245c), docs/plans/runs/2026-10-21-lot3/ (B6 = 05e6b5b, B7 = 3a28867), docs/plans/runs/2026-10-21-lot4/ (B8 = e97f91e, B9 = 0d7ffff), docs/plans/runs/2026-10-21-lot5/ (B10 = 7527e53, B11 = 66bd64e), docs/plans/runs/2026-10-21-lot6/ (B12 = 26f4785)

## À faire et en cours

| ID | Tâche | Tier | Statut | Tent. |
|----|-------|------|--------|-------|
| B13 | Ventes en pharmacie, serveur complet : données et migration, permissions, création idempotente et atomique, liste du jour, détail, annulation, correctif d'ajustement du stock (tasks/B13-ventes-pharmacie.md) | spécifié | à faire | 0 |

## Faites (preuve = commit)

| ID | Tâche | Commit |
|----|-------|--------|
| B12 | Import Excel du stock : modes inventaire et livraison, case vide conservée, quantités avant et après (lot 6) | 26f4785 |
| B11 | Changement de mot de passe en 400, codes JETON_* sur les 401 de la garde (lot 5) | 66bd64e |
| B10 | Permissions selon le type de structure : pharmacie sans dossier médical, structureType dans /auth/me (lot 5) | 7527e53 |
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
- Orchestrateur principal (B10, D84 et D87) : l'éditeur de rôles d'une pharmacie (GET /roles/permissions) liste encore les permissions cliniques, inopérantes ; filtrer le catalogue côté front avec `structureType`, ou côté back dans un lot suivant ? (B13 : les permissions `vente:*` y apparaîtront aussi pour un hôpital, inopérantes, D111.)
- Orchestrateur principal (B11, D90 à D95) : le front ne doit rafraîchir que sur 401 `JETON_ABSENT`, `JETON_EXPIRE` ou `JETON_INVALIDE`, afficher le message du 400 `MOT_DE_PASSE_ACTUEL_INCORRECT` sous le champ « mot de passe actuel », et peut lire `champs[].message` (aujourd'hui `newPassword`).
- Orchestrateur principal (B12, D98 à D100 et D106) : le front doit envoyer le champ multipart `mode` (`inventaire` ou `livraison`) sur l'aperçu ET sur l'import, avec des boutons nommés « Inventaire » et « Livraison », et afficher `quantiteAvant` et `quantiteApres` de chaque ligne acceptée.
- Orchestrateur principal (B13, D114 à D116, D119, D122) : contrat des ventes pour le front lot 7 (codes, `details`, `STOCK_INTROUVABLE`, prix 0 refusé, prix du stock désormais entier) ; documenté dans back_medconnect/CLAUDE.md à la livraison de B13.

## Dernières décisions (5 max, historique complet dans decisions.md)

- D111 Permissions `vente:*` réservées aux pharmacies, retirées partout ailleurs (révisable)
- D112 Permissions rattachées aux rôles existants des pharmacies par migration, cache `perms:v3` (révisable)
- D113 Idempotency-Key : même règle que le SOS, rejeu 201 avec `rejeu: true` (plan)
- D119 `details` des erreurs de vente transmis par le filtre, clés filtrées (révisable)
- D120 Numérotation par compteur atomique en tête de transaction, année UTC (révisable)
