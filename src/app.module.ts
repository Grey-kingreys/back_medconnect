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
// ⚠️ Ancien module de stockage (S3/MinIO générique, sans persistance). Conservé le temps
// de la migration vers le StorageModule R2 (src/storage) puis à retirer — cf. src/storage.
import { StorageModule as LegacyStorageModule } from './common/storage.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queue/queue.module';
import { ConsentModule } from './consent/consent.module';
import { RedisModule } from './common/redis/redis.module';
import { RbacModule } from './common/rbac/rbac.module';
import { RolesModule } from './roles/roles.module';
import { PrismaModule } from './common/prisma.module';
import { validateEnv } from './config/env.validation';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';

import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'http';

@Module({
  imports: [
    // Validation centralisée des variables d'env : fail-fast au boot avec message clair.
    // `envFilePath` suit NODE_ENV, avec `.env` en repli. process.env prime sur les fichiers.
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
    }),
    // Logs structurés (JSON en prod, lisibles en dev). Remplace LoggerMiddleware :
    // pino-http journalise déjà chaque requête (méthode, route, statut, durée).
    // ⚠️ `redact` masque les données sensibles — toute nouvelle donnée de santé
    //    ou de localisation exposée dans un log doit être ajoutée à cette liste.
    LoggerModule.forRoot({
      pinoHttp: {
        // `||` et non `??` : une variable déclarée mais vide (fréquent quand on colle
        // un bloc d'env dans une UI) doit retomber sur le défaut. Avec `??`, Pino
        // recevait level:'' et refusait de démarrer.
        level:
          process.env.LOG_LEVEL ||
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.motDePasse',
            'req.body.symptomes',
            'req.body.latitude',
            'req.body.longitude',
          ],
          censor: '[masqué]',
        },
        // Rattache l'auteur de la requête à chaque ligne de log (traçabilité).
        customProps: (req: IncomingMessage & { user?: { userId?: string } }) => ({
          userId: req.user?.userId,
        }),
        // Le health check (GET /) est appelé en boucle par Docker : ne pas le journaliser.
        autoLogging: { ignore: (req: IncomingMessage) => req.url === '/' },
      },
    }),
    // Palier par défaut : ~120 req/min/utilisateur (trafic dashboard normal).
    // Les paliers stricts (auth) et lourds (IA, SOS, upload) sont appliqués par route
    // via @Throttle(...). Tracker par userId via UserThrottlerGuard.
    // ⚠️ Stockage en mémoire pour l'instant : OK en mono-réplique. En multi-répliques
    //    (BACKEND_REPLICAS > 1), brancher un ThrottlerStorage Redis (cf. PLAN §1.5).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 120 }],
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
    LegacyStorageModule,
    StorageModule,
    QueueModule,
    ConsentModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
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