import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CarnetSanteService } from './carnet-sante.service';
import { CarnetSanteController } from './carnet-sante.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';
import { AiService } from 'src/common/services/ai.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [AuthModule, HttpModule, ConfigModule],
  controllers: [CarnetSanteController],
  providers: [CarnetSanteService, PrismaService, AiService],
  exports: [CarnetSanteService],
})
export class CarnetSanteModule { }