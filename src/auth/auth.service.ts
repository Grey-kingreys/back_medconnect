import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { UserPayload } from './jwt.strategy';
import { CreateUserDto } from './dto/create-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
import { EmailService } from 'src/common/services/email.service';
import * as crypto from 'crypto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Role } from 'generated/prisma/enums';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService
  ) { }

  /**
   * Connexion d'un utilisateur
   */
  async login({ authBody }: { authBody: LoginUserDto }) {
    try {
      const { email, password } = authBody;

      // Recherche de l'utilisateur
      const existingUser = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          password: true,
          role: true,
          isActive: true,
        }
      });

      // Vérification existence utilisateur
      if (!existingUser) {
        throw new UnauthorizedException("Email ou mot de passe incorrect");
      }

      // Vérification compte actif
      if (!existingUser.isActive) {
        throw new UnauthorizedException("Votre compte a été désactivé. Contactez l'administrateur.");
      }

      // Vérification du mot de passe
      const isPasswordValid = await this.comparePassword({
        password,
        hashedPassword: existingUser.password
      });

      if (!isPasswordValid) {
        throw new UnauthorizedException("Email ou mot de passe incorrect");
      }

      // Génération du token
      const tokens = this.authenticateUser({
        userId: existingUser.id,
        role: existingUser.role
      });

      return {
        data: {
          ...tokens,
          user: {
            id: existingUser.id,
            email: existingUser.email,
            nom: existingUser.nom,
            prenom: existingUser.prenom,
            role: existingUser.role,
          }
        },
        message: "Connexion réussie",
        success: true
      };

    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      console.error('Erreur lors de la connexion:', error);
      throw new BadRequestException("Une erreur est survenue lors de la connexion");
    }
  }

  /**
   * Inscription d'un nouvel utilisateur (role USER uniquement)
   */
  async register({ registerBody }: { registerBody: CreateUserDto }) {
    try {
      const { nom, prenom, email, password } = registerBody;

      // Vérification si l'email existe déjà
      const existingUser = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() }
      });

      if (existingUser) {
        throw new ConflictException("Un utilisateur avec cet email existe déjà");
      }

      // Hashage du mot de passe
      const hashedPassword = await this.hashPassword({ password });

      // Création de l'utilisateur avec le rôle USER par défaut
      const user = await this.prisma.user.create({
        data: {
          nom: nom.trim(),
          prenom: prenom.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          role: Role.PATIENT,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          createdAt: true,
        }
      });

      // Génération du token
      const tokens = this.authenticateUser({
        userId: user.id,
        role: user.role
      });

      // TODO: Envoyer un email de bienvenue
      await this.emailService.sendWelcomeEmail(user.email, user.nom, user.prenom);

      return {
        data: {
          ...tokens,
          user: {
            id: user.id,
            email: user.email,
            nom: user.nom,
            prenom: user.prenom,
            role: user.role,
          }
        },
        message: "Inscription réussie ! Un email de bienvenue vous a été envoyé.",
        success: true
      };

    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }

      console.error('Erreur lors de l\'inscription:', error);
      throw new BadRequestException(
        error.message || "Une erreur est survenue lors de l'inscription"
      );
    }
  }

  /**
   * Hashage d'un mot de passe
   */
  private async hashPassword({ password }: { password: string }): Promise<string> {
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    return hashedPassword;
  }

  /**
   * Comparaison d'un mot de passe avec son hash
   */
  private async comparePassword({
    password,
    hashedPassword
  }: {
    password: string;
    hashedPassword: string
  }): Promise<boolean> {
    const isPasswordSame = await bcrypt.compare(password, hashedPassword);
    return isPasswordSame;
  }

  /**
   * Génération du token JWT
   */
  private authenticateUser({ userId, role }: UserPayload) {
    const payload: UserPayload = { userId, role };
    return {
      access_token: this.jwtService.sign(payload, {
        expiresIn: '7d',
      })
    };
  }

  /**
   * Validation d'un token JWT
   */
  async validateToken(token: string): Promise<any> {
    try {
      const payload = await this.jwtService.verifyAsync(token);

      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
        }
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException("Token invalide");
      }

      return user;
    } catch (error) {
      throw new UnauthorizedException("Token invalide ou expiré");
    }
  }

  /**
   * Demande de réinitialisation de mot de passe
   * Génère un token et envoie un email
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    try {
      const { email } = forgotPasswordDto;
      const user = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          isActive: true,
        }
      });

      if (!user) {
        return {
          data: null,
          message: "Si cet email existe, un lien de réinitialisation vous a été envoyé.",
          success: true
        };
      }

      if (!user.isActive) {
        return {
          data: null,
          message: "Si cet email existe, un lien de réinitialisation vous a été envoyé.",
          success: true
        };
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');

      const resetExpires = new Date(Date.now() + 60 * 60 * 1000);

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: resetExpires,
        }
      });

      await this.emailService.sendPasswordResetEmail(
        user.email,
        user.nom,
        user.prenom,
        resetToken
      );

      return {
        data: null,
        message: "Si cet email existe, un lien de réinitialisation vous a été envoyé.",
        success: true
      };

    } catch (error) {
      console.error('Erreur lors de la demande de réinitialisation:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors de la demande de réinitialisation"
      );
    }
  }

  /**
   * Réinitialisation du mot de passe avec le token
   */
  async resetPassword(resetPassword: ResetPasswordDto) {
    try {
      const { token, newPassword } = resetPassword;
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const user = await this.prisma.user.findFirst({
        where: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: {
            gt: new Date(),
          },
          isActive: true,
        }
      });

      if (!user) {
        throw new UnauthorizedException(
          "Token invalide ou expiré. Veuillez faire une nouvelle demande de réinitialisation."
        );
      }

      const hashedPassword = await this.hashPassword({ password: newPassword });

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        }
      });

      return {
        data: null,
        message: "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter.",
        success: true
      };

    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      console.error('Erreur lors de la réinitialisation:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors de la réinitialisation du mot de passe"
      );
    }
  }

  /**
   * Vérifier la validité d'un token de réinitialisation
   */
  async verifyResetToken(token: string) {
    try {
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const user = await this.prisma.user.findFirst({
        where: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: {
            gt: new Date(),
          },
          isActive: true,
        },
        select: {
          id: true,
          email: true,
        }
      });

      if (!user) {
        throw new UnauthorizedException("Token invalide ou expiré");
      }

      return {
        data: {
          valid: true,
          email: user.email
        },
        message: "Token valide",
        success: true
      };

    } catch (error) {
      throw new UnauthorizedException("Token invalide ou expiré");
    }
  }

  /**
 * Changer son propre mot de passe
 */
  async changeOwnPassword(userId: string, changePasswordDto: ChangePasswordDto) {
    try {
      const { currentPassword, newPassword } = changePasswordDto;

      // Récupérer l'utilisateur
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          password: true,
          isActive: true,
        }
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException("Utilisateur non trouvé ou inactif");
      }

      // Vérifier le mot de passe actuel
      const isPasswordValid = await this.comparePassword({
        password: currentPassword,
        hashedPassword: user.password
      });

      if (!isPasswordValid) {
        throw new UnauthorizedException("Le mot de passe actuel est incorrect");
      }

      // Hasher le nouveau mot de passe
      const hashedPassword = await this.hashPassword({ password: newPassword });

      // Mettre à jour le mot de passe
      await this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      return {
        data: null,
        message: "Votre mot de passe a été modifié avec succès",
        success: true
      };

    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      console.error('Erreur lors du changement de mot de passe:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors du changement de mot de passe"
      );
    }
  }

  //editer son profil

  async editProfile(userId: string, updateProfileDto: UpdateProfileDto) {
    try {
      const { name, email } = updateProfileDto;

      // Vérifier que l'utilisateur existe et est actif
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          isActive: true,
        }
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException("Utilisateur non trouvé ou inactif");
      }

      // Préparer les données de mise à jour
      const updateData: any = {};

      if (name !== undefined) {
        updateData.name = name.trim();
      }

      if (email !== undefined && email !== user.email) {
        // Vérifier si le nouvel email n'est pas déjà utilisé par un autre utilisateur
        const existingUserWithEmail = await this.prisma.user.findUnique({
          where: { email: email.toLowerCase() }
        });

        if (existingUserWithEmail && existingUserWithEmail.id !== userId) {
          throw new ConflictException("Cet email est déjà utilisé par un autre utilisateur");
        }

        updateData.email = email.toLowerCase();
      }

      // S'il n'y a rien à mettre à jour
      if (Object.keys(updateData).length === 0) {
        return {
          data: {
            id: user.id,
            nom: user.nom,
            prenom: user.prenom,
            email: user.email
          },
          message: "Aucune modification effectuée",
          success: true
        };
      }

      // Mettre à jour le profil
      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          role: true,
          createdAt: true,
          updatedAt: true,
        }
      });

      return {
        data: updatedUser,
        message: "Profil mis à jour avec succès",
        success: true
      };

    } catch (error) {
      if (error instanceof UnauthorizedException || error instanceof ConflictException) {
        throw error;
      }

      console.error('Erreur lors de la mise à jour du profil:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors de la mise à jour du profil"
      );
    }
  }
}
