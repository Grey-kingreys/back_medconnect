import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import {
  LIMITE_PERMISSIVE,
  PREFIXE_CLE_PERMISSIVE,
} from '../decorators/limite-permissive.decorator';

interface RequeteLimiteur {
  ip?: string;
  user?: { userId?: string };
  headers?: { authorization?: string };
}

/** Compte les requêtes par adresse IP (routes d'auth, trafic anonyme). */
export function suivreParIp(req: Record<string, any>): string {
  const requete = req as RequeteLimiteur;
  return `ip:${requete.ip ?? 'inconnue'}`;
}

/**
 * Garde de limitation de débit globale. Elle compte **par utilisateur** : l'identifiant
 * vient du jeton Bearer dont la signature est vérifiée ici, car une garde globale passe
 * avant l'AuthGuard des contrôleurs (`req.user` est donc encore vide). Sans jeton valide,
 * elle retombe sur l'IP. Les routes d'auth sont forcées par IP (`suivreParIp`).
 * Le stockage est Redis (voir StockageLimiteRedis), juste à plusieurs instances.
 *
 * Pourquoi : sans ça, tous les soignants derrière un même NAT opérateur (fréquent en
 * Guinée) partagent le quota par IP et se bloquent mutuellement. `req.ip` n'est fiable
 * que parce que `trust proxy` est configuré dans main.ts (derrière Caddy).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const requete = req as RequeteLimiteur;
    const userId = requete.user?.userId ?? (await this.userIdDuJeton(requete));
    if (typeof userId === 'string' && userId.length > 0) {
      return `utilisateur:${userId}`;
    }
    return suivreParIp(req);
  }

  private async userIdDuJeton(
    requete: RequeteLimiteur,
  ): Promise<string | undefined> {
    const [type, jeton] = requete.headers?.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !jeton) return undefined;
    try {
      const charge = await this.jwtService.verifyAsync<{ userId?: unknown }>(
        jeton,
        { secret: process.env.JWT_SECRET },
      );
      return typeof charge.userId === 'string' ? charge.userId : undefined;
    } catch {
      return undefined;
    }
  }

  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const cle = super.generateKey(context, suffix, name);
    const permissive = this.reflector.getAllAndOverride<boolean>(
      LIMITE_PERMISSIVE,
      [context.getHandler(), context.getClass()],
    );
    return permissive ? `${PREFIXE_CLE_PERMISSIVE}${cle}` : cle;
  }
}
