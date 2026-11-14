# PB13 - Vérification indépendante (Sonnet)

## Commandes relancées

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `npx eslint <14 fichiers de la fiche>` : aucune erreur. `npx eslint src/pharmacie/pharmacie.service.ts` : aucune sortie.
- `npm test` : 80 suites, 920 passés, 3 ignorés, 0 échec.
- `npm run test:db` : 17 suites vertes sur 18, 202 tests verts sur 203. Seul échec : `annulation.db-spec.ts` test 5 (voir ci-dessous). `qualification.db-spec.ts` : 12 tests verts.
- `jest --config ./test/db/jest-db.json --runInBand test/db/qualification.db-spec.ts` relancé 2 fois : 12/12 verts les deux fois (concurrence stable).
- `git diff --stat -- prisma test/db/instantanes non-regression-lectures vente.db-spec annulation.db-spec` : vide.
- Diff de `fiche-produit.db-spec.ts` et `mouvements-stock.db-spec.ts` : une seule ligne de construction par fichier.
- `grep "FOR UPDATE"` sur `fiche-produit.service.ts` : vide ; `FOR NO KEY UPDATE` : une ligne dans chaque service ; `existante.quantite` : vide.
- Tirets cadratins et demi-cadratins (U+2013, U+2014) dans les lignes ajoutées et dans les 3 fichiers nouveaux : 0.
- `git status` : uniquement les fichiers attendus (plus `docker-entrypoint.sh` et `docs/plans/` hors périmètre code).

## Échec de `annulation.db-spec.ts` test 5 : cause confirmée, hors diff PB13

- Le test annule une vente, puis vérifie que `listeJour.data.ventes[0]` est l'ANNULATION. La liste est triée par `createdAt desc` (`vente.service.ts` ligne 1024, non modifiée par PB13).
- La fixture `test/db/fixtures/format-actuel.ts` crée `vte-p1-4` à `J + 11 h`, avec `J` = minuit UTC du jour. Il est 03:36 UTC lors de la vérification : cette vente est dans le futur, donc première de la liste. Le résultat reçu est bien `vte-p1-4` (VENTE, 1500), pas l'annulation créée.
- Le diff de PB13 sur `vente.service.ts` ne touche que deux constantes, le contrôle `FICHE_MODIFIEE` dans `enregistrerVente` et le bloc 4b dans `annulerVente` (qualification). Aucun lien avec le tri ni la fixture.
- Correctif minimal proposé (hors PB13, tâche PB12 ou fixture) : dans la fixture, plafonner `creeeLe` de `vte-p1-4` à `Math.min(J + 11 h, Date.now() - 1 min)` ou le placer à `J + 1 h`. Alternative côté test : retrouver l'annulation par id plutôt que par `ventes[0]`.

## Relecture du diff contre fiche et PLAN

- Contrat : `conversionStock` (DTO, IsIn, ValidateIf), codes `FICHE_DEJA_QUALIFIEE`, `CONVERSION_IMPOSSIBLE`, `FICHE_MODIFIEE` (avec `details` dans `CODES_AVEC_DETAILS`), messages exacts, `conversion` dans la réponse, controller : conforme.
- Règles pures `qualification.ts` : ordre des règles, tri par `lotId`, coût arrondi par `arrondiGnf`, plafond `ENTIER_MAX` : conformes.
- Service : verrou `FOR NO KEY UPDATE`, lecture du stock calculé (agrégats, plus la colonne gelée), horodatage `clock_timestamp()` (D561), écritures dans l'ordre demandé (lots, puis fiche, puis audit), audit sans coût : conformes.
- `qualifierLotTechnique` : lot mis à jour avant le mouvement `CORRECTION`, `evenementId` `qualification:<lotId>`, pièce `QUALIFICATION` : conforme. Journal non modifié, agrégats jamais écrits.
- Vente : relecture du coefficient sous verrou (409 `FICHE_MODIFIEE`) et refus d'annulation des ventes antérieures à une qualification (409 `PIECE_NON_ANNULABLE`) : conformes à D560 et D561.
- Invariants : quantités entières, montants entiers, aucun nom de clé contenant coût ou marge dans la réponse, pas de `masquerCouts`. Textes lisibles par un vendeur d'officine.
- Tests : les 12 tests de `qualification.db-spec.ts` demandés sont présents, dont les trois tests de concurrence non affaiblis. `http.spec` : lignes retirées/ajoutées comme demandé, test 6 présent. Aucun test supprimé en dehors de la ligne `conversionStock` / `whitelistValidation` prévue par la fiche.
- Aucun secret, aucune URL, aucune migration, aucun changement de schéma.

## Verdict : PASS

## Problèmes

1. (Bloquant pour la suite, hors PB13) `annulation.db-spec.ts` test 5 échoue avant 11 h UTC à cause de la fixture `vte-p1-4` à J + 11 h. Corriger par la fixture ou le test (voir ci-dessus) ; ne rend pas PB13 FAIL.
2. (Mineur, fiche) Le Done when 3 annonce « 18 cas au moins » pour `qualification.spec.ts` ; la liste exacte de la fiche en contient 14, tous présents. Incohérence de la fiche, pas du code.
3. (Mineur, informatif) `docs/plans/ACTIVE.md` et `decisions.md` apparaissent modifiés, alors que la fiche interdit de modifier `docs/plans/` au codeur. À confirmer qu'il s'agit des modifications du chef.
