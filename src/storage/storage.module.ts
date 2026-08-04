import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { AuthModule } from '../auth/auth.module';
import { StorageService } from './storage.service';
import { FileAccessService } from './file-access.service';
import { StorageController } from './storage.controller';
import { R2_CLIENT } from './storage.constants';

/**
 * Module de stockage objets Cloudflare R2 — isolé et réutilisable.
 *
 * Le `S3Client` est instancié UNE seule fois (provider `R2_CLIENT`) puis partagé.
 * `@Global` : `StorageService` est injectable par les modules métier (avatars,
 * pharmacies, imagerie…) sans réimport, comme les autres services transverses.
 * `AuthModule` est importé pour que `AuthGuard` (JwtService) protège le contrôleur.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [
    {
      provide: R2_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): S3Client => {
        const accountId = config.getOrThrow<string>('R2_ACCOUNT_ID');
        return new S3Client({
          region: 'auto',
          endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
            secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
          },
          // Obligatoire : les versions récentes du SDK v3 envoient des checksums
          // CRC32 que R2 rejette (400 « Not implemented »).
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        });
      },
    },
    StorageService,
    FileAccessService,
  ],
  exports: [StorageService, FileAccessService],
})
export class StorageModule {}
