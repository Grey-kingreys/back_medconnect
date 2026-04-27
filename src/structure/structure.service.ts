import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { AuthService } from 'src/auth/auth.service';
import {
  SetupStructureDto,
  CreateMembreDto,
  UpdateStructureDto,
} from './dto/structure.dto';

// Génère un mot de passe temporaire lisible
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for (let i = 0; i < 10; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // S'assurer qu'il contient au moins 1 majuscule, 1 minuscule, 1 chiffre
  return 'Mc' + pass + '1';
}

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly authService: AuthService,
  ) { }

  // ─── Vérifier un token d'invitation ──────────────────────────

  async verifyInviteToken(rawToken: string) {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const structure = await this.prisma.structure.findFirst({
      where: {
        inviteToken: hashedToken,
        inviteExpires: { gt: new Date() },
      },
      select: {
        id: true,
        nom: true,
        type: true,
        email: true,
        isConfigured: true,
      },
    });

    if (!structure) {
      throw new UnauthorizedException(
        'Lien d\'invitation invalide ou expiré. Contactez l\'administrateur MedConnect.',
      );
    }

    if (structure.isConfigured) {
      throw new BadRequestException(
        'Cette structure a déjà été configurée. Connectez-vous à votre espace.',
      );
    }

    return {
      data: structure,
      message: 'Token valide',
      success: true,
    };
  }

  // ─── Setup structure (admin clique sur le lien) ───────────────

  async setupStructure(rawToken: string, dto: SetupStructureDto) {
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const structure = await this.prisma.structure.findFirst({
      where: {
        inviteToken: hashedToken,
        inviteExpires: { gt: new Date() },
        isConfigured: false,
      },
    });

    if (!structure) {
      throw new UnauthorizedException(
        'Lien d\'invitation invalide ou expiré. Contactez l\'administrateur MedConnect.',
      );
    }

    // Vérifier que l'email de la structure n'est pas déjà un compte User
    const existingUser = await this.prisma.user.findUnique({
      where: { email: structure.email },
    });
    if (existingUser) {
      throw new ConflictException(
        'Un compte existe déjà avec cet email. Connectez-vous.',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);

    // Transaction : créer le compte admin + configurer la structure
    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Créer le compte User (STRUCTURE_ADMIN)
      const admin = await tx.user.create({
        data: {
          nom: dto.nom.trim(),
          prenom: dto.prenom.trim(),
          email: structure.email, // email de la structure = email du compte admin
          password: hashedPassword,
          telephone: dto.telephone.trim(),
          role: 'STRUCTURE_ADMIN',
          isActive: true,
          structureId: structure.id,
        },
        select: {
          id: true,
          nom: true,
          prenom: true,
          email: true,
          role: true,
        },
      });

      // 2. Configurer la structure
      const updatedStructure = await tx.structure.update({
        where: { id: structure.id },
        data: {
          nom: dto.structureNom.trim(),
          adresse: dto.adresse.trim(),
          ville: dto.ville.trim(),
          telephone: dto.structureTelephone?.trim(),
          description: dto.description?.trim(),
          adminId: admin.id,
          isConfigured: true,
          inviteToken: null,  // Invalider le token
          inviteExpires: null,
        },
        select: {
          id: true,
          nom: true,
          type: true,
          email: true,
          adresse: true,
          ville: true,
          isConfigured: true,
        },
      });

      return { admin, structure: updatedStructure };
    });

    // Générer le JWT
    const token = this.authService.generateToken({
      userId: result.admin.id,
      role: result.admin.role,
      structureId: structure.id,
    });

    return {
      data: {
        access_token: token,
        user: result.admin,
        structure: result.structure,
      },
      message: 'Votre espace a été configuré avec succès. Bienvenue sur MedConnect !',
      success: true,
    };
  }

  // ─── Créer un membre de la structure ─────────────────────────

  async createMembre(
    structureId: string,
    adminUserId: string,
    dto: CreateMembreDto,
  ) {
    // Vérifier que l'admin appartient bien à cette structure
    const admin = await this.prisma.user.findUnique({
      where: { id: adminUserId },
    });
    if (!admin || admin.structureId !== structureId) {
      throw new ForbiddenException(
        "Vous n'êtes pas autorisé à gérer cette structure",
      );
    }

    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
    });
    if (!structure || !structure.isActive) {
      throw new NotFoundException('Structure non trouvée ou désactivée');
    }

    // Vérifier cohérence rôle / type de structure
    if (structure.type === 'PHARMACIE' && dto.role === 'MEDECIN') {
      throw new BadRequestException(
        'Une pharmacie ne peut pas avoir de médecins. Utilisez le rôle PHARMACIEN.',
      );
    }

    // Vérifier unicité email
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Un compte avec cet email existe déjà');
    }

    // Générer un mot de passe temporaire
    const tempPassword = generateTempPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const membre = await this.prisma.user.create({
      data: {
        nom: dto.nom.trim(),
        prenom: dto.prenom.trim(),
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        telephone: dto.telephone?.trim(),
        role: dto.role as any,
        isActive: true,
        structureId: structureId,
      },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        telephone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    // Envoyer les identifiants par email
    this.emailService
      .sendMemberWelcomeEmail(
        membre.email,
        membre.nom,
        membre.prenom,
        membre.role,
        structure.nom,
        tempPassword,
      )
      .catch(console.error);

    return {
      data: membre,
      message: `Membre créé. Un email avec les identifiants a été envoyé à ${membre.email}.`,
      success: true,
    };
  }

  // ─── Lister les membres de la structure ──────────────────────

  async getMembres(structureId: string, requestingUserId: string) {
    await this.checkStructureAccess(structureId, requestingUserId);

    const membres = await this.prisma.user.findMany({
      where: { structureId, role: { in: ['MEDECIN', 'PHARMACIEN'] } },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        telephone: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return { data: membres, message: 'Membres récupérés', success: true };
  }

  // ─── Infos de ma structure ────────────────────────────────────

  async getMyStructure(structureId: string) {
    const structure = await this.prisma.structure.findUnique({
      where: { id: structureId },
      include: {
        admin: {
          select: { id: true, nom: true, prenom: true, email: true, telephone: true },
        },
        membres: {
          where: { role: { in: ['MEDECIN', 'PHARMACIEN'] } },
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

    return { data: structure, message: 'Structure récupérée', success: true };
  }

  // ─── Mettre à jour la structure ───────────────────────────────

  async updateStructure(
    structureId: string,
    requestingUserId: string,
    dto: UpdateStructureDto,
  ) {
    await this.checkStructureAccess(structureId, requestingUserId);

    const updateData: any = {};
    if (dto.nom !== undefined) updateData.nom = dto.nom.trim();
    if (dto.adresse !== undefined) updateData.adresse = dto.adresse.trim();
    if (dto.ville !== undefined) updateData.ville = dto.ville.trim();
    if (dto.telephone !== undefined) updateData.telephone = dto.telephone.trim();
    if (dto.description !== undefined) updateData.description = dto.description.trim();

    const updated = await this.prisma.structure.update({
      where: { id: structureId },
      data: updateData,
      select: {
        id: true,
        nom: true,
        type: true,
        email: true,
        telephone: true,
        adresse: true,
        ville: true,
        description: true,
        updatedAt: true,
      },
    });

    return {
      data: updated,
      message: 'Structure mise à jour avec succès',
      success: true,
    };
  }

  // ─── Activer/Désactiver un membre ─────────────────────────────

  async toggleMembreActive(
    structureId: string,
    membreId: string,
    requestingUserId: string,
  ) {
    await this.checkStructureAccess(structureId, requestingUserId);

    const membre = await this.prisma.user.findFirst({
      where: { id: membreId, structureId },
    });
    if (!membre) {
      throw new NotFoundException('Membre non trouvé dans cette structure');
    }

    const updated = await this.prisma.user.update({
      where: { id: membreId },
      data: { isActive: !membre.isActive },
      select: { id: true, nom: true, prenom: true, role: true, isActive: true },
    });

    return {
      data: updated,
      message: `Membre ${updated.isActive ? 'activé' : 'désactivé'}`,
      success: true,
    };
  }

  // ─── Helper : vérifier accès STRUCTURE_ADMIN ─────────────────

  private async checkStructureAccess(structureId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.structureId !== structureId || user.role !== 'STRUCTURE_ADMIN') {
      throw new ForbiddenException(
        "Vous n'êtes pas autorisé à gérer cette structure",
      );
    }
    return user;
  }
}