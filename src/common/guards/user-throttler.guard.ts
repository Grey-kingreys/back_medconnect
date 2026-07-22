import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Guard de rate-limiting qui compte **par utilisateur** (`req.user.userId`) pour le
 * trafic authentifié, et retombe sur l'IP pour le trafic anonyme.
 *
 * Pourquoi : sans ça, tous les soignants derrière un même NAT opérateur (fréquent en
 * Guinée) partagent le quota par IP et se bloquent mutuellement. `req.ip` n'est fiable
 * que parce que `trust proxy` est configuré dans main.ts (derrière Caddy).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.userId ?? req.ip ?? 'unknown';
  }
}
