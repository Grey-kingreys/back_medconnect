import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
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

export class LigneVenteDto {
  @ApiProperty({
    description: 'Identifiant de la ligne de stock de la pharmacie',
    example: '3f2b8c1e-5a47-4d9e-9b1a-7c6d2e8f0a11',
  })
  @IsString()
  @IsNotEmpty()
  stockId: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: 10000 })
  @IsInt()
  @Min(1)
  @Max(10000)
  quantite: number;
}

export class CreerVenteDto {
  @ApiProperty({
    type: [LigneVenteDto],
    description:
      'Lignes du panier (1 à 50). Une même ligne de stock ne peut apparaître qu une fois.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LigneVenteDto)
  lignes: LigneVenteDto[];

  @ApiPropertyOptional({ example: 'Mamadou Bah' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientNom?: string;

  @ApiPropertyOptional({ example: '+224 621 00 00 00' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  clientTelephone?: string;

  @ApiPropertyOptional({
    description:
      "Le vendeur a vu l'ordonnance (obligatoire si un médicament l'exige)",
  })
  @IsOptional()
  @IsBoolean()
  ordonnanceVerifiee?: boolean;
}

export class AnnulerVenteDto {
  @ApiProperty({ example: 'Erreur de quantité', minLength: 3, maxLength: 300 })
  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;
}

export class ListerVentesQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-22',
    description: 'Jour au format AAAA-MM-JJ (défaut : aujourd hui)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
