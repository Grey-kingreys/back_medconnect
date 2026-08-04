import { Module } from '@nestjs/common';
import { AuthModule } from 'src/auth/auth.module';
import { ConsentController } from './consent.controller';
import { ConsentService } from './consent.service';

/**
 * Consentement d'accès (code/QR + OTP SMS).
 *
 * Dépendances injectées depuis des modules globaux : `PrismaService`
 * (PrismaModule), `SmsService` (SecurityModule), `REDIS_CLIENT` (RedisModule),
 * `PermissionsGuard` (RbacModule). `AuthModule` est importé pour `JwtService`
 * (utilisé par `AuthGuard`).
 */
@Module({
  imports: [AuthModule],
  controllers: [ConsentController],
  providers: [ConsentService],
})
export class ConsentModule {}
