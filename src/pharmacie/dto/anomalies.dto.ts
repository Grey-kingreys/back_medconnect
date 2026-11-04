import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const TYPES_ANOMALIE = [
  'STOCK_NEGATIF',
  'ECART_INVENTAIRE',
  'CONDITIONNEMENT_CONCURRENT',
  'REMONTEE_APRES_CLOTURE',
  'ECART_CAISSE',
  'FOND_NON_COMPTE',
  'PLAGE_EPUISEE',
  'PRIX_DIVERGENT',
  'ORDONNANCE_NON_CONFIRMEE',
  'VENTE_UNITE_INTERDITE',
  'PRODUIT_ARCHIVE',
  'EVENEMENT_REJETE',
  'SEQUENCE_MANQUANTE',
] as const;

export class ListerAnomaliesDto {
  @ApiPropertyOptional({
    enum: ['OUVERTE', 'TRAITEE'],
    description: 'OUVERTE par défaut',
  })
  @IsOptional()
  @IsIn(['OUVERTE', 'TRAITEE'])
  statut?: 'OUVERTE' | 'TRAITEE';

  @ApiPropertyOptional({ enum: TYPES_ANOMALIE })
  @IsOptional()
  @IsIn(TYPES_ANOMALIE)
  type?: (typeof TYPES_ANOMALIE)[number];

  @ApiPropertyOptional({
    example: 1,
    description: 'Numéro de page (20 par page)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;
}

export class TraiterAnomalieDto {
  @ApiProperty({
    example: 'Stock recompté, vente confirmée',
    description: 'Ce qui a été vérifié ou fait (3 à 500 caractères)',
  })
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  commentaire: string;
}
