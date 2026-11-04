# PB13 - Rapport du chef d'orchestration (Opus)

Statut : validé. Commit PB13 : f41d3ee. Commit du test PB12 : voir le commit qui contient ce rapport (« test(pharmacie): annulation test 5 indépendant de l'heure (PB12) »).

## Ce qui a été fait

- Relecture complète du diff du codeur (16 fichiers de la fiche) contre la fiche, D555 à D564 et le rapport du vérificateur (PASS).
- Un ajout à la relecture (D565) : `MULTIPLIER` avec stock refusé (409 `CONVERSION_IMPOSSIBLE`) si la fiche ne compte plus 1 unité par boîte avant le changement. Cas : fiche passée à N sans stock (PB06, non qualifiée), puis lot technique vide réalimenté par une correction saisie en unités ; la multiplication l'aurait compté comme des boîtes. Garde dans `FicheProduitService.modifierFiche`, test 8 ajouté à `test/db/qualification.db-spec.ts` (13 tests), puce PB13 de `CLAUDE.md` complétée.
- Fiche corrigée : « 18 cas au moins » devient « les 14 cas listés en 2 » ; « 12 tests » complété par le test du chef.
- Test 5 de `test/db/annulation.db-spec.ts` : la pièce d'annulation est retrouvée par son identifiant dans la liste du jour au lieu de `ventes[0]` ; fixture `format-actuel.ts` et instantanés intouchés.

## Preuves (relancées par le chef, via `docker compose exec -T backend`)

- `npx tsc --noEmit` : aucune erreur.
- `npx eslint` sur les 14 fichiers de la fiche plus `pharmacie.service.ts` et `annulation.db-spec.ts` : aucune erreur.
- `npm test` : 80 suites, 920 passés, 3 ignorés ; `qualification.spec.ts` 14 cas.
- `npm run test:db` après PB13 : 203 sur 204, seul échec le test 5 de l'annulation (heure, hors PB13) ; après le correctif du test, à 03:44 UTC (fenêtre où il échouait) : 18 suites, 204 tests verts.
- `qualification.db-spec.ts` relancé deux fois seul : 13 sur 13 les deux fois.
- Aucun tiret cadratin ni demi-cadratin dans les lignes ajoutées.

## Jugement

- Métier : 12 boîtes de coefficient 1 qualifiées à 20 donnent une correction de 228 et 240 unités, reliquat nul (lot mis à jour avant le mouvement, conditionnement maintenu au nouveau coefficient). `CONSERVER` n'écrit rien. Fiche qualifiée : 409 `FICHE_DEJA_QUALIFIEE` avec `conversionStock`, coefficient pour l'avenir sans ; rejeu sans effet. Coût par unité : `arrondiGnf(cout / N)`, entier GNF (1000 / 3 = 333 ; 36 x 333 = 11 988 au lieu de 12 000 : écart d'arrondi borné à N/2 GNF par boîte, acceptable sur un coût de reprise qui vaut 0 dans les faits).
- Concurrence : la fiche est verrouillée en `FOR NO KEY UPDATE` puis par le verrou consultatif (ordre D507), compatible avec le `FOR KEY SHARE` des clés étrangères des mouvements ; aucun code ne prend la fiche en `FOR UPDATE` après le verrou consultatif. Vente : coefficient relu sous verrou (409 `FICHE_MODIFIEE`). Annulation : contrôle après les verrous des fiches (ordre poste, session, origine, fiches inchangé, D527 et D554). Tests 9 à 11 couvrent les trois croisements.
- Sécurité : accès inchangé (`stock:write` par `AccesPharmacieService`), aucune clé de coût dans la réponse ni dans l'audit, `masquerCouts` inutile (D466) ; le coût du lot technique n'est lisible que par les lectures existantes, déjà masquées sans `marge:read`.
- Contrat PF02 : `data.conversion` nul ou `{ mode, coefficientAvant, coefficientApres, quantiteAvant, quantiteApres, lots: [{ lotId, quantiteAvant, quantiteApres }] }`, messages distincts par cas, codes 400 `CONVERSION_REQUISE`, 409 `FICHE_DEJA_QUALIFIEE`, 409 `CONVERSION_IMPOSSIBLE` (deux messages), 409 `FICHE_MODIFIEE` avec `details [{ stockId, nom }]` côté vente.

## Décisions

- D555 à D564 appliquées telles que validées.
- D565 (nouvelle, chef) : `MULTIPLIER` exige un coefficient avant égal à 1. Numéro pris à la suite de D564 : à renuméroter par l'orchestrateur principal en cas de collision avec le run front.

## Réserves

- Faux positif assumé de D561 : une vente dont la transaction a commencé avant l'horodatage de la qualification mais qui a lu la fiche après son commit (donc servie au bon coefficient) serait refusée à l'annulation. Fenêtre de quelques millisecondes, côté sûr ; le pharmacien corrige le stock à la main.
- Horodatage de qualification lu sur l'horloge de la base, `Vente.createdAt` aussi (défaut `now()`) : pas de dérive entre instances backend tant que `createdAt` reste un défaut de la base.
- `docker-entrypoint.sh` reste modifié dans l'arbre (fins de ligne), jamais commité.

## Jalon J2 déployable ?

Sur une base migrée (M1 à M6) avec le back J2 et le front actuel :

- Import Excel du stock (`PharmacieService`, upsert vers la ligne 963, `quantite: { increment }` ligne 982 et `quantite` en mode inventaire) : écrit encore la colonne gelée ; le trigger `stock_medicament_geler_compteur` refuse toute fiche créée à quantité non nulle et toute modification de `quantite`, donc l'import échoue sur toute ligne de quantité non nulle (PB14 et PB15).
- `PATCH /pharmacie/stock/:structureId/:stockId/quantite` : le front envoie `{ variation, notes }` sans `motif` (`front_medconnect/src/lib/api_pharmacie.ts`, `updateStockQuantite`) : 400 `MOTIF_REQUIS` à chaque correction depuis l'écran de stock.
- `POST /pharmacie/stock/:structureId` (upsert) : sans lot en stock, date de péremption obligatoire (400 `DATE_PEREMPTION_REQUISE`) ; un formulaire qui l'omet est refusé ; plusieurs lots : 409 `LOT_REQUIS`, que le front ne sait pas traiter.
- Fiche produit, coefficient, qualification : aucun écran avant PF02 ; tant que les fiches restent à coefficient 1, la vente fonctionne en boîtes comme avant.
- Vente, annulation, caisse : le contrat de PB11 et PB12 est rétrocompatible pour la vente simple en boîtes (paiement espèces par défaut, poste web et session ouverts automatiquement) ; l'annulation exige `motif` et la liste est par jour métier : à vérifier côté front (PF01, PF04) avant d'ouvrir aux pharmacies.
- Réceptions et inventaires (PB14, PB15) absents : aucun moyen métier d'entrer du stock par lot avec coût, hors upsert et correction.

Avis : J2 est cohérent et vert côté back, mais pas déployable seul en production pour des pharmacies réelles : l'import Excel et la correction de quantité, deux gestes courants, cassent sur la base migrée. Déployer J2 seulement sur un environnement de recette, ou avec les correctifs front minimaux (motif dans la correction de quantité, date de péremption à l'ajout) et l'import Excel masqué jusqu'à PB14 et PB15 ; sinon attendre J3 et le front de la tranche.
