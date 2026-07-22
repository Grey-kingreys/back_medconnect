import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { LoginThrottleService } from './login-throttle.service';
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
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly rolesService: RolesService,
    private readonly permissionsService: PermissionsService,
  ) { }

  /** Résout l'appRoleId à assigner (non bloquant : null en cas d'échec, le backfill rattrape). */
  private async resolveAppRoleId(legacyRole: string, structureId?: string | null): Promise<string | null> {
    try {
      return await this.rolesService.resolveAssignableRoleId({ legacyRole, structureId });
    } catch {
      return null;
    }
  }

  // ─── Login ────────────────────────────────────────────────────

  async login(loginDto: LoginDto, res: Response, ip: string) {
    const { email, password } = loginDto;

    // Anti-brute-force : blocage dur (429 + Retry-After) si seuil dépassé, sinon backoff progressif.
    await this.loginThrottle.guard(email, ip, res);

    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        password: true,
        role: true,
        isActive: true,
        structureId: true,
        dateNaissance: true,
        taille: true,
        poids: true,
      },
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
          .catch((e) => console.error('Email alerte connexion échoué:', e));
      }
      throw new UnauthorizedException('Email ou mot de passe incorrect');
    }

    // Connexion réussie → remise à zéro des compteurs anti-brute-force.
    await this.loginThrottle.reset(email, ip);

    const { access_token, refreshToken, refreshTokenExpires } = this.generateTokens({ 
      userId: user.id, 
      role: user.role,
      structureId: user.structureId ?? undefined 
    });

    const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefresh, refreshTokenExpires },
    });

    // Envoyer le refresh token dans un cookie sécurisé
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    });

    // Le refresh token n'est JAMAIS renvoyé dans le JSON : uniquement via le cookie
    // httpOnly ci-dessus (sinon le bénéfice httpOnly est annulé — exposition XSS).
    return {
      data: {
        access_token: access_token,
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

  async register(registerDto: RegisterDto, res: Response) {
    const { nom, prenom, email, password, telephone, dateNaissance, taille, poids } = registerDto;

    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('Un compte avec cet email existe déjà');
    }

    const hashedPassword = await this.hashPassword(password);

    const appRoleId = await this.resolveAppRoleId('PATIENT', null);

    const user = await this.prisma.user.create({
      data: {
        nom: nom.trim(),
        prenom: prenom.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        telephone: telephone?.trim(),
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
    });

    const { access_token, refreshToken, refreshTokenExpires } = this.generateTokens({ userId: user.id, role: user.role });

    const hashedRefresh = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefresh, refreshTokenExpires },
    });

    // Envoyer le refresh token dans un cookie sécurisé
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    });

    // Email de bienvenue (non bloquant)
    this.emailService
      .sendWelcomeEmail(user.email, user.nom, user.prenom)
      .catch(console.error);

    // Refresh token uniquement dans le cookie httpOnly (cf. login).
    return {
      data: {
        access_token: access_token,
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
    const permissions = await this.permissionsService.getUserPermissions(userId);

    return {
      data: { ...user, permissions },
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

    // Vérifier unicité du nouvel email
    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictException('Cet email est déjà utilisé par un autre compte');
      }
    }

    const updateData: any = {};
    if (dto.nom !== undefined) updateData.nom = dto.nom.trim();
    if (dto.prenom !== undefined) updateData.prenom = dto.prenom.trim();
    if (dto.email !== undefined) updateData.email = dto.email.toLowerCase();
    if (dto.telephone !== undefined) updateData.telephone = dto.telephone.trim();
    if (dto.dateNaissance !== undefined) updateData.dateNaissance = new Date(dto.dateNaissance);
    if (dto.taille !== undefined) updateData.taille = dto.taille;
    if (dto.poids !== undefined) updateData.poids = dto.poids;

    if (Object.keys(updateData).length === 0) {
      return {
        data: { id: user.id, nom: user.nom, prenom: user.prenom, email: user.email },
        message: 'Aucune modification effectuée',
        success: true,
      };
    }

    const updatedUser = await this.prisma.user.update({
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
    });

    return {
      data: updatedUser,
      message: 'Profil mis à jour avec succès',
      success: true,
    };
  }

  // ─── Change Password ──────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur non trouvé ou inactif');
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

    return {
      data: null,
      message: 'Mot de passe modifié avec succès',
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

    if (!user || !user.isActive) return genericResponse;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000), // 1h
      },
    });

    await this.emailService.sendPasswordResetEmail(
      user.email,
      user.nom,
      user.prenom,
      resetToken,
    );

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

    return {
      data: null,
      message: 'Mot de passe réinitialisé avec succès. Vous pouvez vous connecter.',
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

  
  generateTokens(payload: UserPayload) {
    const access_token = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m', // ← 15 minutes au lieu de 5
    });
 
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const refreshTokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 jours
 
    return { access_token, refreshToken, refreshTokenExpires };
  }
 
  generateToken(payload: UserPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });
  }


  async refreshAccessToken(rawRefreshToken: string, res: Response) {
    const hashed = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        refreshToken: hashed,
        refreshTokenExpires: { gt: new Date() },
        isActive: true,
      },
    });

    if (!user) throw new UnauthorizedException('Refresh token invalide ou expiré. Reconnectez-vous.');

    // Rotation : générer un nouveau refresh token à chaque appel
    const { access_token, refreshToken: newRefresh, refreshTokenExpires } = this.generateTokens({
      userId: user.id,
      role: user.role,
      structureId: user.structureId ?? undefined,
    });

    const hashedNew = crypto.createHash('sha256').update(newRefresh).digest('hex');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedNew, refreshTokenExpires },
    });

    // Mettre à jour le cookie avec le nouveau refresh token
    res.cookie('refresh_token', newRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    // Nouveau refresh token uniquement dans le cookie httpOnly (rotation).
    return {
      data: {
        access_token,
      },
      message: 'Token renouvelé',
      success: true,
    };
  }

  async logout(userId: string, res: Response) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null, refreshTokenExpires: null },
    });

    // Effacer le cookie
    res.clearCookie('refresh_token');

    return { data: null, message: 'Déconnexion réussie', success: true };
  }
}