import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { CreateStructureDto } from './dto/super-admin.dto';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) { }

  // ─── Créer une structure + envoyer l'invitation ───────────────

  async createStructure(dto: CreateStructureDto) {
    const { nom, type, email, telephone, adresse, ville } = dto;

    // Vérifier si l'email de la structure est déjà utilisé
    const existingStructure = await this.prisma.structure.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existingStructure) {
      throw new ConflictException('Une structure avec cet email existe déjà');
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
        inviteToken: hashedToken,
        inviteExpires: tokenExpires,
        isConfigured: false,
        isActive: true,
      },
    });

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
}