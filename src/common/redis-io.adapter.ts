import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { ServerOptions } from 'socket.io';

/**
 * Adapter socket.io adossé à Redis (pub/sub).
 * Permet à PLUSIEURS instances de l'API de partager les rooms/événements
 * (chat, alertes SOS) → indispensable dès que `BACKEND_REPLICAS > 1`.
 * Sans lui, un message émis par l'instance A n'atteint pas un client connecté
 * à l'instance B.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  async connectToRedis(): Promise<void> {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    const pubClient = new Redis(url);
    const subClient = pubClient.duplicate();

    pubClient.on('error', (e) => this.logger.error(`pub: ${e.message}`));
    subClient.on('error', (e) => this.logger.error(`sub: ${e.message}`));

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('✅ Adapter socket.io ↔ Redis connecté.');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
