// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-enum-comparison, @typescript-eslint/no-unsafe-member-access */
import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/common/services/prisma.service';
import { EmailService } from 'src/common/services/email.service';
import { EncryptionService } from 'src/common/services/encryption.service';
import { RolesService } from 'src/common/rbac/roles.service';
import { StorageService } from 'src/storage/storage.service';
import {
  avecTelephoneUnique,
  exigerTelephone,
  verifierTelephoneLibre,
} from 'src/common/telephone/telephone-unicite';
import { SessionsService } from 'src/auth/sessions.service';
import {
  CreateUserByAdminDto,
  UpdateUserDto,
  ChangeUserPasswordDto,
} from './dto/user.dto';

type StructureResume = { id: string; nom: string; type: string };

/**
 * Structure de rattachement affichée (D202) : celle de User.structureId, sinon celle
 * dont l'utilisateur est l'administrateur (Structure.adminId), sinon null.
 */
function avecStructureResolue<
  T extends {
    structure: StructureResume | null;
    administeredStructure: StructureResume | null;
  },
>(
  utilisateur: T,
): Omit<T, 'structure' | 'administeredStructure'> & {
  structure: StructureResume | null;
} {
  const { structure, administeredStructure, ...reste } = utilisateur;
  return { ...reste, structure: structure ?? administeredStructure ?? null };
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly encryptionService: EncryptionService,
    private readonly rolesService: RolesService,
    private readonly storage: StorageService,
    private readonly sessions: SessionsService,
  ) {}

  // ─── Photo de profil (avatar, bucket public R2) ───────────────

  /** Rattache un avatar (fichier R2 public confirmé) à l'utilisateur courant. */
  async setAvatar(userId: string, fileId: string) {
    await this.storage.assertLinkable(fileId, userId, 'public');
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarFileId: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarFileId: fileId },
    });
    // L'ancien avatar devient orphelin → suppression (bucket public, pas de conservation).
    if (current?.avatarFileId && current.avatarFileId !== fileId) {
      await this.storage
        .deleteStoredFile({ id: current.avatarFileId, requester: { userId } })
        .catch(() => undefined);
    }
    const avatarUrl = await this.storage.getPublicUrlById(fileId);
    return {
      data: { avatarUrl },
      message: 'Photo de profil mise à jour',
      success: true,
    };
  }

  /** Retire l'avatar de l'utilisateur courant et supprime le fichier R2. */
  async removeAvatar(userId: string) {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarFileId: true },
    });
    if (current?.avatarFileId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarFileId: null },
      });
      await this.storage
        .deleteStoredFile({ id: current.avatarFileId, requester: { userId } })
        .catch(() => undefined);
    }
    return {
      data: { avatarUrl: null },
      message: 'Photo de profil supprimée',
      success: true,
    };
  }

  // ─── Créer un utilisateur (par ADMIN/SUPER_ADMIN) ─────────────

  async createByAdmin(dto: CreateUserByAdminDto) {
    const { nom, prenom, email, password, role, telephone } = dto;

    // SUPER_ADMIN ne peut pas être créé via cette route
    if ((role as string) === 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Impossible de créer un compte SUPER_ADMIN via cette route',
      );
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      throw new ConflictException('Un utilisateur avec cet email existe déjà');
    }

    const telephoneE164 = telephone ? exigerTelephone(telephone) : undefined;
    if (telephoneE164) await verifierTelephoneLibre(this.prisma, telephoneE164);

    const hashedPassword = await bcrypt.hash(password, 12);

    // Rôle RBAC : résolu pour les rôles système (PATIENT/ADMIN). Pour un rôle de
    // structure sans structure rattachée ici, reste null → le backfill rattrape. Non bloquant.
    let appRoleId: string | undefined;
    try {
      appRoleId =
        (await this.rolesService.resolveAssignableRoleId({
          legacyRole: role as string,
        })) ?? undefined;
    } catch (e) {
      this.logger.error('Résolution appRole (createByAdmin) échouée', e);
    }

    const user = await avecTelephoneUnique(
      this.prisma.user.create({
        data: {
          nom: nom.trim(),
          prenom: prenom.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          telephone: telephoneE164,
          role: role as any,
          appRoleId,
          isActive: true,
          specialite: role === 'MEDECIN' ? (dto as any).specialite : undefined,
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
      }),
    );

    this.emailService
      .sendWelcomeEmail(user.email, user.nom, user.prenom)
      .catch((e) => this.logger.error('Email de bienvenue échoué', e));

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
        administeredStructure: { select: { id: true, nom: true, type: true } },
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: users.map(avecStructureResolue),
      message: 'Utilisateurs récupérés',
      success: true,
    };
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
        administeredStructure: { select: { id: true, nom: true, type: true } },
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
      data: avecStructureResolue(user),
      message: 'Utilisateur trouvé',
      success: true,
    };
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
    if (dto.telephone === null) {
      // null retire le numéro (D45).
      updateData.telephone = null;
    } else if (dto.telephone !== undefined) {
      const telephoneE164 = exigerTelephone(dto.telephone);
      await verifierTelephoneLibre(this.prisma, telephoneE164, userId);
      updateData.telephone = telephoneE164;
    }

    const updated = await avecTelephoneUnique(
      this.prisma.user.update({
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
      }),
    );

    return {
      data: updated,
      message: 'Utilisateur modifié avec succès',
      success: true,
    };
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
    if (updated.isActive) await this.sessions.reactiverCompte(userId);
    else await this.sessions.desactiverCompte(userId);

    return {
      data: updated,
      message: `Utilisateur ${updated.isActive ? 'activé' : 'désactivé'} avec succès`,
      success: true,
    };
  }

  // ─── Supprimer ────────────────────────────────────────────────

  async remove(targetId: string, requester: { userId: string; role: string }) {
    if (targetId === requester.userId) {
      throw new BadRequestException(
        'Vous ne pouvez pas supprimer votre propre compte.',
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
    });
    if (!target) {
      throw new NotFoundException(`Utilisateur "${targetId}" non trouvé`);
    }

    // Un ADMIN ne peut pas supprimer un SUPER_ADMIN
    if (target.role === 'SUPER_ADMIN' && requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Seul un Super Administrateur peut supprimer un compte Super Admin.',
      );
    }

    await this.prisma.user.delete({ where: { id: targetId } });

    return {
      data: { id: targetId },
      message: 'Utilisateur supprimé',
      success: true,
    };
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
    await this.sessions.revoquerToutes(userId, 'MOT_DE_PASSE_REINITIALISE');

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

  async getPatientsForDoctor(structureId: string, peutVoirCarnet = false) {
    if (!structureId)
      return { data: [], message: 'Aucune structure', success: true };

    // Sans CARNET_READ (accueil, administrateur de structure), aucune donnée médicale n'est lue.
    const profilMedical = peutVoirCarnet
      ? { select: { groupeSanguin: true, allergies: true } }
      : undefined;
    // Allergies stockées chiffrées : déchiffrées uniquement pour qui a CARNET_READ.
    const avecProfilDechiffre = <
      T extends { profilMedical?: { allergies: string | null } | null },
    >(
      patient: T,
    ) => {
      if (!peutVoirCarnet) {
        // Défense en profondeur : aucun profil médical sans CARNET_READ.
        const sansProfil: Partial<T> = { ...patient };
        delete sansProfil.profilMedical;
        return sansProfil;
      }
      return patient.profilMedical
        ? {
            ...patient,
            profilMedical: {
              ...patient.profilMedical,
              allergies: patient.profilMedical.allergies
                ? this.encryptionService.decrypt(
                    patient.profilMedical.allergies,
                  )
                : patient.profilMedical.allergies,
            },
          }
        : patient;
    };

    const consultations = await this.prisma.consultation.findMany({
      where: { structureId, deletedAt: null },
      include: {
        patient: {
          select: {
            id: true,
            nom: true,
            prenom: true,
            email: true,
            telephone: true,
            dateNaissance: true,
            taille: true,
            poids: true,
            medecinTraitantId: true,
            ...(profilMedical && { profilMedical }),
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
            dateNaissance: true,
            taille: true,
            poids: true,
            medecinTraitantId: true,
            ...(profilMedical && { profilMedical }),
          },
        },
      },
    });

    const patientMap = new Map();
    consultations.forEach((c) => {
      if (!patientMap.has(c.patientId)) {
        patientMap.set(c.patientId, {
          ...avecProfilDechiffre(c.patient),
          derniereConsultation: c.dateConsultation,
          dernierMotif: this.encryptionService.decrypt(c.motif),
        });
      }
    });

    autorisations.forEach((a) => {
      if (!patientMap.has(a.patientId)) {
        patientMap.set(a.patientId, {
          ...avecProfilDechiffre(a.patient),
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
      where: { patientId, structureId },
    });
    if (!exist) {
      await this.prisma.autorisationStructure.create({
        data: { patientId, structureId },
      });
    }
    return { success: true, message: 'Structure autorisée' };
  }

  async revoquerStructure(patientId: string, structureId: string) {
    const exist = await this.prisma.autorisationStructure.findFirst({
      where: { patientId, structureId },
    });
    if (exist) {
      await this.prisma.autorisationStructure.delete({
        where: { id: exist.id },
      });
    }
    return { success: true, message: 'Autorisation révoquée' };
  }

  async designerMedecin(patientId: string, medecinId: string) {
    await this.prisma.user.update({
      where: { id: patientId },
      data: { medecinTraitantId: medecinId },
    });
    return { success: true, message: 'Médecin désigné avec succès' };
  }

  async getAutorisations(patientId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: {
        medecinTraitantId: true,
        medecinTraitant: {
          select: { id: true, nom: true, prenom: true, specialite: true },
        },
        autorisationsStructures: {
          select: {
            id: true,
            structureId: true,
            createdAt: true,
            structure: { select: { id: true, nom: true, type: true } },
          },
        },
      },
    });
    return { success: true, data: user };
  }
}
