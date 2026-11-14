import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const MOMENTS_COMPTAGE = ['OUVERTURE', 'FERMETURE'] as const;
export type MomentComptageSaisi = (typeof MOMENTS_COMPTAGE)[number];
export const TYPES_MOUVEMENT_CAISSE = [
  'PRELEVEMENT',
  'APPORT',
  'REMBOURSEMENT',
] as const;
export type TypeMouvementCaisseSaisi = (typeof TYPES_MOUVEMENT_CAISSE)[number];
/** Code de mode de paiement (ESPECES, ORANGE_MONEY, MTN_MOMO, ...). */
export const MOTIF_CODE_MODE = /^[A-Z0-9_]{2,40}$/;

export class LigneComptageDto {
  @ApiProperty({
    example: 20000,
    description: 'Valeur faciale du billet en GNF',
  })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  valeurFaciale: number;

  @ApiProperty({ example: 12, description: 'Nombre de billets, 0 à 10 000' })
  @IsInt()
  @Min(0)
  @Max(10_000)
  nombre: number;
}

export class ReleveModeDto {
  @ApiProperty({ example: 'ORANGE_MONEY' })
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode: string;

  @ApiProperty({
    example: 150000,
    description: 'Total relevé sur le compte marchand, GNF',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  montant: number;
}

export class ComptageOuvertureDto {
  @ApiPropertyOptional({
    example: 350000,
    description:
      "Total des espèces comptées, en GNF (saisie simplifiée). Exclusif avec « coupures » : l'un ou l'autre.",
  })
  // null refusé : seul undefined (champ absent) est toléré
  @ValidateIf((o: ComptageOuvertureDto) => o.montantEspeces !== undefined)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  montantEspeces?: number;

  @ApiPropertyOptional({
    type: [LigneComptageDto],
    description:
      'Comptage par coupures (ancien format, toujours accepté), sinon montantEspeces.',
  })
  @ValidateIf((o: ComptageOuvertureDto) => o.coupures !== undefined)
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LigneComptageDto)
  coupures?: LigneComptageDto[];
}

export class ComptageFermetureDto extends ComptageOuvertureDto {
  @ApiPropertyOptional({
    description: 'UUID généré par le client (rejeu sans doublon)',
  })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiPropertyOptional({ type: [ReleveModeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class SaisirComptageDto extends ComptageFermetureDto {
  @ApiProperty({ enum: MOMENTS_COMPTAGE, example: 'FERMETURE' })
  @IsIn(MOMENTS_COMPTAGE)
  moment: MomentComptageSaisi;
}

export class OuvrirSessionDto {
  @ApiPropertyOptional({
    description: 'UUID généré par le client (rejeu sans doublon)',
  })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ description: 'Identifiant du poste de caisse' })
  @IsUUID('all')
  posteId: string;

  @ApiPropertyOptional({ type: ComptageOuvertureDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageOuvertureDto)
  comptage?: ComptageOuvertureDto;
}

export class SessionCouranteQueryDto {
  @ApiProperty({ description: 'Identifiant du poste de caisse' })
  @IsUUID('all')
  posteId: string;
}

export class MouvementCaisseDto {
  @ApiPropertyOptional({
    description: 'UUID généré par le client (rejeu sans doublon)',
  })
  @IsOptional()
  @IsUUID('all')
  id?: string;

  @ApiProperty({ enum: TYPES_MOUVEMENT_CAISSE, example: 'PRELEVEMENT' })
  @IsIn(TYPES_MOUVEMENT_CAISSE)
  type: TypeMouvementCaisseSaisi;

  @ApiProperty({ example: 100000, description: 'GNF, 1 à 100 000 000' })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  montant: number;

  @ApiPropertyOptional({
    example: 'Dépôt à la banque',
    description: 'Motif obligatoire, 3 à 300 caractères',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300, { message: 'Le motif ne doit pas dépasser 300 caractères.' })
  motif?: string;

  @ApiPropertyOptional({ example: 'ESPECES', description: 'Défaut : ESPECES' })
  @IsOptional()
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode?: string;
}

export class FermerSessionDto {
  @ApiPropertyOptional({ type: ComptageFermetureDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageFermetureDto)
  comptageFermeture?: ComptageFermetureDto;

  @ApiPropertyOptional({
    example: 'Erreur de rendu de monnaie',
    description:
      'Obligatoire si l’écart d’espèces dépasse le seuil (3 à 500 caractères)',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500, {
    message: 'Le commentaire ne doit pas dépasser 500 caractères.',
  })
  commentaire?: string;
}

export class ListerSessionsQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-25',
    description: 'Jour AAAA-MM-JJ (défaut : aujourd hui)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  jour?: string;
}
