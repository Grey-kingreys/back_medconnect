import { Global, Module } from '@nestjs/common';
import { StorageService } from './services/storage.service';
import { StorageController } from './storage.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Module global de stockage objets (S3/MinIO).
 * Injectable partout via `StorageService` (carnet-santé, structures, etc.).
 * Importe AuthModule pour que `AuthGuard` (JwtService) protège le contrôleur.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
