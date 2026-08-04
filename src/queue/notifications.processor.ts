import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SmsService } from '../common/services/sms.service';
import { EmailService } from '../common/services/email.service';

export const NOTIFICATIONS_QUEUE = 'notifications';

/** Payloads typés des jobs de la file `notifications`. */
export interface SmsJob {
  to: string;
  message: string;
}
export interface SosJob {
  recipients: string[]; // numéros de téléphone
  patientName: string;
  location?: string;
}
export interface WelcomeEmailJob {
  email: string;
  nom: string;
  prenom: string;
}
export interface EmergencyEmailJob {
  to: string;
  contactNom: string;
  patientNom: string;
  patientPrenom: string;
  location?: { lat: number; lng: number };
  message?: string;
}

/**
 * Traite les jobs asynchrones de notification (in-process pour l'instant ;
 * peut être externalisé dans un conteneur `worker` dédié — voir WORKER_MODE
 * dans main.ts). Découple l'API des appels lents/faillibles (Nimba, Resend).
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly sms: SmsService,
    private readonly email: EmailService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'sms': {
        const { to, message } = job.data as SmsJob;
        await this.sms.sendSms(to, message);
        break;
      }
      case 'sos': {
        const { recipients, patientName, location } = job.data as SosJob;
        await Promise.allSettled(
          recipients.map((to) => this.sms.sendEmergencySms(to, patientName, location)),
        );
        break;
      }
      case 'email-welcome': {
        const { email, nom, prenom } = job.data as WelcomeEmailJob;
        await this.email.sendWelcomeEmail(email, nom, prenom);
        break;
      }
      case 'email-emergency': {
        const d = job.data as EmergencyEmailJob;
        await this.email.sendEmergencyAlertEmail(
          d.to,
          d.contactNom,
          d.patientNom,
          d.patientPrenom,
          d.location,
          d.message,
        );
        break;
      }
      case 'selftest': {
        this.logger.log(`✅ Job de self-test traité (id=${job.id}).`);
        break;
      }
      default:
        this.logger.warn(`Type de job inconnu : ${job.name}`);
    }
  }
}
