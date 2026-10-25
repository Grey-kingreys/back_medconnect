import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from 'src/common/services/prisma.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import {
  DELAI_REDIS_MS,
  ETAT_REVOQUE_TTL_S,
  ETAT_VALIDE_TTL_S,
  type CodeRevocation,
} from './sessions.constants';

export interface EvenementRevocation {
  userId: string;
  sessionIds: string[];
  code: CodeRevocation;
}

export type Diffuseur = (evt: EvenementRevocation) => void;

const CODES: readonly string[] = [
  'SESSION_REVOQUEE',
  'SESSION_EXPIREE',
  'COMPTE_DESACTIVE',
];

const cleSession = (sid: string): string => `auth:etat:session:${sid}`;
const cleCompte = (userId: string): string => `auth:etat:compte:${userId}`;

/**
 * Contrôle de révocation des sessions : état en cache Redis (30 s si valide, 16 min si
 * révoqué) avec repli sur PostgreSQL quand Redis est lent ou indisponible (D01, D04).
 */
@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);
  private readonly diffuseurs: Diffuseur[] = [];
  private dernierAvertissement = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  enregistrerDiffuseur(fn: Diffuseur): void {
    this.diffuseurs.push(fn);
  }

  /** Renvoie le code de révocation du jeton, ou null s'il reste utilisable. */
  async verifier(jeton: {
    userId: string;
    sid?: string;
  }): Promise<CodeRevocation | null> {
    const cle = jeton.sid ? cleSession(jeton.sid) : cleCompte(jeton.userId);

    let valeur: string | null;
    try {
      valeur = await this.avecDelai(this.redis.get(cle));
    } catch {
      this.avertirRedisIndisponible();
      return this.lireEnBase(jeton);
    }

    if (valeur === 'ok') return null;
    if (valeur !== null && CODES.includes(valeur)) {
      return valeur as CodeRevocation;
    }

    const etat = await this.lireEnBase(jeton);
    try {
      if (etat === null) {
        await this.avecDelai(
          this.redis.set(cle, 'ok', 'EX', ETAT_VALIDE_TTL_S, 'NX'),
        );
      } else {
        await this.avecDelai(
          this.redis.set(cle, etat, 'EX', ETAT_REVOQUE_TTL_S),
        );
      }
    } catch (e) {
      this.logger.warn(
        `État de session non mis en cache : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return etat;
  }

  /** Écrit l'état révoqué dans Redis puis prévient les diffuseurs. Ne lève jamais. */
  async signaler(evt: EvenementRevocation): Promise<void> {
    if (evt.sessionIds.length > 0) {
      try {
        const multi = this.redis.multi();
        for (const id of evt.sessionIds) {
          multi.set(cleSession(id), evt.code, 'EX', ETAT_REVOQUE_TTL_S);
        }
        await this.avecDelai(multi.exec());
      } catch {
        this.logger.error(
          `État de révocation non écrit dans Redis pour ${evt.sessionIds.length} session(s) ; effet sous 30 s au plus (utilisateur ${evt.userId})`,
        );
      }
    }

    if (evt.code === 'COMPTE_DESACTIVE') {
      try {
        await this.avecDelai(
          this.redis.set(
            cleCompte(evt.userId),
            'COMPTE_DESACTIVE',
            'EX',
            ETAT_REVOQUE_TTL_S,
          ),
        );
      } catch {
        this.logger.error(
          `État de désactivation non écrit dans Redis pour l'utilisateur ${evt.userId} ; effet sous 30 s au plus`,
        );
      }
    }

    for (const diffuseur of this.diffuseurs) {
      try {
        diffuseur(evt);
      } catch (e) {
        this.logger.warn(
          `Diffusion de la révocation échouée : ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Efface l'état « compte désactivé » (réactivation, D05). */
  async effacerCompte(userId: string): Promise<void> {
    try {
      await this.avecDelai(this.redis.del(cleCompte(userId)));
    } catch (e) {
      this.logger.warn(
        `État du compte non effacé dans Redis : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async lireEnBase(jeton: {
    userId: string;
    sid?: string;
  }): Promise<CodeRevocation | null> {
    if (jeton.sid) {
      const session = await this.prisma.session.findUnique({
        where: { id: jeton.sid },
        select: {
          userId: true,
          revokedAt: true,
          revokedReason: true,
          expiresAt: true,
          user: { select: { isActive: true } },
        },
      });
      if (!session || session.userId !== jeton.userId) return 'SESSION_EXPIREE';
      if (!session.user.isActive) return 'COMPTE_DESACTIVE';
      if (session.revokedAt) {
        return session.revokedReason === 'COMPTE_DESACTIVE'
          ? 'COMPTE_DESACTIVE'
          : 'SESSION_REVOQUEE';
      }
      if (session.expiresAt.getTime() <= Date.now()) return 'SESSION_EXPIREE';
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: jeton.userId },
      select: { isActive: true },
    });
    if (!user) return 'SESSION_EXPIREE';
    if (!user.isActive) return 'COMPTE_DESACTIVE';
    return null;
  }

  /** Abandonne une opération Redis trop lente (DELAI_REDIS_MS). */
  private async avecDelai<T>(p: Promise<T>): Promise<T> {
    let minuteur: NodeJS.Timeout | undefined;
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(
        () => rejeter(new Error('Délai Redis dépassé')),
        DELAI_REDIS_MS,
      );
    });
    try {
      return await Promise.race([p, delai]);
    } finally {
      clearTimeout(minuteur);
      // Évite un rejet non géré si l'opération échoue après le délai.
      Promise.resolve(p).catch(() => undefined);
    }
  }

  /** Au plus un avertissement par minute. */
  private avertirRedisIndisponible(): void {
    const maintenant = Date.now();
    if (maintenant - this.dernierAvertissement < 60_000) return;
    this.dernierAvertissement = maintenant;
    this.logger.warn(
      'Redis indisponible pour le contrôle des sessions, lecture en base',
    );
  }
}
