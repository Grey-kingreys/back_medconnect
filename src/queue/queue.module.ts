import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import {
  NotificationsProcessor,
  NOTIFICATIONS_QUEUE,
} from './notifications.processor';
import { EmailService } from '../common/services/email.service';
import { optionsConnexionBullmq } from '../common/redis/options-redis';

/**
 * File d'attente asynchrone (BullMQ sur Redis).
 * Global → `QueueService` injectable depuis n'importe quel module.
 * (SmsService vient du SecurityModule global ; EmailService fourni ici.)
 */
@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: optionsConnexionBullmq(
        process.env.REDIS_URL || 'redis://localhost:6379',
      ),
    }),
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  providers: [QueueService, NotificationsProcessor, EmailService],
  exports: [QueueService],
})
export class QueueModule {}
