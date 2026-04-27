import { Module } from '@nestjs/common';
import { CarnetSanteService } from './carnet-sante.service';
import { CarnetSanteController } from './carnet-sante.controller';
import { PrismaService } from 'src/common/services/prisma.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CarnetSanteController],
  providers: [CarnetSanteService, PrismaService],
  exports: [CarnetSanteService],
})
export class CarnetSanteModule { }