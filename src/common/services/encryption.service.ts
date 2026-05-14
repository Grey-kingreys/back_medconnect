import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private configService: ConfigService) {
    const secret = this.configService.get<string>('ENCRYPTION_KEY');
    if (!secret || secret.length !== 64) {
      throw new Error('ENCRYPTION_KEY doit être une chaîne hexadécimale de 64 caractères (32 octets)');
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
    if (!encryptedData || !encryptedData.includes(':')) return encryptedData;

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
      console.error('Erreur de décryptage :', error.message);
      return ' [Donnée illisible] ';
    }
  }
}
