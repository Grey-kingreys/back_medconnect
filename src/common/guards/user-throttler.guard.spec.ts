/* Les gestionnaires de contrôleur sont lus tels quels pour leurs métadonnées, jamais appelés. */
/* eslint-disable @typescript-eslint/unbound-method */
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  ThrottlerException,
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { AuthController } from 'src/auth/auth.controller';
import { CarnetSanteController } from 'src/carnet-sante/carnet-sante.controller';
import { StockageLimiteRedis } from '../redis/stockage-limite-redis';
import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const jetonA = jwt.sign({ userId: 'patient-a', role: 'PATIENT' });
  const jetonB = jwt.sign({ userId: 'patient-b', role: 'PATIENT' });
  const IP = '41.223.10.1';

  let memoire: ThrottlerStorageService;
  const aNettoyer: Array<{ onApplicationShutdown: () => void }> = [];

  beforeEach(() => {
    memoire = new ThrottlerStorageService();
  });

  afterEach(() => {
    memoire.onApplicationShutdown();
    for (const s of aNettoyer.splice(0)) s.onApplicationShutdown();
  });

  const creerGarde = async (stockage: ThrottlerStorage) => {
    const garde = new UserThrottlerGuard(
      { throttlers: [{ ttl: 60000, limit: 120 }] },
      stockage,
      new Reflector(),
      jwt,
    );
    await garde.onModuleInit();
    return garde;
  };

  const contexte = (
    classe: unknown,
    handler: unknown,
    ip: string,
    jeton?: string,
  ) => {
    const req = {
      ip,
      headers: { authorization: jeton ? `Bearer ${jeton}` : undefined },
    };
    return {
      getHandler: () => handler,
      getClass: () => classe,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as never;
  };

  const sos = (ip: string, jeton?: string) =>
    contexte(
      CarnetSanteController,
      CarnetSanteController.prototype.createUrgence,
      ip,
      jeton,
    );
  const login = (ip: string, jeton?: string) =>
    contexte(AuthController, AuthController.prototype.login, ip, jeton);
  const oubli = (ip: string, jeton?: string) =>
    contexte(
      AuthController,
      AuthController.prototype.forgotPassword,
      ip,
      jeton,
    );

  it('compte le SOS par utilisateur, pas par IP', async () => {
    const garde = await creerGarde(memoire);
    for (let i = 0; i < 5; i++) {
      await expect(garde.canActivate(sos(IP, jetonA))).resolves.toBe(true);
    }
    await expect(garde.canActivate(sos(IP, jetonA))).rejects.toBeInstanceOf(
      ThrottlerException,
    );

    for (let i = 0; i < 5; i++) {
      await expect(garde.canActivate(sos(IP, jetonB))).resolves.toBe(true);
    }
    await expect(garde.canActivate(sos(IP, jetonB))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('compte par IP quand le jeton est invalide', async () => {
    const garde = await creerGarde(memoire);
    for (let i = 0; i < 5; i++) {
      await expect(garde.canActivate(sos(IP, 'nimporte-quoi'))).resolves.toBe(
        true,
      );
    }
    await expect(
      garde.canActivate(sos(IP, 'nimporte-quoi')),
    ).rejects.toBeInstanceOf(ThrottlerException);
    await expect(garde.canActivate(sos(IP))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('force /auth/login par IP, jeton ou non', async () => {
    const garde = await creerGarde(memoire);
    const jetons = [jetonA, jetonB, undefined];
    for (let i = 0; i < 10; i++) {
      await expect(garde.canActivate(login(IP, jetons[i % 3]))).resolves.toBe(
        true,
      );
    }
    await expect(garde.canActivate(login(IP, jetonA))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
    await expect(garde.canActivate(login('41.223.10.2', jetonA))).resolves.toBe(
      true,
    );
  });

  it('force /auth/forgot-password par IP', async () => {
    const garde = await creerGarde(memoire);
    for (let i = 0; i < 10; i++) {
      await expect(garde.canActivate(oubli(IP, jetonA))).resolves.toBe(true);
    }
    await expect(garde.canActivate(oubli(IP, jetonB))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('Redis en panne : le SOS passe, le login est compté en mémoire locale', async () => {
    const stockage = new StockageLimiteRedis({
      eval: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as never);
    aNettoyer.push(stockage);
    const garde = await creerGarde(stockage);

    for (let i = 0; i < 8; i++) {
      await expect(garde.canActivate(sos(IP, jetonA))).resolves.toBe(true);
    }
    for (let i = 0; i < 10; i++) {
      await expect(garde.canActivate(login(IP))).resolves.toBe(true);
    }
    await expect(garde.canActivate(login(IP))).rejects.toBeInstanceOf(
      ThrottlerException,
    );
  });

  it('Redis arrêté (client réel) : le SOS passe en moins d’une seconde', async () => {
    const client = new Redis('redis://127.0.0.1:1', {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
    });
    client.on('error', () => undefined);
    const stockage = new StockageLimiteRedis(client);
    aNettoyer.push(stockage);
    const garde = await creerGarde(stockage);

    const debut = Date.now();
    try {
      await expect(garde.canActivate(sos(IP, jetonA))).resolves.toBe(true);
      expect(Date.now() - debut).toBeLessThan(1000);
    } finally {
      client.disconnect();
    }
  });
});
