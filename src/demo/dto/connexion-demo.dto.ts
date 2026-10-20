import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class ConnexionDemoDto {
  @ApiProperty({
    description: 'Identifiant du compte démo, lu dans GET /auth/demo/comptes',
    example: '3f1c2a7e-8d4b-4c1e-9a55-2b7f0c9e6d10',
  })
  @IsNotEmpty({ message: 'Choisissez un compte de démonstration.' })
  @IsUUID('4', {
    message:
      "Ce compte de démonstration n'a pas été reconnu. Choisissez-en un dans la liste proposée.",
  })
  userId: string;
}
