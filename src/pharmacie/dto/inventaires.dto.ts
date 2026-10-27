import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RAISONS_SORTIE, type RaisonSortie } from '../domaine/sortie';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreerSortieStockDto {
  @ApiPropertyOptional({
    description: 'Identifiant choisi par le client pour rejouer sans doublon',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ description: 'Identifiant de la fiche de stock' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @ApiProperty({ description: 'Identifiant du lot sorti' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @ApiProperty({
    enum: ['BOITE', 'UNITE'],
    description:
      'BOITE : boîtes du lot (unités par boîte du lot) ; UNITE : unités minimales',
  })
  @IsIn(['BOITE', 'UNITE'])
  unite: 'BOITE' | 'UNITE';

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(1000000000)
  quantite: number;

  @ApiPropertyOptional({
    enum: RAISONS_SORTIE,
    description: 'Obligatoire (400 MOTIF_REQUIS sinon)',
  })
  @IsOptional()
  @IsIn(RAISONS_SORTIE)
  raison?: RaisonSortie;

  @ApiPropertyOptional({
    example: 'Flacon tombé',
    description: 'Précision, obligatoire pour AUTRE (3 caractères au moins)',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  commentaire?: string;
}

export class LigneInventaireDto {
  @ApiProperty({ description: 'Identifiant de la fiche de stock comptée' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  stockId: string;

  @ApiPropertyOptional({
    description:
      'Lot compté ; sinon numéro de lot, date de péremption, ou lot unique en stock',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId?: string;

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
    description: 'AAAA-MM-JJ ; sert à repérer le lot ou à créer un nouveau lot',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateExpiration?: string;

  @ApiPropertyOptional({
    description: "Ce médicament n'a pas de date de péremption",
  })
  @IsOptional()
  @IsBoolean()
  sansPeremption?: boolean;

  @ApiPropertyOptional({
    example: 27,
    description:
      'Unités minimales comptées, ou bien nombreBoites (et unitesEnPlus)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantiteComptee?: number;

  @ApiPropertyOptional({
    example: 2,
    description:
      'Boîtes entières comptées, multipliées par les unités par boîte du lot',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000)
  nombreBoites?: number;

  @ApiPropertyOptional({
    example: 3,
    description: "Unités d'une boîte entamée, avec nombreBoites",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  unitesEnPlus?: number;
}

export class CreerInventaireDto {
  @ApiPropertyOptional({
    description: 'Identifiant choisi par le client pour rejouer sans doublon',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ example: 'Comptage du soir' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(500)
  commentaire?: string;

  @ApiProperty({ type: [LigneInventaireDto], description: 'Lignes comptées' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LigneInventaireDto)
  lignes: LigneInventaireDto[];
}

export class ListerInventairesDto {
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
