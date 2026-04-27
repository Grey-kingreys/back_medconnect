import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';
import { PrismaService } from 'src/common/services/prisma.service';

@Module({
  controllers: [GeoController],
  providers: [GeoService, PrismaService],
})
export class GeoModule { }