import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import {
  ThrottlerStorageService,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { Redis } from 'ioredis';
import { PREFIXE_CLE_PERMISSIVE } from '../decorators/limite-permissive.decorator';

export const DELAI_REDIS_LIMITE_MS = 250;
export const INTERVALLE_AVERTISSEMENT_MS = 60_000;

// Pendant un blocage, les appels ne sont pas comptés ; à la fin du blocage le compteur
// repart de zéro, comme le stockage mémoire de la bibliothèque.
const SCRIPT_LIMITE = `
local bloc = redis.call('PTTL', KEYS[2])
if bloc > 0 then
  return { tonumber(redis.call('GET', KEYS[2]) or '0'), bloc, 1, bloc }
end
local coups = redis.call('INCR', KEYS[1])
local reste = redis.call('PTTL', KEYS[1])
if reste < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  reste = tonumber(ARGV[1])
end
if coups > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], coups, 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return { coups, tonumber(ARGV[3]), 1, tonumber(ARGV[3]) }
end
return { coups, reste, 0, 0 }
`;

/**
 * Stockage Redis du limiteur de débit (juste à plusieurs instances). Si Redis est
 * absent ou plus lent que DELAI_REDIS_LIMITE_MS : les routes permissives (SOS) passent,
 * les autres sont comptées en mémoire locale.
 */
export class StockageLimiteRedis
  implements ThrottlerStorage, OnApplicationShutdown
{
  private readonly logger = new Logger(StockageLimiteRedis.name);
  private readonly memoire = new ThrottlerStorageService();
  private dernierAvertissement = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const resultat: unknown = await this.avecDelai(
        this.redis.eval(
          SCRIPT_LIMITE,
          2,
          `limite:${key}`,
          `limite:${key}:bloc`,
          ttl,
          limit,
          Math.max(1, blockDuration),
        ),
      );
      if (
        !Array.isArray(resultat) ||
        resultat.length !== 4 ||
        !resultat.every((v) => typeof v === 'number')
      ) {
        throw new Error('Réponse Redis inattendue');
      }
      const r: number[] = resultat;
      return {
        totalHits: r[0],
        timeToExpire: Math.ceil(r[1] / 1000),
        isBlocked: r[2] === 1,
        timeToBlockExpire: Math.ceil(r[3] / 1000),
      };
    } catch (erreur) {
      this.avertir(erreur);
      if (key.startsWith(PREFIXE_CLE_PERMISSIVE)) {
        return {
          totalHits: 0,
          timeToExpire: Math.ceil(ttl / 1000),
          isBlocked: false,
          timeToBlockExpire: 0,
        };
      }
      return this.memoire.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }

  private avecDelai<T>(promesse: Promise<T>): Promise<T> {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(
        () => rejeter(new Error('délai Redis dépassé')),
        DELAI_REDIS_LIMITE_MS,
      );
    });
    return Promise.race([promesse, delai]).finally(() =>
      clearTimeout(minuteur),
    );
  }

  private avertir(erreur: unknown): void {
    const maintenant = Date.now();
    if (maintenant - this.dernierAvertissement < INTERVALLE_AVERTISSEMENT_MS) {
      return;
    }
    this.dernierAvertissement = maintenant;
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    this.logger.warn(
      `Redis indisponible pour le limiteur de débit (${message}) : SOS laissés passer, autres routes comptées en mémoire locale.`,
    );
  }

  onApplicationShutdown(): void {
    this.memoire.onApplicationShutdown();
  }
}
