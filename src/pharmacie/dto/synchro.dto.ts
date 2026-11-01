import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ComptageOuvertureDto,
  MOMENTS_COMPTAGE,
  MOTIF_CODE_MODE,
  ReleveModeDto,
  TYPES_MOUVEMENT_CAISSE,
} from './sessions-caisse.dto';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// PostgreSQL refuse le caractère NUL : une enveloppe qui en contient est refusée en 400
// plutôt que d'échouer en base à chaque envoi (D664).
// eslint-disable-next-line no-control-regex
const SANS_NUL = /^[^\u0000]*$/;

export class CatalogueSynchroQueryDto {
  @ApiProperty({ description: 'Identifiant du poste desktop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(SANS_NUL)
  posteId: string;
}

export const TYPES_EVENEMENT = [
  'SESSION_OUVERTE',
  'COMPTAGE_SAISI',
  'MOUVEMENT_CAISSE',
  'SESSION_FERMEE',
  'VENTE',
] as const;

export class EtatPosteDto {
  @ApiProperty({ description: "Le poste déclare n'avoir plus rien à envoyer" })
  @IsBoolean()
  fileVide: boolean;

  @ApiProperty({ description: 'Une caisse est ouverte sur le poste' })
  @IsBoolean()
  sessionOuverte: boolean;

  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Length(1, 32)
  @Matches(SANS_NUL)
  versionApp: string;
}

export class EvenementRecuDto {
  @ApiProperty({ description: "UUID de l'opération, généré par le poste" })
  @IsUUID('all')
  evenementId: string;

  @ApiProperty({ description: "Numéro d'ordre de l'opération sur ce poste" })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  sequence: number;

  @ApiPropertyOptional({ description: 'Un des types de TYPES_EVENEMENT' })
  @Allow()
  type?: unknown;

  @ApiPropertyOptional({ description: 'Date ISO 8601 locale du poste' })
  @Allow()
  horodatageLocal?: unknown;

  @ApiPropertyOptional({ description: "Vendeur de l'opération" })
  @Allow()
  utilisateurId?: unknown;

  @ApiPropertyOptional({ description: "Corps de l'opération, selon le type" })
  @Allow()
  corps?: unknown;
}

export class RecevoirEvenementsDto {
  @ApiProperty({ description: 'Identifiant du poste desktop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(SANS_NUL)
  posteId: string;

  @ApiProperty({ type: EtatPosteDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => EtatPosteDto)
  etat: EtatPosteDto;

  @ApiProperty({ type: [EvenementRecuDto], description: '0 à 200 opérations' })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EvenementRecuDto)
  evenements: EvenementRecuDto[];
}

// Corps validés par le service (jamais par le ValidationPipe).
export class CorpsSessionOuverteDto {
  @IsUUID('all')
  sessionId: string;
}

export class CorpsComptageSaisiDto extends ComptageOuvertureDto {
  @IsUUID('all')
  comptageId: string;

  @IsUUID('all')
  sessionId: string;

  @IsIn(MOMENTS_COMPTAGE)
  moment: 'OUVERTURE' | 'FERMETURE';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class CorpsMouvementCaisseDto {
  @IsUUID('all')
  mouvementId: string;

  @IsUUID('all')
  sessionId: string;

  @IsIn(TYPES_MOUVEMENT_CAISSE)
  type: 'PRELEVEMENT' | 'APPORT' | 'REMBOURSEMENT';

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  montant: number;

  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;

  @IsOptional()
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode?: string;
}

export class ComptageFermetureRejeuDto extends ComptageOuvertureDto {
  @IsUUID('all')
  comptageId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ReleveModeDto)
  releves?: ReleveModeDto[];
}

export class CorpsSessionFermeeDto {
  @IsUUID('all')
  sessionId: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ComptageFermetureRejeuDto)
  comptageFermeture?: ComptageFermetureRejeuDto;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  commentaire?: string;
}
