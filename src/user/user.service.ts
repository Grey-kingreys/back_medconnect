import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/common/services/prisma.service';
import { CreateUserByAdminDto } from './dto/create-user-by-admin.dto';
import * as bcrypt from 'bcrypt';
import { EmailService } from 'src/common/services/email.service';
import { ChangeUserPasswordDto } from './dto/change-user-password.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) { }

  /**
   * Créer un utilisateur (par l'admin uniquement)
   */
  async createByAdmin(createUserByAdminDto: CreateUserByAdminDto) {
    try {
      console.log("coté service",createUserByAdminDto)
      const { nom, prenom, email, password, role } = createUserByAdminDto;

      // Vérifier si l'email existe déjà
      const existingUser = await this.prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new ConflictException(
          "Un utilisateur avec cet email existe déjà",
        );
      }

      // Vérification que les rôlesSUPER_ADMIN n'ont pas d'assignation de Batiment
      if (role === 'SUPER_ADMIN') {
        throw new BadRequestException(
          `Les rôles ${role} ne doivent pas être assignés à un batiment spécifique`,
        );
      }

      // Hashage du mot de passe
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Création de l'utilisateur
      const user = await this.prisma.user.create({
        data: {
          nom: nom.trim(),
          prenom: prenom.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          role,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      // Envoyer un email de bienvenue
      try {
        await this.emailService.sendWelcomeEmail(user.email, user.nom, user.prenom);
      } catch (emailError) {
        console.warn(
          "⚠️ Impossible d'envoyer l'email de bienvenue:",
          emailError,
        );
        // Ne pas bloquer la création si l'email échoue
      }

      return {
        data: user,
        message: `Utilisateur créé avec succès avec le rôle ${role}`,
        success: true,
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      console.error("Erreur lors de la création de l'utilisateur:", error);
      throw new BadRequestException(
        error.message ||
        "Une erreur est survenue lors de la création de l'utilisateur",
      );
    }
  }

  async getUsers() {
    try {
      const users = await this.prisma.user.findMany({
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return {
        data: users,
        message: 'Les utilisateurs trouvés',
        success: true,
      };
    } catch (error) {
      return {
        data: null,
        message: error.message || 'Users not found',
        success: false,
      };
    }
  }

  async getUser({ userId }: { userId: string }) {
    try {
      const user = await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        throw new NotFoundException(
          `Utilisateur avec l'ID "${userId}" non trouvé`,
        );
      }

      return {
        data: user,
        message: 'Utilisateur trouvé',
        success: true,
      };
    } catch (erreur) {
      console.error('erreur complet: ', erreur);
      console.error('message: ', erreur.message);
      console.error('stack: ', erreur.stack);
      return {
        data: null,
        message: erreur.message || 'User not found',
        success: false,
      };
    }
  }

  async update({ userId }: { userId: string }, updateUserDto: UpdateUserDto) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new NotFoundException(`Utilisateur avec l'ID "${userId}" non trouvé`);
      }

      // // Si le rôle est SUPER_ADMIN, retirer le magasin
      // if (updateUserDto.role === 'SUPER_ADMIN') {
      // }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          nom: updateUserDto.nom,
          prenom: updateUserDto.prenom,
          email: updateUserDto.email,
          role: updateUserDto.role,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
          createdAt: true,
        }
      });

      return {
        data: updatedUser,
        message: 'Utilisateur modifié avec succès',
        success: true
      };

    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      console.error('Erreur lors de la modification de l\'utilisateur:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors de la modification de l'utilisateur"
      );
    }
  }

  async remove({ userId }: { userId: string }) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        // include: {
        //   _count: {
        //     select: {
        //       sales: true,
        //       cashRegisters: true,
        //       stockMovements: true,
        //       expenses: true,
        //       revenues: true,
        //     },
        //   },
        // },
      });

      if (!user) {
        throw new NotFoundException(
          `Utilisateur avec l'ID "${userId}" non trouvé`,
        );
      }

      // Vérifier qu'il n'a pas d'activités
      // const totalActivities =
      //   user._count.sales +
      //   user._count.cashRegisters +
      //   user._count.stockMovements +
      //   user._count.expenses +
      //   user._count.revenues;

      // if (totalActivities > 0) {
      //   throw new ConflictException(
      //     `Impossible de supprimer cet utilisateur car il a ${totalActivities} activité(s) associée(s). Désactivez-le plutôt.`,
      //   );
      // }

      await this.prisma.user.delete({
        where: { id: userId },
      });

      return {
        data: { id: userId },
        message: 'Utilisateur supprimé avec succès',
        success: true,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      console.error("Erreur lors de la suppression de l'utilisateur:", error);
      throw new BadRequestException(
        "Une erreur est survenue lors de la suppression de l'utilisateur",
      );
    }
  }

  /**
   * Activer/Désactiver un utilisateur
   */
  async toggleActive(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException(
          `Utilisateur avec l'ID "${userId}" non trouvé`,
        );
      }

      const updatedUser = await this.prisma.user.update({
        where: { id: userId },
        data: {
          isActive: !user.isActive,
        },
        select: {
          id: true,
          email: true,
          nom: true,
          prenom: true,
          role: true,
          isActive: true,
        },
      });

      return {
        data: updatedUser,
        message: `Utilisateur ${updatedUser.isActive ? 'activé' : 'désactivé'} avec succès`,
        success: true,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      console.error(
        "Erreur lors du changement de statut de l'utilisateur:",
        error,
      );
      throw new BadRequestException(
        'Une erreur est survenue lors du changement de statut',
      );
    }
  }

  /**
   * Récupérer les statistiques des utilisateurs
   */
  async getStats() {
    try {
      const [
        totalUsers,
        activeUsers,
        inactiveUsers,
        usersByRole,
        // usersWithStore,
      ] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true } }),
        this.prisma.user.count({ where: { isActive: false } }),
        this.prisma.user.groupBy({
          by: ['role'],
          _count: true,
          orderBy: {
            _count: {
              role: 'desc',
            },
          },
        }),
        // this.prisma.user.count({
        //   where: {
        //     storeId: {
        //       not: null,
        //     },
        //   },
        // }),
      ]);

      return {
        data: {
          totalUsers,
          activeUsers,
          inactiveUsers,
          // usersWithStore,
          // usersWithoutStore: totalUsers - usersWithStore,
          usersByRole,
        },
        message: 'Statistiques des utilisateurs récupérées',
        success: true,
      };
    } catch (error) {
      console.error(
        'Erreur lors de la récupération des statistiques:',
        error,
      );
      throw new BadRequestException(
        'Une erreur est survenue lors de la récupération des statistiques',
      );
    }
  }


  

  /**
 * Changer le mot de passe d'un utilisateur (Admin)
 */
  async changeUserPassword(userId: string, changePasswordDto: ChangeUserPasswordDto) {
    try {
      const { newPassword } = changePasswordDto;

      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new NotFoundException(`Utilisateur avec l'ID "${userId}" non trouvé`);
      }

      // Hasher le nouveau mot de passe
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Mettre à jour le mot de passe
      await this.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      });

      return {
        data: null,
        message: `Le mot de passe de ${user.nom} ${user.prenom} a été modifié avec succès`,
        success: true
      };

    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      console.error('Erreur lors du changement de mot de passe:', error);
      throw new BadRequestException(
        "Une erreur est survenue lors du changement de mot de passe"
      );
    }
  }
}