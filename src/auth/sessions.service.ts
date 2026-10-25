import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import type { Response } from 'express';
import type { Prisma } from 'generated/prisma/client';
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
  PURGE_SESSIONS_MS,
  RETENTION_SESSIONS_MS,
  dureeSession,
  estSessionsMultiAppareilsActif,
  type CodeRevocation,
  type RaisonRevocation,
} from './sessions.constants';
import { RevocationService } from './revocation.service';

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
  private minuteurPurgeSessions?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly encryption: EncryptionService,
    private readonly revocation: RevocationService,
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
    this.minuteurPurgeSessions = setInterval(() => {
      this.purgerSessionsExpirees().catch((e: unknown) =>
        this.logger.warn(
          `Purge des sessions expirées échouée : ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }, PURGE_SESSIONS_MS);
    this.minuteurPurgeSessions.unref();
  }

  onModuleDestroy(): void {
    if (this.minuteurPurge) clearInterval(this.minuteurPurge);
    if (this.minuteurPurgeSessions) clearInterval(this.minuteurPurgeSessions);
  }

  /** Supprime les sessions expirées ou révoquées depuis plus de 30 jours. */
  async purgerSessionsExpirees(): Promise<number> {
    const limite = new Date(Date.now() - RETENTION_SESSIONS_MS);
    const { count } = await this.prisma.session.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: limite } }, { revokedAt: { lt: limite } }],
      },
    });
    if (count > 0) this.logger.log(`Sessions purgées : ${count}`);
    return count;
  }

  /** Révocation unique de toutes les sessions visées : base, état Redis puis socket. */
  private async revoquer(
    where: Prisma.SessionWhereInput,
    raison: RaisonRevocation,
    code: CodeRevocation,
    userId: string,
  ): Promise<string[]> {
    const trouvees = await this.prisma.session.findMany({
      where: { ...where, revokedAt: null },
      select: { id: true },
    });
    if (trouvees.length === 0) return [];
    const ids = trouvees.map((s) => s.id);
    await this.prisma.session.updateMany({
      where: { id: { in: ids }, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: raison,
        graceSecretEnc: null,
        graceUntil: null,
      },
    });
    await this.revocation.signaler({ userId, sessionIds: ids, code });
    return ids;
  }

  /** Appareils connectés de l'utilisateur, l'appareil courant en tête. */
  async lister(userId: string, sidCourant?: string) {
    if (!estSessionsMultiAppareilsActif()) return [];
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    const liste = sessions.map((s) => {
      const web = s.clientType === SessionClientType.WEB;
      let repli = 'Téléphone';
      if (web) repli = 'Navigateur web';
      else if (s.platform === 'ios') repli = 'iPhone';
      else if (s.platform === 'android') repli = 'Téléphone Android';
      return {
        id: s.id,
        type: web ? ('web' as const) : ('mobile' as const),
        nom: s.deviceName ?? repli,
        plateforme: web ? 'web' : (s.platform ?? 'inconnue'),
        versionApp: s.appVersion ?? null,
        creeLe: s.createdAt,
        derniereActivite: s.lastUsedAt,
        expireLe: s.expiresAt,
        appareilCourant: s.id === sidCourant,
      };
    });
    // Tri stable : l'appareil courant d'abord, le reste garde l'ordre d'activité.
    return [
      ...liste.filter((s) => s.appareilCourant),
      ...liste.filter((s) => !s.appareilCourant),
    ];
  }

  /** Déconnecte un appareil de l'utilisateur ; réponse identique pour tout cas introuvable. */
  async revoquerUne(userId: string, id: string): Promise<void> {
    if (!estSessionsMultiAppareilsActif()) {
      throw new NotFoundException({
        message: MESSAGES_SESSION.appareilIntrouvable,
      });
    }
    const ids = await this.revoquer(
      { id, userId, expiresAt: { gt: new Date() } },
      'REVOCATION_UTILISATEUR',
      'SESSION_REVOQUEE',
      userId,
    );
    if (ids.length === 0) {
      throw new NotFoundException({
        message: MESSAGES_SESSION.appareilIntrouvable,
      });
    }
  }

  /** Déconnecte les autres appareils (tous si sidCourant est absent). */
  async revoquerAutres(
    userId: string,
    sidCourant: string | undefined,
    raison: 'REVOCATION_UTILISATEUR' | 'MOT_DE_PASSE_MODIFIE',
  ): Promise<number> {
    if (!estSessionsMultiAppareilsActif()) return 0;
    const ids = await this.revoquer(
      sidCourant ? { userId, id: { not: sidCourant } } : { userId },
      raison,
      'SESSION_REVOQUEE',
      userId,
    );
    return ids.length;
  }

  /** Déconnecte tous les appareils (réinitialisation du mot de passe). */
  async revoquerToutes(
    userId: string,
    raison: 'MOT_DE_PASSE_REINITIALISE',
  ): Promise<number> {
    if (!estSessionsMultiAppareilsActif()) {
      await this.viderRefreshAncien(userId);
      return 0;
    }
    const ids = await this.revoquer(
      { userId },
      raison,
      'SESSION_REVOQUEE',
      userId,
    );
    return ids.length;
  }

  /** Désactivation du compte : toutes les sessions sont coupées, même sans session ouverte. */
  async desactiverCompte(userId: string): Promise<void> {
    let ids: string[] = [];
    if (estSessionsMultiAppareilsActif()) {
      ids = await this.revoquer(
        { userId },
        'COMPTE_DESACTIVE',
        'COMPTE_DESACTIVE',
        userId,
      );
    } else {
      await this.viderRefreshAncien(userId);
    }
    // Si des sessions ont été révoquées, revoquer() a déjà signalé avec ce code.
    if (ids.length === 0) {
      await this.revocation.signaler({
        userId,
        sessionIds: [],
        code: 'COMPTE_DESACTIVE',
      });
    }
  }

  /** Réactivation du compte : l'état « désactivé » en cache est effacé. */
  async reactiverCompte(userId: string): Promise<void> {
    await this.revocation.effacerCompte(userId);
  }

  private async viderRefreshAncien(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, refreshTokenExpires: null },
    });
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
      await this.revoquer(
        { userId: user.id, deviceId: client.deviceId },
        'NOUVELLE_CONNEXION',
        'SESSION_REVOQUEE',
        user.id,
      );
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
        deviceName: client.nomAppareil ?? null,
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
    await this.revoquer(
      { id },
      'REUTILISATION',
      'SESSION_REVOQUEE',
      session.userId,
    );
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
    let proprietaire: string | null = null;

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
        if (courant || precedent) {
          idSession = session.id;
          proprietaire = session.userId;
        }
      }
    }

    if (!idSession && entree.sid && entree.userId) {
      const session = await this.prisma.session.findUnique({
        where: { id: entree.sid },
      });
      if (session && session.userId === entree.userId) {
        idSession = session.id;
        proprietaire = session.userId;
      }
    }

    if (idSession && proprietaire) {
      await this.revoquer(
        { id: idSession },
        'DECONNEXION',
        'SESSION_REVOQUEE',
        proprietaire,
      );
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
