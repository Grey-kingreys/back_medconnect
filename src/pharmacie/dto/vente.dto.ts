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

/** Téléphone du prescripteur : texte nettoyé, vide -> null (absent -> undefined). */
export const nettoyerTelephonePrescripteur = ({
  value,
}: {
  value: unknown;
}): unknown => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? null : t;
};

/** Chiffres, espaces, +, tirets ; 6 à 20 chiffres utiles. */
export const FORMAT_TELEPHONE_PRESCRIPTEUR =
  /^(?=(?:\D*\d){6,20}\D*$)\+?[\d\s-]+$/;

export const UNITES_VENTE = ['BOITE', 'UNITE'] as const;
export type UniteVenteSaisie = (typeof UNITES_VENTE)[number];

export class SortieManuelleDto {
  @ApiProperty({
    description: 'Lot choisi par le vendeur (périmé ou contre l’ordre FEFO)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  lotId: string;

  @ApiPropertyOptional({
    example: 'Dernière boîte, client informé',
    description: 'Obligatoire, 3 à 300 caractères (sinon MOTIF_REQUIS)',
  })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(300)
  motif?: string;
}

export class LigneVenteDto {
  @ApiProperty({
    description: 'Identifiant de la ligne de stock de la pharmacie',
    example: '3f2b8c1e-5a47-4d9e-9b1a-7c6d2e8f0a11',
  })
  @IsString()
  @IsNotEmpty()
  stockId: string;

  @ApiProperty({
    example: 2,
    minimum: 1,
    maximum: 10000,
    description: "Nombre de boîtes, ou d'unités si unite = UNITE",
  })
  @IsInt()
  @Min(1)
  @Max(10000)
  quantite: number;

  @ApiPropertyOptional({
    enum: UNITES_VENTE,
    description: 'Absent : BOITE',
  })
  @IsOptional()
  @IsIn(UNITES_VENTE)
  unite?: UniteVenteSaisie;

  @ApiPropertyOptional({ type: SortieManuelleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SortieManuelleDto)
  sortieManuelle?: SortieManuelleDto;
}

export class PaiementVenteDto {
  @ApiProperty({ example: 'ESPECES', description: 'Code du mode de paiement' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  mode: string;

  @ApiProperty({ example: 5000, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  montant: number;

  @ApiPropertyOptional({ example: 'OM-778899' })
  @IsOptional()
  @IsString()
  @Transform(rognerTexte)
  @MaxLength(100)
  reference?: string;

  @ApiPropertyOptional({
    example: 10000,
    description: 'Somme remise par le client (espèces), pour calculer le rendu',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  montantRecu?: number;
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

  @ApiPropertyOptional({
    example: '+224 622 11 22 33',
    nullable: true,
    description:
      "Téléphone du prescripteur lu sur l'ordonnance papier (facultatif ; chiffres, espaces, +, tirets ; 6 à 20 chiffres). Vide : non renseigné.",
  })
  @IsOptional()
  @Transform(nettoyerTelephonePrescripteur)
  @IsString()
  @MaxLength(30)
  @Matches(FORMAT_TELEPHONE_PRESCRIPTEUR, {
    message:
      'Le téléphone du prescripteur ne doit contenir que des chiffres, espaces, + et tirets (6 à 20 chiffres).',
  })
  telephonePrescripteur?: string | null;

  @ApiPropertyOptional({
    type: [PaiementVenteDto],
    description:
      'Paiements (1 à 5, un par mode). Absent : espèces pour le total.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => PaiementVenteDto)
  paiements?: PaiementVenteDto[];

  @ApiPropertyOptional({
    description:
      "Poste de caisse ; absent : poste web de l'utilisateur, créé à la volée",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  posteId?: string;
}

export class AnnulerVenteDto {
  @ApiProperty({ example: 'Erreur de quantité', minLength: 3, maxLength: 300 })
  @IsString()
  @Transform(rognerTexte)
  @Length(3, 300)
  motif: string;

  @ApiPropertyOptional({
    description:
      "Poste de caisse d'où sort le remboursement ; absent : poste web de l'utilisateur, créé à la volée",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  posteId?: string;
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
