import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import {
  CreateUserByAdminDto,
  UpdateUserDto,
  ChangeUserPasswordDto,
} from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) { }

  // ─── Créer un utilisateur (par ADMIN/SUPER_ADMIN) ─────────────

  async createByAdmin(dto: CreateUserByAdminDto) {
    const { nom, prenom, email, password, role, telephone } = dto;

    // SUPER_ADMIN ne peut pas être créé via cette route
    if ((role as string) === 'SUPER_ADMIN') {
      throw new ForbiddenException('Impossible de créer un compte SUPER_ADMIN via cette route');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Un utilisateur avec cet email existe déjà');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await this.prisma.user.create({
      data: {
        nom: nom.trim(),
        prenom: prenom.trim(),
        email: email.toLowerCase(),
        password: hashedPassword,
        telephone: telephone?.trim(),
        role: role as any,
        isActive: true,
        specialite: (role === 'MEDECIN') ? (dto as any).specialite : undefined,
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

    this.emailService
      .sendWelcomeEmail(user.email, user.nom, user.prenom)
      .catch(console.error);

    return {
      data: user,
      message: `Utilisateur créé avec le rôle ${role}`,
      success: true,
    };
  }

  // ─── Lister tous les utilisateurs ────────────────────────────

  async getUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        telephone: true,
        role: true,
        isActive: true,
        structureId: true,
        structure: { select: { id: true, nom: true, type: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: users, message: 'Utilisateurs récupérés', success: true };
  }

  // ─── Récupérer un utilisateur par ID ─────────────────────────

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        telephone: true,
        role: true,
        isActive: true,
        structureId: true,
        structure: { select: { id: true, nom: true, type: true } },
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur avec l'ID "${userId}" non trouvé`);
    }

    return { data: user, message: 'Utilisateur trouvé', success: true };
  }

  // ─── Mettre à jour un utilisateur ────────────────────────────

  async update(userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Utilisateur "${userId}" non trouvé`);
    }

    // Vérifier unicité email si changé
    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
      });
      if (existing) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
    }

    const updateData: any = {};
    if (dto.nom !== undefined) updateData.nom = dto.nom.trim();
    if (dto.prenom !== undefined) updateData.prenom = dto.prenom.trim();
    if (dto.email !== undefined) updateData.email = dto.email.toLowerCase();
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.telephone !== undefined) updateData.telephone = dto.telephone.trim();

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        email: true,
        nom: true,
        prenom: true,
        telephone: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    return { data: updated, message: 'Utilisateur modifié avec succès', success: true };
  }

  // ─── Activer/Désactiver ───────────────────────────────────────

  async toggleActive(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Utilisateur "${userId}" non trouvé`);
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
      select: { id: true, nom: true, prenom: true, role: true, isActive: true },
    });

    return {
      data: updated,
      message: `Utilisateur ${updated.isActive ? 'activé' : 'désactivé'} avec succès`,
      success: true,
    };
  }

  // ─── Supprimer ────────────────────────────────────────────────

  async remove(targetId: string, requester: { userId: string; role: string }) {
    if (targetId === requester.userId) {
      throw new BadRequestException("Vous ne pouvez pas supprimer votre propre compte.");
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException(`Utilisateur "${targetId}" non trouvé`);
    }

    // Un ADMIN ne peut pas supprimer un SUPER_ADMIN
    if (target.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        "Seul un Super Administrateur peut supprimer un compte Super Admin.",
      );
    }

    await this.prisma.user.delete({ where: { id: targetId } });

    return { data: { id: targetId }, message: 'Utilisateur supprimé', success: true };
  }

  // ─── Changer le mot de passe (par admin) ─────────────────────

  async changeUserPassword(userId: string, dto: ChangeUserPasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`Utilisateur "${userId}" non trouvé`);
    }

    const hashed = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed },
    });

    return {
      data: null,
      message: `Mot de passe de ${user.prenom} ${user.nom} modifié`,
      success: true,
    };
  }

  // ─── Stats ────────────────────────────────────────────────────

  async getStats() {
    const [total, actifs, inactifs, parRole] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.user.count({ where: { isActive: false } }),
      this.prisma.user.groupBy({
        by: ['role'],
        _count: true,
        orderBy: { _count: { role: 'desc' } },
      }),
    ]);

    return {
      data: { total, actifs, inactifs, parRole },
      message: 'Statistiques récupérées',
      success: true,
    };
  }

  // ─── Patients pour médecins ───────────────────────────────────

  async getPatientsForDoctor(structureId: string) {
    if (!structureId) return { data: [], message: 'Aucune structure', success: true };

    const consultations = await this.prisma.consultation.findMany({
      where: { structureId },
      include: {
        patient: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            telephone: true,
            medecinTraitantId: true,
            profilMedical: {
              select: {
                groupeSanguin: true,
                allergies: true,
              },
            },
          },
        },
      },
      orderBy: { dateConsultation: 'desc' },
    });

    const autorisations = await this.prisma.autorisationStructure.findMany({
      where: { structureId },
      include: {
        patient: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            telephone: true,
            medecinTraitantId: true,
            profilMedical: {
              select: { groupeSanguin: true, allergies: true }
            }
          }
        }
      }
    });

    const patientMap = new Map();
    consultations.forEach((c) => {
      if (!patientMap.has(c.patientId)) {
        patientMap.set(c.patientId, {
          ...c.patient,
          derniereConsultation: c.dateConsultation,
          dernierMotif: c.motif,
        });
      }
    });

    autorisations.forEach(a => {
      if (!patientMap.has(a.patientId)) {
        patientMap.set(a.patientId, {
          ...a.patient,
          autorisationNiveau1: true,
        });
      } else {
        patientMap.get(a.patientId).autorisationNiveau1 = true;
      }
    });

    return {
      data: Array.from(patientMap.values()),
      message: 'Patients de la structure récupérés',
      success: true,
    };
  }

  // ─── Actions Patient (Autorisations) ──────────────────────────

  async autoriserStructure(patientId: string, structureId: string) {
    const exist = await this.prisma.autorisationStructure.findFirst({
      where: { patientId, structureId }
    });
    if (!exist) {
      await this.prisma.autorisationStructure.create({
        data: { patientId, structureId }
      });
    }
    return { success: true, message: 'Structure autorisée' };
  }

  async revoquerStructure(patientId: string, structureId: string) {
    const exist = await this.prisma.autorisationStructure.findFirst({
      where: { patientId, structureId }
    });
    if (exist) {
      await this.prisma.autorisationStructure.delete({
        where: { id: exist.id }
      });
    }
    return { success: true, message: 'Autorisation révoquée' };
  }

  async designerMedecin(patientId: string, medecinId: string) {
    await this.prisma.user.update({
      where: { id: patientId },
      data: { medecinTraitantId: medecinId }
    });
    return { success: true, message: 'Médecin désigné avec succès' };
  }

  async getAutorisations(patientId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: { 
        medecinTraitantId: true,
        medecinTraitant: { select: { id: true, nom: true, prenom: true, specialite: true } },
        autorisationsStructures: {
          select: {
            id: true,
            structureId: true,
            createdAt: true,
            structure: { select: { id: true, nom: true, type: true } }
          }
        }
      }
    });
    return { success: true, data: user };
  }
}