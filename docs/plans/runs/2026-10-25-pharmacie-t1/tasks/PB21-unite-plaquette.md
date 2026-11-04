# PB21 - Unité PLAQUETTE, lots avec coefficient de réception

Tier: spécifié (codeur Sonnet, vérificateur Sonnet)
Audience: API dev ; message du nouveau refus non-dev (titulaire)
Visuel: non
Background-safe: oui, un seul agent en `test:db`
Dépôt: `back_medconnect`, branche `orch/pharmacie-t1-back`
Dépend de: PB20 validé (même fichier `lecture-stock.ts`, carte des libellés du back)

## Spec

### Objectif

Permettre de vendre une boîte de paracétamol à la plaquette : la fiche dit combien de plaquettes contient la boîte et le prix d'une plaquette, le stock se modifie en boîtes, une vente au détail entame une boîte et retire une plaquette. Le modèle existant (`uniteMinimale`, `coefficientBoite`, `prixUnite`, `deconditionnable`, conditionnement ouvert) couvre ce parcours (D723) ; il manque la valeur de l'enum et un garde-fou (D724).

### 1. Migration additive

`prisma/migrations/20261103100000_pharmacie_t1_unite_plaquette/migration.sql`, écrite à la main, entre `BEGIN;` et `COMMIT;` comme les autres (D456) :

```sql
ALTER TYPE "UniteMinimale" ADD VALUE IF NOT EXISTS 'PLAQUETTE' AFTER 'AMPOULE';
```

Appliquée par `prisma migrate deploy` uniquement. La valeur n'est utilisée par aucune instruction de la même transaction.

`prisma/schema.prisma` : `PLAQUETTE` entre `AMPOULE` et `UNITE`, même ordre que la base. `test/db/schema-derive.db-spec.ts` doit rester vert.

`prisma/retours-arriere/20261103100000_pharmacie_t1_unite_plaquette.down.sql` : PostgreSQL ne retire pas une valeur d'enum. Dans une transaction : refuser par `RAISE EXCEPTION` en listant le nombre de fiches si une fiche utilise `PLAQUETTE` ; sinon `ALTER COLUMN "uniteMinimale" DROP DEFAULT`, renommer le type, recréer `UniteMinimale` avec les 7 valeurs, `ALTER COLUMN ... TYPE ... USING ("uniteMinimale"::text::"UniteMinimale")`, remettre `DEFAULT 'UNITE'`, supprimer l'ancien type. README du dossier : cette migration en tête de l'ordre.

Test `test/db/m7-unite-plaquette.db-spec.ts` (modèle `m3-fiche-produit.db-spec.ts`, avec `appliquerMigrations`) : haut, enum à 8 valeurs dans l'ordre ; une fiche `PLAQUETTE` écrite ; bas refusé tant qu'elle existe ; fiche changée, bas accepté, 7 valeurs, défaut `UNITE` ; haut de nouveau. `m3-fiche-produit.db-spec.ts` s'arrête à M3 : il ne change pas.

### 2. Back

- `dto/fiche-produit.dto.ts` : `UNITES_MINIMALES` gagne `PLAQUETTE` après `AMPOULE` ; description Swagger.
- `domaine/quantites.ts` : carte de `formaterQuantiteLisible` (PB20) : `PLAQUETTE: { singulier: 'plaquette', pluriel: 'plaquettes' }`.
- `src/demo/demo.donnees.ts:631` : `UniteMinimaleDemo` gagne la valeur ; aucune fiche démo ne change (les stocks finaux testés restent).
- `synchro/catalogue-synchro.service.ts` : `uniteMinimale` est une chaîne, rien à faire ; à confirmer par un test de la photographie sur une fiche `PLAQUETTE`.

### 3. Changement d'unité sur une fiche qui a du stock (D724)

`fiche-produit.service.ts`, sous le verrou de ligne : si `dto.uniteMinimale` diffère et que la fiche a du stock (`aDuStock(produits, lots)`, agrégat non nul ou lot en stock) : 409 `UNITE_CHANGEMENT_AVEC_STOCK`, ajouté à `codes-erreur.ts`, message : « Ce médicament a du stock compté dans une autre unité : changer l'unité fausserait les quantités. Comptez-le à 0 par un inventaire, changez l'unité, puis enregistrez la prochaine livraison. ». Exception : fiche non qualifiée avec `conversionStock` et coefficient 1 si l'ancienne unité est `UNITE` (un lot technique compte des boîtes, le parcours PB13 reste permis, notamment le passage à la plaquette). Le coefficient d'une fiche qualifiée reste libre comme aujourd'hui : chaque lot garde son `coefficientReception` (D709).

### 4. Lecture (attendu par D709, D711)

`stock/lecture-stock.ts:22-29` et `:111-120` : `LotExpose` gagne `coefficientReception` ; test dans `lecture-stock.spec.ts`. `masquerCouts` ne le retire pas (le nom ne porte pas de coût) ; `test/db/etancheite-couts` reste vert ; instantané `get-stock-pharmacie.json` : seul ajout de cette clé, à justifier.

### 5. Parcours du porteur à prouver

`test/db/plaquette.db-spec.ts`, de bout en bout par les services, fiche Paracétamol, boîte de 10 plaquettes, boîte à 25 000, plaquette à 3 000 :

1. `PATCH .../fiche` : `uniteMinimale: PLAQUETTE`, `coefficientBoite: 10`, `deconditionnable: true`, `prixUnite: 3000` ; `qualifie`.
2. Réception de 2 boîtes : 20 unités minimales, lot à coefficient 10.
3. Vente d'une plaquette : 3 000 GNF, 19 au stock, conditionnement ouvert, `reliquat` 9.
4. Vente d'une boîte : 25 000, prend les 10 d'une boîte fermée, reliquat 9 intact.
5. Vente de 10 plaquettes : les 9 de la boîte entamée puis 1 ; lecture exacte ; 409 `STOCK_INSUFFISANT` au-delà, message « il reste ... plaquette(s) » selon l'accord.
6. Correction et inventaire en boîtes, sortie en boîtes : quantités justes.
7. Écart de prix : `ECART_PRIX` calculé avec le coefficient 10.

Changement d'unité : 409 avec stock, accepté sans stock, accepté par le parcours de conversion PB13.

### 6. Documentation

`CLAUDE.md` du back, puce PB06 : valeur `PLAQUETTE`, migration, refus D724 ; puce PB08 : `coefficientReception` dans `lots`.

## Contraintes

- Écriture par Write/Edit seulement (pas de heredoc, `sed -i`, `prettier --write`, `eslint --fix`).
- Jamais `prisma migrate dev`, `reset` ni `db push` : `prisma migrate deploy` seulement.
- Jamais commiter `docker-entrypoint.sh` (modifié localement, à laisser).
- Jamais afficher une valeur de `.env`.
- Jamais deux agents en `test:db` en même temps.
- Pas de tiret cadratin ni demi-cadratin, tout en français.
- Gates : `docker compose exec -T backend npx tsc --noEmit`, eslint des fichiers touchés, `npm test`, `npm run test:db`, tous par `docker compose exec -T backend`.
- Commit avec la ligne `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, sans amend ni `--no-verify`.

## Test à la main

`GET /pharmacie/stock/:structureId` : `lots[].coefficientReception` présent. `npx prisma migrate deploy` sur la base de dev : une migration appliquée, données intactes.

## Done when

- [ ] Migration additive et retour arrière testés, `schema-derive` vert
- [ ] DTO et Swagger acceptent `PLAQUETTE`, refus des valeurs inconnues inchangé
- [ ] `UNITE_CHANGEMENT_AVEC_STOCK` et ses deux exceptions testés
- [ ] `coefficientReception` exposé dans les lots, aucun coût ajouté
- [ ] Parcours de la section 5 vert en base
- [ ] `tsc`, `eslint`, `npm test`, `npm run test:db` verts

## Return

Fichiers touchés, sorties des gates, justification de l'instantané, tout écart à la fiche.

## Historique

## Validation
