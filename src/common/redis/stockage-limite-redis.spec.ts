import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { StockageLimiteRedis } from './stockage-limite-redis';

describe('StockageLimiteRedis', () => {
  let stockage: StockageLimiteRedis;
  let evalMock: jest.Mock;

  const creer = () => {
    evalMock = jest.fn();
    stockage = new StockageLimiteRedis({ eval: evalMock } as never);
  };

  afterEach(() => {
    stockage.onApplicationShutdown();
    jest.restoreAllMocks();
  });

  it('traduit la réponse du script Lua et lui passe les bons arguments', async () => {
    creer();
    evalMock.mockResolvedValue([3, 59000, 0, 0]);

    const r = await stockage.increment('k', 60000, 5, 60000, 'default');

    expect(r).toEqual({
      totalHits: 3,
      timeToExpire: 59,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'limite:k',
      'limite:k:bloc',
      60000,
      5,
      60000,
    );
  });

  it('laisse passer une clé permissive quand Redis échoue', async () => {
    creer();
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    for (let i = 0; i < 10; i++) {
      const r = await stockage.increment(
        'permissif:abc',
        60000,
        5,
        60000,
        'default',
      );
      expect(r.isBlocked).toBe(false);
      expect(r.totalHits).toBe(0);
    }
  });

  it('compte en mémoire locale une clé ordinaire quand Redis échoue', async () => {
    creer();
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await stockage.increment('abc', 60000, 2, 60000, 'default');
    await stockage.increment('abc', 60000, 2, 60000, 'default');
    const r = await stockage.increment('abc', 60000, 2, 60000, 'default');

    expect(r.isBlocked).toBe(true);
  });

  it('ne reste pas suspendu quand Redis ne répond jamais', async () => {
    creer();
    evalMock.mockReturnValue(new Promise(() => {}));

    const debut = Date.now();
    const r = await stockage.increment(
      'permissif:abc',
      60000,
      5,
      60000,
      'default',
    );

    expect(r.isBlocked).toBe(false);
    expect(Date.now() - debut).toBeLessThan(1000);
  });

  it('n’émet qu’un seul avertissement pour plusieurs échecs rapprochés', async () => {
    creer();
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const avertir = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    for (let i = 0; i < 3; i++) {
      await stockage.increment('abc', 60000, 5, 60000, 'default');
    }

    expect(avertir).toHaveBeenCalledTimes(1);
  });
});

// Contre un vrai Redis, seulement si TEST_REDIS_URL est défini (D19).
const decrireAvecRedis = process.env.TEST_REDIS_URL ? describe : describe.skip;

decrireAvecRedis('StockageLimiteRedis contre un vrai Redis', () => {
  let redis: Redis;
  let stockage: StockageLimiteRedis;
  const cles: string[] = [];

  const nouvelleCle = () => {
    const cle = `test-b2-${Date.now()}-${Math.random()}`;
    cles.push(cle);
    return cle;
  };

  beforeAll(() => {
    redis = new Redis(process.env.TEST_REDIS_URL!);
  });

  beforeEach(() => {
    stockage = new StockageLimiteRedis(redis);
  });

  afterEach(async () => {
    stockage.onApplicationShutdown();
    for (const cle of cles.splice(0)) {
      await redis.del(`limite:${cle}`, `limite:${cle}:bloc`);
    }
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('compte puis bloque après la limite', async () => {
    const cle = nouvelleCle();
    for (let i = 1; i <= 5; i++) {
      const r = await stockage.increment(cle, 60000, 5, 60000, 'default');
      expect(r.isBlocked).toBe(false);
      expect(r.totalHits).toBe(i);
      expect(r.timeToExpire).toBeGreaterThanOrEqual(1);
      expect(r.timeToExpire).toBeLessThanOrEqual(60);
    }
    const sixieme = await stockage.increment(cle, 60000, 5, 60000, 'default');
    expect(sixieme.isBlocked).toBe(true);
    expect(sixieme.timeToBlockExpire).toBeGreaterThanOrEqual(1);
    expect(sixieme.timeToBlockExpire).toBeLessThanOrEqual(60);

    const septieme = await stockage.increment(cle, 60000, 5, 60000, 'default');
    expect(septieme.isBlocked).toBe(true);
  });

  it('garde les clés indépendantes', async () => {
    const a = nouvelleCle();
    const b = nouvelleCle();
    for (let i = 0; i < 6; i++) {
      await stockage.increment(a, 60000, 5, 60000, 'default');
    }
    const r = await stockage.increment(b, 60000, 5, 60000, 'default');
    expect(r.totalHits).toBe(1);
    expect(r.isBlocked).toBe(false);
  });

  it('repart de zéro après la fin du blocage', async () => {
    const cle = nouvelleCle();
    await stockage.increment(cle, 1000, 1, 1000, 'default');
    const bloque = await stockage.increment(cle, 1000, 1, 1000, 'default');
    expect(bloque.isBlocked).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const r = await stockage.increment(cle, 1000, 1, 1000, 'default');
    expect(r.totalHits).toBe(1);
    expect(r.isBlocked).toBe(false);
  });
});
