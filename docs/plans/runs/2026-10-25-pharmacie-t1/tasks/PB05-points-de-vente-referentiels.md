# PB05 - Points de vente, postes et référentiels, migration M2

Tier: spécifié (agent implementeur-specifie : codeur Sonnet selon l'arbitrage A2 ; fiche complète, aucune décision laissée ouverte)
Audience: dev (API) ; quatre messages renvoyés au front et affichés (non-dev, textes imposés ci-dessous)
Visuel: n/a
Background-safe: oui

## Spec

### Objectif

Jalon J1 : aucun changement de comportement visible pour les utilisateurs existants (routes ajoutées seulement, création et suppression de structure inchangées vues de l'extérieur). Cette tâche :

1. ajoute au schéma Prisma 9 modèles et 4 enums (plan 1.1) et la migration M2 `20261026100000_pharmacie_t1_points_de_vente` avec son retour arrière ;
2. crée une fonction unique `assurerPointDeVente` (PV d'ordre 1, poste technique `REPRISE`, compteur de tickets, paramètres) appelée à la création d'une pharmacie, dans le jeu démo, au démarrage et à la première lecture, et `supprimerConfigurationPharmacies` appelée avant toute suppression de structure (super administrateur, purge démo) ;
3. ajoute les routes `GET /pharmacie/:structureId/referentiels`, `GET` et `PATCH /pharmacie/:structureId/parametres`, `POST` et `GET /pharmacie/:structureId/postes`, `PATCH /pharmacie/:structureId/postes/:posteId` ;
4. ajoute une garde de dérive entre `prisma/schema.prisma` et les migrations (`test/db/schema-derive.db-spec.ts`), valable pour toute la tranche.

Aucune route existante, aucun DTO existant, aucune lecture ni écriture de stock ou de vente n'est modifié. `Fournisseur` et `Anomalie` sont des tables seulement (leurs routes arrivent en PB14 et PB15) ; `CompteurTicket` et `PlageTicket` ne sont écrits que par M2 et `assurerPointDeVente` (vente en PB11, plages en PB18).

Décisions qui encadrent la tâche (lire par grep dans `docs/plans/runs/2026-10-25-pharmacie-t1/decisions.md`) : D421, D429, D430, D432, D448, D449, D454, D456, D457, D464, D478 à D484. Correction du porteur (prime) : coupures 20 000, 10 000, 5 000, 2 000, 1 000, 500 GNF, rien en dessous, aucune ligne « pièces et autres ». Arbitrage A4 : `seuilStockBas` est en boîtes.

### Contexte vérifié (ne pas re-découvrir)

- Une pharmacie est créée par `SuperAdminService.createStructure` (`src/super-admin/super-admin.service.ts`, vers la ligne 73 ; le plan dit à tort `structure.service`), puis ses rôles sont semés dans un `try/catch` non bloquant. Elle est supprimée par `SuperAdminService.deleteStructure` (vers la ligne 426), dans un `$transaction` qui supprime membres, administrateur puis `tx.structure.delete`. Le jeu démo crée ses structures par `tx.structure.createMany` dans `DemoSeeder.inserer` (`src/demo/demo.seeder.ts`, vers la ligne 315) et les purge dans `DemoSeeder.purger` (vers la ligne 180 : journaux d'audit, comptes, puis `tx.structure.deleteMany`). `STRUCTURES_DEMO` (`src/demo/demo.donnees.ts`) contient 2 pharmacies (`type: 'PHARMACIE'`).
- `AccesPharmacieService.verifier(structureId, userId)` (`src/pharmacie/acces-pharmacie.service.ts`) renvoie `{ user: { id, nom, prenom, structureId }, structure: { id, type, adminId, isActive, nom, adresse, ville, telephone, logoFile } }` ou lève 404 / 403 (D464). Toutes les routes de PB05 l'appellent en premier.
- `PermissionsGuard` exige TOUTES les permissions de `@RequirePermissions` (ET logique). `PERMISSIONS.CAISSE_UTILISER`, `PERMISSIONS.CAISSE_SUPERVISER`, `PERMISSIONS.STRUCTURE_WRITE` existent (`src/common/rbac/permissions.constants.ts`). `caisse:*` sont réservées aux pharmacies ; `structure:write` ne l'est pas (un hôpital la garde, l'accès est alors refusé par `AccesPharmacieService`).
- Audit : écriture directe `tx.auditLog.create({ data: { userId, action, entityType, entityId, ip, metadata } })` comme `vente.service.ts` (vers la ligne 415). L'`AuditInterceptor` global ne traite que `/carnet-sante` : aucun double audit.
- Erreurs à code : corps `{ message, code }` passé à l'exception (modèle `vente.service.ts`, vers la ligne 562) ; un code doit figurer dans `CODES_ERREUR` (`src/common/filters/codes-erreur.ts`). Validation : `fabriquerErreurValidation` produit `champs: [{ champ, contraintes }]`.
- Harnais (PB01) : `test/db/harnais.ts` exporte `creerBaseVide`, `supprimerBaseDeTest`, `appliquerMigrations(client, { apres?, jusqua?, dossier? })` (renvoie les noms appliqués ; en cas d'échec lève `La migration <nom> a échoué : <message masqué>`), `appliquerSql`, `appliquerRetourArriere(client, nom)`, `creerPrismaDeTest(base)`, `fermerPrismaDeTest(prisma)`, `masquerUrls`, `RACINE_DEPOT`, `DOSSIER_MIGRATIONS`, `DOSSIER_RETOURS_ARRIERE`, `DERNIERE_MIGRATION_FORMAT_ACTUEL` ; `BaseDeTest` a `client` et `url`. Jeu `test/db/fixtures/format-actuel.ts` (`chargerFormatActuel`) : pharmacies `str-pharma-1` « Pharmacie de Kaloum (harnais) », `str-pharma-2` « Pharmacie de Matoto (harnais) », `str-pharma-3` « Pharmacie de Ratoma (harnais) », hôpital `str-hopital-1` ; utilisateurs `usr-admin-p1` (Fatoumata Camara, administrateur de `str-pharma-1`), `usr-pharm-p1` (Mamadou Diallo, pharmacien de `str-pharma-1`), `usr-admin-p2`, `usr-pharm-p2` (Aïssatou Barry, `str-pharma-2`), `usr-admin-p3` (`str-pharma-3`), `usr-admin-h1`, `usr-medecin-h1` (Mariama Sylla, `str-hopital-1`) ; médicaments `med-01` à `med-NN` ; 40 fiches de stock, toutes dans les 3 pharmacies ; ventes dans `str-pharma-1` et `str-pharma-2` seulement. Modèle d'appel de la CLI Prisma depuis un test : `test/db/harnais.db-spec.ts`, test « prisma migrate deploy ne laisse rien… » (vers la ligne 285), et configuration `test/db/fixtures/fautive/prisma.config.ts`.
- Prisma n'applique pas un fichier de migration en transaction (D456) : `BEGIN;`/`COMMIT;` obligatoires, et un test statique le vérifie. Le harnais, lui, applique en transaction implicite et fait `ROLLBACK` après un échec (D457).
- Le texte de M2 et du retour arrière ci-dessous a été exécuté par le chef sur une base jetable : haut, bas, haut sans erreur ; `prisma migrate diff --from-config-datasource --to-schema <schéma de PB05> --exit-code` à 0 (aucune dérive, CHECK et bloc `DO` compris) ; arrêt déclenché avec le message attendu et aucune table ni type laissés.

### 1. Schéma Prisma (`prisma/schema.prisma`)

La cohérence entre ce schéma et M2 est contrôlée par la garde de dérive (section 7f).

a. Dans `model Structure`, juste après la ligne `  compteursVente CompteurVente[]`, insérer (une ligne vide avant) :

```prisma

  // Tranche pharmacie 1 : points de vente, paramètres et fournisseurs (PB05)
  pointsDeVente       PointDeVente[]
  parametresPharmacie ParametresPharmacie?
  fournisseurs        Fournisseur[]
```

b. Juste après l'accolade fermante de `model CompteurVente { ... }` (et avant `model AutorisationStructure`), insérer exactement ce bloc (il commence par une ligne vide) :

```prisma

// ====== Tranche pharmacie 1 : points de vente, postes et référentiels (PB05, M2) ======

enum TypePoste {
  WEB
  DESKTOP
  TECHNIQUE
}

enum TypeCoupure {
  BILLET
  PIECE
}

enum TypeAnomalie {
  STOCK_NEGATIF
  ECART_INVENTAIRE
  CONDITIONNEMENT_CONCURRENT
  REMONTEE_APRES_CLOTURE
  ECART_CAISSE
  FOND_NON_COMPTE
  PLAGE_EPUISEE
  PRIX_DIVERGENT
  ORDONNANCE_NON_CONFIRMEE
  VENTE_UNITE_INTERDITE
  PRODUIT_ARCHIVE
  EVENEMENT_REJETE
  SEQUENCE_MANQUANTE
}

enum StatutAnomalie {
  OUVERTE
  TRAITEE
}

// Point de vente d'une pharmacie (un seul en T1, ordre 1). Clés étrangères en Restrict (O12).
model PointDeVente {
  id          String    @id @default(uuid())
  structureId String
  structure   Structure @relation(fields: [structureId], references: [id], onDelete: Restrict)
  ordre       Int // numéro d'ordre dans la pharmacie, préfixe des tickets T<ordre>-
  nom         String // copie du nom de la pharmacie à la création
  actif       Boolean   @default(true)
  createdAt   DateTime  @default(now())

  postes         Poste[]
  compteurTicket CompteurTicket?
  plagesTicket   PlageTicket[]
  anomalies      Anomalie[]

  @@unique([structureId, ordre])
  @@index([structureId])
}

// Poste de caisse : navigateur (WEB), installation (DESKTOP) ou poste technique REPRISE.
model Poste {
  id                        String       @id @default(uuid())
  pointDeVenteId            String
  pointDeVente              PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  code                      String // W1, D1, REPRISE : unique par point de vente
  libelle                   String
  type                      TypePoste
  appareilId                String? // installation desktop, ou navigateur et utilisateur (web)
  actif                     Boolean      @default(true)
  derniereSequenceAppliquee Int          @default(0)
  dernierContactLe          DateTime?
  dernierEtat               Json? // { fileVide, sessionOuverte, versionApp } déclaré à la dernière synchro
  enregistreParId           String? // sans clé étrangère (D109)
  createdAt                 DateTime     @default(now())

  plagesTicket PlageTicket[]

  @@unique([pointDeVenteId, code])
  @@unique([pointDeVenteId, appareilId])
}

// Seule source des numéros de ticket d'un point de vente.
model CompteurTicket {
  pointDeVenteId String       @id
  pointDeVente   PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  prochainNumero Int          @default(1)
}

// Plage de numéros de ticket d'un poste desktop. CHECK (fin >= debut) posé par la migration.
model PlageTicket {
  id             String       @id @default(uuid())
  posteId        String
  poste          Poste        @relation(fields: [posteId], references: [id], onDelete: Restrict)
  pointDeVenteId String
  pointDeVente   PointDeVente @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  debut          Int
  fin            Int // inclus
  attribueeLe    DateTime     @default(now())
  attribueeParId String? // sans clé étrangère

  @@index([posteId])
}

// Paramètres d'une pharmacie (O9), créés avec les défauts.
model ParametresPharmacie {
  structureId               String    @id
  structure                 Structure @relation(fields: [structureId], references: [id], onDelete: Restrict)
  horizonsPeremptionJours   Int[]     @default([90, 30, 7])
  seuilEcartCaisse          Int       @default(5000) // GNF
  seuilAvertissementPrixPct Int       @default(25)
  seuilStockBas             Int       @default(10) // en boîtes (A4)
  taillePlageTickets        Int       @default(1000)
  seuilRechargementPlagePct Int       @default(20)
  debutFiabiliteMarge       DateTime  @default(now())
  debutCaisse               DateTime  @default(now()) // jours antérieurs non clôturables
  updatedAt                 DateTime  @default(now()) @updatedAt
  misAJourParId             String? // sans clé étrangère
}

// Modes de paiement (O7), globaux : un nouveau mode = un INSERT, sans migration.
model ModePaiement {
  id                 String  @id @default(uuid())
  code               String  @unique // ESPECES, ORANGE_MONEY, MTN_MOMO
  libelle            String
  comptagePhysique   Boolean
  referenceAutorisee Boolean
  ordre              Int
  actif              Boolean @default(true)
}

// Coupures comptées en caisse (O8 et correction du porteur : billets de 20 000 à 500 GNF).
model CoupureMonnaie {
  id            String      @id @default(uuid())
  devise        String      @default("GNF")
  valeurFaciale Int
  type          TypeCoupure
  ordre         Int
  actif         Boolean     @default(true)

  @@unique([devise, valeurFaciale])
}

// Fournisseur d'une pharmacie (minimal : nom et téléphone).
model Fournisseur {
  id          String    @id @default(uuid())
  structureId String
  structure   Structure @relation(fields: [structureId], references: [id], onDelete: Restrict)
  nom         String
  telephone   String?
  actif       Boolean   @default(true)
  createdAt   DateTime  @default(now())

  @@unique([structureId, nom])
}

// File d'anomalies du titulaire : seul objet du domaine dont le statut change.
model Anomalie {
  id                    String         @id @default(uuid())
  pointDeVenteId        String
  pointDeVente          PointDeVente   @relation(fields: [pointDeVenteId], references: [id], onDelete: Restrict)
  type                  TypeAnomalie
  statut                StatutAnomalie @default(OUVERTE)
  attribueeAId          String? // sans clé étrangère, nominatif
  pieceType             String
  pieceId               String?
  details               Json // liste blanche de champs, jamais de donnée de santé
  creeLe                DateTime       @default(now())
  traiteeLe             DateTime?
  traiteeParId          String?
  commentaireTraitement String?

  @@index([pointDeVenteId, statut, creeLe])
}
```

Ne pas lancer `npx prisma format` (il réaligne tout le fichier) ni `prisma migrate dev` (il réécrirait la migration). Après la modification : `docker compose exec -T backend npx prisma generate`, puis `npx prisma validate` dans le conteneur (code 0).

### 2. Migration M2 et retour arrière

Créer `prisma/migrations/20261026100000_pharmacie_t1_points_de_vente/migration.sql`, contenu exact (fin de fichier : un saut de ligne après `COMMIT;`) :

```sql
-- Tranche pharmacie 1, points de vente, postes et référentiels (PB05, M2, D421, D478 à D484).
-- DDL généré par prisma migrate diff (schéma d'avant vers schéma de PB05) ; contrôle d'arrêt, CHECK et reprise écrits à la main.
-- Prisma n'applique pas un fichier en transaction (D456) : BEGIN et COMMIT explicites.
BEGIN;

-- Arrêt (plan, section 2) : un point de vente n'est créé que pour une PHARMACIE.
DO $$
DECLARE
  nombre INTEGER;
  en_cause TEXT;
BEGIN
  SELECT count(*)::int INTO nombre
  FROM "Structure" s
  WHERE s."type" <> 'PHARMACIE'
    AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
      OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"));
  IF nombre > 0 THEN
    SELECT string_agg(x."id", ', ' ORDER BY x."id") INTO en_cause
    FROM (
      SELECT s."id"
      FROM "Structure" s
      WHERE s."type" <> 'PHARMACIE'
        AND (EXISTS (SELECT 1 FROM "StockMedicament" m WHERE m."structureId" = s."id")
          OR EXISTS (SELECT 1 FROM "Vente" v WHERE v."structureId" = s."id"))
      ORDER BY s."id"
      LIMIT 50
    ) x;
    RAISE EXCEPTION 'Migration M2 arrêtée : % structure(s) qui ne sont pas des pharmacies portent du stock ou des ventes, décision requise avant de créer les points de vente. Structures en cause (50 au plus) : %', nombre, en_cause;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "TypePoste" AS ENUM ('WEB', 'DESKTOP', 'TECHNIQUE');

-- CreateEnum
CREATE TYPE "TypeCoupure" AS ENUM ('BILLET', 'PIECE');

-- CreateEnum
CREATE TYPE "TypeAnomalie" AS ENUM ('STOCK_NEGATIF', 'ECART_INVENTAIRE', 'CONDITIONNEMENT_CONCURRENT', 'REMONTEE_APRES_CLOTURE', 'ECART_CAISSE', 'FOND_NON_COMPTE', 'PLAGE_EPUISEE', 'PRIX_DIVERGENT', 'ORDONNANCE_NON_CONFIRMEE', 'VENTE_UNITE_INTERDITE', 'PRODUIT_ARCHIVE', 'EVENEMENT_REJETE', 'SEQUENCE_MANQUANTE');

-- CreateEnum
CREATE TYPE "StatutAnomalie" AS ENUM ('OUVERTE', 'TRAITEE');

-- CreateTable
CREATE TABLE "PointDeVente" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "nom" TEXT NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointDeVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poste" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "type" "TypePoste" NOT NULL,
    "appareilId" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "derniereSequenceAppliquee" INTEGER NOT NULL DEFAULT 0,
    "dernierContactLe" TIMESTAMP(3),
    "dernierEtat" JSONB,
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Poste_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompteurTicket" (
    "pointDeVenteId" TEXT NOT NULL,
    "prochainNumero" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "CompteurTicket_pkey" PRIMARY KEY ("pointDeVenteId")
);

-- CreateTable
CREATE TABLE "PlageTicket" (
    "id" TEXT NOT NULL,
    "posteId" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "debut" INTEGER NOT NULL,
    "fin" INTEGER NOT NULL,
    "attribueeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attribueeParId" TEXT,

    CONSTRAINT "PlageTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametresPharmacie" (
    "structureId" TEXT NOT NULL,
    "horizonsPeremptionJours" INTEGER[] DEFAULT ARRAY[90, 30, 7]::INTEGER[],
    "seuilEcartCaisse" INTEGER NOT NULL DEFAULT 5000,
    "seuilAvertissementPrixPct" INTEGER NOT NULL DEFAULT 25,
    "seuilStockBas" INTEGER NOT NULL DEFAULT 10,
    "taillePlageTickets" INTEGER NOT NULL DEFAULT 1000,
    "seuilRechargementPlagePct" INTEGER NOT NULL DEFAULT 20,
    "debutFiabiliteMarge" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "debutCaisse" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "misAJourParId" TEXT,

    CONSTRAINT "ParametresPharmacie_pkey" PRIMARY KEY ("structureId")
);

-- CreateTable
CREATE TABLE "ModePaiement" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "comptagePhysique" BOOLEAN NOT NULL,
    "referenceAutorisee" BOOLEAN NOT NULL,
    "ordre" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModePaiement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoupureMonnaie" (
    "id" TEXT NOT NULL,
    "devise" TEXT NOT NULL DEFAULT 'GNF',
    "valeurFaciale" INTEGER NOT NULL,
    "type" "TypeCoupure" NOT NULL,
    "ordre" INTEGER NOT NULL,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CoupureMonnaie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" TEXT NOT NULL,
    "structureId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Anomalie" (
    "id" TEXT NOT NULL,
    "pointDeVenteId" TEXT NOT NULL,
    "type" "TypeAnomalie" NOT NULL,
    "statut" "StatutAnomalie" NOT NULL DEFAULT 'OUVERTE',
    "attribueeAId" TEXT,
    "pieceType" TEXT NOT NULL,
    "pieceId" TEXT,
    "details" JSONB NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteeLe" TIMESTAMP(3),
    "traiteeParId" TEXT,
    "commentaireTraitement" TEXT,

    CONSTRAINT "Anomalie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointDeVente_structureId_idx" ON "PointDeVente"("structureId");

-- CreateIndex
CREATE UNIQUE INDEX "PointDeVente_structureId_ordre_key" ON "PointDeVente"("structureId", "ordre");

-- CreateIndex
CREATE UNIQUE INDEX "Poste_pointDeVenteId_code_key" ON "Poste"("pointDeVenteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Poste_pointDeVenteId_appareilId_key" ON "Poste"("pointDeVenteId", "appareilId");

-- CreateIndex
CREATE INDEX "PlageTicket_posteId_idx" ON "PlageTicket"("posteId");

-- CreateIndex
CREATE UNIQUE INDEX "ModePaiement_code_key" ON "ModePaiement"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CoupureMonnaie_devise_valeurFaciale_key" ON "CoupureMonnaie"("devise", "valeurFaciale");

-- CreateIndex
CREATE UNIQUE INDEX "Fournisseur_structureId_nom_key" ON "Fournisseur"("structureId", "nom");

-- CreateIndex
CREATE INDEX "Anomalie_pointDeVenteId_statut_creeLe_idx" ON "Anomalie"("pointDeVenteId", "statut", "creeLe");

-- AddForeignKey
ALTER TABLE "PointDeVente" ADD CONSTRAINT "PointDeVente_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poste" ADD CONSTRAINT "Poste_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompteurTicket" ADD CONSTRAINT "CompteurTicket_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_posteId_fkey" FOREIGN KEY ("posteId") REFERENCES "Poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParametresPharmacie" ADD CONSTRAINT "ParametresPharmacie_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fournisseur" ADD CONSTRAINT "Fournisseur_structureId_fkey" FOREIGN KEY ("structureId") REFERENCES "Structure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Anomalie" ADD CONSTRAINT "Anomalie_pointDeVenteId_fkey" FOREIGN KEY ("pointDeVenteId") REFERENCES "PointDeVente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Une plage de tickets n'est jamais inversée (fin incluse).
ALTER TABLE "PlageTicket" ADD CONSTRAINT "PlageTicket_fin_debut_check" CHECK ("fin" >= "debut");

-- Reprise (D421) : un point de vente (ordre 1) par pharmacie, son poste technique REPRISE
-- (inactif, porteur des ventes historiques à partir de M6), son compteur de tickets et ses paramètres.
INSERT INTO "PointDeVente" ("id", "structureId", "ordre", "nom")
SELECT gen_random_uuid()::text, s."id", 1, s."nom"
FROM "Structure" s
WHERE s."type" = 'PHARMACIE';

INSERT INTO "Poste" ("id", "pointDeVenteId", "code", "libelle", "type", "actif")
SELECT gen_random_uuid()::text, pv."id", 'REPRISE', 'Reprise des ventes historiques', 'TECHNIQUE', false
FROM "PointDeVente" pv;

INSERT INTO "CompteurTicket" ("pointDeVenteId")
SELECT pv."id" FROM "PointDeVente" pv;

INSERT INTO "ParametresPharmacie" ("structureId")
SELECT s."id" FROM "Structure" s WHERE s."type" = 'PHARMACIE';

-- Référentiels globaux : 3 modes de paiement (O7) ; 6 billets (correction du porteur : rien sous 500 GNF).
INSERT INTO "ModePaiement" ("id", "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre")
VALUES
  (gen_random_uuid()::text, 'ESPECES', 'Espèces', true, false, 1),
  (gen_random_uuid()::text, 'ORANGE_MONEY', 'Orange Money', false, true, 2),
  (gen_random_uuid()::text, 'MTN_MOMO', 'MTN MoMo', false, true, 3);

INSERT INTO "CoupureMonnaie" ("id", "devise", "valeurFaciale", "type", "ordre")
VALUES
  (gen_random_uuid()::text, 'GNF', 20000, 'BILLET', 1),
  (gen_random_uuid()::text, 'GNF', 10000, 'BILLET', 2),
  (gen_random_uuid()::text, 'GNF', 5000, 'BILLET', 3),
  (gen_random_uuid()::text, 'GNF', 2000, 'BILLET', 4),
  (gen_random_uuid()::text, 'GNF', 1000, 'BILLET', 5),
  (gen_random_uuid()::text, 'GNF', 500, 'BILLET', 6);

COMMIT;
```

Créer `prisma/retours-arriere/20261026100000_pharmacie_t1_points_de_vente.down.sql`, contenu exact :

```sql
-- Retour arrière de 20261026100000_pharmacie_t1_points_de_vente (PB05, M2).
-- Supprime les tables et les types de M2 (pertes : postes enregistrés, paramètres modifiés,
-- fournisseurs et anomalies). PostgreSQL le refuse tant qu'une migration suivante y fait
-- référence : défaire d'abord les suivantes, dans l'ordre inverse. À suivre du redéploiement
-- du code précédent. Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

DROP TABLE "Anomalie";
DROP TABLE "PlageTicket";
DROP TABLE "CompteurTicket";
DROP TABLE "Poste";
DROP TABLE "PointDeVente";
DROP TABLE "ParametresPharmacie";
DROP TABLE "Fournisseur";
DROP TABLE "CoupureMonnaie";
DROP TABLE "ModePaiement";

DROP TYPE "StatutAnomalie";
DROP TYPE "TypeAnomalie";
DROP TYPE "TypeCoupure";
DROP TYPE "TypePoste";

COMMIT;
```

Ne pas modifier `prisma/retours-arriere/README.md`.

### 3. Fonctions communes (créer `src/pharmacie/point-de-vente.ts`)

Contenu exact :

```ts
import type {
  ParametresPharmacie,
  PointDeVente,
  Prisma,
} from 'generated/prisma/client';

/** Poste technique qui porte les ventes d'avant la tranche (D421, D484). */
export const CODE_POSTE_REPRISE = 'REPRISE';
export const LIBELLE_POSTE_REPRISE = 'Reprise des ventes historiques';

export interface PointDeVenteAssure {
  pointDeVente: PointDeVente;
  parametres: ParametresPharmacie;
}

/**
 * Crée, s'ils manquent, le point de vente (ordre 1) d'une pharmacie, son poste
 * technique REPRISE, son compteur de tickets et ses paramètres (D478). Idempotent :
 * upserts sans mise à jour, mêmes lignes que la migration M2. L'appelant vérifie
 * que la structure est une PHARMACIE.
 */
export async function assurerPointDeVente(
  tx: Prisma.TransactionClient,
  structure: { id: string; nom: string },
): Promise<PointDeVenteAssure> {
  const pointDeVente = await tx.pointDeVente.upsert({
    where: { structureId_ordre: { structureId: structure.id, ordre: 1 } },
    create: { structureId: structure.id, ordre: 1, nom: structure.nom },
    update: {},
  });
  await tx.poste.upsert({
    where: {
      pointDeVenteId_code: {
        pointDeVenteId: pointDeVente.id,
        code: CODE_POSTE_REPRISE,
      },
    },
    create: {
      pointDeVenteId: pointDeVente.id,
      code: CODE_POSTE_REPRISE,
      libelle: LIBELLE_POSTE_REPRISE,
      type: 'TECHNIQUE',
      actif: false,
    },
    update: {},
  });
  await tx.compteurTicket.upsert({
    where: { pointDeVenteId: pointDeVente.id },
    create: { pointDeVenteId: pointDeVente.id },
    update: {},
  });
  const parametres = await tx.parametresPharmacie.upsert({
    where: { structureId: structure.id },
    create: { structureId: structure.id },
    update: {},
  });
  return { pointDeVente, parametres };
}

/**
 * Supprime la configuration de caisse des structures données, dans l'ordre des
 * clés étrangères (toutes en Restrict) ; à appeler juste avant de supprimer ces
 * structures (D479). Liste vide : aucune requête.
 */
export async function supprimerConfigurationPharmacies(
  tx: Prisma.TransactionClient,
  structureIds: string[],
): Promise<void> {
  if (structureIds.length === 0) return;
  const parPointDeVente = {
    pointDeVente: { structureId: { in: structureIds } },
  };
  const parStructure = { structureId: { in: structureIds } };
  await tx.anomalie.deleteMany({ where: parPointDeVente });
  await tx.plageTicket.deleteMany({ where: parPointDeVente });
  await tx.poste.deleteMany({ where: parPointDeVente });
  await tx.compteurTicket.deleteMany({ where: parPointDeVente });
  await tx.pointDeVente.deleteMany({ where: parStructure });
  await tx.parametresPharmacie.deleteMany({ where: parStructure });
  await tx.fournisseur.deleteMany({ where: parStructure });
}
```

Si `tsc` refuse l'un des objets `where` partagés, écrire l'objet en littéral à chaque appel (même contenu), sans `any` ni `as`.

### 4. Branchements de création et de suppression

**`src/super-admin/super-admin.service.ts`** :
- import : `import { assurerPointDeVente, supprimerConfigurationPharmacies } from 'src/pharmacie/point-de-vente';`
- `createStructure` : juste après le bloc `try/catch` du seed des rôles et avant le bloc d'envoi de l'email, insérer :

```ts
    // Point de vente, poste de reprise, compteur et paramètres d'une pharmacie (D478).
    // Non bloquant : le démarrage suivant ou le premier accès aux routes de caisse le rattrape.
    if (structure.type === 'PHARMACIE') {
      try {
        await this.prisma.$transaction((tx) =>
          assurerPointDeVente(tx, structure),
        );
      } catch {
        this.logger.error(
          `superadmin.point_de_vente_echec structureId=${structure.id}`,
        );
      }
    }
```
- `deleteStructure` : dans la transaction, juste avant le commentaire `// 3. Supprimer la structure`, insérer :

```ts
      // Configuration de caisse d'une pharmacie (clés étrangères en Restrict, D479).
      await supprimerConfigurationPharmacies(tx, [structureId]);
```
Rien d'autre ne change dans ce fichier (réponses et messages identiques).

**`src/demo/demo.seeder.ts`** :
- import : `import { assurerPointDeVente, supprimerConfigurationPharmacies } from 'src/pharmacie/point-de-vente';`
- `inserer` : juste après l'appel `await tx.structure.createMany({ ... });` de l'étape 1, insérer :

```ts

    // 1 bis. Point de vente, poste de reprise, compteur et paramètres des pharmacies (D478)
    for (const s of STRUCTURES_DEMO.filter((x) => x.type === 'PHARMACIE')) {
      await assurerPointDeVente(tx, { id: structureId(s.cle), nom: s.nom });
    }
```
- `purger` : entre `const comptesSupprimes = await tx.user.deleteMany({ where: filtre });` et `const structuresSupprimees = await tx.structure.deleteMany({`, insérer :

```ts
    // Configuration de caisse des pharmacies démo (clés étrangères en Restrict, D479).
    const structuresDemo = await tx.structure.findMany({
      where: filtre,
      select: { id: true },
    });
    await supprimerConfigurationPharmacies(
      tx,
      structuresDemo.map((s) => s.id),
    );
```
- Commentaire de `purger` : remplacer la phrase « Les journaux d'audit de ces comptes sont supprimés explicitement (leur clé étrangère est en SET NULL) ; » par « Les journaux d'audit de ces comptes sont supprimés explicitement (leur clé étrangère est en SET NULL), de même que la configuration de caisse des pharmacies (points de vente, postes, compteurs, plages, paramètres, fournisseurs, anomalies : clés étrangères en Restrict) ; ». Si la phrase est coupée sur deux lignes dans le fichier, garder la coupure la plus proche, même texte.

### 5. Codes d'erreur (`src/common/filters/codes-erreur.ts`)

À la fin de `CODES_ERREUR`, après `'ANNULATION_HORS_DELAI',`, ajouter :

```ts
  // Appareil déjà enregistré comme un autre type de poste de caisse (409).
  'POSTE_TYPE_DIFFERENT',
```
Ne pas l'ajouter à `CODES_AVEC_DETAILS` (aucun `details`).

### 6. Routes (créer DTO, service, contrôleur ; modifier le module)

**a. `src/pharmacie/dto/points-de-vente.dto.ts`** (créer) :

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Identifiant stable d'un appareil : même alphabet que Idempotency-Key. */
export const MOTIF_APPAREIL_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export const TYPES_POSTE_ENREGISTRABLES = ['WEB', 'DESKTOP'] as const;
export type TypePosteEnregistrable = (typeof TYPES_POSTE_ENREGISTRABLES)[number];

export class EnregistrerPosteDto {
  @ApiProperty({ enum: TYPES_POSTE_ENREGISTRABLES, example: 'WEB' })
  @IsIn(TYPES_POSTE_ENREGISTRABLES)
  type: TypePosteEnregistrable;

  @ApiProperty({
    description:
      'Identifiant stable de l’appareil (navigateur et utilisateur pour le web, installation pour le desktop) : 8 à 128 caractères parmi lettres, chiffres, . _ : -',
    example: 'web-3f2b8c1e-5a47-4d9e-9b1a-7c6d2e8f0a11',
  })
  @IsString()
  @Matches(MOTIF_APPAREIL_ID)
  appareilId: string;

  @ApiPropertyOptional({ example: 'Comptoir principal', maxLength: 60 })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @Length(1, 60)
  libelle?: string;
}

export class ModifierPosteDto {
  @ApiPropertyOptional({ example: 'Comptoir principal', maxLength: 60 })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @Length(1, 60)
  libelle?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  actif?: boolean;
}

export class ModifierParametresDto {
  @ApiPropertyOptional({
    type: [Number],
    example: [90, 30, 7],
    description: 'Horizons d’alerte de péremption en jours : 1 à 5 valeurs distinctes de 1 à 365',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(365, { each: true })
  horizonsPeremptionJours?: number[];

  @ApiPropertyOptional({ example: 5000, description: 'GNF, 0 à 10 000 000' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  seuilEcartCaisse?: number;

  @ApiPropertyOptional({ example: 25, description: 'Pourcentage, 1 à 100' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  seuilAvertissementPrixPct?: number;

  @ApiPropertyOptional({ example: 10, description: 'En boîtes, 0 à 10 000' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  seuilStockBas?: number;

  @ApiPropertyOptional({ example: 1000, description: '100 à 10 000 numéros' })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(10_000)
  taillePlageTickets?: number;

  @ApiPropertyOptional({ example: 20, description: 'Pourcentage, 5 à 50' })
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(50)
  seuilRechargementPlagePct?: number;
}
```

**b. `src/pharmacie/points-de-vente.service.ts`** (créer). Exports, signatures et règles exactes :

```ts
export const MESSAGE_POSTE_INTROUVABLE = 'Ce poste est introuvable.';
export const MESSAGE_POSTE_TYPE_DIFFERENT =
  'Cet appareil est déjà enregistré comme un autre type de poste.';

export interface ParametresReponse {
  horizonsPeremptionJours: number[];
  seuilEcartCaisse: number;
  seuilAvertissementPrixPct: number;
  seuilStockBas: number;
  taillePlageTickets: number;
  seuilRechargementPlagePct: number;
  debutFiabiliteMarge: Date;
  debutCaisse: Date;
}

export interface ReferentielsCaisse {
  modesPaiement: {
    code: string;
    libelle: string;
    comptagePhysique: boolean;
    referenceAutorisee: boolean;
    ordre: number;
  }[];
  coupures: {
    devise: string;
    valeurFaciale: number;
    type: TypeCoupure; // import type { TypeCoupure } from 'generated/prisma/enums'
    ordre: number;
  }[];
  parametres: ParametresReponse;
}

export interface PosteReponse {
  id: string;
  code: string;
  libelle: string;
  type: TypePoste; // import type { TypePoste } from 'generated/prisma/enums'
  actif: boolean;
  appareilId: string | null;
  derniereSequenceAppliquee: number;
  dernierContactLe: Date | null;
  dernierEtat: Prisma.JsonValue | null;
  createdAt: Date;
}

interface Reponse<T> {
  data: T;
  message: string;
  success: true;
}

@Injectable()
export class PointsDeVenteService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PointsDeVenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accesPharmacie: AccesPharmacieService,
  ) {}

  async onApplicationBootstrap(): Promise<void>;
  async completerPointsDeVente(): Promise<number>;
  async referentiels(structureId: string, userId: string): Promise<Reponse<ReferentielsCaisse>>;
  async parametres(structureId: string, userId: string): Promise<Reponse<ParametresReponse>>;
  async modifierParametres(structureId: string, userId: string, dto: ModifierParametresDto, ip?: string): Promise<Reponse<ParametresReponse>>;
  async enregistrerPoste(structureId: string, userId: string, dto: EnregistrerPosteDto, ip?: string): Promise<Reponse<PosteReponse & { cree: boolean }>>;
  async listerPostes(structureId: string, userId: string): Promise<Reponse<PosteReponse[]>>;
  async modifierPoste(structureId: string, userId: string, posteId: string, dto: ModifierPosteDto, ip?: string): Promise<Reponse<PosteReponse>>;
}
```

Fonctions privées du fichier (non exportées) :
- `versParametresReponse(p: ParametresPharmacie): ParametresReponse` : copie des 8 champs, rien d'autre (ni `structureId`, ni `updatedAt`, ni `misAJourParId`).
- `versPosteReponse(p: Poste): PosteReponse` : copie des 10 champs, rien d'autre (ni `pointDeVenteId`, ni `enregistreParId`).
- `libelleParDefaut(type: TypePosteEnregistrable, code: string, prenom: string): string` : WEB : `prenom.trim()` non vide donne `Navigateur de ${prenom.trim()}`, sinon `Navigateur` ; DESKTOP : `Poste ${code}` ; résultat tronqué à 60 caractères (`slice(0, 60)`).
- méthode privée `lireParametres(structure: { id: string; nom: string }): Promise<ParametresPharmacie>` : `this.prisma.parametresPharmacie.findUnique({ where: { structureId: structure.id } })` ; si absent : `(await this.prisma.$transaction((tx) => assurerPointDeVente(tx, structure))).parametres`.

Règles, dans l'ordre :

1. `onApplicationBootstrap` : `try { await this.completerPointsDeVente(); } catch (e) { this.logger.error(`Complément des points de vente échoué (l'app démarre quand même) : ${e instanceof Error ? e.message : 'raison inconnue'}`); }` (jamais de levée).
2. `completerPointsDeVente` : `this.prisma.structure.findMany({ where: { type: 'PHARMACIE', OR: [{ pointsDeVente: { none: {} } }, { parametresPharmacie: { is: null } }] }, select: { id: true, nom: true }, orderBy: { id: 'asc' } })` ; pour chacune, dans l'ordre : `await this.prisma.$transaction((tx) => assurerPointDeVente(tx, pharmacie))` ; si au moins une : `this.logger.log(`Points de vente complétés pour ${n} pharmacie(s).`)` ; renvoie `n`.
3. `referentiels` : `const { structure } = await this.accesPharmacie.verifier(structureId, userId)` ; en parallèle (`Promise.all`) : `modePaiement.findMany({ where: { actif: true }, orderBy: [{ ordre: 'asc' }, { code: 'asc' }], select: { code: true, libelle: true, comptagePhysique: true, referenceAutorisee: true, ordre: true } })`, `coupureMonnaie.findMany({ where: { actif: true }, orderBy: [{ ordre: 'asc' }, { valeurFaciale: 'desc' }], select: { devise: true, valeurFaciale: true, type: true, ordre: true } })`, `this.lireParametres(structure)`. Réponse `{ data: { modesPaiement, coupures, parametres: versParametresReponse(...) }, message: 'Référentiels de caisse.', success: true }`.
4. `parametres` : vérifier, `lireParametres`, réponse `{ data: versParametresReponse(...), message: 'Paramètres de la pharmacie.', success: true }`.
5. `modifierParametres` : `const { user, structure } = await verifier(...)` ; dans `this.prisma.$transaction(async (tx) => ...)` :
   - `existants = (await tx.parametresPharmacie.findUnique({ where: { structureId: structure.id } })) ?? (await assurerPointDeVente(tx, structure)).parametres` ;
   - `voulus` = objet des 6 champs modifiables (`horizonsPeremptionJours`, `seuilEcartCaisse`, `seuilAvertissementPrixPct`, `seuilStockBas`, `taillePlageTickets`, `seuilRechargementPlagePct`) : valeur du DTO si définie, sinon valeur existante ; `horizonsPeremptionJours` du DTO rangé en ordre décroissant (`[...v].sort((a, b) => b - a)`) ;
   - champs changés = ceux dont `JSON.stringify(voulus[c]) !== JSON.stringify(existants[c])` ; aucun : renvoyer `existants` sans écrire ;
   - sinon `tx.parametresPharmacie.update({ where: { structureId: structure.id }, data: { ...voulus, misAJourParId: user.id } })` puis `tx.auditLog.create({ data: { userId: user.id, action: 'update', entityType: 'ParametresPharmacie', entityId: structure.id, ip: ip ?? null, metadata: { avant, apres } } })` où `avant` et `apres` ne portent que les champs changés (valeurs existantes et nouvelles) ;
   - réponse `{ data: versParametresReponse(resultat), message: 'Paramètres enregistrés.', success: true }`.
6. `enregistrerPoste` : `const { user, structure } = await verifier(...)` ; dans une transaction :
   - `pointDeVente = (await tx.pointDeVente.findFirst({ where: { structureId: structure.id }, orderBy: { ordre: 'asc' } })) ?? (await assurerPointDeVente(tx, structure)).pointDeVente` ;
   - verrou : `await tx.$queryRaw`SELECT "id" FROM "PointDeVente" WHERE "id" = ${pointDeVente.id} FOR UPDATE`` ;
   - `existant = await tx.poste.findFirst({ where: { pointDeVenteId: pointDeVente.id, appareilId: dto.appareilId } })` ; s'il existe : type différent de `dto.type` : `throw new ConflictException({ message: MESSAGE_POSTE_TYPE_DIFFERENT, code: 'POSTE_TYPE_DIFFERENT' })` ; sinon renvoyer `{ poste: existant, cree: false }` sans rien écrire (libellé fourni ignoré, poste inactif non réactivé) ;
   - sinon `rang = (await tx.poste.count({ where: { pointDeVenteId: pointDeVente.id, type: dto.type } })) + 1`, `code = (dto.type === 'WEB' ? 'W' : 'D') + rang`, `tx.poste.create({ data: { pointDeVenteId: pointDeVente.id, code, libelle: dto.libelle ?? libelleParDefaut(dto.type, code, user.prenom), type: dto.type, appareilId: dto.appareilId, enregistreParId: user.id } })`, audit `{ action: 'create', entityType: 'Poste', entityId: poste.id, metadata: { code, type: dto.type } }` ; renvoyer `{ poste, cree: true }` ;
   - réponse `{ data: { ...versPosteReponse(poste), cree }, message: cree ? 'Poste enregistré.' : 'Ce poste était déjà enregistré.', success: true }`.
7. `listerPostes` : vérifier ; `this.prisma.poste.findMany({ where: { pointDeVente: { structureId: structure.id }, type: { not: 'TECHNIQUE' } }, orderBy: [{ createdAt: 'asc' }, { code: 'asc' }] })` ; réponse `{ data: postes.map(versPosteReponse), message: `${postes.length} poste(s).`, success: true }`.
8. `modifierPoste` : `const { user, structure } = await verifier(...)` ; dans une transaction : `poste = await tx.poste.findFirst({ where: { id: posteId, type: { not: 'TECHNIQUE' }, pointDeVente: { structureId: structure.id } } })` ; absent : `throw new NotFoundException(MESSAGE_POSTE_INTROUVABLE)` ; champs changés : `libelle` si défini et différent, `actif` si défini et différent ; aucun : renvoyer `poste` sans écrire ; sinon `tx.poste.update({ where: { id: poste.id }, data: changements })` et audit `{ action: 'update', entityType: 'Poste', entityId: poste.id, metadata: { avant, apres } }` (seulement les champs changés) ; réponse `{ data: versPosteReponse(resultat), message: 'Poste mis à jour.', success: true }`.

Importer `assurerPointDeVente` depuis `./point-de-vente`, `AccesPharmacieService` depuis `./acces-pharmacie.service`, `PrismaService` depuis `src/common/services/prisma.service`, les types de modèle (`ParametresPharmacie`, `Poste`, `Prisma`) depuis `generated/prisma/client`. Aucun `any`, aucun `as unknown as`, aucun `console.*`.

**c. `src/pharmacie/points-de-vente.controller.ts`** (créer), modèle `vente.controller.ts` :

```ts
@ApiTags('Pharmacie : caisse')
@ApiBearerAuth()
@Controller('pharmacie')
@UseGuards(AuthGuard, PermissionsGuard)
export class PointsDeVenteController {
  constructor(private readonly pointsDeVente: PointsDeVenteService) {}
}
```

| Méthode, chemin | Décorateurs | Appel |
|---|---|---|
| `@Get(':structureId/referentiels')` | `@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)`, `@ApiOperation({ summary: 'Référentiels de caisse : modes de paiement, coupures et paramètres' })` | `referentiels(structureId, req.user.userId)` |
| `@Get(':structureId/parametres')` | `@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)`, `@ApiOperation({ summary: 'Paramètres de la pharmacie' })` | `parametres(structureId, req.user.userId)` |
| `@Patch(':structureId/parametres')` | `@RequirePermissions(PERMISSIONS.STRUCTURE_WRITE)`, `@ApiOperation({ summary: 'Modifier les paramètres de la pharmacie' })` | `modifierParametres(structureId, req.user.userId, dto, ip)` |
| `@Post(':structureId/postes')` | `@RequirePermissions(PERMISSIONS.CAISSE_UTILISER)`, `@HttpCode(HttpStatus.OK)`, `@ApiOperation({ summary: 'Enregistrer le poste de caisse de cet appareil', description: 'Idempotent par appareilId : un appareil déjà enregistré renvoie son poste (data.cree faux).' })`, `@ApiResponse({ status: 409, description: 'Appareil déjà enregistré comme un autre type de poste (POSTE_TYPE_DIFFERENT).' })` | `enregistrerPoste(structureId, req.user.userId, dto, ip)` |
| `@Get(':structureId/postes')` | `@RequirePermissions(PERMISSIONS.CAISSE_SUPERVISER)`, `@ApiOperation({ summary: 'Postes de caisse de la pharmacie' })` | `listerPostes(structureId, req.user.userId)` |
| `@Patch(':structureId/postes/:posteId')` | `@RequirePermissions(PERMISSIONS.STRUCTURE_WRITE)`, `@ApiOperation({ summary: 'Modifier un poste de caisse' })`, `@ApiResponse({ status: 404, description: 'Poste inconnu, technique ou d’une autre pharmacie.' })` | `modifierPoste(structureId, req.user.userId, posteId, dto, ip)` |

Paramètres : `@Req() req: RequestWithUser`, `@Param('structureId') structureId: string`, `@Param('posteId') posteId: string`, `@Body() dto` typé par le DTO de la section 6a, `@Ip() ip: string`. Chaque route porte `@ApiParam({ name: 'structureId', description: 'Identifiant de la pharmacie' })` (et `posteId` pour le PATCH).

**d. `src/pharmacie/pharmacie.module.ts`** : ajouter `PointsDeVenteController` à `controllers` (après `VenteController`) et `PointsDeVenteService` à `providers` (après `AccesPharmacieService`). Pas d'`exports`.

### 7. Tests

Noms exacts. Aucun `console.log`, aucune assertion sur une URL (D454), aucun `it.only` ni `it.skip`.

**a. `src/pharmacie/point-de-vente.spec.ts`** (créer), `describe('Point de vente : fonctions communes')`, faux `tx` dont chaque méthode est un `jest.fn` (`upsert` du point de vente renvoie `{ id: 'pv1' }`, celui des paramètres `{ structureId: 's1', seuilStockBas: 10 }`, les autres `{}` ; `deleteMany` renvoie `{ count: 0 }`), passé par `tx as unknown as Prisma.TransactionClient` :
1. `'1. assurerPointDeVente : point de vente d ordre 1, poste REPRISE inactif, compteur et paramètres, sans mise à jour'` : arguments exacts des 4 `upsert` (`where`, `create`, `update: {}`), dans cet ordre (`invocationCallOrder` croissant).
2. `'2. assurerPointDeVente : renvoie le point de vente et les paramètres'` : `toEqual({ pointDeVente: { id: 'pv1' }, parametres: { structureId: 's1', seuilStockBas: 10 } })`.
3. `'3. supprimerConfigurationPharmacies : ordre des suppressions et filtres'` : avec `['s1', 's2']`, ordre anomalie, plage, poste, compteur, point de vente, paramètres, fournisseur ; `anomalie.deleteMany` appelé avec `{ where: { pointDeVente: { structureId: { in: ['s1', 's2'] } } } }`, `pointDeVente.deleteMany` avec `{ where: { structureId: { in: ['s1', 's2'] } } }`.
4. `'4. supprimerConfigurationPharmacies : liste vide, aucune requête'` : aucun `deleteMany` appelé.

**b. `src/pharmacie/points-de-vente.http.spec.ts`** (créer), modèle exact de `vente.http.spec.ts` (vrai `PermissionsGuard`, vrai `PermissionsService`, Prisma et Redis simulés, `AuthGuard` remplacé par l'en-tête `x-essai-user`, même `ValidationPipe` et `AllExceptionsFilter`), `PointsDeVenteService` simulé (`referentiels`, `parametres`, `modifierParametres`, `enregistrerPoste`, `listerPostes`, `modifierPoste`, chacun résolu en `{ data: {}, message: 'ok', success: true }` dans `beforeEach`). Profils : `hopital` (`HOPITAL`, `['caisse:utiliser', 'caisse:superviser', 'structure:write']`), `pharmacien` (`PHARMACIE`, `['stock:read', 'stock:write', 'vente:read', 'vente:write', 'caisse:utiliser']`), `admin` (`PHARMACIE`, `['vente:read', 'caisse:utiliser', 'caisse:superviser', 'structure:write']`). `describe('Points de vente, postes et référentiels (HTTP)')` :
1. `'1. membre d un hôpital avec les permissions de caisse : 403 PERMISSION_REFUSEE'` : `GET /pharmacie/s1/referentiels`, `GET /pharmacie/s1/parametres`, `POST /pharmacie/s1/postes` (corps valide `{ type: 'WEB', appareilId: 'navigateur-essai-0001' }`), `GET /pharmacie/s1/postes` : 403, `code` `PERMISSION_REFUSEE`, aucun appel au service.
2. `'2. pharmacien : référentiels, paramètres et enregistrement de poste acceptés, 200 même à la création'` : les trois requêtes répondent 200 ; `referentiels` appelé avec `('s1', 'pharmacien')`, `parametres` avec `('s1', 'pharmacien')`, `enregistrerPoste` avec `('s1', 'pharmacien', expect.objectContaining({ type: 'WEB', appareilId: 'navigateur-essai-0001' }), expect.any(String))`.
3. `'3. pharmacien : liste des postes, modification d un poste et des paramètres refusées'` : `GET /pharmacie/s1/postes`, `PATCH /pharmacie/s1/postes/p1` (`{ actif: false }`), `PATCH /pharmacie/s1/parametres` (`{ seuilStockBas: 5 }`) : 403 ; aucun appel.
4. `'4. titulaire : liste des postes, modification d un poste et des paramètres acceptées'` : 200 ; `listerPostes` avec `('s1', 'admin')`, `modifierPoste` avec `('s1', 'admin', 'p1', expect.objectContaining({ libelle: 'Caisse 1', actif: false }), expect.any(String))` pour le corps `{ libelle: '  Caisse 1  ', actif: false }` (libellé rogné), `modifierParametres` avec `('s1', 'admin', expect.objectContaining({ seuilStockBas: 5 }), expect.any(String))`.
5. `'5. enregistrement de poste : type, appareilId, libellé et champ inconnu refusés (VALIDATION)'` : en `pharmacien`, chaque corps répond 400, `code` `VALIDATION`, et `champs` contient le champ et la contrainte indiqués : `{ type: 'TECHNIQUE', appareilId: 'navigateur-essai-0001' }` (`type`, `isIn`) ; `{ type: 'WEB', appareilId: 'court' }` (`appareilId`, `matches`) ; `{ type: 'WEB', appareilId: 'navigateur-essai-0001', libelle: '   ' }` (`libelle`, contrainte non vérifiée) ; `{ type: 'WEB', appareilId: 'navigateur-essai-0001', posteId: 'x' }` (`posteId`, `whitelistValidation`) ; aucun appel au service.
6. `'6. paramètres : valeurs hors bornes et dates non modifiables refusées (VALIDATION)'` : en `admin`, 400 `VALIDATION` avec : `{ horizonsPeremptionJours: [] }` (`horizonsPeremptionJours`, `arrayMinSize`), `{ horizonsPeremptionJours: [30, 30] }` (`arrayUnique`), `{ horizonsPeremptionJours: [0] }` (`min`), `{ seuilEcartCaisse: -1 }` (`seuilEcartCaisse`, `min`), `{ taillePlageTickets: 50 }` (`taillePlageTickets`, `min`), `{ seuilAvertissementPrixPct: 2.5 }` (`seuilAvertissementPrixPct`, `isInt`), `{ debutCaisse: '2026-01-01' }` (`debutCaisse`, `whitelistValidation`) ; aucun appel.
7. `'7. modification de poste : actif non booléen refusé'` : `PATCH /pharmacie/s1/postes/p1` `{ actif: 'oui' }` en `admin` : 400, champ `actif`, contrainte `isBoolean`.

**c. `src/super-admin/super-admin.service.spec.ts`** (modifier) : ajouter `$transaction: jest.Mock` au type `prisma` et au `beforeEach` (`$transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(tx))`, `tx` = `{ pointDeVente: { upsert: jest.fn().mockResolvedValue({ id: 'pv1' }) }, poste: { upsert: jest.fn().mockResolvedValue({}) }, compteurTicket: { upsert: jest.fn().mockResolvedValue({}) }, parametresPharmacie: { upsert: jest.fn().mockResolvedValue({}) } }` déclaré au niveau du `describe`). Dans `describe('createStructure')`, ajouter :
1. `'pharmacie : point de vente, poste de reprise, compteur et paramètres créés dans une transaction'` : `structure.create` résout une fois `{ id: 's1', nom: 'Pharmacie Test', type: 'PHARMACIE', email: 'pharmacie@exemple.gn', isConfigured: false, createdAt: new Date() }`, dto `type: 'PHARMACIE'`, email envoyé ; `$transaction` appelé une fois ; `tx.pointDeVente.upsert` appelé avec `expect.objectContaining({ where: { structureId_ordre: { structureId: 's1', ordre: 1 } }, create: { structureId: 's1', ordre: 1, nom: 'Pharmacie Test' } })` ; `tx.poste.upsert` avec `expect.objectContaining({ create: expect.objectContaining({ code: 'REPRISE', type: 'TECHNIQUE', actif: false }) })` ; réponse `success` vrai.
2. `'pharmacie : échec du point de vente, la structure reste créée et l échec est journalisé'` : même structure, `$transaction` rejeté une fois ; `success` vrai, `data.id` `'s1'`, `logError` appelé avec `'superadmin.point_de_vente_echec structureId=s1'`.
3. `'clinique : aucun point de vente'` : dto existant (`CLINIQUE`), `$transaction` non appelé.

**d. `src/demo/demo.seeder.spec.ts`** (modifier), dans le `describe` de la remise à zéro (celui qui contient « mode démo actif : purge le seul domaine démo… ») ajouter :
1. `'purge : la configuration de caisse des structures démo part avant les structures'` : `DEMO_MODE='true'`, `prisma.structure.findMany.mockResolvedValue([{ id: 's-pharma' }])`, `prisma.user.deleteMany` et `prisma.structure.deleteMany` résolus `{ count: 0 }` ; `await seeder.reinitialiserJeuDeDonnees()` ; `prisma.pointDeVente.deleteMany` appelé avec `{ where: { structureId: { in: ['s-pharma'] } } }` ; `prisma.parametresPharmacie.deleteMany` et `prisma.anomalie.deleteMany` appelés ; ordre d'appel de `pointDeVente.deleteMany` inférieur à celui de `structure.deleteMany`.
Et dans le `describe` de la création (celui des tests qui lisent `prisma.structure.createMany`) ajouter :
2. `'création : un point de vente par pharmacie démo, avec son nom'` : après la création habituelle, `prisma.pointDeVente.upsert` appelé autant de fois que `STRUCTURES_DEMO.filter((s) => s.type === 'PHARMACIE').length`, et l'ensemble des `create.nom` égal aux noms de ces pharmacies. Importer `STRUCTURES_DEMO` depuis `./demo.donnees` si ce n'est pas déjà fait.

**e. `test/db/fixtures/schema-courant/prisma.config.ts`** (créer), contenu exact :

```ts
// Configuration Prisma réservée au harnais (PB05, D480) : compare une base jetable
// migrée au schéma courant (prisma migrate diff). Ne lit que HARNAIS_DATABASE_URL et
// refuse toute base hors mc_test_.
import path from 'node:path';
import { defineConfig } from 'prisma/config';

const url = process.env['HARNAIS_DATABASE_URL'] ?? '';
if (!/\/mc_test_[0-9a-f]{12}(\?|$)/.test(url)) {
  throw new Error(
    'Configuration réservée au harnais de test : base mc_test_ attendue.',
  );
}

const racine = process.cwd();

export default defineConfig({
  schema: path.join(racine, 'prisma', 'schema.prisma'),
  migrations: { path: path.join(racine, 'prisma', 'migrations') },
  datasource: { url },
});
```

**f. `test/db/schema-derive.db-spec.ts`** (créer), `describe('Schéma Prisma et migrations (D480)')`, un test `'le schéma Prisma correspond exactement à la base migrée (aucune dérive)'` : `creerBaseVide()` ; `appliquerMigrations(base.client)` (toutes) ; `spawnSync(process.execPath, [path.join(RACINE_DEPOT, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'diff', '--from-config-datasource', '--to-schema', path.join(RACINE_DEPOT, 'prisma', 'schema.prisma'), '--exit-code', '--script', '--config', 'test/db/fixtures/schema-courant/prisma.config.ts'], { cwd: RACINE_DEPOT, env: { ...process.env, HARNAIS_DATABASE_URL: base.url }, encoding: 'utf8', timeout: 150000 })` ; `sortie = masquerUrls((stdout ?? '') + (stderr ?? '')).slice(0, 4000)` ; si `status !== 0` : `throw new Error(`Dérive entre prisma/schema.prisma et les migrations (statut ${String(resultat.status)}) : ${sortie}`)` ; puis `expect(resultat.status).toBe(0)` ; `supprimerBaseDeTest(base)` dans un `finally`.

**g. `test/db/m2-points-de-vente.db-spec.ts`** (créer), `describe('Migration M2, points de vente, postes et référentiels (PB05)')`. Constantes : `M1 = '20261026090000_pharmacie_t1_permissions'`, `M2 = '20261026100000_pharmacie_t1_points_de_vente'`, `TABLES_M2 = ['PointDeVente', 'Poste', 'CompteurTicket', 'PlageTicket', 'ParametresPharmacie', 'ModePaiement', 'CoupureMonnaie', 'Fournisseur', 'Anomalie']`, `TYPES_M2 = ['TypePoste', 'TypeCoupure', 'TypeAnomalie', 'StatutAnomalie']`. Fonctions locales : `lignesSql(fichier)` (identique à `m1-permissions.db-spec.ts`), `tablesPresentes(client)` = `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`, `typesPresents(client)` = `SELECT count(*)::int AS n FROM pg_type WHERE typname = ANY($1)`, `compter(client, sql)` qui renvoie `rows[0].n`. `beforeAll` : `creerBaseVide`, `appliquerMigrations(client, { jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL })`, `chargerFormatActuel`, `appliquees = await appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M2 })` (jamais au-delà de M2 : le retour arrière doit rester applicable quand M4 référencera ces tables). `afterAll` : `supprimerBaseDeTest` (modèle de `m1-permissions.db-spec.ts`). Tests, dans cet ordre :
1. `'la migration et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)'`.
2. `'M2 haut : appliquée après M1, un point de vente d ordre 1 par pharmacie, aucun pour l hôpital'` : `appliquees` `toEqual([M1, M2])` ; `SELECT "structureId", "ordre", "nom", "actif" FROM "PointDeVente" ORDER BY "structureId"` `toEqual` les 3 lignes `{ structureId: 'str-pharma-1', ordre: 1, nom: 'Pharmacie de Kaloum (harnais)', actif: true }`, Matoto pour `str-pharma-2`, Ratoma pour `str-pharma-3`.
3. `'M2 haut : un poste REPRISE technique et inactif, un compteur à 1 par point de vente, aucune plage, aucun fournisseur, aucune anomalie'` : `SELECT pv."structureId", p."code", p."libelle", p."type"::text AS "type", p."actif", p."appareilId", p."derniereSequenceAppliquee" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" ORDER BY pv."structureId"` : 3 lignes, chacune `code` `'REPRISE'`, `libelle` `'Reprise des ventes historiques'`, `type` `'TECHNIQUE'`, `actif` faux, `appareilId` nul, `derniereSequenceAppliquee` 0 ; `SELECT count(*)::int AS n FROM "CompteurTicket" c JOIN "PointDeVente" pv ON pv."id" = c."pointDeVenteId" WHERE c."prochainNumero" = 1` vaut 3 ; `PlageTicket`, `Fournisseur`, `Anomalie` : 0 ligne chacune.
4. `'M2 haut : paramètres par défaut pour chaque pharmacie (O9, seuil de stock bas en boîtes)'` : `SELECT * FROM "ParametresPharmacie" ORDER BY "structureId"` : 3 lignes (`str-pharma-1` à `-3`), chacune `horizonsPeremptionJours` `[90, 30, 7]`, `seuilEcartCaisse` 5000, `seuilAvertissementPrixPct` 25, `seuilStockBas` 10, `taillePlageTickets` 1000, `seuilRechargementPlagePct` 20, `misAJourParId` nul ; `debutFiabiliteMarge.getTime() === debutCaisse.getTime()` ; `Math.abs(Date.now() - debutCaisse.getTime()) < 10 * 60 * 1000`.
5. `'M2 haut : 3 modes de paiement et 6 billets de 20 000 à 500 GNF, rien en dessous'` : `SELECT "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre", "actif" FROM "ModePaiement" ORDER BY "ordre"` `toEqual([{ code: 'ESPECES', libelle: 'Espèces', comptagePhysique: true, referenceAutorisee: false, ordre: 1, actif: true }, { code: 'ORANGE_MONEY', libelle: 'Orange Money', comptagePhysique: false, referenceAutorisee: true, ordre: 2, actif: true }, { code: 'MTN_MOMO', libelle: 'MTN MoMo', comptagePhysique: false, referenceAutorisee: true, ordre: 3, actif: true }])` ; `SELECT "devise", "valeurFaciale", "type"::text AS "type", "ordre", "actif" FROM "CoupureMonnaie" ORDER BY "ordre"` `toEqual` les 6 lignes `GNF` `BILLET` actives de valeurs 20000, 10000, 5000, 2000, 1000, 500 et d'ordres 1 à 6 ; `SELECT count(*)::int AS n FROM "CoupureMonnaie" WHERE "valeurFaciale" < 500` vaut 0.
6. `'arrêt : les structures non pharmacies qui portent du stock ou des ventes sont listées, rien n est créé'` : sur une seconde base jetable (`creerBaseVide`, supprimée dans un `finally`) : migrations jusqu'au format, `chargerFormatActuel`, puis en SQL : `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-clinique-1', 'Clinique de Dixinn (harnais)', 'CLINIQUE', 'clinique1@harnais.test', 'Conakry', true, true, now(), now())`, `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES ('st-hopital-1', 'med-01', 'str-hopital-1', 3, true, now())`, `INSERT INTO "Vente" ("id", "structureId", "numero", "vendeurId", "vendeurNom", "total") VALUES ('vte-clinique-1', 'str-clinique-1', 'V-2026-000001', 'usr-medecin-h1', 'Mariama Sylla', 1000)` ; `appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL, jusqua: M1 })` ; puis `appliquerMigrations(client, { apres: M1, jusqua: M2 })` rejette : le message de l'erreur contient `La migration ${M2} a échoué`, `2 structure(s)` et `Structures en cause (50 au plus) : str-clinique-1, str-hopital-1` ; ensuite `tablesPresentes` 0, `typesPresents` 0, et `SELECT count(*)::int AS n FROM "Permission" WHERE "code" = 'caisse:utiliser'` vaut 1 (M1 intacte).
7. `'retour arrière : haut, bas, haut sur la base chargée'` (base principale) : nombres de `StockMedicament` et de `Vente` relevés ; `appliquerRetourArriere(client, M2)` ; `tablesPresentes` 0, `typesPresents` 0, `Permission` `caisse:utiliser` toujours 1, nombres de `StockMedicament` et `Vente` inchangés ; `appliquerMigrations(client, { apres: M1, jusqua: M2 })` `toEqual([M2])` ; `PointDeVente` 3 lignes, `Poste` 3, `ModePaiement` 3, `CoupureMonnaie` 6, `ParametresPharmacie` 3.

**h. `test/db/points-de-vente.db-spec.ts`** (créer), `describe('Points de vente, postes et référentiels sur base de test (PB05)')`. `beforeAll` : base, migrations jusqu'au format, `chargerFormatActuel`, `appliquerMigrations(client, { apres: DERNIERE_MIGRATION_FORMAT_ACTUEL })` (toutes), `prisma = creerPrismaDeTest(base)`, `service = new PointsDeVenteService(prisma, new AccesPharmacieService(prisma))`. `afterAll` : `fermerPrismaDeTest` puis `supprimerBaseDeTest` (modèle de `non-regression-lectures.db-spec.ts`). Fonction locale `refus(promesse): Promise<{ statut: number; corps: unknown }>` qui attend une `HttpException` et renvoie `getStatus()` et `getResponse()` (échoue si la promesse résout). Tests, dans cet ordre (ils partagent la base) :
1. `'référentiels : 3 modes et 6 billets dans l ordre, paramètres par défaut, aucun champ interne'` : `service.referentiels('str-pharma-1', 'usr-pharm-p1')` : `data.modesPaiement.map((m) => m.code)` `toEqual(['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO'])` ; `Object.keys(data.modesPaiement[0]).sort()` `toEqual(['code', 'comptagePhysique', 'libelle', 'ordre', 'referenceAutorisee'])` ; `data.coupures.map((c) => c.valeurFaciale)` `toEqual([20000, 10000, 5000, 2000, 1000, 500])` et toutes `type` `'BILLET'`, `devise` `'GNF'` ; `Object.keys(data.parametres).sort()` = les 8 champs triés ; `data.parametres.seuilStockBas` 10 ; `message` `'Référentiels de caisse.'`.
2. `'CA17 : un mode de paiement ajouté par un simple INSERT apparaît sans changement de code, un mode inactif n apparaît pas'` : `INSERT INTO "ModePaiement" ("id", "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre", "actif") VALUES ('mode-carte', 'CARTE', 'Carte bancaire', false, true, 4, true), ('mode-cheque', 'CHEQUE', 'Chèque', false, true, 5, false)` ; codes renvoyés `['ESPECES', 'ORANGE_MONEY', 'MTN_MOMO', 'CARTE']` ; le dernier vaut `{ code: 'CARTE', libelle: 'Carte bancaire', comptagePhysique: false, referenceAutorisee: true, ordre: 4 }` ; puis `DELETE FROM "ModePaiement" WHERE "id" IN ('mode-carte', 'mode-cheque')`.
3. `'référentiels : hôpital et membre d une autre pharmacie refusés (403)'` : `refus(service.referentiels('str-hopital-1', 'usr-admin-h1'))` statut 403 ; `refus(service.referentiels('str-pharma-1', 'usr-pharm-p2'))` statut 403.
4. `'paramètres : modification rangée, tracée et auditée, dates de début inchangées'` : `avant = (await service.parametres('str-pharma-1', 'usr-admin-p1')).data` ; `service.modifierParametres('str-pharma-1', 'usr-admin-p1', { horizonsPeremptionJours: [7, 90, 30, 60], seuilStockBas: 5 }, '127.0.0.1')` : `data.horizonsPeremptionJours` `[90, 60, 30, 7]`, `data.seuilStockBas` 5, `data.seuilEcartCaisse` 5000, `data.debutCaisse.getTime()` égal à celui d'`avant`, `message` `'Paramètres enregistrés.'` ; en base `misAJourParId` `'usr-admin-p1'` ; une ligne `AuditLog` `action` `'update'`, `entityType` `'ParametresPharmacie'`, `entityId` `'str-pharma-1'`, `userId` `'usr-admin-p1'`, `metadata` `toEqual({ avant: { horizonsPeremptionJours: [90, 30, 7], seuilStockBas: 10 }, apres: { horizonsPeremptionJours: [90, 60, 30, 7], seuilStockBas: 5 } })`.
5. `'paramètres : corps vide ou valeurs identiques, aucune écriture'` : nombre de lignes `AuditLog` d'`entityType` `'ParametresPharmacie'` relevé, `updatedAt` en base relevé ; `modifierParametres(..., {})` puis `modifierParametres(..., { seuilStockBas: 5 })` : nombre d'audits et `updatedAt` inchangés.
6. `'paramètres : créés avec les défauts pour une pharmacie qui n en a pas'` : `DELETE FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-2'` ; `service.parametres('str-pharma-2', 'usr-admin-p2')` : `seuilStockBas` 10, `horizonsPeremptionJours` `[90, 30, 7]` ; la ligne existe de nouveau en base.
7. `'postes : enregistrement web W1 avec libellé par défaut, idempotent par appareilId'` : `service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', { type: 'WEB', appareilId: 'navigateur-essai-0001' }, '127.0.0.1')` : `data.cree` vrai, `code` `'W1'`, `libelle` `'Navigateur de Mamadou'`, `type` `'WEB'`, `actif` vrai, `message` `'Poste enregistré.'`, pas de clé `enregistreParId` ni `pointDeVenteId` dans `data` ; en base `enregistreParId` `'usr-pharm-p1'` et un audit `create` `entityType` `'Poste'` ; second appel identique avec `libelle: 'Autre'` : `data.cree` faux, même `id`, `libelle` toujours `'Navigateur de Mamadou'`, `message` `'Ce poste était déjà enregistré.'` ; un seul poste WEB dans le PV de `str-pharma-1`.
8. `'postes : second navigateur W2, desktop D1 avec libellé par défaut, libellé fourni rogné et conservé'` : `navigateur-essai-0002` (WEB) donne `W2` ; `installation-essai-0001` (DESKTOP) donne `D1`, libellé `'Poste D1'` ; `installation-essai-0002` (DESKTOP, `libelle: 'Comptoir principal'`) donne `D2`, libellé `'Comptoir principal'`.
9. `'postes : même appareil déclaré avec un autre type, 409 POSTE_TYPE_DIFFERENT'` : `enregistrerPoste('str-pharma-1', 'usr-pharm-p1', { type: 'DESKTOP', appareilId: 'navigateur-essai-0001' })` : statut 409, `corps` contient `code: 'POSTE_TYPE_DIFFERENT'` et `message: 'Cet appareil est déjà enregistré comme un autre type de poste.'`.
10. `'postes : cinq enregistrements simultanés du même appareil créent un seul poste'` : `Promise.all` de 5 `enregistrerPoste('str-pharma-1', 'usr-pharm-p1', { type: 'WEB', appareilId: 'navigateur-course-0001' })` : un seul `cree` vrai, les 5 `id` identiques, code `'W3'` ; en base un seul poste pour cet `appareilId`.
11. `'postes : liste sans le poste technique, modification du libellé et de l activité auditée'` : `listerPostes('str-pharma-1', 'usr-admin-p1')` : codes triés `['D1', 'D2', 'W1', 'W2', 'W3']`, aucun `'REPRISE'`, `message` `'5 poste(s).'` ; `modifierPoste('str-pharma-1', 'usr-admin-p1', <id de W1>, { libelle: 'Caisse 1', actif: false }, '127.0.0.1')` : `libelle` `'Caisse 1'`, `actif` faux, `message` `'Poste mis à jour.'` ; audit `update` `entityType` `'Poste'` avec `metadata` `toEqual({ avant: { libelle: 'Navigateur de Mamadou', actif: true }, apres: { libelle: 'Caisse 1', actif: false } })` ; `enregistrerPoste` du même appareil renvoie ensuite le poste tel quel (`actif` faux, `cree` faux).
12. `'postes : poste technique, poste d une autre pharmacie ou inconnu, 404'` : `id` du poste `REPRISE` de `str-pharma-1` (lu en SQL) ; poste `W1` de `str-pharma-2` créé par `enregistrerPoste('str-pharma-2', 'usr-pharm-p2', { type: 'WEB', appareilId: 'navigateur-essai-0003' })` ; `modifierPoste('str-pharma-1', 'usr-admin-p1', <id>, { actif: false })` pour ces deux `id` et pour `'poste-inconnu'` : statut 404, message `'Ce poste est introuvable.'`.
13. `'démarrage : une pharmacie sans point de vente est complétée, une seconde passe ne crée rien'` : insérer en SQL `str-pharma-4` (`PHARMACIE`, nom `'Pharmacie de Dixinn (harnais)'`, email `pharma4@harnais.test`) et `str-hopital-2` (`HOPITAL`, email `hopital2@harnais.test`), même forme que l'insertion de la clinique du test g6 ; `await service.completerPointsDeVente()` vaut 1 ; pour `str-pharma-4` : un PV d'ordre 1 nommé `'Pharmacie de Dixinn (harnais)'`, un poste `REPRISE` inactif, un compteur à 1, des paramètres ; aucun PV pour `str-hopital-2` ; second appel : 0, et le nombre total de lignes de `PointDeVente`, `Poste`, `CompteurTicket`, `ParametresPharmacie` inchangé.
14. `'suppression d une pharmacie par le super administrateur : sa configuration de caisse part avec elle'` : pour `str-pharma-4`, insérer en SQL un poste `WEB` (`'poste-p4-web'`, code `'W1'`, libellé `'Navigateur'`, appareil `'navigateur-p4-0001'`), une plage (`'plage-p4'`, ce poste, 1 à 1000), un fournisseur (`'four-p4'`, `'Laborex Guinée'`) et une anomalie (`'anom-p4'`, type `'STOCK_NEGATIF'`, `pieceType` `'VENTE'`, `details` `'{}'::jsonb`) ; `new SuperAdminService(prisma, {} as never, {} as never).deleteStructure('str-pharma-4')` résout avec `success` vrai ; plus aucune ligne de `Structure`, `PointDeVente`, `Poste`, `PlageTicket`, `CompteurTicket`, `ParametresPharmacie`, `Fournisseur` ni `Anomalie` rattachée à `str-pharma-4` (par `structureId` ou par son PV, identifiant lu avant la suppression).

### 8. Documentation (`CLAUDE.md` du dépôt back)

Insérer, juste avant la ligne qui commence par `- **Validation** globale : `, la puce suivante (une seule ligne dans le fichier, texte exact) :

```
- **Points de vente, postes et référentiels (tranche pharmacie 1, PB05)** : migration `20261026100000_pharmacie_t1_points_de_vente` (M2, retour arrière dans `prisma/retours-arriere/`) : tables `PointDeVente` (un par pharmacie, `ordre` 1), `Poste` (dont le poste technique `REPRISE`, inactif, jamais exposé), `CompteurTicket`, `PlageTicket`, `ParametresPharmacie`, `ModePaiement` (`ESPECES`, `ORANGE_MONEY`, `MTN_MOMO` ; un nouveau mode = un `INSERT`), `CoupureMonnaie` (billets de 20 000, 10 000, 5 000, 2 000, 1 000 et 500 GNF), `Fournisseur`, `Anomalie`, clés étrangères en `Restrict`. La migration s'arrête et liste les structures qui ne sont pas des pharmacies et portent du stock ou des ventes. `assurerPointDeVente` (`src/pharmacie/point-de-vente.ts`, idempotent) crée point de vente, poste `REPRISE`, compteur et paramètres : à la création d'une pharmacie par le super administrateur (non bloquant), dans le jeu démo, au démarrage (`PointsDeVenteService.completerPointsDeVente`, pharmacies sans point de vente ou sans paramètres) et au premier accès ; `supprimerConfigurationPharmacies` retire cette configuration avant toute suppression de structure (super administrateur, purge démo). Routes (`PointsDeVenteController`, accès par `AccesPharmacieService`) : `GET /pharmacie/:structureId/referentiels` (`caisse:utiliser`) renvoie `{ modesPaiement: [{ code, libelle, comptagePhysique, referenceAutorisee, ordre }], coupures: [{ devise, valeurFaciale, type, ordre }], parametres }`, actifs seulement ; `GET .../parametres` (`caisse:utiliser`) et `PATCH .../parametres` (`structure:write`) sur `horizonsPeremptionJours` (1 à 5 valeurs distinctes de 1 à 365, rangées en ordre décroissant), `seuilEcartCaisse` (0 à 10 000 000 GNF), `seuilAvertissementPrixPct` (1 à 100), `seuilStockBas` (en boîtes, 0 à 10 000), `taillePlageTickets` (100 à 10 000), `seuilRechargementPlagePct` (5 à 50), `debutFiabiliteMarge` et `debutCaisse` lus seulement, modification auditée ; `POST .../postes` (`caisse:utiliser`, 200, `{ type: "WEB" | "DESKTOP", appareilId, libelle? }`, idempotent par `appareilId` avec `data.cree`, codes `W<n>` et `D<n>`, 409 `POSTE_TYPE_DIFFERENT` « Cet appareil est déjà enregistré comme un autre type de poste. ») ; `GET .../postes` (`caisse:superviser`) ; `PATCH .../postes/:posteId` (`structure:write`, `{ libelle?, actif? }`, 404 « Ce poste est introuvable. », audité). Garde de dérive : `test/db/schema-derive.db-spec.ts` exige que `prisma/schema.prisma` corresponde exactement à la base migrée (`prisma migrate diff --exit-code`).
```

Rien d'autre dans `CLAUDE.md`.

### Cas limites (déjà tranchés, ne pas rediscuter)

- Une base de production où un hôpital ou une clinique porte du stock ou des ventes : M2 échoue sans rien appliquer et liste ces structures ; décision du porteur requise, puis `prisma migrate resolve --rolled-back` et nouveau déploiement.
- Pharmacie créée pendant que M2 n'est pas encore déployée (ancien code) : le démarrage du nouveau code la complète (`completerPointsDeVente`).
- Pharmacie désactivée : `AccesPharmacieService` refuse (403) toutes les routes de PB05, comme le stock et les ventes ; le démarrage la complète quand même.
- `structure:write` reste possédée par un administrateur d'hôpital : il passe la garde des `PATCH` mais `AccesPharmacieService` le refuse (403).
- Poste désactivé : il reste listé et renvoyé à son appareil (`actif` faux) ; l'effet de l'inactivité sur la vente est l'affaire de PB10 et PB11.
- `seed_complete.ts` n'est pas modifié (D478).

## Contraintes

Faire uniquement ce qui est demandé : pas de refactors, helpers ou abstractions non demandés. Discipline de code dans l'ordre : réutiliser l'existant > ranger au bon endroit > n'abstraire qu'à la règle de trois. Règles d'audience, visuelles, typographiques et de langue : docs/ORCHESTRATOR.md. Ne pas modifier docs/plans/. Écrire les fichiers uniquement avec Write et Edit, jamais par redirection shell : le hook de garde ne voit pas les écritures faites par Bash.

Spécifiques : français partout (commentaires, noms de tests, messages) ; aucun tiret cadratin ni demi-cadratin ; aucun `eslint-disable`, aucun `any`, aucun `console.log` ; ne pas toucher `package.json`, `package-lock.json`, le harnais (`test/db/harnais.ts`, fichiers existants de `test/db/fixtures/`), les instantanés (`test/db/instantanes/`, ne jamais lancer `MAJ_INSTANTANES=1`), les specs existantes autres que celles listées, les contrôleurs, services et DTO existants autres que ceux listés ; aucun commit (le chef commite) ; ne jamais afficher ni écrire d'URL de base, de mot de passe ou de valeur de `.env`. Si le texte SQL ou Prisma de cette fiche ne passe pas tel quel (`prisma validate`, harnais, garde de dérive), s'arrêter en BLOCKED avec la sortie (masquée) au lieu de l'adapter.

Fichiers touchés (liste fermée) :
- créés : `prisma/migrations/20261026100000_pharmacie_t1_points_de_vente/migration.sql`, `prisma/retours-arriere/20261026100000_pharmacie_t1_points_de_vente.down.sql`, `src/pharmacie/point-de-vente.ts`, `src/pharmacie/point-de-vente.spec.ts`, `src/pharmacie/points-de-vente.service.ts`, `src/pharmacie/points-de-vente.controller.ts`, `src/pharmacie/points-de-vente.http.spec.ts`, `src/pharmacie/dto/points-de-vente.dto.ts`, `test/db/fixtures/schema-courant/prisma.config.ts`, `test/db/schema-derive.db-spec.ts`, `test/db/m2-points-de-vente.db-spec.ts`, `test/db/points-de-vente.db-spec.ts` ;
- modifiés : `prisma/schema.prisma`, `src/pharmacie/pharmacie.module.ts`, `src/common/filters/codes-erreur.ts`, `src/super-admin/super-admin.service.ts`, `src/super-admin/super-admin.service.spec.ts`, `src/demo/demo.seeder.ts`, `src/demo/demo.seeder.spec.ts`, `CLAUDE.md`.

## Done when

Toutes les commandes depuis `D:\souleymane\perso-archive-20260923\perso\medconnecte` (conteneur `backend` démarré), chacune avec un code de sortie 0 :

1. `docker compose exec -T backend npx prisma generate` puis `docker compose exec -T backend npx prisma validate`
2. `docker compose exec -T backend npx tsc --noEmit`
3. `docker compose exec -T backend npx eslint src/pharmacie/point-de-vente.ts src/pharmacie/point-de-vente.spec.ts src/pharmacie/points-de-vente.service.ts src/pharmacie/points-de-vente.controller.ts src/pharmacie/points-de-vente.http.spec.ts src/pharmacie/dto/points-de-vente.dto.ts src/pharmacie/pharmacie.module.ts src/common/filters/codes-erreur.ts src/super-admin/super-admin.service.ts src/super-admin/super-admin.service.spec.ts src/demo/demo.seeder.ts src/demo/demo.seeder.spec.ts test/db/fixtures/schema-courant/prisma.config.ts test/db/schema-derive.db-spec.ts test/db/m2-points-de-vente.db-spec.ts test/db/points-de-vente.db-spec.ts` (aucune erreur ni avertissement ; si un fichier existant portait déjà des erreurs hors des lignes touchées, joindre la sortie d'avant modification, sans les corriger)
4. `docker compose exec -T backend npm test` : toutes les suites passent ; réussis = 825 + tests ajoutés (au moins 16 de plus : 4 + 7 + 3 + 2) ; aucun test supprimé ni ignoré en plus des 3 actuels.
5. `docker compose exec -T backend npm run test:db` : 6 suites vertes (harnais 11, PB02 9, M1 6, M2 7, service 14, dérive 1) ; instantanés PB02 inchangés (`git status --short test/db/instantanes` vide, depuis `back_medconnect`).
6. Aucune base `mc_test_` restante : `docker compose exec -T backend node -e "const {Client}=require('pg');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const c=new Client({connectionString:u.toString()});c.connect().then(()=>c.query(\"select count(*)::int n from pg_database where datname like 'mc_test_%'\")).then(r=>{console.log(r.rows[0].n);return c.end()})"` affiche `0`.
7. Les migrations s'appliquent à la base de développement au redémarrage (M1 et M2 y sont toutes deux en attente ; contrôle du chef : aucune structure en cause dans cette base) : `docker compose restart backend`, puis, une fois l'API démarrée (`docker compose logs --tail 50 backend` montre le démarrage de Nest sans erreur de migration), `docker compose exec -T backend node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query(\"select count(*)::int n from _prisma_migrations where finished_at is not null and rolled_back_at is null and migration_name in ('20261026090000_pharmacie_t1_permissions','20261026100000_pharmacie_t1_points_de_vente')\")).then(r=>{console.log(r.rows[0].n);return c.end()})"` affiche `2`, et `docker compose exec -T backend sh -c 'npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code >/dev/null 2>&1; echo $?'` affiche `0`.
8. `LC_ALL=C.UTF-8 grep -rnP "\x{2013}|\x{2014}" <fichiers touchés>` ne renvoie rien.
9. `git status --short` (depuis `back_medconnect`) ne liste que les fichiers de la liste fermée (plus `docs/plans/`, tenu par l'orchestrateur).

## Return

Chemin de l'artefact + preuve (commande lancée, résultat en une ligne). Ou un bloc BLOCKED. Pas de prose.

## Historique

<!-- une ligne par tentative : AAAA-MM-JJ | tier | résultat | raison si échec -->

## Validation

<!-- commande relancée par l'orchestrateur | résultat en une ligne | hash du commit -->
