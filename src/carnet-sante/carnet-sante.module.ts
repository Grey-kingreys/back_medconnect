import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CarnetSanteService } from './carnet-sante.service';
import { CarnetSanteController } from './carnet-sante.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';
import { AiService } from 'src/common/services/ai.service';
import { EmailService } from 'src/common/services/email.service';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from 'src/common/services/chat.module';

import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [AuthModule, HttpModule, ConfigModule, ChatModule, NotificationsModule],
  controllers: [CarnetSanteController],
  providers: [CarnetSanteService, PrismaService, AiService, EmailService],
  exports: [CarnetSanteService],
})
export class CarnetSanteModule { }