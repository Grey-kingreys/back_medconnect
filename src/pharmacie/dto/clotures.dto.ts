import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const rognerTexte = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CloturerJourneeDto {
  @ApiProperty({
    example: '2026-10-30',
    description: 'Jour métier à clôturer, AAAA-MM-JJ',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  jour: string;

  @ApiPropertyOptional({
    description:
      'Clôturer sans attendre les postes desktop attendus (motif obligatoire)',
  })
  @IsOptional()
  @IsBoolean()
  forcer?: boolean;

  @ApiPropertyOptional({
    maxLength: 500,
    example: 'Poste D1 en panne, ventes saisies demain',
  })
  @IsOptional()
  @Transform(rognerTexte)
  @IsString()
  @MaxLength(500)
  motifForcage?: string;
}

export class ListerCloturesQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'Mois AAAA-MM (défaut : mois en cours)',
  })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  mois?: string;
}
