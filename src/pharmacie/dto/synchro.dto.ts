import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CatalogueSynchroQueryDto {
  @ApiProperty({ description: 'Identifiant du poste desktop' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  posteId: string;
}
