import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  NOTIFICATIONS_QUEUE,
  SmsJob,
  SosJob,
  WelcomeEmailJob,
  EmergencyEmailJob,
} from './notifications.processor';

/** Options par défaut : 3 tentatives, backoff exponentiel, purge des jobs terminés. */
const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: true,
  removeOnFail: 100,
};

/**
 * Façade d'enqueue. Les autres services appellent ces méthodes au lieu
 * d'invoquer directement Resend/Nimba → réponse HTTP immédiate, envoi en
 * arrière-plan avec retries.
 */
@Injectable()
export class QueueService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue) {}

  enqueueSms(payload: SmsJob) {
    return this.queue.add('sms', payload, DEFAULT_JOB_OPTS);
  }

  enqueueSos(payload: SosJob) {
    return this.queue.add('sos', payload, { ...DEFAULT_JOB_OPTS, priority: 1 });
  }

  enqueueWelcomeEmail(payload: WelcomeEmailJob) {
    return this.queue.add('email-welcome', payload, DEFAULT_JOB_OPTS);
  }

  enqueueEmergencyEmail(payload: EmergencyEmailJob) {
    return this.queue.add('email-emergency', payload, { ...DEFAULT_JOB_OPTS, priority: 1 });
  }

  /** Self-test optionnel au démarrage : QUEUE_SELFTEST=1 → enfile un job de contrôle. */
  async onApplicationBootstrap(): Promise<void> {
    if (process.env.QUEUE_SELFTEST === '1') {
      const job = await this.queue.add('selftest', { ts: Date.now() }, { removeOnComplete: true });
      this.logger.log(`🧪 Self-test enfilé (id=${job.id}) — en attente du processor…`);
    }
  }
}
