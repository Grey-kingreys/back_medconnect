import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PresignUploadDto {
  @ApiProperty({ example: 'analyse-glycemie.pdf', description: 'Nom du fichier original' })
  @IsString()
  @MaxLength(200)
  filename: string;

  @ApiPropertyOptional({ example: 'application/pdf', description: 'Type MIME du fichier' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contentType?: string;

  @ApiPropertyOptional({
    example: 'analyses',
    description: 'Dossier logique (analyses, ordonnances, profils…). Lettres/chiffres/tirets uniquement.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{1,40}$/, { message: 'category : lettres minuscules, chiffres, - et _ uniquement' })
  category?: string;
}
