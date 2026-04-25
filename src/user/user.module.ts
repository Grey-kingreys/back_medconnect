import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';

@Module({
  controllers: [UserController],
  providers: [UserService, PrismaService, EmailService],
  exports: [UserService],
})
export class UserModule { }