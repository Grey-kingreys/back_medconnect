-- TB17 : un numéro de téléphone par compte.
-- Colonne dérivée "telephoneNormalise" (E.164, +224 suivi de 9 chiffres), tenue à jour
-- par un trigger à partir de "telephone". Aucune valeur existante n'est modifiée :
-- seule la nouvelle colonne est calculée. Échoue (rien n'est appliqué) si deux comptes
-- portent déjà le même numéro : lancer d'abord npm run telephones:doublons.

-- Miroir exact de normaliserTelephone (src/common/telephone/telephone.ts).
CREATE FUNCTION "telephone_e164"(brut TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT '+224' || substring(regexp_replace(brut, '[ \t  .-]', '', 'g') from '^(?:\+224|00224|224)?([0-9]{9})$')
$$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "telephoneNormalise" TEXT;

UPDATE "User" SET "telephoneNormalise" = "telephone_e164"("telephone") WHERE "telephone" IS NOT NULL;

CREATE FUNCTION "user_telephone_normalise"() RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."telephoneNormalise" := "telephone_e164"(NEW."telephone");
  RETURN NEW;
END
$$;

CREATE TRIGGER "user_telephone_normalise"
BEFORE INSERT OR UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION "user_telephone_normalise"();

-- CreateIndex
CREATE UNIQUE INDEX "User_telephoneNormalise_key" ON "User"("telephoneNormalise") WHERE "telephoneNormalise" IS NOT NULL;
