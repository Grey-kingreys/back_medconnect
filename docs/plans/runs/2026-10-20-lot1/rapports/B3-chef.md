# B3 - Rapport du chef d'équipe back (Opus)

Date : 2026-10-20. Branche `orch/lot1-back`. Verdict : **validé**.

## Ce qui a été fait

- Catalogue des codes d'erreur complété : PERMISSION_REFUSEE, SOS_ROLE_INTERDIT, SOS_DEJA_ACTIF, TRANSITION_INTERDITE.
- `exceptionFactory` du ValidationPipe global (`erreur-validation.ts`) : 400 avec `code: VALIDATION` et `champs: [{ champ, contraintes }]`, jamais la valeur saisie, aussi en production.
- Filtre global : toute 403 sans code reçoit PERMISSION_REFUSEE ; `champs` assaini (seules les clés `champ` et `contraintes`) ; `donnees` en liste blanche (`peutRelancerA`), ce qui corrige la perte de `peutRelancerA` sur le 409 SOS (B18).
- SOS réservé au rôle PATIENT (403 SOS_ROLE_INTERDIT, au début du contrôleur) ; 409 anti-relance porte SOS_DEJA_ACTIF.
- Annulation patient d'un rendez-vous refusée depuis TERMINE, REFUSE, ANNULE (409 TRANSITION_INTERDITE, message français propre à chaque statut).
- Tests : 2 nouvelles suites (erreur-validation, controller SOS), compléments filtre, service, urgence. CLAUDE.md mis à jour.

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : aucune sortie, code 0.
- `npx eslint <11 fichiers de la tâche>` : 0 erreur, 1 avertissement préexistant toléré (`no-floating-promises`, main.ts:89).
- `npx jest` : 37 suites sur 37, 419 passés, 3 ignorés (avant : 35 suites, 396).
- Tirets cadratin et demi-cadratin sur les lignes ajoutées et les nouveaux fichiers : aucun (grep code 1).
- Diff relu en entier : conforme à la spec, rien hors périmètre (ni front, ni `src/auth/client.ts`, ni autres ForbiddenException, aucune dépendance).

## Régressions web et mobile

- Web : ne lit que `message` ; les champs ajoutés (`code`, `champs`, `donnees`) sont un ajout pur. Le bouton SOS du web est déjà masqué hors PATIENT (`EmergencyButton.tsx` l.117), la 403 n'est donc pas atteignable depuis l'interface. Le texte de la 400 de validation est inchangé.
- Mobile : contrat enrichi, aucun champ existant retiré ni renommé.

## Décisions prises

- Critère 6 de la tâche appliqué aux seules lignes ajoutées : les tirets restants sont dans des lignes préexistantes non modifiées (CLAUDE.md, controller, service, service.spec) ; les corriger relève d'un lot séparé.
- Validation sans retouche malgré deux détails cosmétiques (voir réserves).

## Réserves (non bloquantes)

- Un titre de test du filtre utilise une apostrophe typographique (« n’est ») alors que les voisins utilisent l'apostrophe droite : cosmétique, sans effet.
- Le test du contrôleur appelle deux fois la méthode pour lire la réponse de l'exception : correct mais redondant.
- D24 à D27 restent des défauts révisables à confirmer avec le porteur (notamment le SOS réservé aux patients, D24).
