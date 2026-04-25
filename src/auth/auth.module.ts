import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { JwtService } from '@nestjs/jwt';

@Module({
  controllers: [AuthController, PrismaService, EmailService, JwtService],
  providers: [AuthService],
})
export class AuthModule {}

