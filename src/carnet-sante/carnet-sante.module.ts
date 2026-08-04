import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CarnetSanteService } from './carnet-sante.service';
import { CarnetSanteController } from './carnet-sante.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';
import { AiService } from 'src/common/services/ai.service';
import { EmailService } from 'src/common/services/email.service';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from 'src/chat/chat.module';

import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  // Timeout borné sur les appels IA : sans lui, axios attend indéfiniment et une
  // requête vers un service endormi (Hugging Face Space, ~15-30 s de réveil) gèle
  // l'endpoint. Passé ce délai, AiService retombe sur sa réponse de repli.
  imports: [
    AuthModule,
    HttpModule.register({ timeout: 25000 }),
    ConfigModule,
    ChatModule,
    NotificationsModule,
  ],
  controllers: [CarnetSanteController],
  providers: [CarnetSanteService, PrismaService, AiService, EmailService],
  exports: [CarnetSanteService],
})
export class CarnetSanteModule { }