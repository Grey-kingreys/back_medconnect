import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { estCompteDemo, estModeDemoActif } from 'src/demo/demo-mode';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  avecTelephoneUnique,
  exigerTelephone,
  verifierTelephoneLibre,
} from 'src/common/telephone/telephone-unicite';
import { EmailService } from 'src/common/services/email.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { LoginThrottleService } from './login-throttle.service';
import {
  SessionsService,
  type InfosClient,
  type JetonsSession,
  type UtilisateurJeton,
} from './sessions.service';
import { MESSAGES_SESSION } from './sessions.constants';
import { SessionClientType } from 'generated/prisma/enums';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  ChangePasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';

export type UserPayload = {
  userId: string;
  role: string;
  structureId?: string;
  sid?: string;
};

/** Champs lus pour ouvrir une session (connexion classique et connexion démo). */
const CHAMPS_SESSION = {
  id: true,
  email: true,
  nom: true,
  prenom: true,
  role: true,
  isActive: true,
  structureId: true,
  dateNaissance: true,
  taille: true,
  poids: true,
} satisfies Prisma.UserSelect;

type UtilisateurSession = Prisma.UserGetPayload<{
  select: typeof CHAMPS_SESSION;
}>;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Ouvre la session et renvoie les jetons selon le client.
   * Web : refresh uniquement dans le cookie httpOnly. Mobile : refresh dans le JSON, sans cookie.
   */
  private async emettreJetons(
    user: UtilisateurJeton,
    res: Response,
    client: InfosClient,
  ) {
    const jetons = await this.sessions.ouvrir(user, client);
    if (client.type === SessionClientType.MOBILE) {
      return {
        access_token: jetons.access_token,
        refreshToken: jetons.refreshToken,
        expiresIn: jetons.expiresIn,
        sessionId: jetons.sessionId,
      };
    }
    this.sessions.poserCookie(res, jetons.refreshToken, jetons.dureeMs);
    return { access_token: jetons.access_token };
  }

  /** Résout l'appRoleId à assigner (non bloquant : null en cas d'échec, le backfill rattrape). */
  private async resolveAppRoleId(
    legacyRole: string,
    structureId?: string | null,
  ): Promise<string | null> {
    try {
      return await this.rolesService.resolveAssignableRoleId({
        legacyRole,
        structureId,
      });
    } catch {
      return null;
    }
  }

  // ─── Login ────────────────────────────────────────────────────

  async login(
    loginDto: LoginDto,
    res: Response,
    ip: string,
    client: InfosClient,
  ) {
    const { email, password } = loginDto;

    // Anti-brute-force : blocage dur (429 + Retry-After) si seuil dépassé, sinon backoff progressif.
    await this.loginThrottle.guard(email, ip, res);

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { ...CHAMPS_SESSION, password: true },
    });

    if (!user) {
      // Compté pour ne pas révéler l'inexistence de l'email (réponse uniforme).
      await this.loginThrottle.registerFailure(email, ip);
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        "Votre compte a été désactivé. Contactez l'administrateur.",
      );
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      const blockedNow = await this.loginThrottle.registerFailure(email, ip);
      // Notifier le titulaire uniquement au déclenchement du blocage dur (envoi unique).
      if (blockedNow) {
        this.emailService
          .sendSuspiciousLoginEmail(user.email, user.nom, user.prenom, ip)
          .catch((e) =>
            this.logger.error("Email d'alerte de connexion échoué", e),
          );
      }
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    // Connexion réussie → remise à zéro des compteurs anti-brute-force.
    await this.loginThrottle.reset(email, ip);

    return this.ouvrirSession(user, res, client);
  }

  // ─── Connexion démo (mode démo uniquement) ────────────────────

  /**
   * Ouvre une session sur un compte de démonstration, sans mot de passe.
   * Même réponse et mêmes effets que `login` (jetons, cookie, refresh haché).
   * Refuse (403) tout compte absent, inactif ou dont l'email n'est pas en
   * `@demo.medconnecte.gn`, y compris un vrai compte. 404 si le mode est inactif.
   */
  async connexionDemo(userId: string, res: Response, client: InfosClient) {
    if (!estModeDemoActif()) {
      throw new NotFoundException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: CHAMPS_SESSION,
    });

    if (!user || !user.isActive || !estCompteDemo(user.email)) {
      throw new ForbiddenException(
        "Ce compte n'est pas un compte de démonstration. Choisissez un compte dans la liste proposée.",
      );
    }

    return this.ouvrirSession(user, res, client);
  }

  /** Ouvre la session et construit la réponse de connexion. */
  private async ouvrirSession(
    user: UtilisateurSession,
    res: Response,
    client: InfosClient,
  ) {
    const jetons = await this.emettreJetons(
      { id: user.id, role: user.role, structureId: user.structureId },
      res,
      client,
    );

    // Web : le refresh token n'est JAMAIS renvoyé dans le JSON, uniquement via le cookie
    // httpOnly (sinon le bénéfice httpOnly est annulé, exposition XSS).
    // Mobile : le refresh est dans le JSON, sans cookie.
    return {
      data: {
        ...jetons,
        user: {
          id: user.id,
          email: user.email,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role,
          structureId: user.structureId,
          dateNaissance: user.dateNaissance,
          taille: user.taille,
          poids: user.poids,
        },
      },
      message: 'Connexion réussie',
      success: true,
    };
  }

  // ─── Register (patients uniquement) ──────────────────────────

  async register(registerDto: RegisterDto, res: Response, client: InfosClient) {
    const {
      nom,
      prenom,
      email,
      password,
      telephone,
      dateNaissance,
      taille,
      poids,
    } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Un compte avec cet email existe déjà');
    }

    const telephoneE164 = telephone ? exigerTelephone(telephone) : undefined;
    if (telephoneE164) await verifierTelephoneLibre(this.prisma, telephoneE164);

    const hashedPassword = await this.hashPassword(password);

    const appRoleId = await this.resolveAppRoleId('PATIENT', null);

    const user = await avecTelephoneUnique(
      this.prisma.user.create({
        data: {
          nom: nom.trim(),
          prenom: prenom.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          telephone: telephoneE164,
          dateNaissance: dateNaissance ? new Date(dateNaissance) : undefined,
          taille: taille ?? undefined,
          poids: poids ?? undefined,
          role: 'PATIENT',
          appRoleId: appRoleId ?? undefined,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          createdAt: true,
        },
      }),
    );

    const jetons = await this.emettreJetons(
      { id: user.id, role: user.role, structureId: null },
      res,
      client,
    );

    // Email de bienvenue (non bloquant)
    this.emailService
      .sendWelcomeEmail(user.email, user.nom, user.prenom)
      .catch((e) => this.logger.error('Email de bienvenue échoué', e));

    // Refresh token : cookie httpOnly pour le web, JSON pour le mobile (cf. login).
    return {
      data: {
        ...jetons,
        user: {
          id: user.id,
          email: user.email,
          nom: user.nom,
          prenom: user.prenom,
          role: user.role,
        },
      },
      message: 'Inscription réussie ! Bienvenue sur MedConnecte.',
      success: true,
    };
  }

  // ─── Me (profil courant) ──────────────────────────────────────

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        telephone: true,
        dateNaissance: true,
        taille: true,
        poids: true,
        role: true,
        isActive: true,
        structureId: true,
        avatarFile: { select: { key: true } },
        structure: {
          select: { id: true, nom: true, type: true },
        },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Résoudre les permissions effectives de l'utilisateur
    const permissions =
      await this.permissionsService.getUserPermissions(userId);

    // URL publique de l'avatar (bucket public R2 servi via R2_PUBLIC_URL), null si aucun.
    // Résolu inline (pas d'injection de StorageService : StorageModule importe déjà
    // AuthModule → éviterait un cycle de dépendances).
    const { avatarFile, ...rest } = user;
    const base = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
    const avatarUrl = avatarFile ? `${base}/${avatarFile.key}` : null;

    return {
      data: { ...rest, avatarUrl, permissions },
      message: 'Profil récupéré',
      success: true,
    };
  }

  // ─── Edit Profile ─────────────────────────────────────────────

  async editProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur non trouvé ou inactif');
    }

    // Un compte démo garde son email : c'est lui qui le signe comme compte démo.
    if (
      dto.email &&
      dto.email.toLowerCase() !== user.email &&
      estCompteDemo(user.email)
    ) {
      throw new ForbiddenException(
        "L'email d'un compte de démonstration ne peut pas être modifié.",
      );
    }

    // Vérifier unicité du nouvel email
    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictException(
          'Cet email est déjà utilisé par un autre compte',
        );
      }
    }

    const updateData: Prisma.UserUpdateInput = {};
    if (dto.nom !== undefined) updateData.nom = dto.nom.trim();
    if (dto.prenom !== undefined) updateData.prenom = dto.prenom.trim();
    if (dto.email !== undefined) updateData.email = dto.email.toLowerCase();
    if (dto.telephone === null) {
      // null retire le numéro (D45).
      updateData.telephone = null;
    } else if (dto.telephone !== undefined) {
      const telephoneE164 = exigerTelephone(dto.telephone);
      await verifierTelephoneLibre(this.prisma, telephoneE164, userId);
      updateData.telephone = telephoneE164;
    }
    if (dto.dateNaissance !== undefined)
      updateData.dateNaissance = new Date(dto.dateNaissance);
    if (dto.taille !== undefined) updateData.taille = dto.taille;
    if (dto.poids !== undefined) updateData.poids = dto.poids;

    if (Object.keys(updateData).length === 0) {
      return {
        data: {
          id: user.id,
          nom: user.nom,
          prenom: user.prenom,
          email: user.email,
        },
        message: 'Aucune modification effectuée',
        success: true,
      };
    }

    const updatedUser = await avecTelephoneUnique(
      this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          telephone: true,
          dateNaissance: true,
          taille: true,
          poids: true,
          role: true,
          updatedAt: true,
        },
      }),
    );

    return {
      data: updatedUser,
      message: 'Profil mis à jour avec succès',
      success: true,
    };
  }

  // ─── Change Password ──────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto, sid?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur non trouvé ou inactif');
    }

    // Un compte démo reste sans mot de passe connu : il ne s'ouvre que par la connexion démo.
    if (estCompteDemo(user.email)) {
      throw new ForbiddenException(
        "Le mot de passe d'un compte de démonstration ne peut pas être modifié.",
      );
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Le mot de passe actuel est incorrect');
    }

    const hashed = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    const appareilsDeconnectes =
      dto.deconnecterAutresAppareils === false
        ? 0
        : await this.sessions.revoquerAutres(
            userId,
            sid,
            'MOT_DE_PASSE_MODIFIE',
          );

    return {
      data: { appareilsDeconnectes },
      message:
        appareilsDeconnectes > 0
          ? 'Mot de passe modifié. Vos autres appareils ont été déconnectés.'
          : 'Mot de passe modifié avec succès',
      success: true,
    };
  }

  // ─── Forgot Password ──────────────────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto) {
    // Réponse générique pour éviter l'enumeration d'emails
    const genericResponse = {
      data: null,
      message:
        'Si cet email existe, un lien de réinitialisation vous a été envoyé.',
      success: true,
    };

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    // Compte démo : aucune réinitialisation possible (boîte mail fictive, accès par connexion démo).
    if (!user || !user.isActive || estCompteDemo(user.email)) {
      return genericResponse;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000), // 1h
      },
    });

    try {
      await this.emailService.sendPasswordResetEmail(
        user.email,
        user.nom,
        user.prenom,
        resetToken,
      );
    } catch {
      // Réponse identique dans tous les cas : ne révèle pas si le compte existe.
      this.logger.error(`auth.reset_email_echec userId=${user.id}`);
    }

    return genericResponse;
  }

  // ─── Reset Password ───────────────────────────────────────────

  async resetPassword(dto: ResetPasswordDto) {
    const hashedToken = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { gt: new Date() },
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Token invalide ou expiré. Veuillez faire une nouvelle demande.',
      );
    }

    const hashed = await this.hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });
    await this.sessions.revoquerToutes(user.id, 'MOT_DE_PASSE_REINITIALISE');

    return {
      data: null,
      message:
        'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.',
      success: true,
    };
  }

  // ─── Verify Reset Token ───────────────────────────────────────

  async verifyResetToken(token: string) {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { gt: new Date() },
        isActive: true,
      },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('Token invalide ou expiré');
    }

    return {
      data: { valid: true, email: user.email },
      message: 'Token valide',
      success: true,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  // Inutilisée depuis TB3 (sessions par appareil, SessionsService) ; à retirer avec la colonne User.refreshToken.
  generateTokens(payload: UserPayload) {
    const access_token = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m', // ← 15 minutes au lieu de 5
    });

    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours

    return { access_token, refreshToken, refreshTokenExpires };
  }

  // Inutilisée depuis TB3 (sessions par appareil, SessionsService) ; à retirer avec la colonne User.refreshToken.
  generateToken(payload: UserPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });
  }

  /**
   * Renouvelle les jetons. Web : refresh lu dans le cookie, nouveau cookie posé, jamais dans le JSON.
   * Mobile : refresh lu dans le corps, renvoyé dans le JSON, aucun cookie.
   */
  async refreshAccessToken(
    refresh: string | undefined,
    res: Response,
    type: SessionClientType,
  ) {
    const web = type === SessionClientType.WEB;
    if (!refresh) {
      if (web) this.sessions.effacerCookie(res);
      throw new UnauthorizedException({
        message: MESSAGES_SESSION.expiree,
        code: 'SESSION_EXPIREE',
      });
    }

    let jetons: JetonsSession;
    try {
      jetons = await this.sessions.renouveler(refresh, type);
    } catch (e) {
      if (web) this.sessions.effacerCookie(res);
      throw e;
    }

    if (web) {
      this.sessions.poserCookie(res, jetons.refreshToken, jetons.dureeMs);
      return {
        data: { access_token: jetons.access_token },
        message: 'Token renouvelé',
        success: true,
      };
    }
    return {
      data: {
        access_token: jetons.access_token,
        refreshToken: jetons.refreshToken,
        expiresIn: jetons.expiresIn,
        sessionId: jetons.sessionId,
      },
      message: 'Token renouvelé',
      success: true,
    };
  }

  /** Déconnexion de cet appareil : par le refresh, ou par le sid d'un jeton d'accès valide. Répond toujours 200. */
  async logout(
    entree: { refresh?: string; jetonAcces?: string },
    res: Response,
    type: SessionClientType,
  ) {
    let userId: string | undefined;
    let sid: string | undefined;
    if (entree.jetonAcces) {
      try {
        const p = await this.jwtService.verifyAsync<{
          userId: string;
          sid?: string;
        }>(entree.jetonAcces, { secret: process.env.JWT_SECRET });
        userId = p.userId;
        sid = p.sid;
      } catch {
        /* jeton expiré ou invalide : la déconnexion continue avec le refresh */
      }
    }

    await this.sessions.fermer({ refresh: entree.refresh, sid, userId });

    if (type === SessionClientType.WEB) this.sessions.effacerCookie(res);

    return { data: null, message: 'Déconnexion réussie', success: true };
  }
}
