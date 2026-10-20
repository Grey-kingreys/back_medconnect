import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import type { Response } from 'express';
import { SessionClientType } from 'generated/prisma/enums';
import { PrismaService } from 'src/common/services/prisma.service';
import { EncryptionService } from 'src/common/services/encryption.service';
import type { CodeErreur } from 'src/common/filters/codes-erreur';
import {
  DUREE_ACCES,
  DUREE_ACCES_SECONDES,
  DUREE_SESSION_LONGUE_MS,
  GRACE_REFRESH_MS,
  MESSAGES_SESSION,
  NOM_COOKIE_REFRESH,
  PURGE_GRACE_MS,
  dureeSession,
  estSessionsMultiAppareilsActif,
} from './sessions.constants';

export interface InfosClient {
  type: SessionClientType;
  deviceId?: string;
  plateforme?: string;
  nomAppareil?: string;
  versionApp?: string;
}

export interface UtilisateurJeton {
  id: string;
  role: string;
  structureId?: string | null;
}

export interface JetonsSession {
  access_token: string;
  refreshToken: string;
  expiresIn: number; // secondes, DUREE_ACCES_SECONDES
  sessionId: string | null; // null en mode ancien (drapeau false)
  dureeMs: number; // durée restante de la session, sert au maxAge du cookie
}

const FORMAT_REFRESH = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/i;
const FORMAT_SECRET = /^[0-9a-f]{64}$/;

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

/** Comparaison à temps constant de deux empreintes hexadécimales. */
function egal(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function nouveauSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function erreur(code: CodeErreur, message: string): UnauthorizedException {
  return new UnauthorizedException({ message, code });
}

interface SessionAvecUtilisateur {
  id: string;
  userId: string;
  clientType: SessionClientType;
  refreshHash: string;
  previousRefreshHash: string | null;
  graceUntil: Date | null;
  graceSecretEnc: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  user: {
    id: string;
    role: string;
    structureId: string | null;
    isActive: boolean;
  };
}

/**
 * Sessions par appareil : une session = une connexion = une famille de refresh.
 * Rotation à chaque renouvellement, fenêtre de grâce pour les appels concurrents
 * et détection de réutilisation (décisions D02 à D07 du run TB3).
 */
@Injectable()
export class SessionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionsService.name);
  private minuteurPurge?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly encryption: EncryptionService,
  ) {}

  onModuleInit(): void {
    if (!estSessionsMultiAppareilsActif()) return;
    this.minuteurPurge = setInterval(() => {
      this.purgerSecretsDeGrace().catch((e: unknown) =>
        this.logger.warn(
          `Purge des secrets de grâce échouée : ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, PURGE_GRACE_MS);
    this.minuteurPurge.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteurPurge) clearInterval(this.minuteurPurge);
  }

  /** Efface les secrets de grâce échus (D20). Idempotent, sans coordination entre instances. */
  async purgerSecretsDeGrace(): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { graceSecretEnc: { not: null }, graceUntil: { lt: new Date() } },
      data: { graceSecretEnc: null },
    });
    return count;
  }

  signerAcces(payload: {
    userId: string;
    role: string;
    structureId?: string;
    sid?: string;
  }): string {
    const charge: Record<string, string> = {
      userId: payload.userId,
      role: payload.role,
    };
    if (payload.structureId !== undefined) {
      charge.structureId = payload.structureId;
    }
    if (payload.sid !== undefined) charge.sid = payload.sid;
    return this.jwtService.sign(charge, {
      secret: process.env.JWT_SECRET,
      expiresIn: DUREE_ACCES,
    });
  }

  async ouvrir(
    user: UtilisateurJeton,
    client: InfosClient,
  ): Promise<JetonsSession> {
    if (!estSessionsMultiAppareilsActif()) {
      return this.ouvrirAncien(user);
    }

    const maintenant = new Date();

    if (client.type === SessionClientType.MOBILE && client.deviceId) {
      await this.prisma.session.updateMany({
        where: {
          userId: user.id,
          deviceId: client.deviceId,
          revokedAt: null,
        },
        data: {
          revokedAt: maintenant,
          revokedReason: 'NOUVELLE_CONNEXION',
          graceSecretEnc: null,
          graceUntil: null,
        },
      });
    }

    const secret = nouveauSecret();
    const dureeMs = dureeSession(client.type, user.role);
    const web = client.type === SessionClientType.WEB;
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        clientType: client.type,
        platform: web ? null : (client.plateforme ?? null),
        deviceId: web ? null : (client.deviceId ?? null),
        deviceName: web ? null : (client.nomAppareil ?? null),
        appVersion: web ? null : (client.versionApp ?? null),
        refreshHash: sha256(secret),
        expiresAt: new Date(maintenant.getTime() + dureeMs),
      },
    });

    return {
      access_token: this.signerAcces({
        userId: user.id,
        role: user.role,
        structureId: user.structureId ?? undefined,
        sid: session.id,
      }),
      refreshToken: `${session.id}.${secret}`,
      expiresIn: DUREE_ACCES_SECONDES,
      sessionId: session.id,
      dureeMs,
    };
  }

  async renouveler(
    refresh: string,
    clientType: SessionClientType,
  ): Promise<JetonsSession> {
    if (!estSessionsMultiAppareilsActif()) {
      return this.renouvelerAncien(refresh);
    }

    const analyse = FORMAT_REFRESH.exec(refresh ?? '');
    if (!analyse) throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
    const [, id, secret] = analyse;

    let session = await this.lire(id);
    if (!session) throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
    this.controler(session, clientType);

    const maintenant = new Date();
    const h = sha256(secret);

    if (egal(h, session.refreshHash)) {
      const nouveau = nouveauSecret();
      const dureeMs = dureeSession(session.clientType, session.user.role);
      const { count } = await this.prisma.session.updateMany({
        where: { id, refreshHash: h, revokedAt: null },
        data: {
          refreshHash: sha256(nouveau),
          previousRefreshHash: h,
          graceUntil: new Date(maintenant.getTime() + GRACE_REFRESH_MS),
          graceSecretEnc: this.encryption.encrypt(nouveau),
          lastUsedAt: maintenant,
          expiresAt: new Date(maintenant.getTime() + dureeMs),
        },
      });
      if (count === 1) {
        return this.jetons(session, `${id}.${nouveau}`, dureeMs);
      }
      // Un refresh concurrent a tourné entre-temps : relecture unique.
      session = await this.lire(id);
      if (!session) throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
      this.controler(session, clientType);
    }

    // Grâce : l'ancien secret renvoie le secret courant déjà émis.
    if (
      session.previousRefreshHash &&
      egal(h, session.previousRefreshHash) &&
      session.graceUntil &&
      session.graceUntil.getTime() > maintenant.getTime()
    ) {
      const courant = this.encryption.decrypt(session.graceSecretEnc ?? '');
      if (!FORMAT_SECRET.test(courant)) {
        this.logger.warn(`Secret de grâce illisible pour la session ${id}`);
        throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
      }
      await this.prisma.session.update({
        where: { id },
        data: { lastUsedAt: maintenant },
      });
      return this.jetons(
        session,
        `${id}.${courant}`,
        session.expiresAt.getTime() - maintenant.getTime(),
      );
    }

    // Réutilisation d'un secret périmé : la session est révoquée.
    await this.prisma.session.update({
      where: { id },
      data: {
        revokedAt: maintenant,
        revokedReason: 'REUTILISATION',
        graceSecretEnc: null,
        graceUntil: null,
      },
    });
    this.logger.warn(
      `Réutilisation d'un ancien jeton de renouvellement : session ${id} révoquée (utilisateur ${session.userId})`,
    );
    throw erreur('REFRESH_REUTILISE', MESSAGES_SESSION.reutilisee);
  }

  async fermer(entree: {
    refresh?: string;
    sid?: string;
    userId?: string;
  }): Promise<void> {
    if (!estSessionsMultiAppareilsActif()) {
      if (entree.userId) {
        await this.prisma.user.update({
          where: { id: entree.userId },
          data: { refreshToken: null, refreshTokenExpires: null },
        });
      }
      return;
    }

    const maintenant = new Date();
    let idSession: string | null = null;

    const analyse = FORMAT_REFRESH.exec(entree.refresh ?? '');
    if (analyse) {
      const [, id, secret] = analyse;
      const session = await this.prisma.session.findUnique({ where: { id } });
      if (session) {
        const h = sha256(secret);
        const courant = egal(h, session.refreshHash);
        const precedent =
          !!session.previousRefreshHash &&
          egal(h, session.previousRefreshHash) &&
          !!session.graceUntil &&
          session.graceUntil.getTime() > maintenant.getTime();
        if (courant || precedent) idSession = session.id;
      }
    }

    if (!idSession && entree.sid && entree.userId) {
      const session = await this.prisma.session.findUnique({
        where: { id: entree.sid },
      });
      if (session && session.userId === entree.userId) idSession = session.id;
    }

    if (idSession) {
      await this.prisma.session.updateMany({
        where: { id: idSession, revokedAt: null },
        data: {
          revokedAt: maintenant,
          revokedReason: 'DECONNEXION',
          graceSecretEnc: null,
          graceUntil: null,
        },
      });
    }
  }

  poserCookie(res: Response, refreshToken: string, dureeMs: number): void {
    res.cookie(NOM_COOKIE_REFRESH, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: dureeMs,
    });
  }

  effacerCookie(res: Response): void {
    res.clearCookie(NOM_COOKIE_REFRESH);
  }

  private async lire(id: string): Promise<SessionAvecUtilisateur | null> {
    return this.prisma.session.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, role: true, structureId: true, isActive: true },
        },
      },
    });
  }

  private controler(
    session: SessionAvecUtilisateur,
    clientType: SessionClientType,
  ): void {
    if (session.clientType !== clientType) {
      throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
    }
    if (session.revokedAt) {
      throw erreur('SESSION_REVOQUEE', MESSAGES_SESSION.revoquee);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
    }
    if (!session.user.isActive) {
      throw erreur('COMPTE_DESACTIVE', MESSAGES_SESSION.compteDesactive);
    }
  }

  private jetons(
    session: SessionAvecUtilisateur,
    refreshToken: string,
    dureeMs: number,
  ): JetonsSession {
    return {
      access_token: this.signerAcces({
        userId: session.user.id,
        role: session.user.role,
        structureId: session.user.structureId ?? undefined,
        sid: session.id,
      }),
      refreshToken,
      expiresIn: DUREE_ACCES_SECONDES,
      sessionId: session.id,
      dureeMs,
    };
  }

  /** Ancien comportement (drapeau inactif) : un seul refresh par utilisateur. */
  private async ouvrirAncien(user: UtilisateurJeton): Promise<JetonsSession> {
    const refresh = crypto.randomBytes(40).toString('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: sha256(refresh),
        refreshTokenExpires: new Date(Date.now() + DUREE_SESSION_LONGUE_MS),
      },
    });
    return {
      access_token: this.signerAcces({
        userId: user.id,
        role: user.role,
        structureId: user.structureId ?? undefined,
      }),
      refreshToken: refresh,
      expiresIn: DUREE_ACCES_SECONDES,
      sessionId: null,
      dureeMs: DUREE_SESSION_LONGUE_MS,
    };
  }

  private async renouvelerAncien(refresh: string): Promise<JetonsSession> {
    const user = await this.prisma.user.findFirst({
      where: {
        refreshToken: sha256(refresh ?? ''),
        refreshTokenExpires: { gt: new Date() },
        isActive: true,
      },
    });
    if (!user) throw erreur('SESSION_EXPIREE', MESSAGES_SESSION.expiree);
    return this.ouvrirAncien(user);
  }
}
