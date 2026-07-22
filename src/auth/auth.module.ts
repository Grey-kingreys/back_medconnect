import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { LoginThrottleService } from './login-throttle.service';

@Module({
  imports: [
    // Secret lu via ConfigService (getOrThrow) : plus de fallback en dur.
    // La validation centralisée (config/env.validation.ts) garantit déjà sa présence
    // au boot, mais getOrThrow protège contre toute régression.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PrismaService, EmailService, LoginThrottleService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
