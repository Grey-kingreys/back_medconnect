# PB16b - Vérification (Sonnet, indépendant)

Verdict : PASS (aucun problème bloquant, 3 remarques non bloquantes)

## Commandes relancées

- `docker compose exec -T backend npx tsc --noEmit` : aucune erreur.
- `npx eslint` des 6 fichiers de la fiche : 0 erreur, sortie vide.
- `npm test` : 91 suites, 1002 passés, 3 ignorés (préexistants), 0 échec (996 + 6, `etancheite-couts.spec.ts` vert).
- `npm run test:db` : 26 suites, 309 passés, 0 échec (305 + 4, dont `etancheite-couts.db-spec.ts` et `points-de-vente.db-spec.ts`).
- `git status --porcelain` : `CLAUDE.md`, `docker-entrypoint.sh`, `points-de-vente.service.ts`, `points-de-vente.db-spec.ts`, plus les trois nouveaux emplacements (spec unitaire, db-spec, `test/etancheite-couts/`). Aucun service de route corrigé. `git diff --stat -- prisma test/db/instantanes` : vide. Diff de `points-de-vente.db-spec.ts` : une seule ligne retirée.
- Tirets U+2014 et U+2013 : aucun dans les fichiers nouveaux ni dans les lignes ajoutées.
- Non relancée (code à ne pas modifier) : la preuve de mutation du point 5 de la fiche (remise de `debutFiabiliteMarge`, retrait d'une route). Lue par analyse : le test 4 compare `cheminsCout` à `[]` pour chaque réponse, et `/cout|marge/i` attrape `debutFiabiliteMarge`.

## Conformité fiche

- Découverte (`decouverte-routes.ts`) : règle 1 (classe, `forwardRef`, module dynamique avec métadonnée et champs `imports` et `controllers`, dédoublonnage, `Error` sinon) et règle 2 (chemins en tableau, `'/'` vaut vide, barres réduites, barre finale retirée, permissions, gardes méthode puis classe, tri par clé) conformes.
- Inventaire : 50 routes dans l'ordre de la fiche ; 14 `porteCout` (13, 15, 16, 20, 22, 23, 24, 26, 27, 28, 37, 38, 39, 40) ; un seul `exigeMarge` (rapport de marge) ; classes F (2 modèles de stock et catalogue) et P (4 routes publiques) conformes ; commentaire d'en-tête présent.
- Test unitaire : 6 tests conformes, comparaison dans les deux sens, `exigeMarge` suit `MARGE_READ`, PUBLIQUE = sans `AuthGuard`, balayage D609 avec liste blanche exacte `src/demo/demo.seeder.ts`.
- Test sur base : vrais contrôleurs et services de `PharmacieModule`, vrai `PermissionsGuard` et `PermissionsService`, seul `AuthGuard` remplacé ; vendeur étendu à 19 permissions sans `marge:read` vérifié (test 1) ; `APPELS: Record<CleRoutePharmacie, Appel>` ; test 3 exige 2xx sur toutes les réponses des routes `porteCout` et au moins un chemin de coût ; test 4 exige 403 sur `exigeMarge`, 2xx ailleurs (le test ne passe donc pas à vide), `content-type` spreadsheetml pour FICHIER, `cheminsCout` vide sinon. Aucun test à vide relevé.
- D610 : `debutFiabiliteMarge` retiré de `ParametresReponse` et de `versParametresReponse` seulement ; ligne unique du db-spec retirée. Le service de rapports le lit encore pour `debutFiabilite` (voulu).
- Front : aucune occurrence de `debutFiabiliteMarge` dans `front_medconnect/src`.

## Écarts déclarés

- (a) `ignorerPromesses` pour `ConfigModule.forRoot` : acceptable (module de configuration, sans contrôleur, test 6 garde l'erreur par défaut). Recommandation : à terme rendre la découverte asynchrone (`async controleursDuModule`, `await` de chaque élément `Promise` puis parcours du module dynamique résolu), plus sûre qu'un `ignorer` global : un futur module asynchrone portant des contrôleurs ne serait jamais oublié. Non bloquant, le risque est faible aujourd'hui car le test 1 échouerait seulement si l'on ajoutait une route dans un module asynchrone, ce qui est rare.
- (b) Filtre `/pharmacie` du test 2 : accepté (AuthModule amène `/auth` et `/notifications`).
- (c) `Promise.resolve({ module: ModuleB })` : accepté, la forme couvre le cas réel.
- (d) `afterAll` : accepté (la fermeture de l'application ferme Prisma ; branche `else` pour l'échec de création).
- (e) Puce PB05 de `CLAUDE.md` : voir remarque 1.

## Problèmes

Aucun bloquant.

1. Non bloquant : `CLAUDE.md:81` (puce PB05) annonce encore `debutFiabiliteMarge` et `debutCaisse` « lus seulement » par `GET .../parametres` ; périmé après D610. À corriger (retirer `debutFiabiliteMarge`, 7 champs) dans CLAUDE.md, fichier autorisé de la fiche.
2. Non bloquant : voir (a), découverte asynchrone recommandée.
3. Non bloquant : la preuve de mutation de la fiche (point 5) n'a pas été rejouée par le vérificateur.
