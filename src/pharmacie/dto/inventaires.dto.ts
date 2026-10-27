import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
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
