import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { CreateStructureDto, CreateSuperAdminDto } from './dto/super-admin.dto';

@Injectable()
export class SuperAdminService {
  private readonly logger = new Logger(SuperAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly rolesService: RolesService,
  ) { }

  // ─── Créer une structure + envoyer l'invitation ───────────────

  async createStructure(dto: CreateStructureDto) {
    const { nom, type, email, telephone, adresse, ville, latitude, longitude, horaires, estDeGarde } = dto;

    // 1. Vérifier si l'email est déjà utilisé par une structure
    const existingStructure = await this.prisma.structure.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingStructure) {
      throw new ConflictException('Une structure avec cet email existe déjà');
    }

    // 2. Vérifier si l'email est déjà utilisé par un utilisateur (User)
    const existingUser = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('Un compte utilisateur avec cet email existe déjà');
    }

    // Générer le token d'invitation (72h)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpires = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const structure = await this.prisma.structure.create({
      data: {
        nom: nom.trim(),
        type: type as any,
        email: email.toLowerCase(),
        telephone: telephone?.trim(),
        adresse: adresse?.trim(),
        ville: ville?.trim(),
        latitude: latitude,
        longitude: longitude,
        horaires: horaires,
        estDeGarde: estDeGarde,
        inviteToken: hashedToken,
        inviteExpires: tokenExpires,
        isConfigured: false,
        isActive: true,
      },
    });

    // Seeder les rôles par défaut de la structure (Médecin/Accueil/Admin… selon le type).
    // Non bloquant : un échec de seed ne doit pas annuler la création de la structure.
    try {
      await this.rolesService.seedStructureDefaultRoles(structure.id, structure.type);
    } catch (e) {
      // Le seeder de boot rattrapera cette structure au prochain démarrage.
      this.logger.error(`Seed des rôles par défaut échoué pour la structure ${structure.id}`, e);
    }

    // Envoyer l'email d'invitation
    await this.emailService.sendStructureInviteEmail(
      structure.email,
      structure.nom,
      structure.type,
      rawToken,
    );

    return {
      data: {
        id: structure.id,
        nom: structure.nom,
        type: structure.type,
        email: structure.email,
        isConfigured: structure.isConfigured,
        createdAt: structure.createdAt,
      },
      message: `Structure créée. Un email d'invitation a été envoyé à ${structure.email}.`,
      success: true,
    };
  }

  // ─── Renvoyer l'invitation ────────────────────────────────────

  async resendInvitation(structureId: string) {
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
    });
    if (!structure) {
      throw new NotFoundException('Structure non trouvée');
    }
    if (structure.isConfigured) {
      throw new BadRequestException('Cette structure est déjà configurée');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpires = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await this.prisma.structure.update({
      where: { id: structureId },
      data: {
        inviteToken: hashedToken,
        inviteExpires: tokenExpires,
      },
    });

    await this.emailService.sendStructureInviteEmail(
      structure.email,
      structure.nom,
      structure.type,
      rawToken,
    );

    return {
      data: null,
      message: `Invitation renvoyée à ${structure.email}`,
      success: true,
    };
  }

  // ─── Lister toutes les structures ────────────────────────────

  async getStructures() {
    const structures = await this.prisma.structure.findMany({
      select: {
        id: true,
        nom: true,
        type: true,
        email: true,
        telephone: true,
        adresse: true,
        ville: true,
        latitude: true,
        longitude: true,
        isActive: true,
        isConfigured: true,
        admin: {
          select: { id: true, nom: true, prenom: true, email: true },
        },
        _count: { select: { membres: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: structures, message: 'Structures récupérées', success: true };
  }

  // ─── Détails d'une structure ──────────────────────────────────

  async getStructure(structureId: string) {
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
      include: {
        admin: {
          select: { id: true, nom: true, prenom: true, email: true, telephone: true },
        },
        membres: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    if (!structure) {
      throw new NotFoundException('Structure non trouvée');
    }

    return { data: structure, message: 'Structure trouvée', success: true };
  }

  // ─── Activer/Désactiver une structure ─────────────────────────

  async toggleActive(structureId: string) {
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
    });
    if (!structure) {
      throw new NotFoundException('Structure non trouvée');
    }

    const updated = await this.prisma.structure.update({
      where: { id: structureId },
      data: { isActive: !structure.isActive },
      select: { id: true, nom: true, isActive: true },
    });

    return {
      data: updated,
      message: `Structure ${updated.isActive ? 'activée' : 'désactivée'}`,
      success: true,
    };
  }

  // ─── Créer un Super Admin ───────────────────────────────────────────

  async createSuperAdmin(dto: CreateSuperAdminDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Un compte avec cet email existe déjà');
    }

    const hashed = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        nom: dto.nom.trim(),
        prenom: dto.prenom.trim(),
        email: dto.email.toLowerCase(),
        password: hashed,
        telephone: dto.telephone?.trim(),
        role: 'SUPER_ADMIN',
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

    this.emailService
      .sendWelcomeEmail(user.email, user.nom, user.prenom)
      .catch((e) => this.logger.error('Email de bienvenue échoué', e));

    return {
      data: user,
      message: `Compte Super Admin créé pour ${user.prenom} ${user.nom}`,
      success: true,
    };
  }

  // ─── Gestion des Super Admins ───────────────────────────────────

  async getSuperAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        telephone: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: admins, message: 'Super Admins récupérés', success: true };
  }

  async deleteSuperAdmin(targetId: string, requesterId: string) {
    if (targetId === requesterId) {
      throw new BadRequestException("Vous ne pouvez pas supprimer votre propre compte.");
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetId, role: 'SUPER_ADMIN' },
    });

    if (!target) {
      throw new NotFoundException("Super Admin non trouvé.");
    }

    await this.prisma.user.delete({ where: { id: targetId } });

    return { data: null, message: 'Compte Super Admin supprimé avec succès', success: true };
  }

  // ─── Stats globales ───────────────────────────────────────────
  async getStats() {
    const [
      totalUsers,
      totalStructures,
      structuresConfigurees,
      structuresEnAttente,
      parType,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.structure.count(),
      this.prisma.structure.count({ where: { isConfigured: true } }),
      this.prisma.structure.count({ where: { isConfigured: false } }),
      this.prisma.structure.groupBy({
        by: ['type'],
        _count: true,
      }),
    ]);

    return {
      data: {
        totalUsers,
        totalStructures,
        structuresConfigurees,
        structuresEnAttente,
        parType,
      },
      message: 'Statistiques globales',
      success: true,
    };
  }

  // ─── Supprimer une structure ──────────────────────────────────
  async deleteStructure(structureId: string) {
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
      include: { membres: true, admin: true },
    });
    if (!structure) {
      throw new NotFoundException('Structure non trouvée');
    }

    // Transaction pour tout supprimer proprement
    await this.prisma.$transaction(async (tx) => {
      // 1. Supprimer tous les membres de la structure
      await tx.user.deleteMany({
        where: { structureId: structureId },
      });

      // 2. Supprimer l'admin de la structure (s'il n'est pas déjà dans les membres)
      if (structure.adminId) {
        // On vérifie s'il existe toujours (car deleteMany l'a peut-être déjà supprimé s'il avait structureId)
        const adminExists = await tx.user.findUnique({ where: { id: structure.adminId } });
        if (adminExists) {
          await tx.user.delete({ where: { id: structure.adminId } });
        }
      }

      // 3. Supprimer la structure
      await tx.structure.delete({
        where: { id: structureId },
      });
    });

    return {
      data: null,
      message: 'Structure et tous ses comptes associés supprimés avec succès',
      success: true,
    };
  }
}