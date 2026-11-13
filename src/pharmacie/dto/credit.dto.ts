import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FORMAT_TELEPHONE_PRESCRIPTEUR } from './vente.dto';

export { NouveauClientCreditDto } from './vente.dto';

const rogner = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Texte facultatif : vide -> null (absent -> undefined). */
const viderEnNull = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

export const STATUTS_CREDIT = ['EN_COURS', 'EN_RETARD', 'SOLDE'] as const;

const MESSAGE_TELEPHONE =
  'Le téléphone du client ne doit contenir que des chiffres, espaces, + et tirets (6 à 20 chiffres).';

export class CreerClientCreditDto {
  @ApiProperty({ example: 'Mamadou Bah', minLength: 2, maxLength: 100 })
  @IsString()
  @Transform(rogner)
  @Length(2, 100, {
    message: 'Le nom complet du client est obligatoire (2 à 100 caractères).',
  })
  nomComplet: string;

  @ApiPropertyOptional({ example: '+224 621 00 00 00', nullable: true })
  @IsOptional()
  @Transform(viderEnNull)
  @IsString()
  @MaxLength(30)
  @Matches(FORMAT_TELEPHONE_PRESCRIPTEUR, { message: MESSAGE_TELEPHONE })
  telephone?: string | null;

  @ApiPropertyOptional({ example: 'Voisin du marché', nullable: true })
  @IsOptional()
  @Transform(viderEnNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ModifierClientCreditDto {
  @ApiPropertyOptional({ example: 'Mamadou Bah', minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @Transform(rogner)
  @Length(2, 100, {
    message: 'Le nom complet du client est obligatoire (2 à 100 caractères).',
  })
  nomComplet?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null ou vide : efface le téléphone ; absent : inchangé.',
  })
  @IsOptional()
  @Transform(viderEnNull)
  @IsString()
  @MaxLength(30)
  @Matches(FORMAT_TELEPHONE_PRESCRIPTEUR, { message: MESSAGE_TELEPHONE })
  telephone?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'null ou vide : efface la note ; absent : inchangée.',
  })
  @IsOptional()
  @Transform(viderEnNull)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

export class ModifierDateLimiteDto {
  @ApiProperty({
    example: '2026-12-15',
    nullable: true,
    description:
      'AAAA-MM-JJ (aujourd’hui ou plus tard) ; null : retire la date limite.',
  })
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La date limite doit être au format AAAA-MM-JJ.',
  })
  dateLimite: string | null;
}

export class EnregistrerRemboursementDto {
  @ApiProperty({
    example: 50000,
    minimum: 1,
    description: 'Montant entier en GNF, au plus le reste à payer.',
  })
  @IsInt({ message: 'Le montant doit être un nombre entier de GNF.' })
  @Min(1, { message: 'Le montant doit être supérieur à zéro.' })
  @Max(2147483647)
  montant: number;

  @ApiPropertyOptional({ example: 'Payé par sa sœur', nullable: true })
  @IsOptional()
  @Transform(viderEnNull)
  @IsString()
  @MaxLength(300)
  note?: string | null;

  @ApiPropertyOptional({
    default: false,
    description:
      'Verser cet argent dans la caisse ouverte de l’auteur (entrée d’espèces). Absent : non.',
  })
  @IsOptional()
  @IsBoolean()
  verseEnCaisse?: boolean;
}

export class ListerClientsCreditQueryDto {
  @ApiPropertyOptional({
    example: 'bah',
    description: 'Recherche dans le nom et le téléphone.',
  })
  @IsOptional()
  @IsString()
  @Transform(rogner)
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: STATUTS_CREDIT })
  @IsOptional()
  @IsIn(STATUTS_CREDIT)
  statut?: (typeof STATUTS_CREDIT)[number];

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  parPage?: number;
}
