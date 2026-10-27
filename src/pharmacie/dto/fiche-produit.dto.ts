import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { UniteMinimale } from 'generated/prisma/enums';

/** Unités minimales de vente (enum UniteMinimale, D410). */
export const UNITES_MINIMALES = [
  'COMPRIME',
  'GELULE',
  'ML',
  'SACHET',
  'GRAMME',
  'AMPOULE',
  'UNITE',
] as const satisfies readonly UniteMinimale[];

/** Conversion du stock existant à la qualification (PB13, D556). */
export const CONVERSIONS_STOCK = ['MULTIPLIER', 'CONSERVER'] as const;
export type ConversionStock = (typeof CONVERSIONS_STOCK)[number];

/** Plus grand entier enregistrable (colonne Int de PostgreSQL). */
const ENTIER_MAX = 2147483647;

/** Champ facultatif qui ne peut pas valoir null (colonne non nulle). */
const siPresent = (_objet: object, valeur: unknown): boolean =>
  valeur !== undefined;

/**
 * Modification de la fiche produit (PB06, D485 à D490). Aucun champ obligatoire ;
 * null efface prixUnitaire, prixUnite ou toleranceInventaire. conversionStock
 * convertit le stock à la qualification (PB13, D556).
 */
export class ModifierFicheDto {
  @ApiPropertyOptional({
    example: 35000,
    nullable: true,
    description: 'Prix de vente de la boîte en GNF ; null retire le prix.',
  })
  @IsOptional()
  @IsInt({
    message:
      'Le prix de la boîte doit être un nombre entier de francs guinéens, sans décimales.',
  })
  @Min(0)
  @Max(ENTIER_MAX)
  prixUnitaire?: number | null;

  @ApiPropertyOptional({
    example: 2000,
    nullable: true,
    description:
      "Prix de vente d'une unité minimale en GNF, saisi séparément, jamais calculé ; null retire le prix. Exige une fiche déconditionnable.",
  })
  @IsOptional()
  @IsInt({
    message:
      "Le prix à l'unité doit être un nombre entier de francs guinéens, sans décimales.",
  })
  @Min(1)
  @Max(ENTIER_MAX)
  prixUnite?: number | null;

  @ApiPropertyOptional({
    example: 20,
    description: 'Nombre d’unités minimales par boîte (1 à 10 000).',
  })
  @ValidateIf(siPresent)
  @IsInt()
  @Min(1)
  @Max(10000)
  coefficientBoite?: number;

  @ApiPropertyOptional({ enum: UNITES_MINIMALES, example: 'COMPRIME' })
  @ValidateIf(siPresent)
  @IsIn(UNITES_MINIMALES)
  uniteMinimale?: UniteMinimale;

  @ApiPropertyOptional({
    example: true,
    description: 'Vrai si le médicament se vend aussi à l’unité.',
  })
  @ValidateIf(siPresent)
  @IsBoolean()
  deconditionnable?: boolean;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    description:
      "Écart d'inventaire toléré en unités minimales (0 à 1 000 000) ; null vaut 0.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  toleranceInventaire?: number | null;

  @ApiPropertyOptional({
    example: true,
    description:
      'Seule la valeur true est acceptée : le titulaire confirme unité et coefficient. La qualification ne se retire pas.',
  })
  @ValidateIf(siPresent)
  @IsIn([true])
  qualifie?: true;

  @ApiPropertyOptional({
    enum: CONVERSIONS_STOCK,
    example: 'MULTIPLIER',
    description:
      "Lu seulement si le nombre d'unités par boîte change sur une fiche non qualifiée : MULTIPLIER convertit le stock repris (boîtes) en unités, CONSERVER garde les quantités telles quelles. Obligatoire si la fiche a du stock ; qualifie la fiche.",
  })
  @ValidateIf(siPresent)
  @IsIn(CONVERSIONS_STOCK)
  conversionStock?: ConversionStock;
}
