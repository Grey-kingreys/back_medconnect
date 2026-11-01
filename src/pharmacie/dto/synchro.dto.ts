import {
  Allow,
  ArrayMaxSize,
  ArrayMinSize,
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

export class SortieManuelleRejeuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;
}

export class LigneVenteRejeuDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @IsIn(['BOITE', 'UNITE'])
  unite: 'BOITE' | 'UNITE';

  @IsInt()
  @Min(1)
  @Max(10_000)
  nombre: number;

  /** Prix du ticket pour une boîte (BOITE) ou une unité (UNITE). */
  @IsInt()
  @Min(0)
  @Max(2147483647)
  prixUnitaire: number;

  /** Unités non couvertes par un lot sur le poste. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  quantiteProvisoireLocale?: number;

  /** Le poste a entamé une boîte pour cette ligne. */
  @IsOptional()
  @IsBoolean()
  ouvertureConditionnement?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => SortieManuelleRejeuDto)
  sortieManuelle?: SortieManuelleRejeuDto;
}

export class PaiementRejeuDto {
  @IsString()
  @Matches(MOTIF_CODE_MODE)
  mode: string;

  @IsInt()
  @Min(1)
  @Max(2147483647)
  montant: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  montantRecu?: number;
}

export class CorpsVenteDto {
  @IsUUID('all')
  venteId: string;

  @IsUUID('all')
  sessionId: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  numeroTicket?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  numeroSecours?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LigneVenteRejeuDto)
  lignes: LigneVenteRejeuDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaiementRejeuDto)
  paiements: PaiementRejeuDto[];

  @IsInt()
  @Min(0)
  @Max(2147483647)
  total: number;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(100)
  clientNom?: string;

  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(30)
  clientTelephone?: string;

  @IsBoolean()
  ordonnanceVerifiee: boolean;
}
