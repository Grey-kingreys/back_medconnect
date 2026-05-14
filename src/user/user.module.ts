import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { AuthModule } from 'src/auth/auth.module';
import { EncryptionService } from 'src/common/services/encryption.service';

@Module({
  imports: [AuthModule],
  controllers: [UserController],
  providers: [UserService, PrismaService, EmailService, EncryptionService],
  exports: [UserService],
})
export class UserModule { }