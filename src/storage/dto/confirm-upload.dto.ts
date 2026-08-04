import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Confirmation d'un upload présigné : passe le `StoredFile` de `pending` à `confirmed`. */
export class ConfirmUploadDto {
  @ApiProperty({ description: 'Identifiant du StoredFile créé lors de la demande d’URL présignée' })
  @IsUUID()
  id: string;
}
