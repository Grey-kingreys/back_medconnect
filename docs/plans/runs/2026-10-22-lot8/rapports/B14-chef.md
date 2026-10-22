# B14 : rapport du chef d'équipe back

Date : 2026-10-22
Branche : orch/lot8-back
Verdict : validé, commité (hash dans le Return de l'orchestrateur et dans `git log -1`).

## Ce qui a été fait

- `permissions.constants.ts` : `PERMISSIONS_GARANTIES_ADMIN_PHARMACIE` (stock:read, stock:write, vente:read, vente:write, vente:annuler) ; `stock:read` et `stock:write` en tête du rôle « Administrateur de structure » des pharmacies. Rôles hôpital, clinique et Pharmacien inchangés.
- `roles.service.ts` : `completerRolesAdminPharmacie` (ajout seul, `skipDuplicates`, invalidation du cache du rôle si ajout, journal seulement si total > 0), appelée au démarrage après `seedExistingStructures` et avant `backfillUsers`, dans le `try` existant. Formatage prettier et `catch (e: unknown)` (D310), sans autre changement de comportement.
- `demo.donnees.ts` : `admin.kaloum` dans `COMPTES_VITRINE`, description exacte de la fiche, commentaire mis à jour.
- `vente.controller.ts` : deux `@ApiResponse` 2xx (201 création, 200 détail), aucune logique.
- Tests : `roles.service.spec.ts` (6 cas), `demo.vitrine.spec.ts` (2 administrateurs, Kaloum), `demo.controller.spec.ts` (ordre 7 puis 8), `vente.service.spec.ts` (2 cas de reçu).
- `CLAUDE.md` : contrat exact des ventes (contraintes, messages, erreurs, reçu, permissions) et phrase du mode démo.

## Preuves (relancées par le chef)

- `docker compose exec -T backend npx tsc --noEmit` : sortie 0.
- `docker compose exec -T backend npx eslint` sur les 8 fichiers de la tâche : sortie 0, aucune erreur ni avertissement.
- `docker compose exec -T backend npx jest` : 62 suites, 711 réussis, 3 ignorés (préexistants), 0 échec.
- Tirets cadratin et demi-cadratin (locale UTF-8) : aucune ligne dans le diff, `roles.service.spec.ts` ni le dossier du run.
- Journal de démarrage : « Rôles d'administrateur de pharmacie complétés : 4 permission(s) ajoutée(s) sur 2 rôle(s). »
- `curl GET /auth/demo/comptes` : admin.kaloum présent (Pharmacie de Kaloum, description conforme) et admin.donka.
- Appel réel complet (étapes 1 à 8) consigné par le vérificateur dans `B14-verification.md` : vente 201 avec reçu à 6 clés, annulation 200 avec stock remis, 403 `PERMISSION_REFUSEE` pour l'admin de Donka.
- Doc relue contre le code : contraintes (`isArray`, `arrayMinSize`, `arrayMaxSize`, `length`, `matches`, `dateValide`), messages d'annulation et variantes, 403 du garde et du service, 404 sans code : conformes.
- Contrat partagé : `front_medconnect/src/lib/api_ventes.ts` déclare `pharmacie { ..., ville, telephone, logoUrl: string | null }`, mêmes noms que le back.

## Décisions

- `docs/plans/ACTIVE.md` : modification du chef d'équipe (index du lot 8), commitée avec la tâche comme prévu par la consigne ; réserve du vérificateur levée.
- Le diff de `roles.service.ts` est majoritairement du reformatage prettier, autorisé par la fiche (section 2.5, D310).

## Réserves

- La vente de recette V-2026-000009 (ANNULEE) reste en base de développement.
- Une permission de stock ou de vente retirée à la main du rôle d'admin d'une pharmacie revient au démarrage suivant (D305), à annoncer au front et au porteur.
- Libellé « Sans `details` : ... (ces derniers portent `champs` pour `VALIDATION`) » dans CLAUDE.md : formulation un peu lourde mais exacte, non bloquant.
