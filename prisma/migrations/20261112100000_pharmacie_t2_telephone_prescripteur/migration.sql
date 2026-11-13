-- Téléphone du prescripteur lu sur l'ordonnance papier : colonne facultative seulement (aucune donnée existante touchée).
-- Vente est une pièce immuable (trigger M6) : un ajout de colonne ne déclenche ni UPDATE ni DELETE.
ALTER TABLE "Vente" ADD COLUMN "telephonePrescripteur" TEXT;
