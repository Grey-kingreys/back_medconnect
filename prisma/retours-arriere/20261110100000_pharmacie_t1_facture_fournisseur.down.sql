-- Retour arrière de 20261110100000_pharmacie_t1_facture_fournisseur.
-- Supprime les colonnes de facture fournisseur de Reception et de LotStock : les valeurs saisies sont perdues. Aucune autre donnée n'est modifiée.
-- Procédure complète : prisma/retours-arriere/README.md.
BEGIN;

ALTER TABLE "LotStock"
  DROP COLUMN "codeArticleFournisseur",
  DROP COLUMN "codeBarres",
  DROP COLUMN "quantiteCommandee",
  DROP COLUMN "prixPublicBoite",
  DROP COLUMN "codeTva",
  DROP COLUMN "tauxTvaPourMille",
  DROP COLUMN "montantHTLigne",
  DROP COLUMN "colisage",
  DROP COLUMN "tableau",
  DROP COLUMN "bonPreparation";

ALTER TABLE "Reception"
  DROP COLUMN "numeroFacture",
  DROP COLUMN "referenceCommande",
  DROP COLUMN "dateFacture",
  DROP COLUMN "nombrePages",
  DROP COLUMN "montantHT",
  DROP COLUMN "totalTva",
  DROP COLUMN "montantTTC",
  DROP COLUMN "netAPayer";

COMMIT;
