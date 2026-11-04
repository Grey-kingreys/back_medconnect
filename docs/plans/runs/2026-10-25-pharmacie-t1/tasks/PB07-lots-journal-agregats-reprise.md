# PB07 - Lots, journal de stock, agrégats et reprise, migration M4

Tier: dur (codeur Sonnet selon l'arbitrage A2 ; fiche très détaillée, aucune décision laissée ouverte)
Audience: dev (aucune route, aucun texte affiché aux utilisateurs ; sorties de commandes en français pour l'exploitant)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Premier pas du jalon J2 (PB07 à PB13, indissociables, D445). Cette tâche :

1. crée le journal de stock append-only et ses agrégats par la migration M4 `20261026120000_pharmacie_t1_lots_mouvements` et son retour arrière : tables `LotStock`, `MouvementStock`, `AgregatStockLot` (jamais négatif), `AgregatStockProduit`, `ConditionnementOuvert` (index unique partiel), enums `TypeMouvementStock` et `TypePiece`, CHECK, triggers d'agrégat, d'immuabilité (contournement de purge), de cohérence et de gel de `quantite`/`disponible` ;
2. reprend le stock existant : un lot technique et un mouvement `RECEPTION` pièce `MIGRATION` par fiche à quantité positive ;
3. ajoute quatre commandes d'exploitation : `stock:reconstruire`, `stock:verifier`, `stock:comparer-compteur`, `pharmacie:pre-migration` ;
4. adapte le jeu démo (stock initial par lots, purge du journal avant la configuration de caisse).

**Aucune route, aucun service métier, aucune lecture de stock n'est modifiée** : les lectures (`getStockPharmacie`, recherche publique, détail catalogue, ventes) lisent encore `quantite` gelée jusqu'à PB08, les instantanés PB02 restent donc identiques. Les chemins qui écrivent encore `quantite` (upsert, import, PATCH quantité, vente, annulation, `seed_medicaments.ts`) échoueront sur une base migrée : c'est voulu (D505), ne rien contourner, ne pas les toucher.

Premier test à écrire (exigence du plan) : stock calculé égal au compteur d'origine, fiche par fiche (test 2 de la section 10.3).

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D401, D403, D404, D405, D417, D418, D430, D431, D432, D445, D448, D454, D456, D457, D460, D466, D479, D480, D493 à D505. CORRECTIONS-PORTEUR.md prime sur tout (rien ici ne touche aux coupures).

### Contexte vérifié (ne pas re-découvrir)

- `prisma/schema.prisma` a des fins de ligne CRLF : conserver celles du fichier. Modèles concernés : `StockMedicament` (vers la ligne 439, se termine par `createdAt`, `updatedAt`, `@@unique([medicamentId, structureId])`), `PointDeVente` (relations `postes`, `compteurTicket`, `plagesTicket`, `anomalies`), `Poste` (relation `plagesTicket`), `Fournisseur` ; la section `// ====== SECURITE ET ACCES ======` suit `model Anomalie`. Préversion `partialIndexes` déjà active.
- Prisma 7 n'applique pas un fichier de migration en transaction (D456) : `BEGIN;` et `COMMIT;` explicites, test statique obligatoire. Le harnais (`test/db/harnais.ts`) exporte `creerBaseVide`, `supprimerBaseDeTest`, `appliquerMigrations(client, { apres?, jusqua? })`, `appliquerRetourArriere(client, nom)`, `appliquerSql(client, sql)` (fait `ROLLBACK` après un échec), `creerPrismaDeTest`, `fermerPrismaDeTest`, `masquerUrls`, `RACINE_DEPOT`, `DOSSIER_MIGRATIONS`, `DOSSIER_RETOURS_ARRIERE`, `DERNIERE_MIGRATION_FORMAT_ACTUEL`. Modèles de specs : `test/db/m3-fiche-produit.db-spec.ts` (fonction `lignesSql`, test statique, retour arrière), `test/db/m2-points-de-vente.db-spec.ts` (base `autre` pour un arrêt), `test/db/schema-derive.db-spec.ts` (lancement d'un processus par `spawnSync`, sortie passée par `masquerUrls`).
- Jeu `chargerFormatActuel(client)` (`test/db/fixtures/format-actuel.ts`) renvoie `{ aujourdhui, pharmacies, hopital, fiches, ventes }` ; `aujourdhui` = minuit UTC du jour. 40 fiches `stk-01` à `stk-40` : fiche d'indice i (0 à 39) a `quantite = [0, 1, 9, 10, 11, 240][i % 6]`, `dateExpiration = [J-30, J, J+180, null][i % 4]` (minuit UTC), `prixUnitaire = [1500, null, 2500, 0, 12000][i % 5]` ; `stk-01` à `stk-20` dans `str-pharma-1`, `stk-21` à `stk-35` dans `str-pharma-2`, `stk-36` à `stk-40` dans `str-pharma-3` ; `str-hopital-1` est un hôpital. Donc 7 fiches vides (`stk-01`, `07`, `13`, `19`, `25`, `31`, `37`), 33 fiches avec stock ; `stk-02` = 1, `stk-03` = 9 (J+180), `stk-04` = 10 (date nulle), `stk-05` = 11 (J-30), `stk-06` = 240 (J). M2 a créé un point de vente d'ordre 1 par pharmacie. Médicaments `med-01` à `med-20`.
- Scripts existants à imiter : `scripts/telephones-doublons.ts` (client `pg`, `BEGIN READ ONLY`, `ROLLBACK`, `process.exitCode`, message si `DATABASE_URL` manque). `tsconfig.build.json` compile `scripts/` vers `dist/scripts/` et `src/` vers `dist/src/` ; un script importe la logique par chemin relatif `../src/...` ; `commandes-stock.ts` ne doit importer que `import type { Client } from 'pg'` (aucun import `src/...` ni `generated/...`, sinon le script ne se résout pas en production). `pg` 8.20 et `@types/pg` sont présents (D452 : aucune dépendance ajoutée). `pg` renvoie `count(*)` et `sum(...)` en texte : toutes les requêtes ci-dessous castent en `::int`.
- `DemoSeeder` (`src/demo/demo.seeder.ts`) : `inserer(tx, ...)` crée les structures (étape 1), appelle `assurerPointDeVente(tx, { id, nom })` pour chaque pharmacie (étape 1 bis, renvoie `{ pointDeVente, parametres }`), puis crée les fiches par `tx.stockMedicament.createMany` (étape 4, vers la ligne 437) avec `quantite` et `disponible`. `purger(tx)` (vers la ligne 186) supprime journaux d'audit et comptes, lit les structures démo, appelle `supprimerConfigurationPharmacies(tx, ids)`, puis supprime les structures. `trouver(table, cle)` et `maintenant`, `jour(decalage, heure, minute)` existent dans `inserer`. `STOCKS_DEMO` : `{ pharmacie: CleStructure, medicament, quantite, prixUnitaire, expirationJours, notes? }`, contient des quantités nulles et des quantités sous 10.
- `src/demo/demo.seeder.spec.ts` : doublure Prisma par `Proxy` (`creerPrisma`), `donnees(mock, appel)` lit `data` d'un appel ; toute clé autre que `$transaction` renvoie un objet de modèles, donc `tx.$queryRaw` n'y est pas une fonction tant que la section 10.2 n'est pas appliquée.
- Le texte de M4 et de son retour arrière ci-dessous a été exécuté par le chef sur une base jetable (toutes les migrations jusqu'à M3, cinq fiches dont une à quantité nulle, une date avec une heure, deux pharmacies) : haut, rejeu du bloc de reprise sans doublon, gel (refus et réécriture identique acceptée), immuabilité (UPDATE, DELETE, TRUNCATE refusés ; DELETE accepté et UPDATE refusé sous contournement), lot jamais négatif (sortie qui vide exactement un lot acceptée), produit négatif accepté sans lot, cohérence lot et point de vente, index partiel, lot figé, bas après activité (NOTICE, écrêtage, dates), haut de nouveau, arrêts sur quantité négative et sur fiche sans point de vente, puis `prisma migrate diff --from-config-datasource --to-schema <schéma de la section 1> --exit-code` : aucune dérive. Les requêtes des commandes (section 4) ont aussi été exécutées sur cette base.

### 1. Schéma Prisma (`prisma/schema.prisma`)

1.1 Dans `model StockMedicament`, remplacer

```prisma
  updatedAt DateTime @updatedAt

  @@unique([medicamentId, structureId])
}
```

par

```prisma
  updatedAt DateTime @updatedAt

  // Journal de stock (PB07, M4) : quantite et disponible sont gelées par trigger
  lots                    LotStock[]
  mouvements              MouvementStock[]
  agregatsLot             AgregatStockLot[]
  agregatsProduit         AgregatStockProduit[]
  conditionnementsOuverts ConditionnementOuvert[]

  @@unique([medicamentId, structureId])
}
```

1.2 Dans `model PointDeVente`, remplacer

```prisma
  plagesTicket   PlageTicket[]
  anomalies      Anomalie[]
```

par

```prisma
  plagesTicket   PlageTicket[]
  anomalies      Anomalie[]

  // Journal de stock (PB07, M4)
  lots                    LotStock[]
  mouvementsStock         MouvementStock[]
  agregatsLot             AgregatStockLot[]
  agregatsProduit         AgregatStockProduit[]
  conditionnementsOuverts ConditionnementOuvert[]
```

1.3 Dans `model Poste`, remplacer

```prisma
  plagesTicket PlageTicket[]

  @@unique([pointDeVenteId, code])
```

par

```prisma
  plagesTicket    PlageTicket[]
  mouvementsStock MouvementStock[]

  @@unique([pointDeVenteId, code])
```

1.4 Dans `model Fournisseur`, remplacer

```prisma
  actif       Boolean   @default(true)
  createdAt   DateTime  @default(now())

  @@unique([structureId, nom])
```

par

```prisma
  actif       Boolean   @default(true)
  createdAt   DateTime  @default(now())

  lots LotStock[]

  @@unique([structureId, nom])
```

(`model AppRole` porte aussi `@@unique([structureId, nom])`, précédé de `updatedAt` : le remplacement ci-dessus, qui inclut les lignes `actif` et `createdAt` alignées, ne correspond qu'à `model Fournisseur`.)

1.5 Insérer, juste avant la ligne `// ====== SECURITE ET ACCES ======`, exactement le bloc suivant (suivi d'une ligne vide) :

```prisma
// ====== Tranche pharmacie 1 : lots, journal de stock et agrégats (PB07, M4) ======

enum TypeMouvementStock {
  RECEPTION
  VENTE
  RETOUR
  INVENTAIRE
  PERTE
  PEREMPTION
  TRANSFERT
  CORRECTION
}

enum TypePiece {
  MIGRATION
  VENTE
  ANNULATION
  RECEPTION
  INVENTAIRE
  SORTIE_MANUELLE
  RESOLUTION
  QUALIFICATION
  AJUSTEMENT
}

// Lot d'une fiche dans un point de vente. Figé après insertion par trigger, sauf dateExpiration
// (correction auditée) et, pour un lot technique seulement, coefficientReception et coutUnitaire (PB13).
model LotStock {
  id                   String          @id @default(uuid())
  stockMedicamentId    String
  stockMedicament      StockMedicament @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  pointDeVenteId       String
  pointDeVente         PointDeVente    @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  numeroLot            String? // nul pour le lot technique de reprise
  dateExpiration       DateTime?       @db.Date
  quantiteRecue        Int // en UM
  coutUnitaire         Int // GNF par UM, figé ; 0 = inconnu, non valorisable
  coutAchatBoite       Int? // saisi à la réception, traçabilité
  coefficientReception Int // UM par boîte à la réception, base du reliquat
  fournisseurId        String?
  fournisseur          Fournisseur?    @relation(fields: [fournisseurId], references: [id], onDelete: Restrict)
  receptionId          String? // clé étrangère vers Reception posée par M5 (PB09)
  dateReception        DateTime
  lotTechnique         Boolean         @default(false)
  auteurId             String? // nul = système, sans clé étrangère (D109)
  createdAt            DateTime        @default(now())

  mouvements       MouvementStock[]
  agregat          AgregatStockLot?
  conditionnements ConditionnementOuvert[]

  @@index([stockMedicamentId, pointDeVenteId, dateExpiration, dateReception])
  @@index([pointDeVenteId, dateExpiration])
}

// Journal de stock, append-only : jamais modifié ni supprimé (trigger), sauf purge démo et harnais.
model MouvementStock {
  id                String             @id @default(uuid())
  evenementId       String             @unique // stable : UUID client, UUID serveur, ou migration:<stockId>
  pointDeVenteId    String
  pointDeVente      PointDeVente       @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  stockMedicamentId String
  stockMedicament   StockMedicament    @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  lotId             String? // nul seulement pour une sortie provisoire sans lot (O11)
  lot               LotStock?          @relation(fields: [lotId], references: [id], onDelete: Restrict)
  type              TypeMouvementStock
  quantite          Int // signée, en UM
  pieceOrigineType  TypePiece
  pieceOrigineId    String?
  motif             String?
  auteurId          String? // nul = système, sans clé étrangère (D109)
  horodatageServeur DateTime           @default(now())
  horodatageLocal   DateTime?
  posteId           String?
  poste             Poste?             @relation(fields: [posteId], references: [id], onDelete: Restrict)
  sequencePoste     Int?

  @@index([stockMedicamentId, pointDeVenteId])
  @@index([lotId])
  @@index([pieceOrigineType, pieceOrigineId])
}

// Agrégat de lecture reconstructible : solde d'un lot, tenu par trigger, jamais négatif.
model AgregatStockLot {
  lotId             String          @id
  lot               LotStock        @relation(fields: [lotId], references: [id], onDelete: Restrict)
  stockMedicamentId String
  stockMedicament   StockMedicament @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  pointDeVenteId    String
  pointDeVente      PointDeVente    @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  quantite          Int
  misAJourLe        DateTime        @default(now())

  @@index([stockMedicamentId, pointDeVenteId])
}

// Agrégat de lecture reconstructible : solde d'une fiche dans un point de vente, peut être négatif (O11).
model AgregatStockProduit {
  stockMedicamentId String
  stockMedicament   StockMedicament @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  pointDeVenteId    String
  pointDeVente      PointDeVente    @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  quantite          Int
  misAJourLe        DateTime        @default(now())

  @@id([stockMedicamentId, pointDeVenteId])
  @@index([pointDeVenteId, quantite])
}

// Conditionnement entamé (état dérivé matérialisé) : au plus un ouvert par fiche, lot et point de vente.
model ConditionnementOuvert {
  id                       String          @id @default(uuid())
  stockMedicamentId        String
  stockMedicament          StockMedicament @relation(fields: [stockMedicamentId], references: [id], onDelete: Restrict)
  lotId                    String
  lot                      LotStock        @relation(fields: [lotId], references: [id], onDelete: Restrict)
  pointDeVenteId           String
  pointDeVente             PointDeVente    @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  unitesParConditionnement Int // coefficientReception du lot
  ouvertLe                 DateTime        @default(now())
  ouvertParId              String? // sans clé étrangère (D109)
  ouvertParPieceId         String?
  fermeLe                  DateTime?

  @@unique([stockMedicamentId, lotId, pointDeVenteId], where: raw("\"fermeLe\" IS NULL"))
  @@index([lotId])
}
```

Puis `docker compose exec -T backend npx prisma generate` et `docker compose exec -T backend npx prisma validate`.

### 2. Migration M4

Créer `prisma/migrations/20261026120000_pharmacie_t1_lots_mouvements/migration.sql`, contenu exact (fin de fichier : un saut de ligne après `COMMIT;`) :

```sql
-- Tranche pharmacie 1, lots, journal de stock, agrégats et reprise (PB07, M4, D401, D403 à D405, D418, D431, D493 à D505).
-- DDL généré par prisma migrate diff (schéma de PB06 vers schéma de PB07) ; contrôles, CHECK, fonctions,
-- triggers et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
-- À lancer avant le déploiement : npm run pharmacie:pre-migration (lecture seule).
BEGIN;

-- Arrêt (plan, section 2) : aucune quantité négative, et toute fiche avec du stock a un point de vente.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" < 0;
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id" FROM "StockMedicament" f WHERE f."quantite" < 0 ORDER BY f."id" LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : % fiche(s) de stock ont une quantité négative, à corriger avant la reprise. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;

  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1
    );
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id"
      FROM "StockMedicament" f
      WHERE f."quantite" > 0
        AND NOT EXISTS (
          SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1
        )
      ORDER BY f."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : % fiche(s) avec du stock appartiennent à une structure sans point de vente. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypeMouvementStock" AS ENUM ('RECEPTION', 'VENTE', 'RETOUR', 'INVENTAIRE', 'PERTE', 'PEREMPTION', 'TRANSFERT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "TypePiece" AS ENUM ('MIGRATION', 'VENTE', 'ANNULATION', 'RECEPTION', 'INVENTAIRE', 'SORTIE_MANUELLE', 'RESOLUTION', 'QUALIFICATION', 'AJUSTEMENT');

-- CreateTable
CREATE TABLE "LotStock" (
    "id" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "numeroLot" TEXT,
    "dateExpiration" DATE,
    "quantiteRecue" INTEGER NOT NULL,
    "coutUnitaire" INTEGER NOT NULL,
    "coutAchatBoite" INTEGER,
    "coefficientReception" INTEGER NOT NULL,
    "fournisseurId" TEXT,
    "receptionId" TEXT,
    "dateReception" TIMESTAMP(3) NOT NULL,
    "lotTechnique" BOOLEAN NOT NULL DEFAULT false,
    "auteurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" TEXT NOT NULL,
    "evenementId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT,
    "type" "TypeMouvementStock" NOT NULL,
    "quantite" INTEGER NOT NULL,
    "pieceOrigineType" "TypePiece" NOT NULL,
    "pieceOrigineId" TEXT,
    "motif" TEXT,
    "auteurId" TEXT,
    "horodatageServeur" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "horodatageLocal" TIMESTAMP(3),
    "posteId" TEXT,
    "sequencePoste" INTEGER,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgregatStockLot" (
    "lotId" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "misAJourLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgregatStockLot_pkey" PRIMARY KEY ("lotId")
);

-- CreateTable
CREATE TABLE "AgregatStockProduit" (
    "stockMedicamentId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "misAJourLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgregatStockProduit_pkey" PRIMARY KEY ("stockMedicamentId","pointDeVenteId")
);

-- CreateTable
CREATE TABLE "ConditionnementOuvert" (
    "id" TEXT NOT NULL,
    "stockMedicamentId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "unitesParConditionnement" INTEGER NOT NULL,
    "ouvertLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ouvertParId" TEXT,
    "ouvertParPieceId" TEXT,
    "fermeLe" TIMESTAMP(3),

    CONSTRAINT "ConditionnementOuvert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LotStock_stockMedicamentId_pointDeVenteId_dateExpiration_da_idx" ON "LotStock"("stockMedicamentId", "pointDeVenteId", "dateExpiration", "dateReception");

-- CreateIndex
CREATE INDEX "LotStock_pointDeVenteId_dateExpiration_idx" ON "LotStock"("pointDeVenteId", "dateExpiration");

-- CreateIndex
CREATE UNIQUE INDEX "MouvementStock_evenementId_key" ON "MouvementStock"("evenementId");

-- CreateIndex
CREATE INDEX "MouvementStock_stockMedicamentId_pointDeVenteId_idx" ON "MouvementStock"("stockMedicamentId", "pointDeVenteId");

-- CreateIndex
CREATE INDEX "MouvementStock_lotId_idx" ON "MouvementStock"("lotId");

-- CreateIndex
CREATE INDEX "MouvementStock_pieceOrigineType_pieceOrigineId_idx" ON "MouvementStock"("pieceOrigineType", "pieceOrigineId");

-- CreateIndex
CREATE INDEX "AgregatStockLot_stockMedicamentId_pointDeVenteId_idx" ON "AgregatStockLot"("stockMedicamentId", "pointDeVenteId");

-- CreateIndex
CREATE INDEX "AgregatStockProduit_pointDeVenteId_quantite_idx" ON "AgregatStockProduit"("pointDeVenteId", "quantite");

-- CreateIndex
CREATE INDEX "ConditionnementOuvert_lotId_idx" ON "ConditionnementOuvert"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionnementOuvert_stockMedicamentId_lotId_pointDeVenteI_key" ON "ConditionnementOuvert"("stockMedicamentId", "lotId", "pointDeVenteId") WHERE ("fermeLe" IS NULL);

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockProduit" ADD CONSTRAINT "AgregatStockProduit_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgregatStockProduit" ADD CONSTRAINT "AgregatStockProduit_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_stockMedicamentId_fkey" FOREIGN KEY ("stockMedicamentId") REFERENCES "StockMedicament"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "LotStock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Contraintes (plan 1.3, D494)
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_quantiteRecue_check" CHECK ("quantiteRecue" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coutUnitaire_check" CHECK ("coutUnitaire" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coutAchatBoite_check" CHECK ("coutAchatBoite" IS NULL OR "coutAchatBoite" >= 0);
ALTER TABLE "LotStock" ADD CONSTRAINT "LotStock_coefficientReception_check" CHECK ("coefficientReception" >= 1);
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_quantite_check" CHECK ("quantite" <> 0 OR "type" = 'INVENTAIRE');
ALTER TABLE "AgregatStockLot" ADD CONSTRAINT "AgregatStockLot_quantite_check" CHECK ("quantite" >= 0);
ALTER TABLE "ConditionnementOuvert" ADD CONSTRAINT "ConditionnementOuvert_unitesParConditionnement_check" CHECK ("unitesParConditionnement" >= 2);

-- Immuabilité du journal (D431) : ni modification ni suppression ni troncature, sauf suppression et
-- troncature sous SET LOCAL medconnecte.purge_autorisee = 'on' (purge démo et harnais). Réutilisée par M5 et M6.
CREATE FUNCTION "journal_refuser_modification"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') AND current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Écriture refusée sur la table % : le journal de stock et les pièces ne se modifient ni ne se suppriment jamais.', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER "mouvement_stock_immuable"
BEFORE UPDATE OR DELETE ON "MouvementStock"
FOR EACH ROW EXECUTE FUNCTION "journal_refuser_modification"();

CREATE TRIGGER "mouvement_stock_sans_troncature"
BEFORE TRUNCATE ON "MouvementStock"
FOR EACH STATEMENT EXECUTE FUNCTION "journal_refuser_modification"();

-- Lot : point de vente de la pharmacie de la fiche ; figé après insertion, sauf dateExpiration, et
-- coefficientReception et coutUnitaire d'un lot technique (qualification, PB13) ; jamais supprimé hors purge.
CREATE FUNCTION "lot_stock_proteger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('medconnecte.purge_autorisee', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Le lot % ne peut pas être supprimé : un lot de stock est conservé définitivement.', OLD."id";
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1
    FROM "StockMedicament" f
    JOIN "PointDeVente" pv ON pv."structureId" = f."structureId"
    WHERE f."id" = NEW."stockMedicamentId" AND pv."id" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lot refusé : le point de vente % n''appartient pas à la pharmacie de la fiche %.', NEW."pointDeVenteId", NEW."stockMedicamentId";
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."stockMedicamentId" IS DISTINCT FROM OLD."stockMedicamentId"
    OR NEW."pointDeVenteId" IS DISTINCT FROM OLD."pointDeVenteId"
    OR NEW."numeroLot" IS DISTINCT FROM OLD."numeroLot"
    OR NEW."quantiteRecue" IS DISTINCT FROM OLD."quantiteRecue"
    OR NEW."coutAchatBoite" IS DISTINCT FROM OLD."coutAchatBoite"
    OR NEW."fournisseurId" IS DISTINCT FROM OLD."fournisseurId"
    OR NEW."receptionId" IS DISTINCT FROM OLD."receptionId"
    OR NEW."dateReception" IS DISTINCT FROM OLD."dateReception"
    OR NEW."lotTechnique" IS DISTINCT FROM OLD."lotTechnique"
    OR NEW."auteurId" IS DISTINCT FROM OLD."auteurId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : seule sa date de péremption se corrige après la réception.', OLD."id";
  END IF;
  IF NOT OLD."lotTechnique"
    AND (NEW."coefficientReception" IS DISTINCT FROM OLD."coefficientReception"
      OR NEW."coutUnitaire" IS DISTINCT FROM OLD."coutUnitaire") THEN
    RAISE EXCEPTION 'Le lot % ne peut pas être modifié : le coefficient et le coût ne changent que sur un lot technique, à la qualification de la fiche.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "lot_stock_proteger"
BEFORE INSERT OR UPDATE OR DELETE ON "LotStock"
FOR EACH ROW EXECUTE FUNCTION "lot_stock_proteger"();

-- Agrégats de lecture (D403) : tenus dans la transaction du mouvement, jamais par le code applicatif.
-- Un lot ne descend jamais sous zéro (AgregatStockLot_quantite_check) ; le produit peut être négatif (O11).
CREATE FUNCTION "mouvement_stock_agreger"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."lotId" IS NOT NULL THEN
    PERFORM 1
    FROM "LotStock" l
    WHERE l."id" = NEW."lotId"
      AND l."stockMedicamentId" = NEW."stockMedicamentId"
      AND l."pointDeVenteId" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mouvement refusé : le lot % n''appartient pas à la fiche % dans le point de vente %.', NEW."lotId", NEW."stockMedicamentId", NEW."pointDeVenteId";
    END IF;
  ELSE
    PERFORM 1
    FROM "StockMedicament" f
    JOIN "PointDeVente" pv ON pv."structureId" = f."structureId"
    WHERE f."id" = NEW."stockMedicamentId" AND pv."id" = NEW."pointDeVenteId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mouvement refusé : le point de vente % n''appartient pas à la pharmacie de la fiche %.', NEW."pointDeVenteId", NEW."stockMedicamentId";
    END IF;
  END IF;

  INSERT INTO "AgregatStockProduit" ("stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
  VALUES (NEW."stockMedicamentId", NEW."pointDeVenteId", NEW."quantite", now())
  ON CONFLICT ("stockMedicamentId", "pointDeVenteId") DO UPDATE
  SET "quantite" = "AgregatStockProduit"."quantite" + EXCLUDED."quantite",
      "misAJourLe" = EXCLUDED."misAJourLe";

  -- Pas de ON CONFLICT ici : PostgreSQL vérifie le CHECK sur la ligne proposée à l'insertion
  -- (une sortie négative serait refusée même quand le solde reste positif). Le premier mouvement
  -- d'un lot est écrit dans la transaction qui crée le lot, sous verrou de la fiche (D500).
  IF NEW."lotId" IS NOT NULL THEN
    UPDATE "AgregatStockLot"
    SET "quantite" = "quantite" + NEW."quantite",
        "misAJourLe" = now()
    WHERE "lotId" = NEW."lotId";
    IF NOT FOUND THEN
      INSERT INTO "AgregatStockLot" ("lotId", "stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
      VALUES (NEW."lotId", NEW."stockMedicamentId", NEW."pointDeVenteId", NEW."quantite", now());
    END IF;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "mouvement_stock_agreger"
AFTER INSERT ON "MouvementStock"
FOR EACH ROW EXECUTE FUNCTION "mouvement_stock_agreger"();

-- REPRISE: DEBUT (rejouable sans doublon, D418, D497)
-- Un lot technique par fiche à quantité positive : sans numéro, date de péremption de la fiche (O4),
-- coût 0 (non valorisable), coefficient 1, point de vente d'ordre 1 de la pharmacie.
INSERT INTO "LotStock" ("id", "stockMedicamentId", "pointDeVenteId", "numeroLot", "dateExpiration", "quantiteRecue", "coutUnitaire", "coutAchatBoite", "coefficientReception", "fournisseurId", "receptionId", "dateReception", "lotTechnique", "auteurId")
SELECT gen_random_uuid()::text, f."id", pv."id", NULL, f."dateExpiration"::date, f."quantite", 0, NULL, 1, NULL, NULL, now(), true, NULL
FROM "StockMedicament" f
JOIN "PointDeVente" pv ON pv."structureId" = f."structureId" AND pv."ordre" = 1
WHERE f."quantite" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "LotStock" l WHERE l."stockMedicamentId" = f."id" AND l."lotTechnique"
  );

-- Un mouvement RECEPTION par lot repris, pièce MIGRATION, auteur système ; les agrégats suivent par trigger.
INSERT INTO "MouvementStock" ("id", "evenementId", "pointDeVenteId", "stockMedicamentId", "lotId", "type", "quantite", "pieceOrigineType", "pieceOrigineId", "motif", "auteurId")
SELECT gen_random_uuid()::text, 'migration:' || f."id", l."pointDeVenteId", f."id", l."id", 'RECEPTION', l."quantiteRecue", 'MIGRATION', '20261026120000_pharmacie_t1_lots_mouvements', 'Reprise du stock existant', NULL
FROM "LotStock" l
JOIN "StockMedicament" f ON f."id" = l."stockMedicamentId"
WHERE l."lotTechnique" AND f."quantite" > 0
ON CONFLICT ("evenementId") DO NOTHING;
-- REPRISE: FIN

-- Contrôle final : le stock calculé égale le compteur, fiche par fiche, sinon rien n'est appliqué.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "StockMedicament" f
  WHERE f."quantite" <> COALESCE((SELECT sum(a."quantite") FROM "AgregatStockProduit" a WHERE a."stockMedicamentId" = f."id"), 0);
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT f."id"
      FROM "StockMedicament" f
      WHERE f."quantite" <> COALESCE((SELECT sum(a."quantite") FROM "AgregatStockProduit" a WHERE a."stockMedicamentId" = f."id"), 0)
      ORDER BY f."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M4 arrêtée : le stock calculé diffère du compteur pour % fiche(s). Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- Gel du compteur (plan 2, D493) : quantite et disponible ne s'écrivent plus ; une fiche se crée à quantité nulle.
CREATE FUNCTION "stock_medicament_geler_compteur"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."quantite" <> 0 THEN
      RAISE EXCEPTION 'Fiche de stock refusée : la quantité ne s''écrit plus sur la fiche (créer la fiche à quantité nulle, le stock vient du journal MouvementStock).';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."quantite" IS DISTINCT FROM OLD."quantite" OR NEW."disponible" IS DISTINCT FROM OLD."disponible" THEN
    RAISE EXCEPTION 'Fiche de stock % : quantite et disponible sont gelées depuis la reprise, le stock s''écrit par le journal MouvementStock.', OLD."id";
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "stock_medicament_geler_compteur"
BEFORE INSERT OR UPDATE ON "StockMedicament"
FOR EACH ROW EXECUTE FUNCTION "stock_medicament_geler_compteur"();

COMMIT;
```

### 3. Retour arrière de M4

Créer `prisma/retours-arriere/20261026120000_pharmacie_t1_lots_mouvements.down.sql`, contenu exact (fin de fichier : un saut de ligne après `COMMIT;`) :

```sql
-- Retour arrière de 20261026120000_pharmacie_t1_lots_mouvements (PB07, M4).
-- Valable même après activité réelle : restaure le compteur de chaque fiche depuis le stock calculé
-- (somme de ses mouvements, écrêtée à 0 ; les fiches écrêtées sont listées par un NOTICE),
-- disponible = quantité positive, et la date de péremption de la fiche depuis ses lots encore en
-- stock (la plus proche, nulle si aucun n'est daté ; inchangée si la fiche n'a plus de lot en stock).
-- Pertes : lots (numéros, dates par lot, fournisseurs), coûts, journal des mouvements, conditionnements ouverts.
-- À appliquer après les retours arrière de M6 puis M5, puis redéployer le code précédent.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DROP TRIGGER "stock_medicament_geler_compteur" ON "StockMedicament";

DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM (
    SELECT m."stockMedicamentId" FROM "MouvementStock" m GROUP BY m."stockMedicamentId" HAVING sum(m."quantite") < 0
  ) n;
  IF nombre > 0 THEN
    SELECT string_agg(x."stockMedicamentId", ', ' ORDER BY x."stockMedicamentId") INTO en_cause
    FROM (
      SELECT m."stockMedicamentId"
      FROM "MouvementStock" m
      GROUP BY m."stockMedicamentId"
      HAVING sum(m."quantite") < 0
      ORDER BY m."stockMedicamentId"
      LIMIT 50
    ) x;
    RAISE NOTICE 'Retour arrière de M4 : % fiche(s) au stock calculé négatif remises à 0. Fiches en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

UPDATE "StockMedicament" f
SET "quantite" = c."quantite",
    "disponible" = c."quantite" > 0
FROM (
  SELECT s."id", GREATEST(COALESCE(sum(m."quantite"), 0), 0)::int AS "quantite"
  FROM "StockMedicament" s
  LEFT JOIN "MouvementStock" m ON m."stockMedicamentId" = s."id"
  GROUP BY s."id"
) c
WHERE c."id" = f."id"
  AND (f."quantite" <> c."quantite" OR f."disponible" <> (c."quantite" > 0));

UPDATE "StockMedicament" f
SET "dateExpiration" = d."dateExpiration"::timestamp(3)
FROM (
  SELECT l."stockMedicamentId", min(l."dateExpiration") AS "dateExpiration"
  FROM "LotStock" l
  JOIN (
    SELECT m."lotId", sum(m."quantite") AS "solde"
    FROM "MouvementStock" m
    WHERE m."lotId" IS NOT NULL
    GROUP BY m."lotId"
  ) s ON s."lotId" = l."id"
  WHERE s."solde" > 0
  GROUP BY l."stockMedicamentId"
) d
WHERE d."stockMedicamentId" = f."id"
  AND f."dateExpiration"::date IS DISTINCT FROM d."dateExpiration";

DROP TABLE "ConditionnementOuvert";
DROP TABLE "AgregatStockLot";
DROP TABLE "AgregatStockProduit";
DROP TABLE "MouvementStock";
DROP TABLE "LotStock";

DROP FUNCTION "stock_medicament_geler_compteur"();
DROP FUNCTION "mouvement_stock_agreger"();
DROP FUNCTION "lot_stock_proteger"();
DROP FUNCTION "journal_refuser_modification"();

DROP TYPE "TypePiece";
DROP TYPE "TypeMouvementStock";

COMMIT;
```

### 4. Logique des commandes : `src/pharmacie/stock/commandes-stock.ts` (nouveau)

En-tête : commentaire de fichier en français (rôle, D501, aucune écriture hors `reconstruireStock`). Seul import : `import type { Client } from 'pg';`. Aucune classe, aucun Nest, aucun Prisma.

Types exportés, exactement :

```ts
export const MAX_EXEMPLES = 50;

export interface Echantillon<T> {
  nombre: number;
  exemples: T[]; // MAX_EXEMPLES au plus, dans l'ordre de la requête
}

export interface RapportVerification {
  agregatsProduit: Echantillon<{ stockMedicamentId: string; pointDeVenteId: string; agregat: number | null; recalcul: number | null }>;
  agregatsLot: Echantillon<{ lotId: string; agregat: number | null; recalcul: number | null }>;
  lotsNegatifs: Echantillon<{ lotId: string; solde: number }>;
  conditionnements: Echantillon<{ lotId: string; reliquat: number; ouverts: number }>;
  plagesSuperposees: Echantillon<{ pointDeVenteId: string; plageA: string; plageB: string }>;
  totalAnomalies: number; // somme des cinq `nombre`
}

export interface BilanReconstruction {
  agregatsProduit: number;
  agregatsLot: number;
  conditionnementsFermes: number;
  conditionnementsOuverts: number;
}

export interface RapportComparaison {
  fiches: number;
  ecartsReprise: Echantillon<{ stockMedicamentId: string; compteur: number; reprise: number }>;
  ecartsAgregat: Echantillon<{ stockMedicamentId: string; agregat: number; recalcul: number }>;
  fichesEnEcartActivite: number;
  activite: { typePiece: string; mouvements: number; quantite: number }[];
}

export interface RapportPreMigration {
  pharmacies: number;
  fiches: number;
  fichesAvecStock: number;
  fichesVides: number;
  fichesPrixManquant: number;
  fichesPerimees: number;
  fichesSansDate: number;
  ventes: number | null; // null si la table Vente n'existe pas
  fichesNegatives: Echantillon<string>;
  structuresNonPharmacie: Echantillon<string>;
  fichesSansPointDeVente: Echantillon<string> | null; // null si la table PointDeVente n'existe pas
  journalEnPlace: boolean; // vrai si la table LotStock existe (M4 appliquée)
  bloquant: boolean; // fichesNegatives, structuresNonPharmacie ou fichesSansPointDeVente non vide
}
```

Fonctions exportées, exactement ces signatures :

```ts
export function echantillon<T>(lignes: T[]): Echantillon<T>; // { nombre: lignes.length, exemples: lignes.slice(0, MAX_EXEMPLES) }
export async function verifierStock(client: Client): Promise<RapportVerification>;
export async function reconstruireStock(client: Client): Promise<BilanReconstruction>;
export async function comparerCompteur(client: Client): Promise<RapportComparaison>;
export async function analyserPreMigration(client: Client): Promise<RapportPreMigration>;
```

Transactions :
- `verifierStock`, `comparerCompteur`, `analyserPreMigration` : `await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')`, requêtes, puis dans un `finally` `await client.query('ROLLBACK')` entouré d'un `try/catch` vide commenté (« Transaction en lecture seule : rien à annuler. »). Elles ne ferment jamais le client.
- `reconstruireStock` : `BEGIN`, les six instructions de la section 4.2 dans l'ordre, `COMMIT` ; sur erreur, `ROLLBACK` (dans un `try/catch` vide) puis relancer l'erreur d'origine.

Chaque requête est une constante `const SQL_<NOM> = \`...\`;` de module, texte exact ci-dessous (les retours à la ligne sont libres, le SQL non). Les lignes reçues sont typées par le générique de `client.query<...>`.

4.1 Vérification (`verifierStock`)

`SQL_VERIFIER_AGREGATS_PRODUIT` (→ `agregatsProduit`) :

```sql
SELECT COALESCE(c."stockMedicamentId", a."stockMedicamentId") AS "stockMedicamentId",
       COALESCE(c."pointDeVenteId", a."pointDeVenteId") AS "pointDeVenteId",
       a."quantite" AS "agregat", c."quantite"::int AS "recalcul"
FROM (
  SELECT m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite") AS "quantite"
  FROM "MouvementStock" m
  GROUP BY m."stockMedicamentId", m."pointDeVenteId"
) c
FULL JOIN "AgregatStockProduit" a
  ON a."stockMedicamentId" = c."stockMedicamentId" AND a."pointDeVenteId" = c."pointDeVenteId"
WHERE a."stockMedicamentId" IS NULL OR c."stockMedicamentId" IS NULL OR a."quantite" <> c."quantite"
ORDER BY 1, 2
```

`SQL_VERIFIER_AGREGATS_LOT` (→ `agregatsLot`) :

```sql
SELECT COALESCE(c."lotId", a."lotId") AS "lotId", a."quantite" AS "agregat", c."quantite"::int AS "recalcul"
FROM (
  SELECT m."lotId", sum(m."quantite") AS "quantite"
  FROM "MouvementStock" m
  WHERE m."lotId" IS NOT NULL
  GROUP BY m."lotId"
) c
FULL JOIN "AgregatStockLot" a ON a."lotId" = c."lotId"
WHERE a."lotId" IS NULL OR c."lotId" IS NULL OR a."quantite" <> c."quantite"
ORDER BY 1
```

`SQL_VERIFIER_LOTS_NEGATIFS` (→ `lotsNegatifs`) :

```sql
SELECT m."lotId", sum(m."quantite")::int AS "solde"
FROM "MouvementStock" m
WHERE m."lotId" IS NOT NULL
GROUP BY m."lotId"
HAVING sum(m."quantite") < 0
ORDER BY 1
```

`SQL_VERIFIER_CONDITIONNEMENTS` (→ `conditionnements` ; reliquat dérivé du journal, D405) :

```sql
SELECT r."lotId", r."reliquat", COALESCE(o."ouverts", 0)::int AS "ouverts"
FROM (
  SELECT l."id" AS "lotId", l."coefficientReception" AS "coefficient",
         CASE WHEN COALESCE(s."solde", 0) > 0 AND l."coefficientReception" > 1
              THEN (s."solde" % l."coefficientReception")::int ELSE 0 END AS "reliquat"
  FROM "LotStock" l
  LEFT JOIN (
    SELECT m."lotId", sum(m."quantite") AS "solde" FROM "MouvementStock" m WHERE m."lotId" IS NOT NULL GROUP BY m."lotId"
  ) s ON s."lotId" = l."id"
) r
LEFT JOIN (
  SELECT c."lotId", count(*) AS "ouverts", min(c."unitesParConditionnement") AS "unitesMin", max(c."unitesParConditionnement") AS "unitesMax"
  FROM "ConditionnementOuvert" c
  WHERE c."fermeLe" IS NULL
  GROUP BY c."lotId"
) o ON o."lotId" = r."lotId"
WHERE (r."reliquat" > 0 AND (o."ouverts" IS NULL OR o."ouverts" > 1 OR o."unitesMin" <> r."coefficient" OR o."unitesMax" <> r."coefficient"))
   OR (r."reliquat" = 0 AND o."ouverts" IS NOT NULL)
ORDER BY 1
```

`SQL_VERIFIER_PLAGES` (→ `plagesSuperposees`) :

```sql
SELECT a."pointDeVenteId", a."id" AS "plageA", b."id" AS "plageB"
FROM "PlageTicket" a
JOIN "PlageTicket" b
  ON b."pointDeVenteId" = a."pointDeVenteId" AND a."id" < b."id" AND a."debut" <= b."fin" AND b."debut" <= a."fin"
ORDER BY 1, 2, 3
```

4.2 Reconstruction (`reconstruireStock`), six instructions dans cet ordre, après `BEGIN` :

1. `LOCK TABLE "MouvementStock", "ConditionnementOuvert" IN SHARE ROW EXCLUSIVE MODE` (D500) ;
2. `TRUNCATE "AgregatStockLot", "AgregatStockProduit"` ;
3. `SQL_RECONSTRUIRE_PRODUIT` (rowCount → `agregatsProduit`) :
```sql
INSERT INTO "AgregatStockProduit" ("stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
SELECT m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite")::int, now()
FROM "MouvementStock" m
GROUP BY m."stockMedicamentId", m."pointDeVenteId"
```
4. `SQL_RECONSTRUIRE_LOT` (rowCount → `agregatsLot`) :
```sql
INSERT INTO "AgregatStockLot" ("lotId", "stockMedicamentId", "pointDeVenteId", "quantite", "misAJourLe")
SELECT m."lotId", m."stockMedicamentId", m."pointDeVenteId", sum(m."quantite")::int, now()
FROM "MouvementStock" m
WHERE m."lotId" IS NOT NULL
GROUP BY m."lotId", m."stockMedicamentId", m."pointDeVenteId"
```
5. `SQL_FERMER_CONDITIONNEMENTS` (rowCount → `conditionnementsFermes`) :
```sql
UPDATE "ConditionnementOuvert" c
SET "fermeLe" = now()
FROM "LotStock" l
LEFT JOIN "AgregatStockLot" a ON a."lotId" = l."id"
WHERE c."lotId" = l."id"
  AND c."fermeLe" IS NULL
  AND (COALESCE(a."quantite", 0) <= 0
    OR l."coefficientReception" <= 1
    OR a."quantite" % l."coefficientReception" = 0
    OR c."unitesParConditionnement" <> l."coefficientReception")
```
6. `SQL_OUVRIR_CONDITIONNEMENTS` (rowCount → `conditionnementsOuverts`) :
```sql
INSERT INTO "ConditionnementOuvert" ("id", "stockMedicamentId", "lotId", "pointDeVenteId", "unitesParConditionnement", "ouvertLe")
SELECT gen_random_uuid()::text, l."stockMedicamentId", l."id", l."pointDeVenteId", l."coefficientReception", now()
FROM "LotStock" l
JOIN "AgregatStockLot" a ON a."lotId" = l."id"
WHERE a."quantite" > 0
  AND l."coefficientReception" > 1
  AND a."quantite" % l."coefficientReception" <> 0
  AND NOT EXISTS (
    SELECT 1 FROM "ConditionnementOuvert" c WHERE c."lotId" = l."id" AND c."fermeLe" IS NULL
  )
```
`rowCount` nul vaut 0 (`res.rowCount ?? 0`). Un solde de lot négatif fait échouer l'instruction 4 (`AgregatStockLot_quantite_check`) : rien n'est modifié, l'erreur remonte.

4.3 Comparaison (`comparerCompteur`, plan section 2)

- `fiches` : `SELECT count(*)::int AS "n" FROM "StockMedicament"`.
- `SQL_COMPARER_REPRISE` (→ `ecartsReprise`, doit être vide : prouve la reprise) :
```sql
SELECT f."id" AS "stockMedicamentId", f."quantite" AS "compteur", COALESCE(m."quantite", 0)::int AS "reprise"
FROM "StockMedicament" f
LEFT JOIN (
  SELECT x."stockMedicamentId", sum(x."quantite") AS "quantite" FROM "MouvementStock" x WHERE x."pieceOrigineType" = 'MIGRATION' GROUP BY x."stockMedicamentId"
) m ON m."stockMedicamentId" = f."id"
WHERE f."quantite" <> COALESCE(m."quantite", 0)
ORDER BY f."id"
```
- `SQL_COMPARER_AGREGAT` (→ `ecartsAgregat`, doit être vide : prouve l'agrégat) :
```sql
SELECT f."id" AS "stockMedicamentId", COALESCE(a."quantite", 0)::int AS "agregat", COALESCE(c."quantite", 0)::int AS "recalcul"
FROM "StockMedicament" f
LEFT JOIN (SELECT p."stockMedicamentId", sum(p."quantite") AS "quantite" FROM "AgregatStockProduit" p GROUP BY p."stockMedicamentId") a ON a."stockMedicamentId" = f."id"
LEFT JOIN (SELECT m."stockMedicamentId", sum(m."quantite") AS "quantite" FROM "MouvementStock" m GROUP BY m."stockMedicamentId") c ON c."stockMedicamentId" = f."id"
WHERE COALESCE(a."quantite", 0) <> COALESCE(c."quantite", 0)
ORDER BY f."id"
```
- `SQL_COMPARER_ACTIVITE_FICHES` (→ `fichesEnEcartActivite`, information) :
```sql
SELECT count(*)::int AS "n"
FROM "StockMedicament" f
LEFT JOIN (SELECT m."stockMedicamentId", sum(m."quantite") AS "quantite" FROM "MouvementStock" m GROUP BY m."stockMedicamentId") c ON c."stockMedicamentId" = f."id"
WHERE f."quantite" <> COALESCE(c."quantite", 0)
```
- `SQL_COMPARER_ACTIVITE` (→ `activite`) :
```sql
SELECT m."pieceOrigineType"::text AS "typePiece", count(*)::int AS "mouvements", sum(m."quantite")::int AS "quantite"
FROM "MouvementStock" m
WHERE m."pieceOrigineType" <> 'MIGRATION'
GROUP BY m."pieceOrigineType"
ORDER BY 1
```

4.4 Contrôle avant migration (`analyserPreMigration`, lecture seule, valable avant M2, entre M2 et M4 et après M4)

1. `SELECT to_regclass('"PointDeVente"') IS NOT NULL AS "pointsDeVente", to_regclass('"LotStock"') IS NOT NULL AS "lots", to_regclass('"Vente"') IS NOT NULL AS "ventes"` → trois booléens.
2. `SELECT count(*)::int AS "n" FROM "Structure" WHERE "type" = 'PHARMACIE'` → `pharmacies`.
3. Fiches :
```sql
SELECT count(*)::int AS "fiches",
       count(*) FILTER (WHERE "quantite" > 0)::int AS "avecStock",
       count(*) FILTER (WHERE "quantite" = 0)::int AS "vides",
       count(*) FILTER (WHERE "prixUnitaire" IS NULL OR "prixUnitaire" = 0)::int AS "prixManquant",
       count(*) FILTER (WHERE "dateExpiration" IS NOT NULL AND "dateExpiration"::date < current_date)::int AS "perimees",
       count(*) FILTER (WHERE "dateExpiration" IS NULL)::int AS "sansDate"
FROM "StockMedicament"
```
4. `SELECT "id" FROM "StockMedicament" WHERE "quantite" < 0 ORDER BY "id"` → `fichesNegatives` (identifiants).
5. Structures non pharmacies porteuses de stock, ou de ventes si la table `Vente` existe :
```sql
SELECT s."id"
FROM "Structure" s
WHERE s."type" <> 'PHARMACIE'
  AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
    OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"))
ORDER BY s."id"
```
sans la ligne `OR EXISTS (... "Vente" ...)` (et sa parenthèse fermante reportée) quand `ventes` est faux : écrire deux constantes, `SQL_NON_PHARMACIES_AVEC_VENTES` et `SQL_NON_PHARMACIES_SANS_VENTES`.
6. Si `ventes` : `SELECT count(*)::int AS "n" FROM "Vente"` → `ventes`, sinon `null`.
7. Si `pointsDeVente` :
```sql
SELECT f."id"
FROM "StockMedicament" f
WHERE f."quantite" > 0
  AND NOT EXISTS (SELECT 1 FROM "PointDeVente" pv WHERE pv."structureId" = f."structureId" AND pv."ordre" = 1)
ORDER BY f."id"
```
→ `fichesSansPointDeVente`, sinon `null`.
8. `journalEnPlace` = `lots` ; `bloquant` = `fichesNegatives.nombre > 0 || structuresNonPharmacie.nombre > 0 || (fichesSansPointDeVente?.nombre ?? 0) > 0`.

### 5. Purge du stock démo : `src/pharmacie/stock/purge-stock.ts` (nouveau)

Contenu exact (commentaire d'en-tête compris) :

```ts
import type { Prisma } from 'generated/prisma/client';

/**
 * Supprime le journal de stock des structures données : conditionnements ouverts,
 * agrégats, mouvements et lots de leurs points de vente (D503). Réservé à la purge du
 * jeu démo et au harnais : le contournement `medconnecte.purge_autorisee` (local à la
 * transaction, D496) n'autorise que les suppressions, et il est retiré à la fin.
 * À appeler avant `supprimerConfigurationPharmacies` (les lots référencent les points
 * de vente). Jamais pour la suppression d'une vraie pharmacie. Liste vide : aucune requête.
 */
export async function purgerStockPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parPointDeVente = {
    pointDeVente: { structureId: { in: structureIds } },
  };
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'on', true)`;
  await tx.conditionnementOuvert.deleteMany({ where: parPointDeVente });
  await tx.agregatStockLot.deleteMany({ where: parPointDeVente });
  await tx.agregatStockProduit.deleteMany({ where: parPointDeVente });
  await tx.mouvementStock.deleteMany({ where: parPointDeVente });
  await tx.lotStock.deleteMany({ where: parPointDeVente });
  await tx.$queryRaw`SELECT set_config('medconnecte.purge_autorisee', 'off', true)`;
}
```

### 6. Scripts (`scripts/`, nouveaux)

Quatre fichiers sur le modèle de `scripts/telephones-doublons.ts` : commentaire d'en-tête (rôle ; `Usage (dev) : docker compose exec -T backend npm run <script npm>` ; `Usage (production) : docker compose -f compose.yml -f compose.prod.yml run --rm --entrypoint "" backend node dist/scripts/<fichier>.js` ; `Lit DATABASE_URL.`), fonction `principal()`, `DATABASE_URL` absente : `console.error("DATABASE_URL n'est pas définie.")`, `process.exitCode = 1`, retour ; sinon `new Client({ connectionString })`, `connect`, appel de la fonction de la section 4, affichage, `process.exitCode = 1` dans les cas indiqués, `client.end()` dans un `finally`. `principal().catch(...)` affiche `console.error('<préfixe d\'échec> :', erreur instanceof Error ? erreur.message : erreur)` et met `process.exitCode = 1`. Jamais d'URL ni de valeur d'environnement affichée. Import : `from '../src/pharmacie/stock/commandes-stock'`.

Format d'affichage commun : un « écart » se liste par lignes `  - <texte>` (deux espaces, tiret simple, espace), pour les seuls `exemples` ; si `nombre > exemples.length`, la liste se termine par la ligne `  et <nombre - exemples.length> autre(s)`. Une valeur `null` s'affiche `absent`.

6.1 `scripts/stock-verifier.ts` (`verifierStock`), préfixe d'échec `Échec de la vérification du stock`. Lignes :
```
Vérification du stock (lecture seule, aucune donnée modifiée)
Agrégats produit différents du journal : <n>
  - <stockMedicamentId> | point de vente <pointDeVenteId> | agrégat <agregat> | journal <recalcul>
Agrégats lot différents du journal : <n>
  - <lotId> | agrégat <agregat> | journal <recalcul>
Lots au solde négatif : <n>
  - <lotId> | solde <solde>
Conditionnements ouverts incohérents avec le reliquat : <n>
  - <lotId> | reliquat <reliquat> | ouverts <ouverts>
Plages de tickets superposées : <n>
  - point de vente <pointDeVenteId> | <plageA> et <plageB>
```
puis `Résultat : aucune anomalie.` si `totalAnomalies` vaut 0, sinon `Résultat : <totalAnomalies> anomalie(s). Agrégats et conditionnements : lancer stock:reconstruire ; lots négatifs et plages : analyse requise.` et `process.exitCode = 1`.

6.2 `scripts/stock-reconstruire.ts` (`reconstruireStock`), préfixe d'échec `Échec de la reconstruction (rien n'a été modifié)`. Lignes :
```
Reconstruction des agrégats de stock depuis le journal
Agrégats produit recalculés : <agregatsProduit>
Agrégats lot recalculés : <agregatsLot>
Conditionnements fermés : <conditionnementsFermes>
Conditionnements ouverts : <conditionnementsOuverts>
Résultat : agrégats reconstruits.
```

6.3 `scripts/stock-comparer-compteur.ts` (`comparerCompteur`), préfixe d'échec `Échec de la comparaison`. Lignes :
```
Comparaison du compteur gelé et du stock calculé (lecture seule, aucune donnée modifiée)
Fiches : <fiches>
1. Compteur gelé différent de la reprise (doit être 0) : <n>
  - <stockMedicamentId> | compteur <compteur> | reprise <reprise>
2. Agrégat différent du journal (doit être 0) : <n>
  - <stockMedicamentId> | agrégat <agregat> | journal <recalcul>
3. Fiches dont le stock a bougé depuis la reprise (information) : <fichesEnEcartActivite>
Mouvements depuis la reprise, par type de pièce :
  - <typePiece> : <mouvements> mouvement(s), <quantite>
```
(si `activite` est vide, la ligne `  - aucun` remplace la liste), puis `Résultat : reprise et agrégats cohérents.` si les deux écarts sont vides, sinon `Résultat : écart à analyser avant toute suppression de la colonne quantite.` et `process.exitCode = 1`.

6.4 `scripts/pharmacie-pre-migration.ts` (`analyserPreMigration`), préfixe d'échec `Échec du contrôle avant migration`. Lignes :
```
Contrôle avant migration de la tranche pharmacie 1 (lecture seule, aucune donnée modifiée)
Pharmacies : <pharmacies>
Fiches de stock : <fiches> (<fichesAvecStock> avec du stock, <fichesVides> vides)
Ventes : <ventes>                        (ou « Ventes : table absente » si null)
Fiches sans prix ou à prix nul (information) : <fichesPrixManquant>
Fiches à date de péremption passée (information) : <fichesPerimees>
Fiches sans date de péremption (information) : <fichesSansDate>
Journal de stock : déjà en place (M4 appliquée)      (ou « Journal de stock : pas encore créé (M4) »)
Bloquant pour M4, fiches à quantité négative : <n>
  - <id>
Bloquant pour M2, structures non pharmacies porteuses de stock ou de ventes : <n>
  - <id>
Bloquant pour M4, fiches avec du stock sans point de vente : <n>
  - <id>
```
(la dernière rubrique devient la seule ligne `Points de vente : pas encore créés (créés par M2)` si `fichesSansPointDeVente` est null), puis `Résultat : migration possible.` ou `Résultat : migration impossible en l'état, corriger les points bloquants ci-dessus.` avec `process.exitCode = 1` si `bloquant`.

### 7. `package.json`

Ajouter après la ligne `"structures:rattachements": ...` (virgule à ajouter à cette ligne), dans cet ordre :

```json
    "stock:reconstruire": "ts-node --transpile-only scripts/stock-reconstruire.ts",
    "stock:verifier": "ts-node --transpile-only scripts/stock-verifier.ts",
    "stock:comparer-compteur": "ts-node --transpile-only scripts/stock-comparer-compteur.ts",
    "pharmacie:pre-migration": "ts-node --transpile-only scripts/pharmacie-pre-migration.ts"
```

`package-lock.json` n'est pas touché (aucune dépendance).

### 8. Jeu démo (`src/demo/demo.seeder.ts`)

8.1 Import : ajouter `import { purgerStockPharmacies } from 'src/pharmacie/stock/purge-stock';` après l'import de `src/pharmacie/point-de-vente`.

8.2 `purger(tx)` : juste avant l'appel `await supprimerConfigurationPharmacies(tx, structuresDemo.map((s) => s.id));`, insérer :

```ts
    // Journal de stock des pharmacies démo (lots en Restrict vers les points de vente, D503).
    await purgerStockPharmacies(
      tx,
      structuresDemo.map((s) => s.id),
    );
```

et, dans le commentaire de `purger`, remplacer « de même que la configuration de caisse des pharmacies » par « de même que le journal de stock (lots, mouvements, agrégats, conditionnements, D503) et la configuration de caisse des pharmacies ».

8.3 Étape 1 bis : remplacer la boucle par

```ts
    // 1 bis. Point de vente, poste de reprise, compteur et paramètres des pharmacies (D478)
    const idsPointsDeVente = new Map<CleStructure, string>();
    for (const s of STRUCTURES_DEMO.filter((x) => x.type === 'PHARMACIE')) {
      const { pointDeVente } = await assurerPointDeVente(tx, {
        id: structureId(s.cle),
        nom: s.nom,
      });
      idsPointsDeVente.set(s.cle, pointDeVente.id);
    }
```

8.4 Étape 4 : remplacer l'appel `await tx.stockMedicament.createMany({ ... });` (bloc entier, de `await tx.stockMedicament.createMany({` à la ligne `});` qui le ferme) par

```ts
    // Fiches à quantité nulle : le stock vient du journal (gel du compteur, D493).
    const fiches = STOCKS_DEMO.map((s) => ({ s, id: randomUUID() }));
    await tx.stockMedicament.createMany({
      data: fiches.map(({ s, id }) => ({
        id,
        medicamentId: trouver(idsMedicaments, s.medicament),
        structureId: structureId(s.pharmacie),
        prixUnitaire: s.prixUnitaire,
        dateExpiration: jour(s.expirationJours, 0, 0),
        notes: s.notes ?? null,
      })),
    });
    // Stock initial (D504) : un lot technique et un mouvement RECEPTION par fiche non vide.
    const lots = fiches
      .filter(({ s }) => s.quantite > 0)
      .map(({ s, id }) => ({
        id: randomUUID(),
        stockMedicamentId: id,
        pointDeVenteId: trouver(idsPointsDeVente, s.pharmacie),
        dateExpiration: jour(s.expirationJours, 0, 0),
        quantiteRecue: s.quantite,
        coutUnitaire: 0,
        coefficientReception: 1,
        dateReception: maintenant,
        lotTechnique: true,
      }));
    await tx.lotStock.createMany({ data: lots });
    await tx.mouvementStock.createMany({
      data: lots.map((l) => ({
        evenementId: randomUUID(),
        pointDeVenteId: l.pointDeVenteId,
        stockMedicamentId: l.stockMedicamentId,
        lotId: l.id,
        type: 'RECEPTION' as const,
        quantite: l.quantiteRecue,
        pieceOrigineType: 'RECEPTION' as const,
        motif: 'Stock initial du jeu de démonstration',
      })),
    });
```

Aucune autre ligne du seeder ne change.

### 9. `CLAUDE.md` (back)

Ajouter, juste après la puce « **Fiche produit étendue (tranche pharmacie 1, PB06)** » (même niveau, fins de ligne CRLF du fichier), la puce :

```
- **Journal de stock (tranche pharmacie 1, PB07)** : migration `20261026120000_pharmacie_t1_lots_mouvements` (M4, retour arrière dans `prisma/retours-arriere/`, qui restaure `quantite` depuis la somme des mouvements écrêtée à 0 et liste les fiches écrêtées). Tables `LotStock` (lot par fiche et point de vente, figé après insertion sauf `dateExpiration`, et `coefficientReception`/`coutUnitaire` d'un lot technique), `MouvementStock` (journal append-only : jamais modifié ni supprimé, trigger `journal_refuser_modification`, quantités signées en unités minimales, `evenementId` unique), `AgregatStockLot` (solde par lot, jamais négatif) et `AgregatStockProduit` (solde par fiche et point de vente, peut être négatif), agrégats de lecture tenus uniquement par le trigger `mouvement_stock_agreger` (ne jamais les écrire), `ConditionnementOuvert` (au plus un ouvert par fiche, lot et point de vente, index unique partiel). La reprise a créé un lot technique (coût 0, date de la fiche) et un mouvement `RECEPTION` pièce `MIGRATION` (`evenementId` `migration:<stockId>`) par fiche à quantité positive. `StockMedicament.quantite` et `disponible` sont gelées (trigger `stock_medicament_geler_compteur` : une fiche se crée à quantité nulle, toute modification de ces deux colonnes est refusée) ; elles seront supprimées à la version suivante. Le premier mouvement d'un lot est écrit dans la transaction qui crée le lot. Contournement de purge (`set_config('medconnecte.purge_autorisee', 'on', true)`, suppressions seulement) réservé à `purgerStockPharmacies` (purge démo) et au harnais. Commandes (dev `docker compose exec -T backend npm run <nom>`, production `node dist/scripts/<fichier>.js` par `docker compose run --rm --entrypoint ""`) : `pharmacie:pre-migration` (lecture seule, à lancer avant de déployer la tranche : quantités négatives, structures non pharmacies, fiches sans point de vente), `stock:verifier` (lecture seule : agrégats contre journal, lots négatifs, conditionnements, plages), `stock:reconstruire` (recalcule les agrégats et réaligne les conditionnements, sous verrou), `stock:comparer-compteur` (lecture seule : compteur gelé contre reprise, agrégat contre journal, activité depuis la reprise) ; code de sortie 1 en cas d'anomalie.
```

### 10. Tests

#### 10.1 `src/pharmacie/stock/purge-stock.spec.ts` (nouveau, `npm test`)

Doublure : objet `tx` avec `$queryRaw: jest.fn().mockResolvedValue([])` et, pour `conditionnementOuvert`, `agregatStockLot`, `agregatStockProduit`, `mouvementStock`, `lotStock`, un objet `{ deleteMany: jest.fn().mockResolvedValue({ count: 0 }) }` ; passé par `as never`.

- `liste vide : aucune requête` : `purgerStockPharmacies(tx, [])` ; aucun des six mocks appelé.
- `pose le contournement, supprime dans l ordre des dépendances, puis le retire` : avec `['s1', 's2']` ; chaque `deleteMany` appelé une fois avec `{ where: { pointDeVente: { structureId: { in: ['s1', 's2'] } } } }` ; `$queryRaw` appelé deux fois, `(appel[0] as string[]).join('')` contient `set_config('medconnecte.purge_autorisee', 'on', true)` au premier appel et `'off'` au second ; ordre par `mock.invocationCallOrder[0]` strictement croissant : `$queryRaw` (1er appel), `conditionnementOuvert`, `agregatStockLot`, `agregatStockProduit`, `mouvementStock`, `lotStock`, `$queryRaw` (2e appel, `invocationCallOrder[1]`).

#### 10.2 `src/demo/demo.seeder.spec.ts` (modifié)

- Dans `creerPrisma`, déclarer `const requeteBrute = jest.fn().mockResolvedValue([]);` à côté de `transaction`, et dans le piège `get` ajouter `if (cle === '$queryRaw') return requeteBrute;` juste après la ligne `if (cle === '$transaction') return transaction;`. Le type `PrismaSimule` devient `Record<string, Modele> & { $transaction: jest.Mock; $queryRaw: jest.Mock }`.
- Dans le test « couvre tous les statuts de rendez-vous et de SOS attendus », remplacer le bloc `// Stocks : au moins une rupture et un stock faible` (commentaire et les trois instructions qui suivent) par :
```ts
      // Stocks : fiches à quantité nulle, stock porté par les lots (D504)
      const stocks = donnees<Record<string, unknown>[]>(
        prisma.stockMedicament.createMany,
      );
      expect(stocks).toHaveLength(STOCKS_DEMO.length);
      expect(stocks.every((s) => !('quantite' in s) && !('disponible' in s))).toBe(true);
      const lots = donnees<{ id: string; stockMedicamentId: string; quantiteRecue: number }[]>(
        prisma.lotStock.createMany,
      );
      expect(lots).toHaveLength(STOCKS_DEMO.filter((s) => s.quantite > 0).length);
      expect(lots.length).toBeLessThan(stocks.length); // au moins une rupture
      expect(lots.some((l) => l.quantiteRecue < 10)).toBe(true); // un stock faible
```
  et ajouter `STOCKS_DEMO` à l'import de `./demo.donnees`.
- Nouveau test dans `describe('mode actif')` : `création : un lot technique et un mouvement RECEPTION par fiche non vide, jamais de pièce MIGRATION` : `await seeder.creerJeuDeDonnees()` ; `lots` comme ci-dessus avec `lotTechnique`, `coutUnitaire`, `coefficientReception`, `pointDeVenteId` : tous `lotTechnique === true`, `coutUnitaire === 0`, `coefficientReception === 1`, `pointDeVenteId === 'id-upsert'` ; `mouvements = donnees<...>(prisma.mouvementStock.createMany)` : même longueur que `lots`, pour chaque indice `mouvements[i].lotId === lots[i].id`, `quantite === lots[i].quantiteRecue`, `type === 'RECEPTION'`, `pieceOrigineType === 'RECEPTION'`, `motif === 'Stock initial du jeu de démonstration'`, `evenementId` chaîne ; aucun `pieceOrigineType === 'MIGRATION'` ; ordre : `stockMedicament.createMany` avant `lotStock.createMany` avant `mouvementStock.createMany` (`invocationCallOrder`).
- Test « purge : la configuration de caisse des structures démo part avant les structures » : ajouter `expect(prisma.mouvementStock.deleteMany).toHaveBeenCalledWith({ where: { pointDeVente: { structureId: { in: ['s-pharma'] } } } });` et `expect(prisma.lotStock.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(prisma.pointDeVente.deleteMany.mock.invocationCallOrder[0]);`.

#### 10.3 `test/db/m4-lots-mouvements.db-spec.ts` (nouveau, `npm run test:db`)

Constantes `M3 = '20261026110000_pharmacie_t1_fiche_produit'`, `M4 = '20261026120000_pharmacie_t1_lots_mouvements'`. Fonction `lignesSql` copiée de la spec M3. `beforeAll` : base, migrations `jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL`, `resume = await chargerFormatActuel(base.client)`, `appliquees = await appliquerMigrations(base.client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M4 })` avec le commentaire « Jamais au-delà de M4 : le retour arrière doit rester applicable quand M5 et M6 existeront. ». `afterAll` : `supprimerBaseDeTest`. Aides de la spec (requêtes paramétrées sur `base.client`) : `pv(structureId)` (id du point de vente d'ordre 1), `lotTechnique(stockId)` (id du lot technique), `mouvement({ evenementId, stockId, lotId | null, type, quantite, piece, pointDeVenteId? })` qui insère dans `MouvementStock` (`id` = `evenementId`, PV par défaut = celui de la pharmacie de la fiche), `jourIso(date)` = `date.toISOString().slice(0, 10)`, `etatFiches()` = `SELECT "id", "quantite", "disponible", to_char("dateExpiration", 'YYYY-MM-DD HH24:MI:SS') AS "date" FROM "StockMedicament" ORDER BY "id"`, `calcule()` = somme des mouvements par fiche (0 si aucun). Les tests s'enchaînent dans cet ordre (état partagé) :

1. `M4 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)` : comme la spec M3, sur les deux fichiers. Vérifier aussi que le fichier de migration contient exactement une ligne `-- REPRISE: DEBUT (rejouable sans doublon, D418, D497)` et une ligne `-- REPRISE: FIN`.
2. `premier test : stock calculé égal au compteur d origine, fiche par fiche` : `appliquees` vaut `[M1, M2, M3, M4]` (noms des trois premières en constantes) ; pour les 40 fiches de `resume.fiches`, `SELECT f."id", COALESCE(sum(m."quantite"), 0)::int AS "q" FROM "StockMedicament" f LEFT JOIN "MouvementStock" m ON m."stockMedicamentId" = f."id" GROUP BY f."id" ORDER BY f."id"` est égal à `resume.fiches.map((f) => ({ id: f.id, q: f.quantite }))` trié par id ; même égalité avec la somme de `AgregatStockProduit` par fiche.
3. `reprise : un lot technique par fiche à quantité positive, aucune trace pour les fiches vides` : 33 lots ; pour chaque fiche à quantité positive, exactement un lot avec `numeroLot` nul, `lotTechnique` vrai, `coutUnitaire` 0, `coutAchatBoite` nul, `coefficientReception` 1, `quantiteRecue` = quantité de la fiche, `fournisseurId`, `receptionId`, `auteurId` nuls, `pointDeVenteId` = `pv(structure de la fiche)`, `to_char("dateExpiration", 'YYYY-MM-DD')` = `jourIso(f.dateExpiration)` ou nul ; `AgregatStockLot.quantite` = `quantiteRecue` ; pour les 7 fiches vides : aucun lot, aucun mouvement, aucune ligne d'agrégat.
4. `reprise : un mouvement RECEPTION pièce MIGRATION par lot, auteur système` : 33 mouvements ; chacun `evenementId` = `'migration:' + stockMedicamentId`, `type` `RECEPTION`, `pieceOrigineType` `MIGRATION`, `pieceOrigineId` = M4, `motif` « Reprise du stock existant », `lotId` = le lot technique, `quantite` = quantité de la fiche, `auteurId`, `posteId`, `sequencePoste` nuls.
5. `reprise rejouable sans doublon` : extraire du fichier de migration le texte de la ligne `-- REPRISE: DEBUT` à la ligne `-- REPRISE: FIN` incluses ; photographier lots, mouvements et les deux agrégats (`SELECT * ... ORDER BY` clé, sans `misAJourLe`) ; `appliquerSql(client, bloc)` ; photographies identiques.
6. `agrégats égaux au recalcul après un scénario mixte, sorties partielles et totales acceptées` : dans `str-pharma-1`, insérer et attendre la réussite de chacun : (a) `essai-1` VENTE pièce VENTE -1 sur le lot technique de `stk-06` ; (b) `essai-2` VENTE pièce VENTE -5 sur `stk-02` sans lot ; (c) lot `lot-essai-06` sur `stk-06` (`numeroLot` `L-ESSAI`, date `jourIso(J+400)`, `quantiteRecue` 200, `coutUnitaire` 50, `coutAchatBoite` 1000, `coefficientReception` 20, `dateReception` now(), non technique), puis `essai-3` RECEPTION pièce RECEPTION +200 et `essai-4` VENTE pièce VENTE -15 sur ce lot ; (d) `essai-5` VENTE -11 sur le lot technique de `stk-05` (le vide exactement), lot `lot-essai-05` sur `stk-05` (`numeroLot` `L-05`, date `jourIso(J+400)`, `quantiteRecue` 5, coût 0, coefficient 1), `essai-6` RECEPTION pièce RECEPTION +5 ; (e) `essai-7` VENTE -10 sur le lot technique de `stk-04` (le vide) ; (f) `essai-8` INVENTAIRE pièce INVENTAIRE quantité 0 sur le lot technique de `stk-03`. Puis : `AgregatStockProduit` = somme des mouvements par (fiche, PV) pour toutes les lignes, et `AgregatStockLot` = somme par lot ; valeurs précises : produit `stk-06` 424, `stk-02` -4, `stk-05` 5, `stk-04` 0, `stk-03` 9 ; lot technique de `stk-06` 239, `lot-essai-06` 185, lot technique de `stk-02` 1, lot technique de `stk-05` 0, lot technique de `stk-04` 0.
7. `un lot n est jamais négatif` : -10 sur le lot technique de `stk-03` (solde 9) rejette avec `{ constraint: 'AgregatStockLot_quantite_check' }` ; nombre de mouvements et agrégat du lot inchangés.
8. `mouvement à quantité nulle refusé sauf inventaire` : VENTE 0 sur `stk-03` rejette avec `{ constraint: 'MouvementStock_quantite_check' }`.
9. `journal immuable : ni modification, ni suppression, ni troncature ; la purge ne fait que supprimer` : `UPDATE "MouvementStock" SET "motif" = 'x' WHERE "evenementId" = 'essai-1'`, `DELETE ... WHERE "evenementId" = 'essai-1'`, `TRUNCATE "MouvementStock" CASCADE` rejettent, message contenant `ne se modifient ni ne se suppriment jamais` ; puis `BEGIN`, `SELECT set_config('medconnecte.purge_autorisee', 'on', true)`, l'UPDATE rejette ; `ROLLBACK` ; `BEGIN`, contournement, `DELETE FROM "MouvementStock" WHERE "evenementId" = 'essai-1'` a `rowCount` 1, `ROLLBACK` ; `essai-1` existe toujours.
10. `mouvement incohérent refusé` : mouvement de `stk-03` sur le lot technique de `stk-06` rejette, message contenant `n'appartient pas à la fiche` ; mouvement sans lot de `stk-03` avec le PV de `str-pharma-2` rejette, message contenant `n'appartient pas à la pharmacie de la fiche` ; lot de `stk-03` avec le PV de `str-pharma-2` rejette, même message.
11. `lot figé après insertion` : sur `lot-essai-06` : `UPDATE ... SET "dateExpiration" = <J+401>` a `rowCount` 1 (puis remettre J+400) ; `quantiteRecue` = 300 rejette (message `seule sa date de péremption`) ; `coefficientReception` = 10 rejette (message `que sur un lot technique`) ; `DELETE` rejette (message `ne peut pas être supprimé`) ; sur le lot technique de `stk-03`, dans `BEGIN`/`ROLLBACK`, `coefficientReception` = 20 a `rowCount` 1 ; insertion d'un lot avec `coefficientReception` 0 rejette avec `{ constraint: 'LotStock_coefficientReception_check' }`, avec `coutUnitaire` -1 avec `{ constraint: 'LotStock_coutUnitaire_check' }`.
12. `compteur gelé : quantite et disponible ne s écrivent plus` : `UPDATE ... SET "quantite" = 5 WHERE "id" = 'stk-03'` et `SET "disponible" = false` rejettent (message `sont gelées`) ; dans `BEGIN`/`ROLLBACK`, `SET "quantite" = 9, "prixUnitaire" = 2600 WHERE "id" = 'stk-03'` a `rowCount` 1 ; insertion d'une fiche (`med-20`, `str-pharma-2`) à quantité 3 rejette (message `la quantité ne s'écrit plus`) ; à quantité 0 réussit dans `BEGIN`/`ROLLBACK`.
13. `un seul conditionnement ouvert par fiche, lot et point de vente (CA6 en base)` : insérer `co-1` (`stk-06`, `lot-essai-06`, PV de `str-pharma-1`, 20) ; `co-2` identique rejette avec `{ constraint: 'ConditionnementOuvert_stockMedicamentId_lotId_pointDeVenteI_key' }` ; fermer `co-1` (`fermeLe = now()`) puis `co-2` réussit ; `co-3` avec `unitesParConditionnement` 1 rejette avec `{ constraint: 'ConditionnementOuvert_unitesParConditionnement_check' }` ; à la fin `DELETE FROM "ConditionnementOuvert"`.
14. `point de vente non nul sur lot et mouvement (CA26 partiel)` : `information_schema.columns.is_nullable` vaut `NO` pour `LotStock.pointDeVenteId` et `MouvementStock.pointDeVenteId` ; une insertion de mouvement avec `pointDeVenteId` NULL rejette avec `{ code: '23502' }`.
15. `retour arrière après activité : compteur restauré depuis le journal, négatif écrêté et signalé, dates depuis les lots en stock` : abonner un écouteur `notice` (`client.on('notice', ...)`, retiré à la fin) ; `appliquerRetourArriere(client, M4)` ; un NOTICE contient `1 fiche(s) au stock calculé négatif remises à 0` et `stk-02` ; `etatFiches()` est égal à l'attendu construit depuis `resume.fiches` (date formatée `toISOString().slice(0, 19).replace('T', ' ')` ou nul, `disponible` = quantité > 0) avec ces seules différences : `stk-06` 424, `stk-02` 0 (non disponible), `stk-05` 5 avec la date `jourIso(J+400) + ' 00:00:00'`, `stk-04` 0 (non disponible, date toujours nulle) ; tables `LotStock`, `MouvementStock`, `AgregatStockLot`, `AgregatStockProduit`, `ConditionnementOuvert` absentes (`to_regclass`), types `TypePiece` et `TypeMouvementStock` absents, fonctions `journal_refuser_modification`, `lot_stock_proteger`, `mouvement_stock_agreger`, `stock_medicament_geler_compteur` absentes (`pg_proc`) ; dans `BEGIN`/`ROLLBACK`, `UPDATE "StockMedicament" SET "quantite" = 1 WHERE "id" = 'stk-03'` a `rowCount` 1 (gel retiré).
16. `retour arrière puis haut de nouveau : reprise depuis les compteurs restaurés` : `appliquerMigrations(client, { apres: M3, jusqua: M4 })` vaut `[M4]` ; stock calculé = compteur restauré pour les 40 fiches ; nombre de mouvements = nombre de fiches à quantité positive (31).

Sous-`describe` `arrêts de M4` avec sa propre base (`beforeAll` : migrations jusqu'à FORMAT, jeu, migrations jusqu'à M3 ; `afterAll` : suppression) :

17. `arrêt : fiches à quantité négative listées, rien n est créé` : `UPDATE "StockMedicament" SET "quantite" = -2 WHERE "id" IN ('stk-03', 'stk-09')` ; `appliquerMigrations(..., { apres: M3, jusqua: M4 })` rejette, message contenant `La migration ${M4} a échoué`, `2 fiche(s) de stock ont une quantité négative` et `Fiches en cause (50 au plus) : stk-03, stk-09` ; `to_regclass('"LotStock"')` nul ; aucun type `TypePiece` ; aucune fonction `mouvement_stock_agreger`.
18. `arrêt : fiche avec du stock d une structure sans point de vente, puis M4 passe une fois corrigée` : remettre `stk-03` à 9 et `stk-09` à 11 ; insérer la structure `str-pharma-sans-pv` (PHARMACIE, colonnes de la spec M2 : `id`, `nom`, `type`, `email`, `ville`, `isActive`, `isConfigured`, `createdAt`, `updatedAt`) et la fiche `stk-sans-pv` (`med-01`, quantité 3, `disponible` vrai, `updatedAt` now()) ; la migration rejette, message contenant `1 fiche(s) avec du stock appartiennent à une structure sans point de vente` et `Fiches en cause (50 au plus) : stk-sans-pv` ; supprimer `stk-sans-pv` ; la migration vaut alors `[M4]`.

#### 10.4 `test/db/commandes-stock.db-spec.ts` (nouveau, `npm run test:db`)

`beforeAll` : base, migrations jusqu'à FORMAT, `resume = chargerFormatActuel`, migrations `apres: DERNIERE_MIGRATION_FORMAT_ACTUEL` (toutes), `prisma = creerPrismaDeTest(base)`. `afterAll` : `fermerPrismaDeTest` puis `supprimerBaseDeTest` (modèle `points-de-vente.db-spec.ts`). Aide `lancer(script, env)` : `spawnSync(process.execPath, [path.join(RACINE_DEPOT, 'node_modules', 'ts-node', 'dist', 'bin.js'), '--transpile-only', path.join('scripts', script)], { cwd: RACINE_DEPOT, env, encoding: 'utf8', timeout: 120000 })`, renvoie `{ statut, sortie: masquerUrls(stdout + stderr) }` ; `env` = `{ ...process.env, DATABASE_URL: base.url }` (jamais la base de développement). Aide `compterStock(structureId)` : nombre de lots, mouvements, agrégats lot, agrégats produit et conditionnements des PV de la structure. Tests dans cet ordre :

1. `les quatre scripts se lancent sur la base migrée et rendent 0` : `stock-verifier.ts` (statut 0, sortie contient `Résultat : aucune anomalie.`), `stock-comparer-compteur.ts` (0, `Résultat : reprise et agrégats cohérents.`), `pharmacie-pre-migration.ts` (0, `Résultat : migration possible.` et `Journal de stock : déjà en place (M4 appliquée)`), `stock-reconstruire.ts` (0, `Résultat : agrégats reconstruits.`) ; puis `stock-verifier.ts` avec un `env` copié de `process.env` dont la clé `DATABASE_URL` est supprimée (`delete`) : statut 1, sortie contient `DATABASE_URL n'est pas définie.`.
2. `stock:verifier est propre juste après la reprise` : `verifierStock(base.client)` : `totalAnomalies` 0, les cinq `nombre` à 0.
3. `stock:comparer-compteur : reprise prouvée, aucune activité` : `fiches` 40, `ecartsReprise.nombre` 0, `ecartsAgregat.nombre` 0, `fichesEnEcartActivite` 0, `activite` `[]`.
4. `après une vente, l écart d activité est ventilé sans être une erreur` : mouvement `cmd-1` VENTE pièce VENTE -2 sur le lot technique de `stk-06` ; `comparerCompteur` : écarts de reprise et d'agrégat à 0, `fichesEnEcartActivite` 1, `activite` `[{ typePiece: 'VENTE', mouvements: 1, quantite: -2 }]`.
5. `stock:verifier détecte agrégats faussés, conditionnement manquant et plages superposées` : `UPDATE "AgregatStockProduit" SET "quantite" = "quantite" + 1` pour `stk-06` ; lot `cmd-lot` sur `stk-06` (coefficient 20, `quantiteRecue` 200, coût 50, date J+400) avec `cmd-2` RECEPTION +200 et `cmd-3` VENTE -15 ; `DELETE FROM "AgregatStockLot" WHERE "lotId" = <lot technique de stk-05>` ; deux plages `cmd-pl1` (1 à 1000) et `cmd-pl2` (1000 à 1999) sur le poste `REPRISE` du PV de `str-pharma-1` ; `verifierStock` : `agregatsProduit.nombre` 1 (exemple `stk-06`, `agregat` = `recalcul` + 1), `agregatsLot.nombre` 1 (`agregat` null, `recalcul` 11), `conditionnements` `{ nombre: 1, exemples: [{ lotId: 'cmd-lot', reliquat: 5, ouverts: 0 }] }`, `plagesSuperposees.nombre` 1 (`plageA` `cmd-pl1`, `plageB` `cmd-pl2`), `lotsNegatifs.nombre` 0, `totalAnomalies` 4 ; `comparerCompteur().ecartsAgregat` `{ nombre: 1 }` sur `stk-06` ; `stock-verifier.ts` lancé rend 1 et sa sortie contient `Résultat : 4 anomalie(s).`.
6. `stock:reconstruire rétablit les agrégats et ouvre le conditionnement manquant` : supprimer `cmd-pl2` ; `reconstruireStock` : `conditionnementsOuverts` 1, `conditionnementsFermes` 0, `agregatsProduit` = nombre de couples (fiche, PV) ayant des mouvements, `agregatsLot` = nombre de lots ayant des mouvements ; `verifierStock().totalAnomalies` 0 ; la ligne ouverte de `cmd-lot` a `unitesParConditionnement` 20, `ouvertParId` et `ouvertParPieceId` nuls.
7. `stock:reconstruire ferme un conditionnement devenu sans reliquat et reste idempotent` : `cmd-4` VENTE -5 sur `cmd-lot` (solde 180) ; `verifierStock().conditionnements.nombre` 1 ; `reconstruireStock` : `conditionnementsFermes` 1, `conditionnementsOuverts` 0 ; second appel : `conditionnementsFermes` 0, `conditionnementsOuverts` 0, et photographie des deux agrégats (sans `misAJourLe`) identique avant et après ; `verifierStock().totalAnomalies` 0.
8. `pharmacie:pre-migration sur une base d avant la tranche` : nouvelle base dans le test (supprimée dans un `finally`) : migrations jusqu'à FORMAT, `r = chargerFormatActuel` ; `analyserPreMigration(autre.client)` : `pharmacies` 3, `fiches` 40, `fichesAvecStock` 33, `fichesVides` 7, `fichesPrixManquant` = nombre de fiches de `r.fiches` à prix nul ou 0, `fichesPerimees` = nombre à date strictement antérieure à `r.aujourdhui`, `fichesSansDate` = nombre à date nulle, `ventes` = `r.ventes.validees + r.ventes.annulees`, `fichesNegatives.nombre` 0, `structuresNonPharmacie.nombre` 0, `fichesSansPointDeVente` null, `journalEnPlace` faux, `bloquant` faux ; puis `UPDATE "StockMedicament" SET "quantite" = -1 WHERE "id" = 'stk-03'` et insertion d'une fiche `stk-hopital` (`med-01`, `str-hopital-1`, quantité 2) : `fichesNegatives` `{ nombre: 1, exemples: ['stk-03'] }`, `structuresNonPharmacie` `{ nombre: 1, exemples: ['str-hopital-1'] }`, `bloquant` vrai.
9. `pharmacie:pre-migration sur la base migrée` : `fichesSansPointDeVente` `{ nombre: 0, exemples: [] }`, `journalEnPlace` vrai, `bloquant` faux.
10. `sans contournement, ni mouvement ni lot ne se supprime` : `prisma.mouvementStock.deleteMany({ where: { pointDeVente: { structureId: 'str-pharma-3' } } })` rejette ; `prisma.lotStock.deleteMany` (même filtre) rejette ; `compterStock('str-pharma-3')` inchangé.
11. `purge démo : purgerStockPharmacies vide le journal des seules structures données` : `avant1 = compterStock('str-pharma-1')` ; `prisma.$transaction((tx) => purgerStockPharmacies(tx, ['str-pharma-2']))` ; `compterStock('str-pharma-2')` tout à 0 ; `compterStock('str-pharma-1')` égal à `avant1`.
12. `purge démo : le contournement est retiré à la fin de la purge` : `prisma.$transaction(async (tx) => { await purgerStockPharmacies(tx, ['str-pharma-3']); await tx.mouvementStock.deleteMany({ where: { pointDeVente: { structureId: 'str-pharma-1' } } }); })` rejette ; la transaction est annulée en bloc : `compterStock('str-pharma-3').lots` > 0 et `compterStock('str-pharma-1')` égal à `avant1` du test 11 (variable de `describe`).

### Cas limites (à couvrir tels quels, déjà dans le texte imposé)

- Sortie qui vide exactement un lot : acceptée (D499) ; sortie qui le rendrait négatif : refusée par le CHECK, rien n'est écrit.
- Mouvement sans lot : seul le produit bouge, il peut devenir négatif (O11).
- Inventaire à écart nul : écrit (D417).
- Fiche créée après la reprise : quantité 0 imposée ; comparaison (1) reste nulle pour elle.
- Fiche à quantité nulle à la reprise : ni lot, ni mouvement, ni agrégat.
- Date de fiche avec une heure : le lot prend le jour (`::date`) ; le retour arrière ne réécrit la date que si le jour change.
- Retour arrière : fiche au stock calculé négatif écrêtée à 0 et listée ; fiche dont tous les lots sont épuisés : date inchangée ; lots sans date mêlés à des lots datés : la plus proche date connue.
- Commandes : base vide de mouvements (tout à 0), table `Vente` ou `PointDeVente` absente (pré-migration).

### Liste fermée des fichiers

Créés : `prisma/migrations/20261026120000_pharmacie_t1_lots_mouvements/migration.sql`, `prisma/retours-arriere/20261026120000_pharmacie_t1_lots_mouvements.down.sql`, `src/pharmacie/stock/commandes-stock.ts`, `src/pharmacie/stock/purge-stock.ts`, `src/pharmacie/stock/purge-stock.spec.ts`, `scripts/stock-reconstruire.ts`, `scripts/stock-verifier.ts`, `scripts/stock-comparer-compteur.ts`, `scripts/pharmacie-pre-migration.ts`, `test/db/m4-lots-mouvements.db-spec.ts`, `test/db/commandes-stock.db-spec.ts`.
Modifiés : `prisma/schema.prisma`, `package.json`, `src/demo/demo.seeder.ts`, `src/demo/demo.seeder.spec.ts`, `CLAUDE.md`.
Rien d'autre : ni `pharmacie.service.ts`, ni `vente.service.ts`, ni `point-de-vente.ts`, ni `super-admin.service.ts`, ni `test/db/instantanes/`, ni les specs en base existantes, ni `docs/plans/`.

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md (français partout, aucun tiret cadratin ni demi-cadratin, aucun caractère points de suspension). Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash. Textes SQL des sections 2 et 3 recopiés à l'identique. Jamais `prisma migrate dev`, `migrate reset` ni `db push` ; ne pas appliquer M4 sur la base de développement (le chef s'en charge à la validation). Ne jamais afficher ni écrire d'URL de base, de mot de passe ni de valeur de `.env` (D454). Si un point de cette fiche est impossible tel quel, s'arrêter en BLOCKED en citant la section.

## Done when

Depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` :

1. `docker compose exec -T backend npx prisma generate` puis `docker compose exec -T backend npx prisma validate` : succès.
2. `docker compose exec -T backend npx tsc --noEmit` : code 0.
3. `docker compose exec -T backend npx eslint src/pharmacie/stock/commandes-stock.ts src/pharmacie/stock/purge-stock.ts src/pharmacie/stock/purge-stock.spec.ts scripts/stock-reconstruire.ts scripts/stock-verifier.ts scripts/stock-comparer-compteur.ts scripts/pharmacie-pre-migration.ts src/demo/demo.seeder.ts src/demo/demo.seeder.spec.ts test/db/m4-lots-mouvements.db-spec.ts test/db/commandes-stock.db-spec.ts` (chemins relatifs au dépôt back) : code 0, aucun avertissement.
4. `docker compose exec -T backend npm test` : tout vert (suites existantes plus `purge-stock.spec.ts` et les tests ajoutés au seeder).
5. `docker compose exec -T backend npm run test:db` : tout vert, dont `m4-lots-mouvements.db-spec.ts` (18 tests), `commandes-stock.db-spec.ts` (12 tests), `schema-derive.db-spec.ts`, `non-regression-lectures.db-spec.ts` et `fiche-produit.db-spec.ts` inchangés et verts.
6. `git -C back_medconnect status --short test/db/instantanes` : vide.
7. Aucune base `mc_test_` restante : `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname LIKE '"'"'mc_test_%'"'"'"'` affiche 0.
8. Aucun tiret cadratin ni demi-cadratin ni points de suspension typographiques dans les fichiers créés ou modifiés (`git -C back_medconnect diff` et fichiers non suivis).

## Return

Chemin de chaque fichier créé ou modifié + preuve (commande lancée, résultat en une ligne, pour chaque point de « Done when »). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->
2026-10-25 | dur (Sonnet) | réussi, vérifié (PASS) puis validé par le chef |

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
tsc, eslint (11 fichiers), npm test, npm run test:db | 0, 0, 852 verts, 94 verts | voir git log (PB07)
