import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Informations d'appareil envoyées à la connexion (obligatoires pour l'application mobile, ignorées pour le web). */
export class InfosAppareilDto {
  @ApiPropertyOptional({
    description: "Identifiant stable de l'appareil (mobile seulement)",
    example: 'a1b2c3d4-e5f6-7890',
  })
  @IsOptional()
  @IsString()
  @Length(8, 128, { message: "L'identifiant de l'appareil n'est pas valide." })
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message: "L'identifiant de l'appareil n'est pas valide.",
  })
  deviceId?: string;

  @ApiPropertyOptional({
    description: "Plateforme de l'appareil : android ou ios (mobile seulement)",
    enum: ['android', 'ios'],
    example: 'android',
  })
  @IsOptional()
  @IsIn(['android', 'ios'], {
    message: 'La plateforme doit être android ou ios.',
  })
  plateforme?: string;

  @ApiPropertyOptional({
    description: "Nom lisible de l'appareil (mobile seulement)",
    example: 'Tecno Spark 10',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  nomAppareil?: string;

  @ApiPropertyOptional({
    description: "Version de l'application (mobile seulement)",
    example: '1.0.0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  versionApp?: string;
}
