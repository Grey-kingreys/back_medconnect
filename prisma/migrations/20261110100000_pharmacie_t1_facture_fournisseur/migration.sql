-- Facture fournisseur sur la réception : colonnes facultatives seulement (aucune donnée existante touchée).
-- Les triggers de Reception (UPDATE, DELETE) et de LotStock (contrôle à l'INSERT : point de vente de la pharmacie) ne bloquent pas ces ajouts.
ALTER TABLE "Reception"
  ADD COLUMN "numeroFacture" TEXT,
  ADD COLUMN "referenceCommande" TEXT,
  ADD COLUMN "dateFacture" DATE,
  ADD COLUMN "nombrePages" INTEGER,
  ADD COLUMN "montantHT" INTEGER,
  ADD COLUMN "totalTva" INTEGER,
  ADD COLUMN "montantTTC" INTEGER,
  ADD COLUMN "netAPayer" INTEGER;

ALTER TABLE "LotStock"
  ADD COLUMN "codeArticleFournisseur" TEXT,
  ADD COLUMN "codeBarres" TEXT,
  ADD COLUMN "quantiteCommandee" INTEGER,
  ADD COLUMN "prixPublicBoite" INTEGER,
  ADD COLUMN "codeTva" TEXT,
  ADD COLUMN "tauxTvaPourMille" INTEGER,
  ADD COLUMN "montantHTLigne" INTEGER,
  ADD COLUMN "colisage" INTEGER,
  ADD COLUMN "tableau" TEXT,
  ADD COLUMN "bonPreparation" TEXT;
