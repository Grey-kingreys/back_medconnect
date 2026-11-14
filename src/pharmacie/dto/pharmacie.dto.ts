import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsInt,
  IsArray,
  IsDateString,
  IsIn,
  IsUUID,
  Min,
  Max,
  Length,
  NotEquals,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Créer un médicament (catalogue global : ADMIN/SUPER_ADMIN) ──────────────

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

  @ApiPropertyOptional({
    example: 50,
    description:
      'Quantité en stock, en unités minimales. Absente : aucune écriture de stock (prix et notes seulement).',
  })
  @IsOptional()
  @IsInt({ message: 'La quantité doit être un nombre entier.' })
  @Min(0)
  quantite?: number;

  @ApiPropertyOptional({ example: 35000, description: 'Prix en GNF' })
  @IsOptional()
  @IsInt({
    message:
      'Le prix unitaire doit être un nombre entier de francs guinéens, sans décimales.',
  })
  @Min(0)
  @Max(2147483647)
  prixUnitaire?: number;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  dateExpiration?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description:
      "Vrai pour un médicament sans date de péremption : autorise l'absence de date quand la saisie crée un lot.",
  })
  @IsOptional()
  @IsBoolean()
  sansPeremption?: boolean;
}

export class UpdateStockQuantiteDto {
  @ApiPropertyOptional({
    description:
      "Identifiant choisi par le client : rejouer la même correction ne l'applique qu'une fois",
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    example: -2,
    description: 'Ajouter ou retirer (négatif), en unités minimales',
  })
  @IsInt({ message: 'La variation doit être un nombre entier.' })
  @NotEquals(0, { message: 'La variation ne peut pas être nulle.' })
  variation: number;

  @ApiPropertyOptional({
    description:
      "Lot à corriger ; facultatif si le médicament n'a qu'un lot en stock",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  lotId?: string;

  @ApiPropertyOptional({
    example: 'Boîte abîmée au rangement',
    description: 'Motif de la correction, obligatoire (3 à 300 caractères)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300, {
    message: 'Le motif ne doit pas dépasser 300 caractères.',
  })
  motif?: string;

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

/** Façon de compter les quantités du fichier : remplacer le stock ou s'y ajouter. */
export const MODES_IMPORT_STOCK = ['inventaire', 'livraison'] as const;
export type ModeImportStock = (typeof MODES_IMPORT_STOCK)[number];

/** Champs texte du formulaire d'import du stock (en plus du fichier). */
export class OptionsImportStockDto {
  @ApiPropertyOptional({
    enum: MODES_IMPORT_STOCK,
    default: 'inventaire',
    description:
      "inventaire (défaut, inventaire:write) : la quantité comptée remplace le stock du lot, écart enregistré, anomalie au-delà de la tolérance. livraison (reception:write) : la quantité du fichier (en boîtes) s'ajoute au stock par une réception, un lot par ligne.",
  })
  @IsOptional()
  @IsIn(MODES_IMPORT_STOCK)
  mode?: ModeImportStock;
}

/** Paramètres de la route d'export du stock. */
export class ExportStockDto {
  @ApiPropertyOptional({
    enum: ['tous', 'alertes', 'rupture', 'qualifier'],
    default: 'tous',
    description: "Étendue : tout le stock ou l'un des onglets de la page Stock",
  })
  @IsOptional()
  @IsIn(['tous', 'alertes', 'rupture', 'qualifier'])
  filtre?: 'tous' | 'alertes' | 'rupture' | 'qualifier';

  @ApiPropertyOptional({ description: 'Recherche sur le nom du médicament' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Paramètre de la route du modèle Excel. */
export class ModeleImportStockDto {
  @ApiPropertyOptional({
    enum: MODES_IMPORT_STOCK,
    default: 'livraison',
    description: "Modèle de livraison (défaut) ou d'inventaire",
  })
  @IsOptional()
  @IsIn(MODES_IMPORT_STOCK)
  mode?: ModeImportStock;
}

/** Résultat de l'analyse d'une ligne du classeur. */
export interface LigneImportStock {
  /** Numéro de la ligne dans Excel (sous la ligne des titres). */
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
  /** Numéro de lot inscrit sur la boîte (colonne « Lot »). */
  numeroLot?: string;
  /** Coût d'achat d'une boîte en GNF (colonne « Coût d'achat »), retiré sans marge:read. */
  coutAchatBoite?: number;
  /** Vrai si la date de péremption est « sans péremption ». */
  sansPeremption?: boolean;
  /** Unités minimales reçues (boîtes x unités par boîte de la fiche), lignes acceptées seulement. */
  unitesRecues?: number;
  /** Lot créé par l'import, lignes acceptées seulement. */
  lotId?: string;
  /** Livraison : stock calculé en unités avant l'import ; inventaire : stock du lot avant le comptage (0 pour un nouveau lot). Lignes acceptées seulement. */
  quantiteAvant?: number;
  /** Livraison : stock calculé après l'import ; inventaire : quantité comptée. Lignes acceptées seulement. */
  quantiteApres?: number;
  /** Livraison : part du stock à régulariser avant l'import (ventes faites sans stock), seulement si positive (D717). */
  quantiteARegulariserAvant?: number;
  /** Inventaire : unités d'une boîte entamée (colonne « Unités en plus »). */
  unitesEnPlus?: number;
  /** Inventaire : unités comptées (boîtes x unités par boîte du lot + unités en plus). */
  quantiteComptee?: number;
  /** Inventaire : stock attendu du lot (stock moins les ventes faites sans stock rattachées), jamais négatif (D717). */
  quantiteTheorique?: number;
  /** Inventaire : part des ventes faites sans stock que le lot ne couvre pas, `max(0, -théorique)` (D717). */
  quantiteARegulariser?: number;
  /** Inventaire : quantité comptée moins quantité théorique. */
  ecart?: number;
  /** Inventaire : écart de la fiche dans la tolérance du médicament. */
  sousTolerance?: boolean;
  /** Inventaire : boîtes d'un lot qui n'était pas enregistré (lot créé). */
  nouveauLot?: boolean;
}

/** Colonnes du fichier telles que l'import les a comprises, montrées dans l'aperçu. */
export interface ColonnesLuesImport {
  /** Numéro de la ligne des titres dans Excel (1 le plus souvent). */
  ligneTitres: number;
  /** Titres reconnus, dans l'ordre du fichier, avec la colonne de la plateforme. */
  reconnues: { titre: string; colonne: string }[];
  /** Titres non reconnus (ou en double), dont le contenu n'est pas importé. */
  ignorees: string[];
}

/** Rapport renvoyé par l'aperçu et par l'import (stock ou catalogue). */
export interface RapportImport<L> {
  totalLignes: number;
  acceptees: number;
  rejetees: number;
  lignes: L[];
  /** Colonnes reconnues et ignorées, pour vérifier que le fichier a été bien compris. */
  colonnes: ColonnesLuesImport;
}

/** Rapport renvoyé par l'aperçu et par l'import du stock. */
export type RapportImportStock = RapportImport<LigneImportStock>;

/** Rapport de l'import, avec le nombre de lignes réellement écrites. */
export interface ResultatImportStock extends RapportImportStock {
  importees: number;
  receptionId: string | null;
  inventaireId: string | null;
}

// Import Excel du catalogue des médicaments

/** Résultat de l'analyse d'une ligne du classeur du catalogue. */
export interface LigneImportCatalogue {
  /** Numéro de la ligne dans Excel (sous la ligne des titres). */
  ligne: number;
  /** Nom du médicament tel qu'écrit dans le fichier. */
  nom: string;
  statut: 'acceptee' | 'rejetee';
  /** Raison du rejet, lisible par un administrateur non technicien. */
  raison?: string;
  nomGenerique?: string;
  /** Catégorie retenue (orthographe du catalogue si elle existe déjà). */
  categorie?: string;
  description?: string;
  ordonnanceRequise?: boolean;
  formes?: string[];
}

/** Rapport renvoyé par l'aperçu et par l'import du catalogue. */
export type RapportImportCatalogue = RapportImport<LigneImportCatalogue>;

/** Rapport de l'import du catalogue, avec le nombre de médicaments créés. */
export interface ResultatImportCatalogue extends RapportImportCatalogue {
  importees: number;
}
