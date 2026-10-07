// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly apiUrl = 'https://api.nimbasms.com/v1/messages';
  private readonly sid = process.env.NIMBA_SID;
  private readonly token = process.env.NIMBA_TOKEN;
  private readonly sender = process.env.NIMBA_SENDER || 'MedConnecte';

  /**
   * Envoie un SMS via Nimba SMS
   * @param to Numéro de téléphone (ex: +224622000000)
   * @param message Contenu du message
   */
  async sendSms(to: string, message: string): Promise<boolean> {
    if (!this.sid || !this.token) {
      this.logger.error(
        'Identifiants Nimba SMS manquants dans le fichier .env',
      );
      return false;
    }

    try {
      // Nettoyer le numéro : garder uniquement les chiffres
      let cleanNumber = to.replace(/\D/g, ''); // \D enlève tout ce qui n'est pas un chiffre

      // Si c'est un numéro guinéen local (9 chiffres), ajouter le préfixe 224
      if (cleanNumber.length === 9) {
        cleanNumber = `224${cleanNumber}`;
      }

      const auth = Buffer.from(`${this.sid}:${this.token}`).toString('base64');

      // Utiliser l'expéditeur défini dans le .env (Max 11 caractères, pas d'espaces pour le standard SMS)
      const rawSender = this.sender || 'Nimba';
      const finalSender = rawSender.replace(/\s/g, '').substring(0, 11);

      const response = await axios.post(
        this.apiUrl,
        {
          to: [cleanNumber],
          message: message,
          sender_name: finalSender,
        },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        },
      );

      this.logger.log(
        `SMS envoyé au ${this.masquerNumero(cleanNumber)} avec succès (ID: ${response.data.id || 'N/A'})`,
      );
      return true;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message;
      // Pas le corps brut de la réponse du fournisseur : il peut contenir le numéro
      this.logger.error(
        `Échec de l'envoi du SMS au ${this.masquerNumero(to)} (statut HTTP : ${error.response?.status ?? 'aucun'}) : ${errorMessage}`,
      );
      return false;
    }
  }

  /**
   * Masque un numéro de téléphone pour les logs : seuls les 2 derniers chiffres restent visibles
   */
  private masquerNumero(numero: string): string {
    return `***${numero.replace(/\D/g, '').slice(-2)}`;
  }

  /**
   * Envoie un SMS d'urgence (SOS)
   */
  async sendEmergencySms(
    to: string,
    patientName: string,
    location?: string,
  ): Promise<boolean> {
    const locText = location ? ` à ${location}` : '';
    const message = `[URGENCE MedConnecte] SOS déclenché par ${patientName}${locText}. Veuillez vérifier son état immédiatement.`;
    return this.sendSms(to, message);
  }
}
