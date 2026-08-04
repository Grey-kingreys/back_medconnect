import { Global, Module, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

/** Jeton d'injection du client Redis partagé. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Client Redis (ioredis) partagé, injectable partout via `@Inject(REDIS_CLIENT)`.
 *
 * Réutilisé par l'anti-brute-force de l'auth (et extensible : cache, throttler…).
 * ioredis reconnecte automatiquement ; les commandes émises pendant une coupure
 * sont mises en file (`enableOfflineQueue`).
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const logger = new Logger('Redis');
        const url = process.env.REDIS_URL || 'redis://localhost:6379';
        const client = new Redis(url, {
          maxRetriesPerRequest: 2,
          enableOfflineQueue: true,
        });
        client.on('error', (e) => logger.error(`Redis: ${e.message}`));
        client.on('connect', () => logger.log('✅ Client Redis connecté.'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
