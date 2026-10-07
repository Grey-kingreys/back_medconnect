import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';
import { ConversationType } from 'generated/prisma/enums';

// Corps de POST /chat/conversations/start : validé par le ValidationPipe global
export class StartConversationDto {
  @ApiProperty({
    description: "Identifiant de l'utilisateur ou de l'établissement contacté",
    example: '3f2b8c1e-6a4d-4e2b-9c1a-7d5e8f9a0b1c',
  })
  @IsUUID('all', {
    message: 'Le destinataire de la conversation est invalide.',
  })
  targetId: string;

  @ApiProperty({ enum: ConversationType, example: ConversationType.PRIVE })
  @IsEnum(ConversationType, {
    message: 'Le type de conversation est invalide.',
  })
  type: ConversationType;
}
