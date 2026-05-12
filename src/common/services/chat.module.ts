import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ChatController } from './chat.controller';
import { PrismaService } from './prisma.service';
import { JwtModule } from '@nestjs/jwt';

import { NotificationsModule } from 'src/notifications/notifications.module';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, PrismaService],
  exports: [ChatService, ChatGateway],
})
export class ChatModule {}
