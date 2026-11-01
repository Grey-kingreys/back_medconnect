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
  IsUUID,
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
export type TypePosteEnregistrable =
  (typeof TYPES_POSTE_ENREGISTRABLES)[number];

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
    description:
      'Horizons d’alerte de péremption en jours : 1 à 5 valeurs distinctes de 1 à 365',
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

export class AttribuerPlageDto {
  @ApiProperty({
    description: 'UUID généré par le poste (rejeu sans doublon)',
  })
  @IsUUID('all')
  id: string;
}
