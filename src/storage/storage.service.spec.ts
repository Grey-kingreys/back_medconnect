import { BadRequestException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { StorageService } from './storage.service';

/**
 * Tests unitaires du StorageService (aucune infra : R2 est mocké via
 * aws-sdk-client-mock, Prisma est inerte). On vérifie les invariants de sécurité
 * du module : format des clés (jamais le nom original), whitelist MIME côté serveur,
 * sélection du bon bucket selon la visibilité, TTL des URLs présignées.
 *
 * NB : `getSignedUrl` s'exécute réellement (pure crypto, sans réseau) — il lit la
 * config du client (endpoint/credentials) mais n'appelle pas `send()`. Le mock ne
 * couvre donc que les opérations `send()` (Put/Get/Head/Delete).
 */
describe('StorageService', () => {
  const PUBLIC_BUCKET = 'medconnecte-public';
  const PRIVATE_BUCKET = 'medconnecte-private';
  const PUBLIC_URL = 'https://cdn.medconnecte.com';
  const ACCOUNT_ID = 'testaccount';

  const s3mock = mockClient(S3Client);

  const config = {
    getOrThrow: (key: string): string => {
      const values: Record<string, string> = {
        R2_BUCKET_PUBLIC: PUBLIC_BUCKET,
        R2_BUCKET_PRIVATE: PRIVATE_BUCKET,
        R2_PUBLIC_URL: PUBLIC_URL,
      };
      return values[key];
    },
  };

  let client: S3Client;
  let service: StorageService;
  let prisma: any;

  beforeEach(() => {
    s3mock.reset();
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    });
    prisma = { storedFile: {} };
    service = new StorageService(client, config as any, prisma as any);
  });

  // ─── Génération de clé ──────────────────────────────────────

  describe('buildKey (via getSignedUploadUrl)', () => {
    it('produit {prefix}/{YYYY}/{MM}/{uuid}.{ext} et ne réutilise jamais le nom original', async () => {
      const { key } = await service.getSignedUploadUrl(
        'analyses',
        'Résultat Patient Diabète.PDF',
        'application/pdf',
        'private',
      );

      const mois = String(new Date().getUTCMonth() + 1).padStart(2, '0');
      const annee = new Date().getUTCFullYear();
      expect(key).toMatch(
        new RegExp(`^analyses/${annee}/${mois}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`),
      );
      // Aucun fragment du nom original ne fuite dans la clé.
      expect(key.toLowerCase()).not.toContain('patient');
      expect(key.toLowerCase()).not.toContain('diab');
      expect(key.toLowerCase()).not.toContain('résultat');
    });

    it('dérive l’extension du type MIME, pas du nom de fichier', async () => {
      const { key } = await service.getSignedUploadUrl('avatars', 'photo.pdf', 'image/png', 'public');
      expect(key.endsWith('.png')).toBe(true);
    });

    it('génère une clé unique à chaque appel', async () => {
      const a = await service.getSignedUploadUrl('avatars', 'a.png', 'image/png', 'public');
      const b = await service.getSignedUploadUrl('avatars', 'a.png', 'image/png', 'public');
      expect(a.key).not.toEqual(b.key);
    });
  });

  // ─── Whitelist MIME (côté serveur) ──────────────────────────

  describe('whitelist MIME', () => {
    it('rejette un MIME hors whitelist (privé)', async () => {
      await expect(
        service.getSignedUploadUrl('docs', 'x.exe', 'application/x-msdownload', 'private'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejette un PDF pour un fichier public (réservé aux images)', async () => {
      await expect(
        service.getSignedUploadUrl('avatars', 'x.pdf', 'application/pdf', 'public'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepte le DICOM pour un document médical privé', async () => {
      const { key } = await service.getSignedUploadUrl('imagerie', 'scan', 'application/dicom', 'private');
      expect(key.endsWith('.dcm')).toBe(true);
    });

    it('upload() rejette un MIME non autorisé sans jamais appeler R2', async () => {
      await expect(
        service.upload({ buffer: Buffer.from('x'), mimetype: 'text/html' }, 'docs', 'private'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(s3mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    });
  });

  // ─── Sélection du bucket selon la visibilité ────────────────

  describe('sélection du bucket', () => {
    it('signe l’upload public contre le bucket public', async () => {
      const { url } = await service.getSignedUploadUrl('avatars', 'a.png', 'image/png', 'public');
      expect(url.toLowerCase()).toContain(PUBLIC_BUCKET);
      expect(url.toLowerCase()).not.toContain(PRIVATE_BUCKET);
    });

    it('signe l’upload privé contre le bucket privé', async () => {
      const { url } = await service.getSignedUploadUrl('docs', 'a.pdf', 'application/pdf', 'private');
      expect(url.toLowerCase()).toContain(PRIVATE_BUCKET);
      expect(url.toLowerCase()).not.toContain(PUBLIC_BUCKET);
    });

    it('getSignedReadUrl signe TOUJOURS contre le bucket privé', async () => {
      const url = await service.getSignedReadUrl('docs/2026/07/abc.pdf');
      expect(url.toLowerCase()).toContain(PRIVATE_BUCKET);
    });

    it('upload() public envoie sur le bucket public et retourne l’URL CDN', async () => {
      s3mock.on(PutObjectCommand).resolves({});
      const res = await service.upload(
        { buffer: Buffer.from('img'), mimetype: 'image/webp' },
        'avatars',
        'public',
      );
      const call = s3mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(call.Bucket).toBe(PUBLIC_BUCKET);
      expect(res.url).toBe(`${PUBLIC_URL}/${res.key}`);
    });

    it('upload() privé envoie sur le bucket privé et ne retourne pas d’URL', async () => {
      s3mock.on(PutObjectCommand).resolves({});
      const res = await service.upload(
        { buffer: Buffer.from('pdf'), mimetype: 'application/pdf' },
        'docs',
        'private',
      );
      const call = s3mock.commandCalls(PutObjectCommand)[0].args[0].input;
      expect(call.Bucket).toBe(PRIVATE_BUCKET);
      expect(res.url).toBeNull();
    });
  });

  // ─── TTL des URLs présignées ────────────────────────────────

  describe('TTL des URLs présignées', () => {
    it('URL d’upload : TTL 600 s', async () => {
      const { url, expiresIn } = await service.getSignedUploadUrl('docs', 'a.pdf', 'application/pdf', 'private');
      expect(expiresIn).toBe(600);
      expect(url).toContain('X-Amz-Expires=600');
    });

    it('URL de lecture : TTL 300 s par défaut', async () => {
      const url = await service.getSignedReadUrl('docs/2026/07/abc.pdf');
      expect(url).toContain('X-Amz-Expires=300');
    });

    it('URL de lecture : TTL personnalisable', async () => {
      const url = await service.getSignedReadUrl('docs/2026/07/abc.pdf', 120);
      expect(url).toContain('X-Amz-Expires=120');
    });
  });

  // ─── getPublicUrl / exists ──────────────────────────────────

  describe('getPublicUrl', () => {
    it('concatène R2_PUBLIC_URL et la clé', () => {
      expect(service.getPublicUrl('avatars/2026/07/x.png')).toBe(
        `${PUBLIC_URL}/avatars/2026/07/x.png`,
      );
    });
  });

  describe('exists (HeadObject)', () => {
    it('retourne true si l’objet existe', async () => {
      s3mock.on(HeadObjectCommand).resolves({ ContentLength: 10 });
      await expect(service.exists('docs/x.pdf', 'private')).resolves.toBe(true);
    });

    it('retourne false sur 404 (objet absent)', async () => {
      s3mock
        .on(HeadObjectCommand)
        .rejects(Object.assign(new Error('Not Found'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }));
      await expect(service.exists('docs/x.pdf', 'private')).resolves.toBe(false);
    });

    it('interroge le bon bucket selon la visibilité', async () => {
      s3mock.on(HeadObjectCommand).resolves({});
      await service.exists('avatars/x.png', 'public');
      expect(s3mock.commandCalls(HeadObjectCommand)[0].args[0].input.Bucket).toBe(PUBLIC_BUCKET);
    });
  });

  // ─── delete ─────────────────────────────────────────────────

  describe('delete', () => {
    it('supprime l’objet sur le bucket correspondant à la visibilité', async () => {
      s3mock.on(DeleteObjectCommand).resolves({});
      await service.delete('docs/x.pdf', 'private');
      const input = s3mock.commandCalls(DeleteObjectCommand)[0].args[0].input;
      expect(input.Bucket).toBe(PRIVATE_BUCKET);
      expect(input.Key).toBe('docs/x.pdf');
    });
  });

  // Garde-fou : GetObjectCommand n'est utilisé que pour présigner (jamais envoyé).
  afterEach(() => {
    expect(s3mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });
});
