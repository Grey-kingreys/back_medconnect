import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Stockage objets S3-compatible — Cloudflare R2 (dev & prod).
 * Sert aux documents médicaux : résultats d'analyses, ordonnances scannées,
 * photos de profil, pièces jointes.
 *
 * Deux clients (héritage du setup MinIO interne/public) :
 *  - `client`      : opérations serveur (upload buffer, delete, head/create bucket)
 *  - `publicClient`: génération d'URLs présignées joignables par le NAVIGATEUR.
 * Avec R2 il n'y a pas de séparation interne/public : si `S3_PUBLIC_ENDPOINT`
 * est vide, `publicClient` réutilise le même endpoint que `client` (S3_ENDPOINT).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.S3_BUCKET || 'medconnecte';
  private readonly client: S3Client;
  private readonly publicClient: S3Client;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT || endpoint;
    const region = process.env.S3_REGION || 'us-east-1';
    const credentials = {
      accessKeyId: process.env.S3_ACCESS_KEY || '',
      secretAccessKey: process.env.S3_SECRET_KEY || '',
    };
    // forcePathStyle : indispensable pour MinIO (pas de virtual-hosted-style).
    this.client = new S3Client({
      endpoint,
      region,
      credentials,
      forcePathStyle: true,
    });
    this.publicClient = new S3Client({
      endpoint: publicEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });
  }

  /** Crée le bucket au démarrage s'il n'existe pas (idempotent, non bloquant). */
  async onModuleInit(): Promise<void> {
    if (!process.env.S3_ACCESS_KEY) {
      this.logger.warn('S3_ACCESS_KEY absent — stockage objets non configuré.');
      return;
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`✅ Bucket S3 « ${this.bucket} » prêt.`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`✅ Bucket S3 « ${this.bucket} » créé.`);
      } catch (err: any) {
        // Ne pas faire échouer le boot si le stockage est momentanément indisponible.
        this.logger.error(`Stockage objets indisponible : ${err.message}`);
      }
    }
  }

  /** Upload direct d'un buffer (ex. PDF généré côté serveur). */
  async uploadBuffer(
    key: string,
    body: Buffer | Uint8Array | string,
    contentType?: string,
  ): Promise<{ key: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return { key };
  }

  /**
   * URL présignée d'UPLOAD (PUT) : le client (navigateur/mobile) envoie le
   * fichier directement à MinIO/S3 sans transiter par l'API.
   */
  async getPresignedUploadUrl(
    key: string,
    contentType?: string,
    expiresIn = 900,
  ): Promise<{ key: string; url: string; expiresIn: number }> {
    const url = await getSignedUrl(
      this.publicClient,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn },
    );
    return { key, url, expiresIn };
  }

  /** URL présignée de TÉLÉCHARGEMENT (GET), expirante. */
  async getPresignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
