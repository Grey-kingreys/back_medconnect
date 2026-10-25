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
import { ChatModule } from './chat/chat.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SecurityModule } from './common/security.module';
// Module débranché (backlog P0 point 2) : GET /storage/download-url signe n'importe quelle clé
// pour tout utilisateur connecté sans contrôle d'accès. Code conservé dans src/common/storage.*.
// Le stockage actif est src/storage/ (R2, contrôle d'accès par FileAccessService).
// Ne pas rebrancher sans contrôle de propriété.
// import { StorageModule as LegacyStorageModule } from './common/storage.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { ConsentModule } from './consent/consent.module';
import { REDIS_CLIENT, RedisModule } from './common/redis/redis.module';
import { StockageLimiteRedis } from './common/redis/stockage-limite-redis';
import type { Redis } from 'ioredis';
import { RbacModule } from './common/rbac/rbac.module';
import { RolesModule } from './roles/roles.module';
import { PrismaModule } from './common/prisma.module';
import { DemoModule } from './demo/demo.module';
import { ConfigurationPubliqueModule } from './configuration-publique/configuration-publique.module';
import { VersionMinimaleGuard } from './configuration-publique/version-minimale.guard';
import { validateEnv } from './config/env.validation';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { optionsPinoHttp } from './common/journalisation/journalisation-http';

@Module({
  imports: [
    // Validation centralisée des variables d'env : fail-fast au boot avec message clair.
    // `envFilePath` suit NODE_ENV, avec `.env` en repli. process.env prime sur les fichiers.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    // Logs structurés (JSON en prod, lisibles en dev) ; configuration et minimisation dans src/common/journalisation/journalisation-http.ts.
    LoggerModule.forRoot({ pinoHttp: optionsPinoHttp() }),
    // Palier par défaut : ~120 req/min/utilisateur (trafic dashboard normal).
    // Les paliers stricts (auth) et lourds (IA, SOS, upload) sont appliqués par route
    // via @Throttle(...). Compté par utilisateur (jeton lu par UserThrottlerGuard), sinon par IP.
    // Le stockage est Redis (StockageLimiteRedis), donc juste à plusieurs instances ; le SOS
    // est laissé passer si Redis tombe (D17).
    ThrottlerModule.forRootAsync({
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => ({
        throttlers: [{ ttl: 60000, limit: 120 }],
        storage: new StockageLimiteRedis(redis),
      }),
    }),
    PrismaModule,
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
    // Module débranché (backlog P0 point 2) : GET /storage/download-url signe n'importe quelle clé
    // pour tout utilisateur connecté sans contrôle d'accès. Code conservé dans src/common/storage.*.
    // Le stockage actif est src/storage/ (R2, contrôle d'accès par FileAccessService).
    // Ne pas rebrancher sans contrôle de propriété.
    // LegacyStorageModule,
    StorageModule,
    QueueModule,
    ConsentModule,
    ConfigurationPubliqueModule,
    // Mode démo : inerte si DEMO_MODE ne vaut pas `true` (routes en 404, aucune donnée).
    DemoModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Version minimale de l'application mobile (TB5) : avant le limiteur, une requête
    // refusée en 426 n'entame pas le quota.
    {
      provide: APP_GUARD,
      useClass: VersionMinimaleGuard,
    },
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
    // Audit trail des données de santé : consultations, ordonnances, analyses
    // et vaccinations (qui / quoi / quand / IP). Exigence de traçabilité santé.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
