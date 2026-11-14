import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
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

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const MONTANT_MAX = 2147483647;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const TELEPHONE = /^[0-9 +().-]{6,30}$/;

export class CreerFournisseurDto {
  @ApiProperty({ example: 'Sopharma', description: 'Nom du fournisseur' })
  @IsString()
  @Transform(rognerTexte)
  @Length(2, 100)
  nom: string;

  @ApiPropertyOptional({
    example: '+224 620 00 00 00',
    description: 'Téléphone du fournisseur, facultatif',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @Matches(TELEPHONE)
  telephone?: string;
}

export class LigneReceptionDto {
  @ApiProperty({ description: 'Identifiant de la fiche de stock reçue' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @ApiPropertyOptional({
    example: 'A123',
    description: 'Numéro inscrit sur la boîte, facultatif',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  numeroLot?: string;

  @ApiPropertyOptional({
    example: '2027-12-31',
    description:
      'AAAA-MM-JJ, obligatoire sauf sansPeremption (DATE_PEREMPTION_REQUISE), jamais passée (DATE_PEREMPTION_PASSEE)',
  })
  @IsOptional()
  @IsString()
  @Matches(JOUR)
  dateExpiration?: string;

  @ApiPropertyOptional({
    example: false,
    description:
      'Vrai pour un médicament sans date de péremption (sans date, la ligne est refusée)',
  })
  @IsOptional()
  @IsBoolean()
  sansPeremption?: boolean;

  @ApiPropertyOptional({
    example: 10,
    description:
      "Exactement un des deux : boîtes (multipliées par le nombre d'unités par boîte de la fiche) ou unités",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  nombreBoites?: number;

  @ApiPropertyOptional({
    example: 15,
    description:
      "Exactement un des deux : boîtes (multipliées par le nombre d'unités par boîte de la fiche) ou unités",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantiteUnites?: number;

  @ApiPropertyOptional({
    example: 1000,
    description:
      'Coût d’achat d’une boîte en GNF ; absent : coût inconnu, marge non calculable',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  coutAchatBoite?: number;

  @ApiPropertyOptional({
    description: 'Code article du fournisseur, facultatif',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  codeArticleFournisseur?: string;

  @ApiPropertyOptional({ description: 'Code-barres, facultatif' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  codeBarres?: string;

  @ApiPropertyOptional({
    description: 'Quantité commandée en boîtes, facultative',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  quantiteCommandee?: number;

  @ApiPropertyOptional({
    description:
      'Prix public de la boîte en GNF, facultatif ; ne modifie jamais le prix de la fiche',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  prixPublicBoite?: number;

  @ApiPropertyOptional({ description: 'Code TVA de la facture, facultatif' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(10)
  codeTva?: string;

  @ApiPropertyOptional({
    description:
      'Taux de TVA en pour mille (180 = 18 %, 55 = 5,5 %), facultatif',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  tauxTvaPourMille?: number;

  @ApiPropertyOptional({
    description:
      'Montant hors taxes de la ligne en GNF, facultatif (coût d’achat, retiré sans marge:read)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  montantHTLigne?: number;

  @ApiPropertyOptional({ description: 'Boîtes par colis, facultatif' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  colisage?: number;

  @ApiPropertyOptional({
    description: 'Tableau : liste I, liste II, stupéfiant…, facultatif',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(20)
  tableau?: string;

  @ApiPropertyOptional({ description: 'Bon de préparation, facultatif' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  bonPreparation?: string;
}

export class CreerReceptionDto {
  @ApiPropertyOptional({
    description: 'Identifiant choisi par le client pour rejouer sans doublon',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ description: 'Identifiant du fournisseur' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  fournisseurId?: string;

  @ApiPropertyOptional({
    example: 'BL-2026-0142',
    description: 'Référence du bon de livraison, facultative',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({
    example: '2026-10-27T09:30:00.000Z',
    description:
      'Date et heure de réception, maintenant par défaut, jamais dans le futur',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  recueLe?: string;

  @ApiPropertyOptional({
    description: 'Numéro de la facture fournisseur, facultatif',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  numeroFacture?: string;

  @ApiPropertyOptional({ description: 'Référence de la commande, facultative' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(64)
  referenceCommande?: string;

  @ApiPropertyOptional({
    example: '2026-11-05',
    description: 'Date de la facture, AAAA-MM-JJ, facultative',
  })
  @IsOptional()
  @IsString()
  @Matches(JOUR)
  dateFacture?: string;

  @ApiPropertyOptional({
    description: 'Nombre de pages de la facture, facultatif',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  nombrePages?: number;

  @ApiPropertyOptional({
    description:
      'Montant hors taxes en GNF, facultatif (retiré sans marge:read)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  montantHT?: number;

  @ApiPropertyOptional({
    description: 'Total de la TVA en GNF, facultatif (retiré sans marge:read)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  totalTva?: number;

  @ApiPropertyOptional({
    description:
      'Montant toutes taxes comprises en GNF, facultatif (retiré sans marge:read)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  montantTTC?: number;

  @ApiPropertyOptional({
    description: 'Net à payer en GNF, facultatif (retiré sans marge:read)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MONTANT_MAX)
  netAPayer?: number;

  @ApiProperty({ type: [LigneReceptionDto], description: 'Lignes reçues' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LigneReceptionDto)
  lignes: LigneReceptionDto[];
}

export class ListerReceptionsDto {
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

export class CorrigerLotDto {
  @ApiPropertyOptional({
    example: '2027-12-31',
    description: 'Nouvelle date de péremption, AAAA-MM-JJ',
  })
  @IsOptional()
  @IsString()
  @Matches(JOUR)
  dateExpiration?: string;

  @ApiPropertyOptional({
    description: 'Vrai pour retirer la date : le lot n’a pas de péremption',
  })
  @IsOptional()
  @IsBoolean()
  sansPeremption?: boolean;

  @ApiPropertyOptional({
    example: 'Erreur de saisie',
    description: 'Obligatoire, 3 à 300 caractères (sinon MOTIF_REQUIS)',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  motif?: string;
}
