import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PrismaService } from '../services/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  filtrerPermissionsSelonTypeStructure,
  typeStructureEffectif,
} from './permissions-type-structure';

/**
 * Résout les permissions effectives d'un utilisateur (= permissions de son rôle).
 *
 * Choix d'archi (cf. PLAN §2.5.b) : les permissions sont résolues CÔTÉ SERVEUR à
 * chaque requête, jamais portées par le JWT — ainsi une modification de rôle par un
 * admin prend effet immédiatement (au plus après expiration du cache), sans attendre
 * un nouveau login. Cache Redis court (5 min), invalidé explicitement aux mutations.
 *
 * Les permissions du rôle sont filtrées selon le type de la structure de l'utilisateur
 * (une pharmacie n'a aucun accès au dossier médical, cf. permissions-type-structure.ts).
 *
 * Sécurité : en cas d'indisponibilité de Redis, on retombe sur la base (jamais de
 * « fail-open » qui accorderait des droits).
 */
@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);
  // v2 : permissions filtrées selon le type de structure (B10) ; le changement de préfixe ignore les anciennes entrées au déploiement.
  private readonly CACHE_PREFIX = 'perms:v2:user:';
  private readonly CACHE_TTL_S = 300; // 5 min

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private cacheKey(userId: string): string {
    return `${this.CACHE_PREFIX}${userId}`;
  }

  /** Permissions effectives d'un utilisateur (codes). Vide si pas de rôle assigné. */
  async getUserPermissions(userId: string): Promise<string[]> {
    const key = this.cacheKey(userId);

    // 1) Cache
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) {
        return JSON.parse(cached) as string[];
      }
    } catch (e) {
      this.logger.warn(
        `Lecture cache permissions échouée (fallback DB): ${(e as Error).message}`,
      );
    }

    // 2) Base
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        structure: { select: { type: true } },
        administeredStructure: { select: { type: true } },
        appRole: {
          select: {
            permissions: { select: { permission: { select: { code: true } } } },
          },
        },
      },
    });

    const codesDuRole =
      user?.appRole?.permissions.map((rp) => rp.permission.code) ?? [];
    const codes = filtrerPermissionsSelonTypeStructure(
      codesDuRole,
      typeStructureEffectif(user),
    );

    // 3) Mise en cache (best-effort)
    try {
      await this.redis.set(key, JSON.stringify(codes), 'EX', this.CACHE_TTL_S);
    } catch (e) {
      this.logger.warn(
        `Écriture cache permissions échouée: ${(e as Error).message}`,
      );
    }

    return codes;
  }

  /** Vrai si l'utilisateur possède TOUTES les permissions requises. */
  async hasPermissions(userId: string, required: string[]): Promise<boolean> {
    if (required.length === 0) return true;
    const perms = await this.getUserPermissions(userId);
    const set = new Set(perms);
    return required.every((code) => set.has(code));
  }

  /** Invalide le cache d'un utilisateur (ex. changement de rôle assigné). */
  async invalidateUser(userId: string): Promise<void> {
    try {
      await this.redis.del(this.cacheKey(userId));
    } catch (e) {
      this.logger.warn(
        `Invalidation cache user échouée: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Invalide le cache de TOUS les utilisateurs portant un rôle donné.
   * À appeler quand les permissions d'un rôle changent (2.5.d).
   */
  async invalidateRole(appRoleId: string): Promise<void> {
    try {
      const users = await this.prisma.user.findMany({
        where: { appRoleId },
        select: { id: true },
      });
      if (users.length === 0) return;
      await this.redis.del(...users.map((u) => this.cacheKey(u.id)));
    } catch (e) {
      this.logger.warn(
        `Invalidation cache rôle échouée: ${(e as Error).message}`,
      );
    }
  }
}
