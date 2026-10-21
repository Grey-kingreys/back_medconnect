import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Corps facultatif de POST /auth/refresh et POST /auth/logout (mobile seulement). */
export class JetonRenouvellementDto {
  @ApiPropertyOptional({
    description:
      'Refresh token du mobile (absent pour le web, qui utilise le cookie)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}
