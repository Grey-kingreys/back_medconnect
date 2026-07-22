import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Laborantin' })
  @IsString()
  @Length(2, 60)
  nom: string;

  @ApiPropertyOptional({ example: 'Saisit les résultats d’analyses.' })
  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;

  @ApiProperty({
    example: ['analyse:write', 'patient:read'],
    description: 'Codes de permissions (parmi le catalogue délégable).',
    type: [String],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Laborantin senior' })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  nom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 255)
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['analyse:write'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}
