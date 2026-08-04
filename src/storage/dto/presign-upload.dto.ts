import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, Matches, MaxLength } from 'class-validator';

/** Visibilité demandée par le client (validée, puis mappée sur le bucket R2). */
export enum FileVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/**
 * Demande d'URL présignée d'upload.
 *
 * ⚠️ La whitelist MIME est appliquée CÔTÉ SERVEUR (cf. STORAGE_POLICY) : `contentType`
 * est simplement transporté ici, sa validité dépend de la `visibility` choisie et
 * n'est pas négociable par le client.
 */
export class PresignUploadDto {
  @ApiProperty({ example: 'analyse-glycemie.pdf', description: 'Nom original (affichage seulement)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ example: 'application/pdf', description: 'Type MIME déclaré (vérifié côté serveur)' })
  @IsString()
  @MaxLength(120)
  contentType: string;

  @ApiProperty({ enum: FileVisibility, example: FileVisibility.PRIVATE })
  @IsEnum(FileVisibility, { message: 'visibility doit valoir "public" ou "private"' })
  visibility: FileVisibility;

  @ApiPropertyOptional({
    example: 'analyses',
    description: 'Dossier logique = préfixe de clé (minuscules, chiffres, - _ /).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]([a-z0-9/_-]{0,38}[a-z0-9])?$/, {
    message: 'prefix : minuscules/chiffres, séparateurs - _ /, sans / initial ou final (max 40)',
  })
  prefix?: string;

  @ApiPropertyOptional({
    example: 1_048_576,
    description: 'Taille déclarée en octets (contrôle indicatif ; la taille réelle est revérifiée à la confirmation).',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  size?: number;
}
