import { IsOptional, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class RapportMargeQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Premier jour AAAA-MM-JJ (défaut : 1er du mois de au)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  du?: string;

  @ApiPropertyOptional({
    example: '2026-10-27',
    description: 'Dernier jour AAAA-MM-JJ, inclus (défaut : aujourd hui)',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  au?: string;
}
