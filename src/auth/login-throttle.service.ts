import { Inject, Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module';

/**
 * Anti-brute-force sur la connexion (hybride backoff + blocage dur), adossé à Redis.
 *
 * Stratégie (cf. PLAN-REMEDIATION §1.4) :
 *  - Clé de comptage `login:fail:{email}:{ip}` (TTL 15 min). La composante **IP**
 *    neutralise le DoS-lockout (un attaquant distant accumule sur SON IP, pas sur
 *    celle de la victime) ; la composante **email** évite d'additionner plusieurs
 *    vrais utilisateurs derrière un même NAT mobile.
 *  - Backoff progressif dès le 2ᵉ échec (délai croissant, plafonné) — ne verrouille
 *    jamais totalement un utilisateur légitime.
 *  - Blocage dur `429 Retry-After` (15 min) au-delà du seuil élevé (~10 échecs).
 *  - Compteur remis à zéro sur connexion réussie.
 *  - Messages volontairement génériques (ne révèle ni l'existence de l'email ni
 *    l'état exact de verrouillage).
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger(LoginThrottleService.name);

  private readonly WINDOW_S = 15 * 60; // fenêtre de comptage : 15 min
  private readonly BLOCK_S = 15 * 60; // durée du blocage dur : 15 min
  private readonly BACKOFF_FROM = 1; // backoff dès qu'il y a ≥ 1 échec (donc 2ᵉ tentative)
  private readonly HARD_THRESHOLD = 10; // blocage dur au-delà de 10 échecs
  private readonly BASE_DELAY_MS = 1000; // 1s, 2s, 4s…
  private readonly MAX_DELAY_MS = 8000; // plafond du backoff

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private failKey(email: string, ip: string): string {
    return `login:fail:${email.toLowerCase()}:${ip}`;
  }

  private blockKey(email: string, ip: string): string {
    return `login:block:${email.toLowerCase()}:${ip}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * À appeler AVANT la vérification du mot de passe.
   * Lève 429 si le couple est en blocage dur, sinon applique le backoff progressif.
   * Tolérant aux pannes Redis : en cas d'erreur, on laisse passer (fail-open) pour
   * ne pas transformer un incident Redis en panne d'authentification.
   */
  async guard(email: string, ip: string, res?: Response): Promise<void> {
    try {
      const blockTtl = await this.redis.ttl(this.blockKey(email, ip));
      if (blockTtl > 0) {
        // En-tête standard pour indiquer au client quand réessayer.
        res?.setHeader('Retry-After', String(blockTtl));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message:
              'Trop de tentatives de connexion. Réessayez plus tard ou réinitialisez votre mot de passe.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const countRaw = await this.redis.get(this.failKey(email, ip));
      const count = countRaw ? parseInt(countRaw, 10) : 0;
      if (count >= this.BACKOFF_FROM) {
        const delay = Math.min(
          this.BASE_DELAY_MS * 2 ** (count - this.BACKOFF_FROM),
          this.MAX_DELAY_MS,
        );
        await this.sleep(delay);
      }
    } catch (err) {
      if (err instanceof HttpException) throw err; // le 429 doit remonter
      this.logger.warn(`guard() — Redis indisponible, fail-open: ${(err as Error).message}`);
    }
  }

  /**
   * À appeler après un échec d'authentification.
   * Incrémente le compteur ; déclenche le blocage dur au franchissement du seuil.
   * @returns true UNIQUEMENT lorsque ce franchissement vient d'activer le blocage
   *          (sert à n'envoyer l'email de notification qu'une seule fois).
   */
  async registerFailure(email: string, ip: string): Promise<boolean> {
    try {
      const key = this.failKey(email, ip);
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.WINDOW_S);
      }

      if (count >= this.HARD_THRESHOLD) {
        // SET NX : ne (re)programme le blocage que s'il n'existe pas déjà → email unique.
        const set = await this.redis.set(
          this.blockKey(email, ip),
          '1',
          'EX',
          this.BLOCK_S,
          'NX',
        );
        return set === 'OK';
      }
      return false;
    } catch (err) {
      this.logger.warn(`registerFailure() — Redis indisponible: ${(err as Error).message}`);
      return false;
    }
  }

  /** À appeler après une connexion réussie : remet les compteurs à zéro. */
  async reset(email: string, ip: string): Promise<void> {
    try {
      await this.redis.del(this.failKey(email, ip), this.blockKey(email, ip));
    } catch (err) {
      this.logger.warn(`reset() — Redis indisponible: ${(err as Error).message}`);
    }
  }
}
