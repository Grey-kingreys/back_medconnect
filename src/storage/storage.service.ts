import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { StoredFileBucket, StoredFileStatus } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  MIME_TO_EXT,
  PRESIGNED_READ_TTL,
  PRESIGNED_UPLOAD_TTL,
  R2_CLIENT,
  STORAGE_POLICY,
  StorageVisibility,
} from './storage.constants';

/** Fichier tel qu'exposé à l'appelant (jamais la clé brute côté client final si privé). */
export interface StoredFileView {
  id: string;
  key: string;
  bucket: StoredFileBucket;
  mimeType: string;
  size: number;
  originalName: string;
  status: StoredFileStatus;
  createdAt: Date;
  confirmedAt: Date | null;
  /** URL publique pérenne (bucket public) ou `null` (privé → passer par une URL présignée). */
  url: string | null;
}

/** Entrée d'un upload serveur (sous-ensemble d'`Express.Multer.File`). */
export interface UploadInput {
  buffer: Buffer | Uint8Array;
  mimetype: string;
  originalname?: string;
  size?: number;
}

/**
 * Accès unifié au stockage objets Cloudflare R2 (S3-compatible), isolé du reste
 * de l'application. Deux buckets : public (avatars/logos, servis via CDN) et privé
 * (documents médicaux, URLs présignées courtes uniquement).
 *
 * Règles structurantes :
 *  - le `S3Client` est instancié UNE seule fois (provider `R2_CLIENT`, cf. module) ;
 *  - la clé d'objet ne réutilise JAMAIS le nom original (path traversal / collision /
 *    fuite d'info patient) — cf. `buildKey` ;
 *  - la whitelist MIME et les tailles max sont appliquées CÔTÉ SERVEUR (STORAGE_POLICY) ;
 *  - on ne persiste JAMAIS d'URL présignée : seule la `key` est stockée (StoredFile).
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicBaseUrl: string;
  private purgeTimer?: NodeJS.Timeout;

  constructor(
    @Inject(R2_CLIENT) private readonly client: S3Client,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.publicBucket = this.config.getOrThrow<string>('R2_BUCKET_PUBLIC');
    this.privateBucket = this.config.getOrThrow<string>('R2_BUCKET_PRIVATE');
    // Retire un éventuel `/` final pour une concaténation propre des URLs publiques.
    this.publicBaseUrl = this.config.getOrThrow<string>('R2_PUBLIC_URL').replace(/\/+$/, '');
  }

  // ─── Cycle de vie ─────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.verifyBuckets();
    this.schedulePurge();
  }

  onModuleDestroy(): void {
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /** Vérifie (sans bloquer le boot) que les deux buckets sont joignables. */
  private async verifyBuckets(): Promise<void> {
    const cibles: Array<[StorageVisibility, string]> = [
      ['public', this.publicBucket],
      ['private', this.privateBucket],
    ];
    for (const [visibility, bucket] of cibles) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
        this.logger.log(`✅ Bucket R2 ${visibility} « ${bucket} » joignable.`);
      } catch (err: any) {
        this.logger.warn(
          `Bucket R2 ${visibility} « ${bucket} » injoignable au démarrage : ${err?.message ?? err}`,
        );
      }
    }
  }

  /** Planifie une purge quotidienne des uploads `pending` périmés. */
  private schedulePurge(): void {
    if (process.env.NODE_ENV === 'test') return;
    const UN_JOUR = 24 * 60 * 60 * 1000;
    this.purgeTimer = setInterval(() => {
      void this.purgeStalePending().catch((e) =>
        this.logger.warn(`Purge périodique échouée : ${(e as Error).message}`),
      );
    }, UN_JOUR);
    // Ne pas maintenir le process en vie uniquement pour ce timer.
    this.purgeTimer.unref?.();
  }

  // ─── Primitives R2 ────────────────────────────────────────────

  /**
   * Upload direct depuis le backend (ex. PDF d'ordonnance généré côté serveur).
   * Ne crée PAS de `StoredFile` : la persistance est portée par le flux présigné
   * (`createUploadTicket` / `confirmUpload`). Retourne l'URL publique si `public`.
   */
  async upload(
    file: UploadInput,
    prefix: string,
    visibility: StorageVisibility,
  ): Promise<{ key: string; url: string | null }> {
    this.assertMimeAllowed(file.mimetype, visibility);
    this.assertSizeAllowed(file.size, visibility);

    const key = this.buildKey(prefix, file.mimetype);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketNameFor(visibility),
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return { key, url: visibility === 'public' ? this.getPublicUrl(key) : null };
  }

  /**
   * URL PUT présignée : le client téléverse directement sur R2 (le fichier ne
   * transite pas par l'API). TTL = 600 s. Retourne aussi la `key` générée.
   * `filename` n'entre pas dans la clé — il n'est conservé que pour l'affichage.
   */
  async getSignedUploadUrl(
    prefix: string,
    filename: string,
    contentType: string,
    visibility: StorageVisibility,
  ): Promise<{ key: string; url: string; expiresIn: number }> {
    void filename; // conservé par la couche de persistance (originalName), pas dans la clé
    this.assertMimeAllowed(contentType, visibility);
    const key = this.buildKey(prefix, contentType);
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucketNameFor(visibility),
        Key: key,
        ContentType: contentType,
      }),
      { expiresIn: PRESIGNED_UPLOAD_TTL },
    );
    return { key, url, expiresIn: PRESIGNED_UPLOAD_TTL };
  }

  /** URL GET présignée sur le bucket PRIVÉ (documents médicaux). TTL = 300 s par défaut. */
  async getSignedReadUrl(key: string, expiresIn: number = PRESIGNED_READ_TTL): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.privateBucket, Key: key }),
      { expiresIn },
    );
  }

  /** URL publique pérenne (bucket public via domaine custom). */
  getPublicUrl(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }

  async delete(key: string, visibility: StorageVisibility): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucketNameFor(visibility), Key: key }),
    );
  }

  /** Vrai si l'objet existe dans le bucket (via HeadObject). */
  async exists(key: string, visibility: StorageVisibility): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketNameFor(visibility), Key: key }),
      );
      return true;
    } catch (err: any) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return false;
      throw err;
    }
  }

  // ─── Flux présigné avec persistance (StoredFile) ──────────────

  /**
   * Étape 1 : crée un `StoredFile` en `pending` et renvoie une URL PUT présignée.
   * L'appelant (contrôleur) fournit le `ownerId` issu du JWT.
   */
  async createUploadTicket(params: {
    ownerId: string;
    prefix?: string;
    filename: string;
    contentType: string;
    visibility: StorageVisibility;
    size?: number;
  }): Promise<{ id: string; key: string; uploadUrl: string; expiresIn: number }> {
    const { ownerId, prefix, filename, contentType, visibility, size } = params;
    this.assertSizeAllowed(size, visibility);

    const { key, url, expiresIn } = await this.getSignedUploadUrl(
      prefix ?? 'divers',
      filename,
      contentType,
      visibility,
    );

    const stored = await this.prisma.storedFile.create({
      data: {
        key,
        bucket: this.bucketEnum(visibility),
        mimeType: contentType,
        size: size ?? 0,
        originalName: filename,
        ownerId,
        status: StoredFileStatus.PENDING,
      },
      select: { id: true },
    });

    return { id: stored.id, key, uploadUrl: url, expiresIn };
  }

  /**
   * Étape 2 : confirme un upload présigné. Vérifie via HeadObject que l'objet
   * existe réellement, recontrôle la taille réelle (le client ne peut pas
   * contourner la limite), puis passe le `StoredFile` en `confirmed`.
   */
  async confirmUpload(params: { id: string; ownerId: string }): Promise<StoredFileView> {
    const { id, ownerId } = params;
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file || file.ownerId !== ownerId) {
      throw new NotFoundException('Fichier introuvable.');
    }
    if (file.status === StoredFileStatus.CONFIRMED) {
      return this.toView(file); // idempotent
    }

    const visibility = this.visibilityOf(file.bucket);
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucketNameFor(visibility), Key: file.key }),
      );
    } catch {
      throw new BadRequestException(
        "L'upload n'a pas été trouvé sur le stockage. Retéléversez le fichier puis réessayez.",
      );
    }

    const realSize = head.ContentLength ?? file.size;
    const { maxSize } = STORAGE_POLICY[visibility];
    if (realSize > maxSize) {
      // Fichier trop volumineux : on nettoie l'objet et l'enregistrement.
      await this.delete(file.key, visibility).catch(() => undefined);
      await this.prisma.storedFile.delete({ where: { id } }).catch(() => undefined);
      throw new BadRequestException(
        `Fichier trop volumineux (${realSize} octets). Maximum ${maxSize} octets pour un fichier ${visibility}.`,
      );
    }

    const updated = await this.prisma.storedFile.update({
      where: { id },
      data: { status: StoredFileStatus.CONFIRMED, confirmedAt: new Date(), size: realSize },
    });
    return this.toView(updated);
  }

  // ─── Rattachement à une entité métier (avatar, logo, document…) ─

  /**
   * Vérifie qu'un fichier peut être RATTACHÉ à une entité : il existe, appartient à
   * `ownerId`, est CONFIRMÉ (upload terminé) et dans le bon bucket (public pour un
   * avatar/logo, privé pour un document médical). Défense contre le rattachement d'un
   * fichier d'autrui ou d'un upload jamais finalisé.
   */
  async assertLinkable(
    fileId: string,
    ownerId: string,
    visibility: StorageVisibility,
  ): Promise<void> {
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { ownerId: true, bucket: true, status: true },
    });
    if (!file) throw new NotFoundException('Fichier introuvable.');
    if (file.ownerId !== ownerId) {
      throw new ForbiddenException("Ce fichier ne vous appartient pas.");
    }
    if (file.status !== StoredFileStatus.CONFIRMED) {
      throw new BadRequestException(
        "Upload non confirmé : confirmez le fichier (POST /storage/confirm) avant de le rattacher.",
      );
    }
    if (file.bucket !== this.bucketEnum(visibility)) {
      throw new BadRequestException(`Ce fichier n'est pas dans l'espace « ${visibility} ».`);
    }
  }

  /**
   * Rattache un document médical PRIVÉ (fraîchement téléversé par `uploaderId`) au
   * carnet de `patientId`. Le document « appartient » au patient : `FileAccessService`
   * autorise toujours le propriétaire à le lire, et le soignant y accède via son
   * équipe de soin. On transfère donc la propriété du fichier au patient.
   */
  async claimPrivateForPatient(
    fileId: string,
    uploaderId: string,
    patientId: string,
  ): Promise<void> {
    await this.assertLinkable(fileId, uploaderId, 'private');
    if (patientId !== uploaderId) {
      await this.prisma.storedFile.update({
        where: { id: fileId },
        data: { ownerId: patientId },
      });
    }
  }

  /** URL publique pérenne d'un fichier (bucket public) à partir de son id, ou null. */
  async getPublicUrlById(fileId: string | null | undefined): Promise<string | null> {
    if (!fileId) return null;
    const file = await this.prisma.storedFile.findUnique({
      where: { id: fileId },
      select: { key: true, bucket: true },
    });
    if (!file || file.bucket !== StoredFileBucket.PUBLIC) return null;
    return this.getPublicUrl(file.key);
  }

  /** Charge un `StoredFile` par id (404 sinon). Le contrôle d'accès est fait à part. */
  async getStoredFileOrThrow(id: string): Promise<StoredFileView & { ownerId: string }> {
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('Fichier introuvable.');
    return { ...this.toView(file), ownerId: file.ownerId };
  }

  /**
   * Supprime un fichier (objet R2 + enregistrement). Propriétaire ou rôle
   * administratif uniquement. Un document médical PRIVÉ déjà confirmé n'est pas
   * supprimable par le propriétaire (conservation) — réservé à l'administration.
   */
  async deleteStoredFile(params: {
    id: string;
    requester: { userId: string; role?: string };
  }): Promise<void> {
    const { id, requester } = params;
    const file = await this.prisma.storedFile.findUnique({ where: { id } });
    if (!file) throw new NotFoundException('Fichier introuvable.');

    const isOwner = file.ownerId === requester.userId;
    const isAdmin = requester.role === 'SUPER_ADMIN' || requester.role === 'ADMIN';
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à supprimer ce fichier.");
    }
    if (
      file.status === StoredFileStatus.CONFIRMED &&
      file.bucket === StoredFileBucket.PRIVATE &&
      !isAdmin
    ) {
      throw new ForbiddenException(
        'Les documents médicaux confirmés suivent la politique de conservation du carnet de santé ' +
          "et ne peuvent pas être supprimés par cette voie.",
      );
    }

    await this.delete(file.key, this.visibilityOf(file.bucket)).catch((e) =>
      this.logger.warn(`Suppression R2 échouée (${file.key}) : ${(e as Error).message}`),
    );
    await this.prisma.storedFile.delete({ where: { id } });
  }

  /**
   * Purge les uploads restés `pending` au-delà de `olderThanHours` (24 h par défaut) :
   * abandons du flux présigné. Best-effort côté R2 (l'objet peut n'avoir jamais existé).
   */
  async purgeStalePending(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const stale = await this.prisma.storedFile.findMany({
      where: { status: StoredFileStatus.PENDING, createdAt: { lt: cutoff } },
      select: { id: true, key: true, bucket: true },
    });
    let purged = 0;
    for (const f of stale) {
      await this.delete(f.key, this.visibilityOf(f.bucket)).catch(() => undefined);
      await this.prisma.storedFile.delete({ where: { id: f.id } }).catch(() => undefined);
      purged++;
    }
    if (purged > 0) {
      this.logger.log(`Purge stockage : ${purged} upload(s) « pending » périmé(s) supprimé(s).`);
    }
    return purged;
  }

  // ─── Helpers privés ───────────────────────────────────────────

  /**
   * Construit la clé d'objet : `{prefix}/{YYYY}/{MM}/{uuid}.{ext}`.
   * L'extension est dérivée du type MIME (jamais du nom original).
   */
  private buildKey(prefix: string, contentType: string): string {
    const safePrefix = this.sanitizePrefix(prefix);
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const ext = MIME_TO_EXT[contentType] ?? 'bin';
    return `${safePrefix}/${yyyy}/${mm}/${randomUUID()}.${ext}`;
  }

  /** Normalise un préfixe (défense en profondeur, même si le DTO le valide déjà). */
  private sanitizePrefix(prefix?: string): string {
    const cleaned = (prefix ?? 'divers')
      .toLowerCase()
      .replace(/[^a-z0-9/_-]/g, '-')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\/{2,}/g, '/');
    return cleaned || 'divers';
  }

  private assertMimeAllowed(contentType: string, visibility: StorageVisibility): void {
    const { mimes } = STORAGE_POLICY[visibility];
    if (!mimes.includes(contentType)) {
      throw new BadRequestException(
        `Type de fichier « ${contentType} » non autorisé (${visibility}). ` +
          `Types acceptés : ${mimes.join(', ')}.`,
      );
    }
  }

  private assertSizeAllowed(size: number | undefined, visibility: StorageVisibility): void {
    if (size == null) return;
    const { maxSize } = STORAGE_POLICY[visibility];
    if (size > maxSize) {
      throw new BadRequestException(
        `Fichier trop volumineux (${size} octets). Maximum ${maxSize} octets pour un fichier ${visibility}.`,
      );
    }
  }

  private bucketNameFor(visibility: StorageVisibility): string {
    return visibility === 'public' ? this.publicBucket : this.privateBucket;
  }

  private bucketEnum(visibility: StorageVisibility): StoredFileBucket {
    return visibility === 'public' ? StoredFileBucket.PUBLIC : StoredFileBucket.PRIVATE;
  }

  private visibilityOf(bucket: StoredFileBucket): StorageVisibility {
    return bucket === StoredFileBucket.PUBLIC ? 'public' : 'private';
  }

  private toView(file: {
    id: string;
    key: string;
    bucket: StoredFileBucket;
    mimeType: string;
    size: number;
    originalName: string;
    status: StoredFileStatus;
    createdAt: Date;
    confirmedAt: Date | null;
  }): StoredFileView {
    return {
      id: file.id,
      key: file.key,
      bucket: file.bucket,
      mimeType: file.mimeType,
      size: file.size,
      originalName: file.originalName,
      status: file.status,
      createdAt: file.createdAt,
      confirmedAt: file.confirmedAt,
      url: file.bucket === StoredFileBucket.PUBLIC ? this.getPublicUrl(file.key) : null,
    };
  }
}
