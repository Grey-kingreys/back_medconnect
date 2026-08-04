import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { NotificationsProcessor, NOTIFICATIONS_QUEUE } from './notifications.processor';
import { EmailService } from '../common/services/email.service';

/** Construit les options de connexion BullMQ à partir de REDIS_URL. */
function redisConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
  };
}

/**
 * File d'attente asynchrone (BullMQ sur Redis).
 * Global → `QueueService` injectable depuis n'importe quel module.
 * (SmsService vient du SecurityModule global ; EmailService fourni ici.)
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({ connection: redisConnection() }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [QueueService, NotificationsProcessor, EmailService],
  exports: [QueueService],
})
export class QueueModule {}
