import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
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
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SecurityModule } from './common/security.module';
import { LoggerMiddleware } from './common/logger.middleware';

import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    AuthModule,
    UserModule,
    StructureModule,
    SuperAdminModule,
    CarnetSanteModule,
    PharmacieModule,
    GeoModule,
    ChatModule,
    NotificationsModule,
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerMiddleware)
      .forRoutes('*');
  }
}