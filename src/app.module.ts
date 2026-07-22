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
import { StorageModule } from './common/storage.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { RbacModule } from './common/rbac/rbac.module';
import { RolesModule } from './roles/roles.module';
import { LoggerMiddleware } from './common/logger.middleware';
import { validateEnv } from './config/env.validation';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';

import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    // Validation centralisée des variables d'env : fail-fast au boot avec message clair.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Palier par défaut : ~120 req/min/utilisateur (trafic dashboard normal).
    // Les paliers stricts (auth) et lourds (IA, SOS, upload) sont appliqués par route
    // via @Throttle(...). Tracker par userId via UserThrottlerGuard.
    // ⚠️ Stockage en mémoire pour l'instant : OK en mono-réplique. En multi-répliques
    //    (BACKEND_REPLICAS > 1), brancher un ThrottlerStorage Redis (cf. PLAN §1.5).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 120 }],
    }),
    RedisModule,
    RbacModule,
    AuthModule,
    RolesModule,
    UserModule,
    StructureModule,
    SuperAdminModule,
    CarnetSanteModule,
    PharmacieModule,
    GeoModule,
    ChatModule,
    NotificationsModule,
    SecurityModule,
    StorageModule,
    QueueModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
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