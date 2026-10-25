// Dette de typage préexistante, backlog points 21 et 22
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-floating-promises */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  UpsertProfilMedicalDto,
  CreateConsultationDto,
  CreateOrdonnanceDto,
  CreateResultatAnalyseDto,
  CreateVaccinationDto,
  CreateAutoDiagnosticDto,
  CreateRendezVousDto,
  CreateUrgenceDto,
  TakeChargeUrgenceDto,
  UrgenceStatusEnum,
  AiEmergencyRequestDto,
} from './dto/carnet-sante.dto';
import { AiService } from 'src/common/services/ai.service';
import { EmailService } from 'src/common/services/email.service';
import { ChatGateway } from 'src/chat/chat.gateway';

import { NotificationsService } from 'src/notifications/notifications.service';
import { EncryptionService } from 'src/common/services/encryption.service';
import { SmsService } from 'src/common/services/sms.service';
import { QueueService } from 'src/queue/queue.service';
import { StorageService } from 'src/storage/storage.service';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';
import { estCompteDemo } from 'src/demo/demo-mode';
import {
  AppointmentStatus,
  UrgenceStatus,
  Prisma,
} from 'generated/prisma/client';
import {
  evaluerPositionSos,
  avertissementPositionApproximative,
  phrasePositionApproximative,
  messagePositionNonUtilisee,
} from './sos-position';
import {
  SOS_IDEMPOTENCE_HEURES,
  MESSAGE_SOS_DIFFUSION_EN_COURS,
  lireCleIdempotence,
  estBilanSos,
  estConflitCleIdempotence,
  donneesUrgencePubliques,
  type BilanSos,
} from './sos-idempotence';
import type {
  ProfilMedical,
  Consultation,
  Ordonnance,
  ResultatAnalyse,
  Vaccination,
} from 'generated/prisma/client';

// Délai minimal entre deux alertes SOS tant que la précédente n'est pas prise en charge.
export const SOS_ANTI_DOUBLON_MINUTES = 5;

// Délai maximal d'attente de la file (Redis) pour prévenir le proche d'un SOS.
export const DELAI_FILE_SOS_MS = 2000;

@Injectable()
export class CarnetSanteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly emailService: EmailService,
    private readonly chatGateway: ChatGateway,
    private readonly notificationsService: NotificationsService,
    private readonly encryptionService: EncryptionService,
    private readonly smsService: SmsService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
    private readonly permissionsService: PermissionsService,
  ) {}

  private readonly logger = new Logger(CarnetSanteService.name);

  // ─── Private Helper: Vérifier l'accès au patient ────────────────

  /**
   * Périmètre patient : QUEL dossier l'acteur peut atteindre (médecin traitant
   * ou structure explicitement autorisée par le patient). Le TYPE d'action
   * (lire / écrire) est porté par les permissions du rôle, vérifiées en amont
   * par `PermissionsGuard`, les deux contrôles sont complémentaires.
   *
   * @returns `isMedecinTraitant` : le médecin traitant voit tout le carnet,
   *   une structure autorisée ne voit que ce qu'elle y a elle-même produit.
   * @returns `actorStructureId` : établissement réel de l'acteur en base
   *   (`null` s'il n'en a pas, absent si l'acteur est le patient lui-même).
   */
  private async checkAccess(
    actorId: string,
    patientId: string,
    structureId?: string,
    mode: 'lecture' | 'ecriture' = 'ecriture',
  ): Promise<{ isMedecinTraitant: boolean; actorStructureId?: string | null }> {
    if (actorId === patientId) return { isMedecinTraitant: false }; // Son propre dossier

    const [patient, actor] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: patientId },
        select: { medecinTraitantId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actorId },
        select: { structureId: true },
      }),
    ]);

    if (!patient) throw new NotFoundException('Patient non trouvé');

    const isMedecinTraitant = patient.medecinTraitantId === actorId;

    // `structureId` provient du JWT, figé à l'émission du token. On le
    // reconfronte à l'appartenance réelle en base : sans cela, un membre retiré
    // d'une structure garde l'accès aux carnets de ses patients jusqu'à
    // l'expiration de son token.
    let hasStructureAccess = false;
    if (structureId && actor?.structureId === structureId) {
      const auth = await this.prisma.autorisationStructure.findUnique({
        where: { patientId_structureId: { patientId, structureId } },
      });
      hasStructureAccess = !!auth;
    }

    if (!isMedecinTraitant && !hasStructureAccess) {
      throw new ForbiddenException(
        mode === 'lecture'
          ? "Vous n'êtes pas autorisé à consulter le dossier de ce patient."
          : "Vous n'êtes pas autorisé à modifier le dossier de ce patient.",
      );
    }

    return { isMedecinTraitant, actorStructureId: actor?.structureId ?? null };
  }

  // ─── Vue Médecin : Carnet complet d'un patient ─────────────────

  async getPatientCarnetForDoctor(
    medecinId: string,
    patientId: string,
    structureId?: string,
  ) {
    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        nom: true,
        prenom: true,
        email: true,
        telephone: true,
        medecinTraitantId: true,
        dateNaissance: true,
        taille: true,
        poids: true,
      },
    });

    if (!patient) throw new NotFoundException('Patient non trouvé');

    // Même contrôle de périmètre que les écritures (lève 403 si hors périmètre).
    const { isMedecinTraitant } = await this.checkAccess(
      medecinId,
      patientId,
      structureId,
      'lecture',
    );

    const profil = await this.prisma.profilMedical.findUnique({
      where: { userId: patientId },
    });

    // Récupérer les consultations et ordonnances
    // Si Médecin traitant (Niveau 1) -> Tout voir.
    // Si Structure (Niveau 2) -> Ne voir QUE les consultations et ordonnances de sa structure.
    const consultations = await this.prisma.consultation.findMany({
      where: isMedecinTraitant
        ? { patientId, deletedAt: null }
        : { patientId, deletedAt: null, structureId: structureId as string },
      include: {
        structure: { select: { id: true, nom: true, type: true } },
        medecin: { select: { nom: true, prenom: true } },
      },
      orderBy: { dateConsultation: 'desc' },
      take: 50,
    });

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: isMedecinTraitant
        ? { patientId, deletedAt: null }
        : {
            patientId,
            deletedAt: null,
            consultation: { structureId: structureId as string },
          },
      include: { medecin: { select: { nom: true, prenom: true } } },
      orderBy: { dateEmission: 'desc' },
      take: 50,
    });

    // Analyses et Vaccinations : le médecin traitant voit tout ; une structure
    // autorisée ne voit que celles dont l'auteur est membre de la structure
    // (ces tables n'ont pas de `structureId`, cf. décision D03).
    const filtreAuteur = isMedecinTraitant
      ? {}
      : { medecin: { structureId: structureId as string } };
    const [analyses, vaccinations] = await Promise.all([
      this.prisma.resultatAnalyse.findMany({
        where: { patientId, deletedAt: null, ...filtreAuteur },
        include: { medecin: { select: { nom: true, prenom: true } } },
        orderBy: { dateAnalyse: 'desc' },
        take: 20,
      }),
      this.prisma.vaccination.findMany({
        where: { patientId, deletedAt: null, ...filtreAuteur },
        include: { medecin: { select: { nom: true, prenom: true } } },
        orderBy: { dateVaccin: 'desc' },
      }),
    ]);

    // Statistiques : mêmes filtres que les listes, pour ne pas révéler le
    // volume du carnet hors du périmètre de la structure.
    const [
      totalConsultations,
      totalOrdonnances,
      totalAnalyses,
      totalVaccinations,
    ] = await Promise.all([
      this.prisma.consultation.count({
        where: isMedecinTraitant
          ? { patientId, deletedAt: null }
          : { patientId, deletedAt: null, structureId: structureId as string },
      }),
      this.prisma.ordonnance.count({
        where: isMedecinTraitant
          ? { patientId, deletedAt: null }
          : {
              patientId,
              deletedAt: null,
              consultation: { structureId: structureId as string },
            },
      }),
      this.prisma.resultatAnalyse.count({
        where: { patientId, deletedAt: null, ...filtreAuteur },
      }),
      this.prisma.vaccination.count({
        where: { patientId, deletedAt: null, ...filtreAuteur },
      }),
    ]);

    const stats = {
      consultations: totalConsultations,
      ordonnances: totalOrdonnances,
      analyses: totalAnalyses,
      vaccinations: totalVaccinations,
    };

    return {
      data: {
        patient: {
          id: patient.id,
          nom: patient.nom,
          prenom: patient.prenom,
          email: patient.email,
          telephone: patient.telephone,
          dateNaissance: patient.dateNaissance,
          taille: patient.taille,
          poids: patient.poids,
        },
        isMedecinTraitant,
        profil: profil ? this.decryptProfil(profil) : null,
        stats,
        consultations: consultations.map((c) => ({
          ...this.decryptConsultation(c),
          medecinNom:
            c.medecinNom ||
            (c.medecin ? `Dr. ${c.medecin.prenom} ${c.medecin.nom}` : null),
        })),
        ordonnances: ordonnances.map((o) => ({
          ...this.decryptOrdonnance(o),
          medecinNom:
            o.medecinNom ||
            (o.medecin ? `Dr. ${o.medecin.prenom} ${o.medecin.nom}` : null),
        })),
        vaccinations: vaccinations.map((v) => ({
          ...this.decryptVaccination(v),
          administrePar:
            v.administrePar ||
            (v.medecin ? `Dr. ${v.medecin.prenom} ${v.medecin.nom}` : null),
        })),
        analyses: analyses.map((a) => ({
          ...this.decryptAnalyse(a),
          laboratoire:
            a.laboratoire ||
            (a.medecin ? `Dr. ${a.medecin.prenom} ${a.medecin.nom}` : null),
        })),
      },
      message: 'Carnet du patient récupéré',
      success: true,
    };
  }

  async getProfilMedical(userId: string) {
    const profil = await this.prisma.profilMedical.findUnique({
      where: { userId },
    });
    return {
      data: profil ? this.decryptProfil(profil) : null,
      message: profil ? 'Profil médical trouvé' : 'Aucun profil médical créé',
      success: true,
    };
  }

  async upsertProfilMedical(userId: string, dto: UpsertProfilMedicalDto) {
    const data: Omit<Prisma.ProfilMedicalUncheckedCreateInput, 'userId'> = {};
    if (dto.groupeSanguin !== undefined) data.groupeSanguin = dto.groupeSanguin;
    if (dto.allergies !== undefined)
      data.allergies = this.encryptionService.encrypt(dto.allergies);
    if (dto.pathologies !== undefined)
      data.pathologies = this.encryptionService.encrypt(dto.pathologies);
    if (dto.traitements !== undefined)
      data.traitements = this.encryptionService.encrypt(dto.traitements);
    if (dto.taille !== undefined) data.taille = dto.taille;
    if (dto.poids !== undefined) data.poids = dto.poids;
    if (dto.dateNaissance !== undefined)
      data.dateNaissance = new Date(dto.dateNaissance);
    if (dto.genre !== undefined) data.genre = dto.genre;
    if (dto.contactNom !== undefined) data.contactNom = dto.contactNom;
    if (dto.contactTelephone !== undefined)
      data.contactTelephone = dto.contactTelephone;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;

    const profil = await this.prisma.profilMedical.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return {
      data: this.decryptProfil(profil),
      message: 'Profil médical enregistré',
      success: true,
    };
  }

  async getConsultations(userId: string, role?: string) {
    const isDoctor = role === 'MEDECIN' || role === 'STRUCTURE_ADMIN';

    const where = isDoctor
      ? { medecinId: userId, deletedAt: null } // Le médecin voit celles qu'il a rédigées
      : { patientId: userId, deletedAt: null }; // Le patient voit les siennes

    const consultations = await this.prisma.consultation.findMany({
      where,
      include: {
        structure: { select: { id: true, nom: true, type: true, ville: true } },
        medecin: { select: { id: true, nom: true, prenom: true } },
        patient: isDoctor
          ? { select: { id: true, nom: true, prenom: true } }
          : false,
        ordonnances: {
          select: { id: true, dateEmission: true, medecinNom: true },
        },
      },
      orderBy: { dateConsultation: 'desc' },
    });

    return {
      data: consultations.map((c) => ({
        ...this.decryptConsultation(c),
        medecinNom:
          c.medecinNom ||
          (c.medecin ? `Dr. ${c.medecin.prenom} ${c.medecin.nom}` : null),
        ...(isDoctor && 'patient' in c && c.patient
          ? {
              patientNom: `${c.patient.prenom} ${c.patient.nom}`,
              patientId: c.patient.id,
            }
          : {}),
      })),
      message: `${consultations.length} consultation(s)`,
      success: true,
    };
  }

  async getConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, patientId: userId, deletedAt: null },
      include: {
        structure: {
          select: {
            id: true,
            nom: true,
            type: true,
            adresse: true,
            ville: true,
          },
        },
        ordonnances: true,
      },
    });

    if (!consultation) throw new NotFoundException('Consultation non trouvée');

    return {
      data: this.decryptConsultation(consultation),
      message: 'Consultation trouvée',
      success: true,
    };
  }

  async createConsultation(
    actorId: string,
    dto: CreateConsultationDto,
    structureId?: string,
  ) {
    const patientId = dto.patientId || actorId;
    const { actorStructureId } = await this.checkAccess(
      actorId,
      patientId,
      structureId,
    );

    // Établissement enregistré : pour un soignant, c'est son établissement réel
    // en base (pas celui du corps de requête ni seulement celui du JWT). Le
    // patient qui saisit sa propre consultation garde le comportement existant
    // (décision D04).
    let structureEnregistree: string | null | undefined;
    if (actorId === patientId) {
      structureEnregistree = dto.structureId || structureId;
    } else {
      const etablissementReel = actorStructureId ?? null;
      if (dto.structureId && dto.structureId !== etablissementReel) {
        throw new ForbiddenException(
          'Vous ne pouvez enregistrer une consultation que pour votre propre établissement de santé.',
        );
      }
      structureEnregistree = etablissementReel;
    }

    // Vérifier que la structure existe si fournie
    if (dto.structureId) {
      const structure = await this.prisma.structure.findUnique({
        where: { id: dto.structureId },
      });
      if (!structure) throw new NotFoundException('Structure non trouvée');
    }

    // Récupérer le nom du médecin si c'est un professionnel
    let medecinNom = dto.medecinNom;
    if (!medecinNom && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
      });
      if (actor) medecinNom = `Dr. ${actor.prenom} ${actor.nom}`;
    }

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId,
        motif: this.encryptionService.encrypt(dto.motif.trim()),
        medecinId: actorId !== patientId ? actorId : null,
        medecinNom: medecinNom?.trim(),
        diagnostic: this.encryptionService.encrypt(
          dto.diagnostic?.trim() || '',
        ),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
        structureId: structureEnregistree,
        dateConsultation: dto.dateConsultation
          ? new Date(dto.dateConsultation)
          : new Date(),
      },
      include: {
        structure: { select: { id: true, nom: true, type: true } },
        medecin: { select: { id: true, nom: true, prenom: true } },
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'SYSTEME',
        titre: 'Nouvelle consultation',
        message: `Une nouvelle consultation a été enregistrée par ${consultation.medecinNom || 'un médecin'}.`,
        lien: `/dashboard/carnet-sante/consultations/${consultation.id}`,
      });
    }

    return {
      data: consultation,
      message: 'Consultation ajoutée au carnet de santé',
      success: true,
    };
  }

  async deleteConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, patientId: userId, deletedAt: null },
    });
    if (!consultation) throw new NotFoundException('Consultation non trouvée');

    await this.prisma.consultation.update({
      where: { id: consultationId },
      data: { deletedAt: new Date() },
    });

    return { data: null, message: 'Consultation supprimée', success: true };
  }

  // ─── Ordonnances ──────────────────────────────────────────────

  async getOrdonnances(userId: string) {
    const ordonnances = await this.prisma.ordonnance.findMany({
      where: { patientId: userId, deletedAt: null },
      include: {
        medecin: { select: { id: true, nom: true, prenom: true } },
        consultation: {
          include: { structure: { select: { id: true, nom: true } } },
        },
      },
      orderBy: { dateEmission: 'desc' },
    });

    return {
      data: ordonnances.map((o) => ({
        ...this.decryptOrdonnance(o),
        // La consultation liée est chiffrée en base (motif, diagnostic, notes).
        consultation: o.consultation
          ? this.decryptConsultation(o.consultation)
          : null,
        medecinNom:
          o.medecinNom ||
          (o.medecin ? `Dr. ${o.medecin.prenom} ${o.medecin.nom}` : null),
      })),
      message: `${ordonnances.length} ordonnance(s)`,
      success: true,
    };
  }

  async createOrdonnance(
    actorId: string,
    dto: CreateOrdonnanceDto,
    structureId?: string,
  ) {
    // Lignes liées au catalogue : les médicaments doivent toujours exister (une requête).
    const medicamentIds = [
      ...new Set(
        dto.medicaments
          .map((m) => m.medicamentId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (medicamentIds.length > 0) {
      const trouves = await this.prisma.medicament.findMany({
        where: { id: { in: medicamentIds } },
        select: { id: true },
      });
      if (trouves.length !== medicamentIds.length) {
        throw new BadRequestException(
          "Un médicament de l'ordonnance n'est plus dans le catalogue. Retirez-le puis choisissez-le à nouveau, ou saisissez son nom librement.",
        );
      }
    }

    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    // Vérifier que la consultation appartient bien à cet utilisateur
    if (dto.consultationId) {
      const c = await this.prisma.consultation.findFirst({
        where: { id: dto.consultationId, patientId, deletedAt: null },
      });
      if (!c) throw new NotFoundException('Consultation non trouvée');
    }

    // Récupérer le nom du médecin si c'est un professionnel
    let medecinNom = dto.medecinNom;
    if (!medecinNom && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
      });
      if (actor) medecinNom = `Dr. ${actor.prenom} ${actor.nom}`;
    }

    // Ordonnance scannée (bucket privé) : vérifie + rattache le document au patient.
    if (dto.scanFileId) {
      await this.storage.claimPrivateForPatient(
        dto.scanFileId,
        actorId,
        patientId,
      );
    }

    const ordonnance = await this.prisma.ordonnance.create({
      data: {
        patientId,
        medecinId: actorId !== patientId ? actorId : null,
        consultationId: dto.consultationId,
        medecinNom: medecinNom?.trim(),
        medicaments: this.encryptionService.encrypt(
          JSON.stringify(dto.medicaments),
        ),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
        dateExpiration: dto.dateExpiration
          ? new Date(dto.dateExpiration)
          : null,
        scanFileId: dto.scanFileId ?? null,
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'NOUVELLE_ORDONNANCE',
        titre: 'Nouvelle ordonnance',
        message: `${medecinNom || 'Un médecin'} vous a prescrit une nouvelle ordonnance.`,
        lien: `/dashboard/carnet-sante/ordonnances`,
      });
    }

    return {
      data: { ...ordonnance, medicaments: dto.medicaments },
      message: 'Ordonnance enregistrée',
      success: true,
    };
  }

  async deleteOrdonnance(userId: string, ordonnanceId: string) {
    const ordonnance = await this.prisma.ordonnance.findFirst({
      where: { id: ordonnanceId, patientId: userId, deletedAt: null },
    });
    if (!ordonnance) throw new NotFoundException('Ordonnance non trouvée');

    await this.prisma.ordonnance.update({
      where: { id: ordonnanceId },
      data: { deletedAt: new Date() },
    });

    return { data: null, message: 'Ordonnance supprimée', success: true };
  }

  // ─── Résultats d'analyses ─────────────────────────────────────

  async getAnalyses(userId: string) {
    const analyses = await this.prisma.resultatAnalyse.findMany({
      where: { patientId: userId, deletedAt: null },
      include: { medecin: { select: { id: true, nom: true, prenom: true } } },
      orderBy: { dateAnalyse: 'desc' },
    });

    return {
      data: analyses.map((a) => {
        // Le laboratoire est chiffré en base : on part de la valeur déchiffrée,
        // jamais de `a.laboratoire` brut (sinon le patient voit le texte chiffré).
        const analyse = this.decryptAnalyse(a);
        return {
          ...analyse,
          laboratoire:
            analyse.laboratoire ||
            (a.medecin ? `Dr. ${a.medecin.prenom} ${a.medecin.nom}` : null),
        };
      }),
      message: `${analyses.length} résultat(s)`,
      success: true,
    };
  }

  async createAnalyse(
    actorId: string,
    dto: CreateResultatAnalyseDto,
    structureId?: string,
  ) {
    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    // Déterminer le laboratoire par défaut (nom de la structure de l'acteur)
    let laboratoire = dto.laboratoire;
    if (!laboratoire && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        include: { structure: true },
      });
      if (actor?.structure) laboratoire = actor.structure.nom;
    }

    // Document d'analyse (bucket privé) : vérifie + rattache le document au patient.
    if (dto.documentFileId) {
      await this.storage.claimPrivateForPatient(
        dto.documentFileId,
        actorId,
        patientId,
      );
    }

    const analyse = await this.prisma.resultatAnalyse.create({
      data: {
        patientId,
        medecinId: actorId !== patientId ? actorId : null,
        typeAnalyse: this.encryptionService.encrypt(dto.typeAnalyse.trim()),
        laboratoire: this.encryptionService.encrypt(laboratoire?.trim() || ''),
        resultats: this.encryptionService.encrypt(dto.resultats.trim()),
        documentFileId: dto.documentFileId ?? null,
        dateAnalyse: new Date(dto.dateAnalyse),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'NOUVELLE_ORDONNANCE', // On pourrait utiliser SYSTEME si pas de type ANALYSE
        titre: "Résultats d'analyses",
        message: `Vos résultats pour "${analyse.typeAnalyse}" sont disponibles.`,
        lien: `/dashboard/carnet-sante/analyses`,
      });
    }

    return { data: analyse, message: 'Résultat ajouté', success: true };
  }

  async deleteAnalyse(userId: string, analyseId: string) {
    const analyse = await this.prisma.resultatAnalyse.findFirst({
      where: { id: analyseId, patientId: userId, deletedAt: null },
    });
    if (!analyse) throw new NotFoundException('Résultat non trouvé');

    await this.prisma.resultatAnalyse.update({
      where: { id: analyseId },
      data: { deletedAt: new Date() },
    });
    return { data: null, message: 'Résultat supprimé', success: true };
  }

  // ─── Vaccinations ─────────────────────────────────────────────

  async getVaccinations(userId: string) {
    const vaccinations = await this.prisma.vaccination.findMany({
      where: { patientId: userId, deletedAt: null },
      include: { medecin: { select: { id: true, nom: true, prenom: true } } },
      orderBy: { dateVaccin: 'desc' },
    });

    return {
      data: vaccinations.map((v) => ({
        ...this.decryptVaccination(v),
        administrePar:
          v.administrePar ||
          (v.medecin ? `Dr. ${v.medecin.prenom} ${v.medecin.nom}` : null),
      })),
      message: `${vaccinations.length} vaccination(s)`,
      success: true,
    };
  }

  async createVaccination(
    actorId: string,
    dto: CreateVaccinationDto,
    structureId?: string,
  ) {
    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    // Déterminer qui administre (Dr. Nom si pro)
    let administrePar = dto.administrePar;
    if (!administrePar && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorId },
        include: { structure: true },
      });
      if (actor) {
        administrePar = `Dr. ${actor.prenom} ${actor.nom}`;
        if (actor.structure) administrePar += ` (${actor.structure.nom})`;
      }
    }

    const vaccination = await this.prisma.vaccination.create({
      data: {
        patientId,
        medecinId: actorId !== patientId ? actorId : null,
        vaccin: this.encryptionService.encrypt(dto.vaccin.trim()),
        dateVaccin: new Date(dto.dateVaccin),
        prochainRappel: dto.prochainRappel
          ? new Date(dto.prochainRappel)
          : null,
        lotNumero: dto.lotNumero?.trim(),
        administrePar: administrePar?.trim(),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'SYSTEME',
        titre: 'Vaccination enregistrée',
        message: `Votre vaccination contre "${vaccination.vaccin}" a été ajoutée à votre carnet.`,
        lien: `/dashboard/carnet-sante/vaccinations`,
      });
    }

    return {
      data: vaccination,
      message: 'Vaccination enregistrée',
      success: true,
    };
  }

  async deleteVaccination(userId: string, vaccinationId: string) {
    const vac = await this.prisma.vaccination.findFirst({
      where: { id: vaccinationId, patientId: userId, deletedAt: null },
    });
    if (!vac) throw new NotFoundException('Vaccination non trouvée');

    await this.prisma.vaccination.update({
      where: { id: vaccinationId },
      data: { deletedAt: new Date() },
    });
    return { data: null, message: 'Vaccination supprimée', success: true };
  }

  // ─── Rendez-vous ──────────────────────────────────────────────

  async getRendezVous(userId: string, role: string, structureId?: string) {
    // - Patient : ses propres RDV.
    // - Personnel de structure : tous les RDV de sa structure (l'accueil suit ce qu'il
    //   crée, le médecin voit les propositions à valider + les RDV « structure »).
    // - Soignant sans structure (cas limite) : uniquement les RDV qui lui sont affectés.
    const where =
      role === 'PATIENT'
        ? { patientId: userId }
        : structureId
          ? { structureId }
          : { medecinId: userId };
    const rv = await this.prisma.rendezVous.findMany({
      where,
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        medecin: {
          select: { id: true, nom: true, prenom: true, specialite: true },
        },
        structure: { select: { id: true, nom: true } },
      },
      orderBy: { date: 'asc' },
    });

    return { data: rv, message: `${rv.length} rendez-vous`, success: true };
  }

  /**
   * Création d'un RDV. Le médecin cible + le statut dépendent de qui crée le RDV :
   *  - `medecinId` fourni == acteur → le médecin se programme lui-même (PROGRAMME) ;
   *  - `medecinId` fourni != acteur → proposition à ce médecin (EN_ATTENTE) ;
   *  - `medecinId` absent + acteur médecin → auto-affectation (PROGRAMME, rétro-compat) ;
   *  - `medecinId` absent + acteur non médecin (accueil) → RDV « structure » (EN_ATTENTE,
   *    non affecté), à prendre en charge par un médecin.
   */
  async createRendezVous(
    actorId: string,
    actorRole: string,
    dto: CreateRendezVousDto,
    structureId?: string,
  ) {
    let medecinId: string | null;
    let status: AppointmentStatus;

    if (dto.medecinId) {
      medecinId = dto.medecinId;
      status = dto.medecinId === actorId ? 'PROGRAMME' : 'EN_ATTENTE';
    } else if (actorRole === 'MEDECIN') {
      medecinId = actorId;
      status = 'PROGRAMME';
    } else {
      medecinId = null;
      status = 'EN_ATTENTE';
    }

    const rv = await this.prisma.rendezVous.create({
      data: {
        patientId: dto.patientId,
        medecinId,
        structureId: dto.structureId || structureId,
        date: new Date(dto.date),
        motif: dto.motif.trim(),
        notes: dto.notes?.trim(),
        status,
      },
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        medecin: {
          select: { id: true, nom: true, prenom: true, specialite: true },
        },
        structure: { select: { id: true, nom: true } },
      },
    });

    const message =
      status === 'EN_ATTENTE'
        ? medecinId
          ? 'Rendez-vous proposé au médecin (en attente de validation)'
          : 'Rendez-vous enregistré, en attente de prise en charge par un médecin'
        : 'Rendez-vous programmé';
    return { data: rv, message, success: true };
  }

  /**
   * Validation / refus d'un RDV en attente par un médecin.
   *  - RDV nominatif (`medecinId` défini) : seul le médecin ciblé peut répondre.
   *  - RDV « structure » (`medecinId` null) : un médecin de la même structure peut le
   *    prendre en charge → il s'y affecte à la validation.
   */
  async respondToRendezVous(
    rvId: string,
    actorId: string,
    actorRole: string,
    actorStructureId: string | undefined,
    decision: 'valider' | 'refuser',
  ) {
    const rv = await this.prisma.rendezVous.findUnique({
      where: { id: rvId },
      select: { id: true, medecinId: true, structureId: true, status: true },
    });
    if (!rv) throw new NotFoundException('Rendez-vous introuvable.');
    if (rv.status !== 'EN_ATTENTE') {
      throw new BadRequestException(
        "Ce rendez-vous n'est pas en attente de validation.",
      );
    }

    if (rv.medecinId) {
      if (rv.medecinId !== actorId) {
        throw new ForbiddenException(
          'Ce rendez-vous est adressé à un autre médecin.',
        );
      }
    } else if (
      actorRole !== 'MEDECIN' ||
      !actorStructureId ||
      rv.structureId !== actorStructureId
    ) {
      throw new ForbiddenException(
        'Seul un médecin de la structure peut prendre en charge ce rendez-vous.',
      );
    }

    const updated = await this.prisma.rendezVous.update({
      where: { id: rvId },
      data:
        decision === 'valider'
          ? {
              status: 'CONFIRME',
              ...(rv.medecinId ? {} : { medecinId: actorId }),
            }
          : { status: 'REFUSE' },
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        medecin: {
          select: { id: true, nom: true, prenom: true, specialite: true },
        },
        structure: { select: { id: true, nom: true } },
      },
    });
    return {
      data: updated,
      message:
        decision === 'valider' ? 'Rendez-vous confirmé' : 'Rendez-vous refusé',
      success: true,
    };
  }

  async updateRendezVousStatus(
    rvId: string,
    status: AppointmentStatus,
    actorId: string,
    actorStructureId?: string | null,
  ) {
    const rv = await this.prisma.rendezVous.findUnique({
      where: { id: rvId },
      select: {
        id: true,
        patientId: true,
        medecinId: true,
        structureId: true,
        status: true,
      },
    });
    if (!rv) throw new NotFoundException('Rendez-vous introuvable.');

    if (actorId === rv.patientId) {
      // Le patient peut seulement annuler son propre rendez-vous.
      if (status !== 'ANNULE') {
        throw new ForbiddenException(
          'Vous pouvez seulement annuler votre rendez-vous.',
        );
      }
      // Annulation permise seulement avant le rendez-vous et avant toute décision finale.
      const messagesTransition: Partial<Record<AppointmentStatus, string>> = {
        TERMINE: 'Ce rendez-vous a déjà eu lieu, il ne peut plus être annulé.',
        REFUSE:
          "Ce rendez-vous a été refusé par l'établissement, il n'y a rien à annuler.",
        ANNULE: 'Ce rendez-vous est déjà annulé.',
      };
      const messageTransition = messagesTransition[rv.status];
      if (messageTransition) {
        throw new ConflictException({
          message: messageTransition,
          code: 'TRANSITION_INTERDITE',
        });
      }
    } else {
      // Soignant : permission d'écriture + lien avec le rendez-vous (médecin ou structure).
      const aPermission = await this.permissionsService.hasPermissions(
        actorId,
        [PERMISSIONS.RENDEZVOUS_WRITE],
      );
      const estMedecin = actorId === rv.medecinId;
      const estDeLaStructure =
        !!rv.structureId && rv.structureId === actorStructureId;
      if (!aPermission || !(estMedecin || estDeLaStructure)) {
        throw new ForbiddenException("Vous n'avez pas accès à ce rendez-vous.");
      }
    }

    const updated = await this.prisma.rendezVous.update({
      where: { id: rvId },
      data: { status },
    });
    return {
      data: updated,
      message: 'Statut du rendez-vous mis à jour',
      success: true,
    };
  }

  // ─── Helpers de Décryptage ───────────────────────────────────

  /** Déchiffre une valeur optionnelle : null reste null (comportement de decrypt). */
  private decryptNullable(value: string | null): string | null {
    return value === null ? null : this.encryptionService.decrypt(value);
  }

  private decryptProfil<
    T extends Pick<ProfilMedical, 'allergies' | 'pathologies' | 'traitements'>,
  >(profil: T) {
    return {
      ...profil,
      allergies: this.encryptionService.decrypt(profil.allergies || ''),
      pathologies: this.encryptionService.decrypt(profil.pathologies || ''),
      traitements: this.encryptionService.decrypt(profil.traitements || ''),
    };
  }

  /**
   * Fiche d'urgence transmise aux soignants lors d'un SOS : uniquement ce qui sert à
   * intervenir (groupe sanguin, allergies, pathologies, traitements). Jamais le profil
   * complet (poids, taille, date de naissance, coordonnées du proche...).
   */
  private ficheUrgence(
    profil: Pick<
      ProfilMedical,
      'groupeSanguin' | 'allergies' | 'pathologies' | 'traitements'
    > | null,
  ) {
    if (!profil) return null;
    const dechiffre = this.decryptProfil(profil);
    return {
      groupeSanguin: profil.groupeSanguin,
      allergies: dechiffre.allergies,
      pathologies: dechiffre.pathologies,
      traitements: dechiffre.traitements,
    };
  }

  private decryptConsultation<
    T extends Pick<Consultation, 'motif' | 'diagnostic' | 'notes'>,
  >(c: T) {
    return {
      ...c,
      motif: this.encryptionService.decrypt(c.motif),
      diagnostic: this.decryptNullable(c.diagnostic),
      notes: this.decryptNullable(c.notes),
    };
  }

  private decryptOrdonnance<
    T extends Pick<Ordonnance, 'medicaments' | 'notes'>,
  >(o: T) {
    const decryptedMedicaments = this.encryptionService.decrypt(o.medicaments);
    return {
      ...o,
      medicaments: this.safeJsonParse(decryptedMedicaments),
      notes: this.decryptNullable(o.notes),
    };
  }

  private decryptAnalyse<
    T extends Pick<
      ResultatAnalyse,
      'typeAnalyse' | 'laboratoire' | 'resultats' | 'notes'
    >,
  >(a: T) {
    return {
      ...a,
      typeAnalyse: this.encryptionService.decrypt(a.typeAnalyse),
      laboratoire: this.decryptNullable(a.laboratoire),
      resultats: this.encryptionService.decrypt(a.resultats),
      notes: this.decryptNullable(a.notes),
    };
  }

  private decryptVaccination<T extends Pick<Vaccination, 'vaccin' | 'notes'>>(
    v: T,
  ) {
    return {
      ...v,
      vaccin: this.encryptionService.decrypt(v.vaccin),
      notes: this.decryptNullable(v.notes),
    };
  }

  // ─── Auto-diagnostics ─────────────────────────────────────────

  async getAutoDiagnostics(userId: string) {
    const diagnostics = await this.prisma.autoDiagnostic.findMany({
      where: { patientId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: diagnostics.map((d) => ({
        ...d,
        symptomes: this.encryptionService.decrypt(d.symptomes),
        recommendation: this.encryptionService.decrypt(d.recommendation || ''),
        analyseia: d.analyseia ? this.safeJsonParse(d.analyseia) : null,
      })),
      message: `${diagnostics.length} auto-diagnostic(s)`,
      success: true,
    };
  }

  async createAutoDiagnostic(userId: string, dto: CreateAutoDiagnosticDto) {
    // 1. Enregistre d'abord les symptômes
    const diagnostic = await this.prisma.autoDiagnostic.create({
      data: {
        patientId: userId,
        symptomes: this.encryptionService.encrypt(dto.symptomes.trim()),
      },
    });

    // 2. Appel à l'IA
    const result = (await this.aiService.predictMaladie(dto.symptomes)) as {
      reponse?: string;
      maladie: string;
    };

    // 3. Mise à jour avec le résultat
    const updated = await this.prisma.autoDiagnostic.update({
      where: { id: diagnostic.id },
      data: {
        analyseia: JSON.stringify(result),
        recommendation: this.encryptionService.encrypt(
          result.reponse || result.maladie,
        ),
      },
    });

    return {
      data: {
        ...updated,
        symptomes: dto.symptomes,
        recommendation: result.reponse || result.maladie,
        analyseia: result,
      },
      message: 'Analyse IA terminée avec succès.',
      success: true,
    };
  }

  async getResume(userId: string) {
    const [
      profilMedical,
      nbConsultations,
      nbOrdonnances,
      nbAnalyses,
      nbVaccinations,
      prochainRappel,
    ] = await Promise.all([
      this.prisma.profilMedical.findUnique({ where: { userId } }),
      this.prisma.consultation.count({
        where: { patientId: userId, deletedAt: null },
      }),
      this.prisma.ordonnance.count({
        where: { patientId: userId, deletedAt: null },
      }),
      this.prisma.resultatAnalyse.count({
        where: { patientId: userId, deletedAt: null },
      }),
      this.prisma.vaccination.count({
        where: { patientId: userId, deletedAt: null },
      }),
      // Prochain rappel vaccinal
      this.prisma.vaccination.findFirst({
        where: {
          patientId: userId,
          deletedAt: null,
          prochainRappel: { gt: new Date() },
        },
        orderBy: { prochainRappel: 'asc' },
        select: { vaccin: true, prochainRappel: true },
      }),
    ]);

    return {
      data: {
        profil: profilMedical ? this.decryptProfil(profilMedical) : null,
        stats: {
          consultations: nbConsultations,
          ordonnances: nbOrdonnances,
          analyses: nbAnalyses,
          vaccinations: nbVaccinations,
        },
        prochainRappelVaccinal: prochainRappel
          ? {
              ...prochainRappel,
              vaccin: this.encryptionService.decrypt(
                prochainRappel.vaccin || '',
              ),
            }
          : null,
      },
      message: 'Résumé du carnet de santé',
      success: true,
    };
  }

  private safeJsonParse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // ─── AI Emergency (First Aid) ─────────────────────────────────

  async getAiEmergencyInstructions(dto: AiEmergencyRequestDto) {
    // Jamais le contenu de la question dans les logs (donnée de santé)
    this.logger.log("Demande d'instructions de secours IA reçue");
    const result = await this.aiService.getEmergencyFirstAid(dto.question);

    return {
      success: true,
      data: result,
      message: result.certain
        ? 'Instructions de secours récupérées.'
        : 'Instructions imprécises. En cas de doute, contactez les secours.',
    };
  }

  // Les 5 structures actives les plus proches d'une position (distance euclidienne simple).
  private async structuresLesPlusProches(latitude: number, longitude: number) {
    const structures = await this.prisma.structure.findMany({
      where: { isActive: true },
      select: {
        id: true,
        nom: true,
        latitude: true,
        longitude: true,
        type: true,
      },
    });

    // Calcul de distance simple (euclidienne pour l'exemple)
    return structures
      .filter((s) => s.latitude !== null && s.longitude !== null)
      .map((s) => {
        const lat = s.latitude!;
        const lng = s.longitude!;
        const dist = Math.sqrt(
          Math.pow(lat - latitude, 2) + Math.pow(lng - longitude, 2),
        );
        return { ...s, dist };
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
  }

  // Dernière alerte encore active du patient (lancée ou prise en charge).
  private derniereUrgenceActive(patientId: string) {
    return this.prisma.urgence.findFirst({
      where: {
        patientId,
        status: {
          in: [UrgenceStatusEnum.LANCE, UrgenceStatusEnum.PRIS_EN_CHARGE],
        },
      },
      orderBy: { createdAt: 'desc' },
      include: { structurePriseEnCharge: { select: { id: true, nom: true } } },
      omit: { cleIdempotence: true, bilanDiffusion: true },
    });
  }

  // Fin du délai d'arrivée annoncé et heure à partir de laquelle le patient peut relancer
  // une alerte (null si la relance est déjà possible).
  private etatRelanceUrgence(
    urgence: {
      status: string;
      createdAt: Date;
      priseEnChargeAt: Date | null;
      delaiArriveeMinutes: number | null;
      latitude?: number | null;
      longitude?: number | null;
      precisionMetres?: number | null;
      horodatagePosition?: Date | null;
    },
    maintenant: Date,
  ) {
    let finDelaiAt: Date | null = null;
    let peutRelancerA: Date | null = null;

    if (
      urgence.status === 'PRIS_EN_CHARGE' &&
      urgence.priseEnChargeAt &&
      urgence.delaiArriveeMinutes
    ) {
      finDelaiAt = new Date(
        urgence.priseEnChargeAt.getTime() +
          urgence.delaiArriveeMinutes * 60_000,
      );
      if (finDelaiAt > maintenant) peutRelancerA = finDelaiAt;
    } else if (
      urgence.status === 'LANCE' &&
      // Sans position utilisable (absente, trop ancienne ou trop imprécise), l'alerte n'a
      // été diffusée à aucun établissement : le patient peut relancer tout de suite (D56).
      evaluerPositionSos(urgence, urgence.createdAt).utilisable
    ) {
      const finAntiDoublon = new Date(
        urgence.createdAt.getTime() + SOS_ANTI_DOUBLON_MINUTES * 60_000,
      );
      if (finAntiDoublon > maintenant) peutRelancerA = finAntiDoublon;
    }

    return { finDelaiAt, peutRelancerA };
  }

  async getUrgenceEnCours(userId: string) {
    const urgence = await this.derniereUrgenceActive(userId);
    if (!urgence) {
      return {
        success: true,
        data: null,
        message: "Vous n'avez aucune alerte SOS en cours.",
      };
    }

    const { finDelaiAt, peutRelancerA } = this.etatRelanceUrgence(
      urgence,
      new Date(),
    );
    return {
      success: true,
      data: {
        ...urgence,
        structurePriseEnCharge: urgence.structurePriseEnCharge ?? null,
        finDelaiAt: finDelaiAt ? finDelaiAt.toISOString() : null,
        peutRelancerA: peutRelancerA ? peutRelancerA.toISOString() : null,
      },
      message: 'Alerte SOS en cours',
    };
  }

  /** Envoi en file d'un message SOS au proche, borné : une panne de file ne fait pas échouer l'alerte. */
  private async enfilerSansBloquer(
    nature: 'email' | 'sms',
    urgenceId: string,
    envoi: () => Promise<unknown>,
  ): Promise<void> {
    let minuteur: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        envoi(),
        new Promise((_, rejeter) => {
          minuteur = setTimeout(
            () =>
              rejeter(new Error(`délai de ${DELAI_FILE_SOS_MS} ms dépassé`)),
            DELAI_FILE_SOS_MS,
          );
        }),
      ]);
    } catch (e) {
      this.logger.error(
        `sos.file_indisponible urgenceId=${urgenceId} envoi=${nature} : ${(e as Error).message}`,
      );
    } finally {
      clearTimeout(minuteur);
    }
  }

  /** Réponse à un rejeu (même patient, même clé) : même alerte, aucune nouvelle diffusion. */
  private reponseRejeuSos(
    urgence: Record<string, unknown> & { id: string; bilanDiffusion?: unknown },
  ): {
    success: boolean;
    data: Record<string, unknown> &
      Partial<Omit<BilanSos, 'message'>> & {
        rejeu: boolean;
        diffusionEnCours?: boolean;
      };
    message: string;
  } {
    const donnees = donneesUrgencePubliques(urgence);
    if (estBilanSos(urgence.bilanDiffusion)) {
      const { message, ...bilan } = urgence.bilanDiffusion;
      this.logger.log(`sos.rejeu urgenceId=${urgence.id}`);
      return {
        success: true,
        data: { ...donnees, ...bilan, rejeu: true },
        message,
      };
    }
    this.logger.log(`sos.rejeu urgenceId=${urgence.id} diffusionEnCours=true`);
    return {
      success: true,
      data: { ...donnees, rejeu: true, diffusionEnCours: true },
      message: MESSAGE_SOS_DIFFUSION_EN_COURS,
    };
  }

  async createUrgence(
    userId: string,
    dto: CreateUrgenceDto,
    enTeteIdempotence?: string,
  ) {
    const cleIdempotence = lireCleIdempotence(enTeteIdempotence);
    if (
      enTeteIdempotence !== undefined &&
      enTeteIdempotence.trim() !== '' &&
      !cleIdempotence
    ) {
      this.logger.warn('sos.cle_idempotence_ignoree format invalide');
    }
    if (cleIdempotence) {
      const existante = await this.prisma.urgence.findUnique({
        where: {
          patientId_cleIdempotence: { patientId: userId, cleIdempotence },
        },
      });
      if (existante) {
        const limite = Date.now() - SOS_IDEMPOTENCE_HEURES * 3_600_000;
        if (existante.createdAt.getTime() >= limite) {
          return this.reponseRejeuSos(existante);
        }
        // Clé réutilisée après 24 h : elle est retirée de l'ancienne alerte, la nouvelle la reprend.
        await this.prisma.urgence.update({
          where: { id: existante.id },
          data: { cleIdempotence: null },
        });
        this.logger.log(
          `sos.cle_idempotence_expiree urgenceId=${existante.id}`,
        );
      }
    }

    // Anti-relance : pas de nouvelle alerte tant que les secours sont attendus ou que
    // la précédente vient juste d'être envoyée. L'ancienne alerte n'est jamais modifiée.
    const derniere = await this.derniereUrgenceActive(userId);
    if (derniere) {
      const maintenant = new Date();
      const { peutRelancerA } = this.etatRelanceUrgence(derniere, maintenant);
      if (peutRelancerA) {
        const minutes = Math.max(
          1,
          Math.ceil((peutRelancerA.getTime() - maintenant.getTime()) / 60_000),
        );
        const duree = `${minutes} minute${minutes > 1 ? 's' : ''}`;
        const message =
          derniere.status === 'PRIS_EN_CHARGE'
            ? `Votre alerte a été prise en charge par ${derniere.structurePriseEnCharge?.nom ?? 'un établissement de santé'}. ` +
              `Les secours sont attendus dans environ ${duree}. ` +
              "Si personne n'est arrivé d'ici là, vous pourrez relancer une alerte."
            : 'Votre alerte a déjà été envoyée aux établissements proches. ' +
              `Vous pourrez en relancer une dans environ ${duree}.`;
        this.logger.log(
          `sos.relance_refusee urgenceId=${derniere.id} statut=${derniere.status}`,
        );
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message,
          code: 'SOS_DEJA_ACTIF',
          peutRelancerA: peutRelancerA.toISOString(),
        });
      }
    }

    let urgence: Prisma.UrgenceGetPayload<{
      include: {
        patient: {
          select: {
            nom: true;
            prenom: true;
            telephone: true;
            email: true;
            profilMedical: true;
          };
        };
      };
    }>;
    try {
      urgence = await this.prisma.urgence.create({
        data: {
          patientId: userId,
          latitude: dto.latitude,
          longitude: dto.longitude,
          message: dto.message,
          precisionMetres: dto.precision ?? undefined,
          horodatagePosition: dto.horodatagePosition
            ? new Date(dto.horodatagePosition)
            : undefined,
          sourcePosition: dto.source ?? undefined,
          cleIdempotence: cleIdempotence ?? undefined,
          status: 'LANCE',
        },
        include: {
          patient: {
            select: {
              nom: true,
              prenom: true,
              telephone: true,
              email: true,
              profilMedical: true,
            },
          },
        },
      });
    } catch (erreur) {
      if (cleIdempotence && estConflitCleIdempotence(erreur)) {
        const trouvee = await this.prisma.urgence.findUnique({
          where: {
            patientId_cleIdempotence: { patientId: userId, cleIdempotence },
          },
        });
        if (trouvee) {
          this.logger.log(`sos.rejeu_concurrent urgenceId=${trouvee.id}`);
          return this.reponseRejeuSos(trouvee);
        }
      }
      throw erreur;
    }

    const evaluation = evaluerPositionSos(
      {
        latitude: dto.latitude,
        longitude: dto.longitude,
        precisionMetres: dto.precision,
        horodatagePosition: dto.horodatagePosition
          ? new Date(dto.horodatagePosition)
          : null,
      },
      urgence.createdAt,
    );
    if (evaluation.horodatageIgnore) {
      this.logger.warn(`sos.horodatage_futur urgenceId=${urgence.id}`);
    }
    const positionUtilisee = evaluation.utilisable;
    const positionApproximative = evaluation.qualite === 'approximative';
    const avertissementPosition =
      positionApproximative && evaluation.precisionMetres !== null
        ? avertissementPositionApproximative(evaluation.precisionMetres)
        : null;

    const contactEmail = urgence.patient.profilMedical?.contactEmail;
    const contactNom = urgence.patient.profilMedical?.contactNom || 'Proche';
    const contactTel = urgence.patient.profilMedical?.contactTelephone;
    const hasLocation =
      dto.latitude !== undefined &&
      dto.longitude !== undefined &&
      dto.latitude !== null &&
      dto.longitude !== null;

    // Compte démo : aucun email ni SMS réel vers le proche (coordonnées fictives qui
    // peuvent appartenir à quelqu'un). La diffusion interne aux soignants reste active.
    const envoisExternesBloques = estCompteDemo(urgence.patient.email);
    if (envoisExternesBloques && (contactEmail || contactTel)) {
      this.logger.log(
        `sos.demo urgenceId=${urgence.id} email et SMS au proche non envoyés (compte démo)`,
      );
    }

    // 1. Email d'alerte → file asynchrone (réponse immédiate, retries automatiques).
    if (contactEmail && !envoisExternesBloques) {
      await this.enfilerSansBloquer('email', urgence.id, () =>
        this.queueService.enqueueEmergencyEmail({
          to: contactEmail,
          contactNom,
          patientNom: urgence.patient.nom,
          patientPrenom: urgence.patient.prenom,
          location: positionUtilisee
            ? { lat: dto.latitude!, lng: dto.longitude! }
            : undefined,
          message: dto.message,
        }),
      );
    }

    // 2. SMS d'urgence (Nimba) → file asynchrone.
    if (contactTel && !envoisExternesBloques) {
      const locationStr = positionUtilisee
        ? `Position: https://www.google.com/maps?q=${dto.latitude},${dto.longitude}`
        : undefined;
      await this.enfilerSansBloquer('sms', urgence.id, () =>
        this.queueService.enqueueSos({
          recipients: [String(contactTel)],
          patientName: `${urgence.patient.prenom} ${urgence.patient.nom}`,
          location: locationStr,
        }),
      );
    }

    // 3. Notifier les 5 structures les plus proches, mais seulement les membres qui
    //    ont la permission de traiter les alertes (sos:respond). L'accueil, les
    //    pharmaciens et les administrateurs sans cette permission ne reçoivent ni
    //    l'alerte ni la fiche d'urgence du patient.
    let structuresAlertees = 0;
    let soignantsAlertes = 0;
    if (positionUtilisee) {
      const sortedStructures = await this.structuresLesPlusProches(
        dto.latitude!,
        dto.longitude!,
      );

      const alertData = {
        urgenceId: urgence.id,
        patientId: urgence.patientId,
        patientName: `${urgence.patient.prenom} ${urgence.patient.nom}`,
        latitude: dto.latitude,
        longitude: dto.longitude,
        qualitePosition: evaluation.qualite,
        precisionMetres: evaluation.precisionMetres,
        positionApproximative,
        avertissementPosition,
        message: dto.message,
        createdAt: urgence.createdAt,
        // Fiche d'urgence réduite, jamais le profil médical complet.
        profilMedical: this.ficheUrgence(urgence.patient.profilMedical),
      };

      for (const s of sortedStructures) {
        const members = await this.prisma.user.findMany({
          where: {
            OR: [
              { structureId: s.id },
              { administeredStructure: { id: s.id } },
            ],
            isActive: true,
          },
          select: { id: true },
        });

        const soignants: string[] = [];
        for (const m of members) {
          if (
            await this.permissionsService.hasPermissions(m.id, [
              PERMISSIONS.SOS_RESPOND,
            ])
          ) {
            soignants.push(m.id);
          }
        }

        this.logger.debug(
          `sos.structure_notifiee structureId=${s.id} distanceKm=${(s.dist * 111).toFixed(2)} soignants=${soignants.length}`,
        );
        if (soignants.length === 0) continue;

        structuresAlertees++;
        soignantsAlertes += soignants.length;
        this.chatGateway.sendEmergencyAlert(soignants, alertData);
        await this.notificationsService.createManyNotifications(soignants, {
          type: 'SOS_ALERTE',
          titre: 'Alerte SOS à proximité',
          message: `URGENCE : Un patient (${alertData.patientName}) a besoin d'aide à proximité.${avertissementPosition ? ` ${avertissementPosition}.` : ''}`,
          lien: '/dashboard',
        });
      }
    }

    // Ni les coordonnées GPS du patient ni son identité ne sont journalisées (audit #8).
    this.logger.log(
      `sos.diffusion urgenceId=${urgence.id} position=${hasLocation} qualitePosition=${evaluation.qualite} structures=${structuresAlertees} soignants=${soignantsAlertes}`,
    );

    // Le patient doit savoir exactement qui a été prévenu : jamais de faux succès.
    const procheAlerte =
      !envoisExternesBloques && Boolean(contactEmail || contactTel);
    let proche = '';
    if (procheAlerte) {
      proche = ` Votre proche (${contactNom}) a été prévenu.`;
    } else if (envoisExternesBloques && (contactEmail || contactTel)) {
      proche =
        " Compte de démonstration : votre proche n'a pas été prévenu (aucun email ni SMS n'est envoyé).";
    }
    let message: string;
    if (structuresAlertees > 0) {
      message =
        `Alerte envoyée à ${structuresAlertees} établissement${structuresAlertees > 1 ? 's' : ''} de santé proche${structuresAlertees > 1 ? 's' : ''}.` +
        `${proche}` +
        (positionApproximative && evaluation.precisionMetres !== null
          ? phrasePositionApproximative(evaluation.precisionMetres)
          : '') +
        ' Restez calme, un soignant va prendre en charge votre alerte.';
    } else if (
      evaluation.qualite === 'trop_ancienne' ||
      evaluation.qualite === 'trop_imprecise'
    ) {
      message = messagePositionNonUtilisee(evaluation.qualite, proche);
    } else if (!hasLocation) {
      message =
        "Votre position n'a pas pu être obtenue : aucun établissement de santé n'a été alerté." +
        `${proche} Appelez immédiatement les secours, puis activez la localisation et relancez l'alerte.`;
    } else {
      message =
        "Aucun soignant disponible n'a pu être alerté près de vous." +
        `${proche} Appelez immédiatement les secours.`;
    }

    await this.notificationsService.createNotification({
      userId: userId,
      type: 'SOS_DECLENCHE',
      titre: 'SOS Lancé',
      message,
    });

    const bilan: BilanSos = {
      structuresAlertees,
      soignantsAlertes,
      procheAlerte,
      positionTransmise: hasLocation,
      positionUtilisee,
      qualitePosition: evaluation.qualite,
      precisionMetres: evaluation.precisionMetres,
      message,
    };
    if (cleIdempotence) {
      try {
        await this.prisma.urgence.update({
          where: { id: urgence.id },
          data: { bilanDiffusion: bilan as unknown as Prisma.InputJsonValue },
        });
      } catch (e) {
        this.logger.error(
          `sos.bilan_non_enregistre urgenceId=${urgence.id} : ${(e as Error).message}`,
        );
      }
    }
    // Pas de profil médical (chiffré) dans la réponse : le patient n'en a pas besoin ici.
    const { message: messageBilan, ...champsBilan } = bilan;
    return {
      success: true,
      data: {
        ...donneesUrgencePubliques(urgence),
        ...champsBilan,
        rejeu: false,
      },
      message: messageBilan,
    };
  }

  async takeCharge(
    urgenceId: string,
    userId: string,
    dto: TakeChargeUrgenceDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { structure: true, administeredStructure: true },
    });

    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    const urgence = await this.prisma.urgence.findUnique({
      where: { id: urgenceId },
    });

    if (!urgence) throw new NotFoundException('Urgence non trouvée');
    if (urgence.status !== UrgenceStatus.LANCE) {
      throw new BadRequestException(
        'Cette urgence est déjà prise en charge ou terminée',
      );
    }

    // Structure qui intervient : celle du soignant, ou celle qu'il administre.
    const structure = user.structure ?? user.administeredStructure ?? null;
    const handledAt = new Date();
    const delaiArriveeMinutes = dto.delaiArriveeMinutes;
    const finDelaiAt = new Date(
      handledAt.getTime() + delaiArriveeMinutes * 60_000,
    );

    const updatedUrgence = await this.prisma.urgence.update({
      where: { id: urgenceId },
      data: {
        status: UrgenceStatusEnum.PRIS_EN_CHARGE,
        structurePriseEnChargeId: structure?.id ?? null,
        priseEnChargeParId: userId,
        priseEnChargeAt: handledAt,
        delaiArriveeMinutes,
      },
      // Seuls les champs utiles : ne jamais renvoyer l'objet utilisateur complet du patient.
      include: { patient: { select: { id: true, nom: true, prenom: true } } },
      omit: { cleIdempotence: true, bilanDiffusion: true },
    });

    // Notification Patient
    await this.notificationsService.createNotification({
      userId: updatedUrgence.patientId,
      type: 'SOS_PRIS_EN_CHARGE',
      titre: 'SOS Pris en charge',
      message:
        `${structure?.nom || 'Un établissement de santé'} a pris en charge votre alerte. ` +
        `Les secours arrivent dans environ ${delaiArriveeMinutes} minute${delaiArriveeMinutes > 1 ? 's' : ''}.`,
    });

    // Diffusion ciblée : le patient, les structures notifiées à l'origine (recalculées
    // depuis la position de l'alerte), la structure qui intervient et le soignant.
    const structureIds = new Set<string>();
    if (structure) structureIds.add(structure.id);
    if (urgence.latitude !== null && urgence.longitude !== null) {
      const proches = await this.structuresLesPlusProches(
        urgence.latitude,
        urgence.longitude,
      );
      proches.forEach((s) => structureIds.add(s.id));
    }
    const destinataires = new Set<string>([updatedUrgence.patientId, userId]);
    if (structureIds.size > 0) {
      const ids = [...structureIds];
      const membres = await this.prisma.user.findMany({
        where: {
          OR: [
            { structureId: { in: ids } },
            { administeredStructure: { id: { in: ids } } },
          ],
          isActive: true,
        },
        select: { id: true },
      });
      membres.forEach((m) => destinataires.add(m.id));
    }

    this.chatGateway.sendEmergencyHandled([...destinataires], {
      urgenceId: urgenceId,
      structureName: structure?.nom || `${user.prenom} ${user.nom}`,
      handledAt,
      delaiArriveeMinutes,
      finDelaiAt,
    });
    this.logger.log(
      `sos.pris_en_charge urgenceId=${urgenceId} structureId=${structure?.id ?? 'aucune'} destinataires=${destinataires.size}`,
    );

    return {
      success: true,
      data: updatedUrgence,
      message: `Vous avez pris en charge l'urgence de ${updatedUrgence.patient.prenom}`,
    };
  }

  async getActiveUrgences() {
    const urgences = await this.prisma.urgence.findMany({
      where: { status: { in: ['LANCE', 'PRIS_EN_CHARGE'] } },
      include: {
        patient: {
          select: {
            nom: true,
            prenom: true,
            telephone: true,
            profilMedical: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      omit: { cleIdempotence: true, bilanDiffusion: true },
    });

    return {
      data: urgences.map((u) => ({
        ...u,
        patient: {
          ...u.patient,
          // Fiche d'urgence réduite, jamais le profil médical complet.
          profilMedical: this.ficheUrgence(u.patient.profilMedical),
        },
      })),
      message: `${urgences.length} alerte(s) active(s)`,
      success: true,
    };
  }

  async updateUrgenceStatus(id: string, status: UrgenceStatus) {
    const urgence = await this.prisma.urgence.update({
      where: { id },
      data: { status: status },
      omit: { cleIdempotence: true, bilanDiffusion: true },
    });
    return {
      data: urgence,
      message: "Statut de l'urgence mis à jour",
      success: true,
    };
  }
}
