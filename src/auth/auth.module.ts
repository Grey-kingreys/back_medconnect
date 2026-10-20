import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { LoginThrottleService } from './login-throttle.service';
import { SessionsService } from './sessions.service';

@Module({
  imports: [
    // Secret lu via ConfigService (getOrThrow) : plus de fallback en dur.
    // La validation centralisée (config/env.validation.ts) garantit déjà sa présence
    // au boot, mais getOrThrow protège contre toute régression.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        // Filet de sécurité : tout jeton signé sans durée explicite expire en 15 min (TB3).
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionsService,
    PrismaService,
    EmailService,
    LoginThrottleService,
  ],
  exports: [AuthService, SessionsService, JwtModule],
})
export class AuthModule {}
