import { Module } from '@nestjs/common';
import { PharmacieService } from './pharmacie.service';
import { PharmacieController } from './pharmacie.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PharmacieController],
  providers: [PharmacieService, PrismaService],
})
export class PharmacieModule { }