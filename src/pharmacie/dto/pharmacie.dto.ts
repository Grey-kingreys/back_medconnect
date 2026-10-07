import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsDateString,
  Min,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Créer un médicament (catalogue global — ADMIN/SUPER_ADMIN) ──────────────

export class CreateMedicamentDto {
  @ApiProperty({ example: 'Coartem 20mg/120mg' })
  @IsNotEmpty()
  @IsString()
  @Length(2, 200)
  nom: string;

  @ApiPropertyOptional({ example: 'Artémether/Luméfantrine' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  nomGenerique?: string;

  @ApiProperty({ example: 'Antipaludéen' })
  @IsNotEmpty()
  @IsString()
  @Length(2, 100)
  categorie: string;

  @ApiPropertyOptional({ example: 'Traitement du paludisme non compliqué' })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  ordonnanceRequise: boolean;

  @ApiPropertyOptional({ example: ['comprimé'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formes?: string[];
}

export class UpdateMedicamentDto {
  @ApiPropertyOptional({ example: 'Coartem 20mg/120mg' })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  nom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nomGenerique?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categorie?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ordonnanceRequise?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formes?: string[];
}

// ─── Gérer le stock d'une pharmacie ──────────────────────────────────────────

export class UpsertStockDto {
  @ApiProperty({ description: 'ID du médicament dans le catalogue' })
  @IsNotEmpty()
  @IsString()
  medicamentId: string;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  quantite: number;

  @ApiPropertyOptional({ example: 35000, description: 'Prix en GNF' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  prixUnitaire?: number;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  dateExpiration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateStockQuantiteDto {
  @ApiProperty({ example: 10, description: 'Ajouter ou retirer (négatif)' })
  @IsNumber()
  variation: number;

  @ApiPropertyOptional({ example: 'Livraison du 26/04/2026' })
  @IsOptional()
  @IsString()
  notes?: string;
}

// Import Excel du stock d'une pharmacie

/** Fichier reçu par FileInterceptor (stockage mémoire de multer). */
export interface FichierImport {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/** Résultat de l'analyse d'une ligne du classeur. */
export interface LigneImportStock {
  /** Numéro de la ligne dans Excel (la ligne 1 contient les titres). */
  ligne: number;
  /** Nom du médicament tel qu'écrit dans le fichier. */
  nom: string;
  statut: 'acceptee' | 'rejetee';
  /** Raison du rejet, lisible par un pharmacien. */
  raison?: string;
  medicamentId?: string;
  /** Nom du médicament dans le catalogue. */
  medicamentNom?: string;
  quantite?: number;
  prixUnitaire?: number;
  /** Date ISO 8601. */
  dateExpiration?: string;
  notes?: string;
}

/** Rapport renvoyé par l'aperçu et par l'import. */
export interface RapportImportStock {
  totalLignes: number;
  acceptees: number;
  rejetees: number;
  lignes: LigneImportStock[];
}

/** Rapport de l'import, avec le nombre de lignes réellement écrites. */
export interface ResultatImportStock extends RapportImportStock {
  importees: number;
}
