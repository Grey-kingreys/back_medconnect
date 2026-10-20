import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

// Format stocké : IV (12 octets) : tag GCM (16 octets) : texte chiffré, en hexadécimal
const FORMAT_CHIFFRE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]*$/i;

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;
  private readonly logger = new Logger(EncryptionService.name);

  constructor(private configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_KEY');
    if (!secret || secret.length !== 64) {
      throw new Error(
        'ENCRYPTION_KEY doit être une chaîne hexadécimale de 64 caractères (32 octets)',
      );
    }
    this.key = Buffer.from(secret, 'hex');
  }

  /**
   * Crypte une chaîne de caractères
   */
  encrypt(text: string): string {
    if (!text) return text;

    const iv = crypto.randomBytes(12); // IV de 12 octets recommandé pour GCM
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // On stocke tout ensemble : IV:AuthTag:TexteCrypté
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Décrypte une chaîne de caractères
   */
  decrypt(encryptedData: string): string {
    if (!encryptedData) return encryptedData;

    // Valeur non chiffrée (donnée ancienne ou saisie hors service) : renvoyée telle quelle,
    // signalée sans jamais journaliser son contenu.
    if (!FORMAT_CHIFFRE.test(encryptedData)) {
      this.logger.warn({
        evenement: 'encryption.valeur_non_chiffree',
        longueur: encryptedData.length,
      });
      return encryptedData;
    }

    try {
      const [ivHex, authTagHex, encryptedText] = encryptedData.split(':');

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // Clé changée ou donnée altérée : seul le type d'erreur est journalisé, jamais le contenu.
      this.logger.error({
        evenement: 'encryption.dechiffrement_echoue',
        message: 'Déchiffrement impossible : clé modifiée ou donnée altérée',
        raison: error instanceof Error ? error.name : 'inconnue',
        longueur: encryptedData.length,
      });
      return ' [Donnée illisible] ';
    }
  }
}
