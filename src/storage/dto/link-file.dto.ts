import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Rattachement d'un fichier R2 déjà téléversé ET confirmé à une entité métier
 * (avatar utilisateur, logo structure, document médical…). On ne transmet que
 * l'`id` du `StoredFile` — le fichier lui-même a transité directement vers R2.
 */
export class LinkFileDto {
  @ApiProperty({ description: 'Identifiant du StoredFile confirmé à rattacher.' })
  @IsUUID()
  fileId: string;
}
