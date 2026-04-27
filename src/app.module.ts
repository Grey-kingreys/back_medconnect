import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { StructureModule } from './structure/structure.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { CarnetSanteModule } from './carnet-sante/carnet-sante.module';
import { PharmacieModule } from './pharmacie/pharmacie.module';
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    UserModule,
    StructureModule,
    SuperAdminModule,
    CarnetSanteModule,
    PharmacieModule,
    GeoModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }