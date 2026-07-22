import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
    private readonly queueService: QueueService
  ) { }

  private readonly logger = new Logger(CarnetSanteService.name);

  // ─── Private Helper: Vérifier l'accès au patient ────────────────

  /**
   * Périmètre patient : QUEL dossier l'acteur peut atteindre (médecin traitant
   * ou structure explicitement autorisée par le patient). Le TYPE d'action
   * (lire / écrire) est porté par les permissions du rôle, vérifiées en amont
   * par `PermissionsGuard` — les deux contrôles sont complémentaires.
   *
   * @returns `isMedecinTraitant` — le médecin traitant voit tout le carnet,
   *   une structure autorisée ne voit que ce qu'elle y a elle-même produit.
   */
  private async checkAccess(
    actorId: string,
    patientId: string,
    structureId?: string,
    mode: 'lecture' | 'ecriture' = 'ecriture',
  ): Promise<{ isMedecinTraitant: boolean }> {
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

    return { isMedecinTraitant };
  }

  // ─── Vue Médecin : Carnet complet d'un patient ─────────────────

  async getPatientCarnetForDoctor(medecinId: string, patientId: string, structureId?: string) {
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
        poids: true
      }
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
      where: isMedecinTraitant ? { patientId, deletedAt: null } : { patientId, deletedAt: null, structureId: structureId as string },
      include: { 
        structure: { select: { id: true, nom: true, type: true } },
        medecin: { select: { nom: true, prenom: true } }
      },
      orderBy: { dateConsultation: 'desc' },
      take: 50
    });

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: isMedecinTraitant ? { patientId, deletedAt: null } : { patientId, deletedAt: null, consultation: { structureId: structureId as string } },
      include: { medecin: { select: { nom: true, prenom: true } } },
      orderBy: { dateEmission: 'desc' },
      take: 50
    });

    // Analyses et Vaccinations : Médecin traitant comme structure autorisée
    // (au-delà de `checkAccess`, l'accès est déjà refusé).
    const [analyses, vaccinations] = await Promise.all([
      this.prisma.resultatAnalyse.findMany({
        where: { patientId, deletedAt: null },
        include: { medecin: { select: { nom: true, prenom: true } } },
        orderBy: { dateAnalyse: 'desc' },
        take: 20
      }),
      this.prisma.vaccination.findMany({
        where: { patientId, deletedAt: null },
        include: { medecin: { select: { nom: true, prenom: true } } },
        orderBy: { dateVaccin: 'desc' }
      }),
    ]);

    // Récupérer les STATISTIQUES GLOBALES
    const [totalConsultations, totalOrdonnances, totalAnalyses, totalVaccinations] = await Promise.all([
      this.prisma.consultation.count({ where: { patientId, deletedAt: null } }),
      this.prisma.ordonnance.count({ where: { patientId, deletedAt: null } }),
      this.prisma.resultatAnalyse.count({ where: { patientId, deletedAt: null } }),
      this.prisma.vaccination.count({ where: { patientId, deletedAt: null } }),
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
          id: patient.id, nom: patient.nom, prenom: patient.prenom, 
          email: patient.email,
          telephone: patient.telephone,
          dateNaissance: patient.dateNaissance, taille: patient.taille, poids: patient.poids
        },
        isMedecinTraitant,
        profil: profil ? this.decryptProfil(profil) : null,
        stats,
        consultations: consultations.map(c => ({
          ...this.decryptConsultation(c),
          medecinNom: c.medecinNom || (c.medecin ? `Dr. ${c.medecin.prenom} ${c.medecin.nom}` : null)
        })),
        ordonnances: ordonnances.map(o => ({
          ...this.decryptOrdonnance(o),
          medecinNom: o.medecinNom || (o.medecin ? `Dr. ${o.medecin.prenom} ${o.medecin.nom}` : null)
        })),
        vaccinations: vaccinations.map(v => ({
          ...this.decryptVaccination(v),
          administrePar: v.administrePar || (v.medecin ? `Dr. ${v.medecin.prenom} ${v.medecin.nom}` : null)
        })),
        analyses: analyses.map(a => ({
          ...this.decryptAnalyse(a),
          laboratoire: a.laboratoire || (a.medecin ? `Dr. ${a.medecin.prenom} ${a.medecin.nom}` : null)
        })),
      },
      message: 'Carnet du patient récupéré',
      success: true,
    };
  }

  async getProfilMedical(userId: string) {
    const profil = await this.prisma.profilMedical.findUnique({ where: { userId } });
    return { 
      data: profil ? this.decryptProfil(profil) : null, 
      message: profil ? 'Profil médical trouvé' : 'Aucun profil médical créé', 
      success: true 
    };
  }

  async upsertProfilMedical(userId: string, dto: UpsertProfilMedicalDto) {
    const data: any = {};
    if (dto.groupeSanguin !== undefined) data.groupeSanguin = dto.groupeSanguin;
    if (dto.allergies !== undefined) data.allergies = this.encryptionService.encrypt(dto.allergies);
    if (dto.pathologies !== undefined) data.pathologies = this.encryptionService.encrypt(dto.pathologies);
    if (dto.traitements !== undefined) data.traitements = this.encryptionService.encrypt(dto.traitements);
    if (dto.taille !== undefined) data.taille = dto.taille;
    if (dto.poids !== undefined) data.poids = dto.poids;
    if (dto.dateNaissance !== undefined) data.dateNaissance = new Date(dto.dateNaissance);
    if (dto.genre !== undefined) data.genre = dto.genre;
    if (dto.contactNom !== undefined) data.contactNom = dto.contactNom;
    if (dto.contactTelephone !== undefined) data.contactTelephone = dto.contactTelephone;
    if (dto.contactEmail !== undefined) data.contactEmail = dto.contactEmail;

    const profil = await this.prisma.profilMedical.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return { data: this.decryptProfil(profil), message: 'Profil médical enregistré', success: true };
  }

  async getConsultations(userId: string, role?: string) {
    const isDoctor = role === 'MEDECIN' || role === 'STRUCTURE_ADMIN';

    const where = isDoctor
      ? { medecinId: userId, deletedAt: null }   // Le médecin voit celles qu'il a rédigées
      : { patientId: userId, deletedAt: null };  // Le patient voit les siennes

    const consultations = await this.prisma.consultation.findMany({
      where,
      include: {
        structure: { select: { id: true, nom: true, type: true, ville: true } },
        medecin: { select: { id: true, nom: true, prenom: true } },
        patient: isDoctor
          ? { select: { id: true, nom: true, prenom: true } }
          : false,
        ordonnances: { select: { id: true, dateEmission: true, medecinNom: true } },
      },
      orderBy: { dateConsultation: 'desc' },
    });

    return { 
      data: consultations.map(c => ({
        ...this.decryptConsultation(c),
        medecinNom: c.medecinNom || (c.medecin ? `Dr. ${c.medecin.prenom} ${c.medecin.nom}` : null),
        ...(isDoctor && (c as any).patient ? {
          patientNom: `${(c as any).patient.prenom} ${(c as any).patient.nom}`,
          patientId: (c as any).patient.id,
        } : {}),
      })), 
      message: `${consultations.length} consultation(s)`, 
      success: true 
    };
  }

  async getConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, patientId: userId, deletedAt: null },
      include: {
        structure: { select: { id: true, nom: true, type: true, adresse: true, ville: true } },
        ordonnances: true,
      },
    });

    if (!consultation) throw new NotFoundException('Consultation non trouvée');

    return { 
      data: this.decryptConsultation(consultation), 
      message: 'Consultation trouvée', 
      success: true 
    };
  }

  async createConsultation(actorId: string, dto: CreateConsultationDto, structureId?: string) {
    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

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
      const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
      if (actor) medecinNom = `Dr. ${actor.prenom} ${actor.nom}`;
    }

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId,
        motif: this.encryptionService.encrypt(dto.motif.trim()),
        medecinId: actorId !== patientId ? actorId : null,
        medecinNom: medecinNom?.trim(),
        diagnostic: this.encryptionService.encrypt(dto.diagnostic?.trim() || ''),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
        structureId: dto.structureId || structureId,
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
        lien: `/dashboard/carnet-sante/consultations/${consultation.id}`
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

    await this.prisma.consultation.update({ where: { id: consultationId }, data: { deletedAt: new Date() } });

    return { data: null, message: 'Consultation supprimée', success: true };
  }

  // ─── Ordonnances ──────────────────────────────────────────────

  async getOrdonnances(userId: string) {
    const ordonnances = await this.prisma.ordonnance.findMany({
      where: { patientId: userId, deletedAt: null },
      include: {
        medecin: { select: { id: true, nom: true, prenom: true } },
        consultation: {
          include: { structure: { select: { id: true, nom: true } } }
        }
      },
      orderBy: { dateEmission: 'desc' },
    });

    return {
      data: ordonnances.map((o) => ({
        ...this.decryptOrdonnance(o),
        medecinNom: o.medecinNom || (o.medecin ? `Dr. ${o.medecin.prenom} ${o.medecin.nom}` : null)
      })),
      message: `${ordonnances.length} ordonnance(s)`,
      success: true,
    };
  }

  async createOrdonnance(actorId: string, dto: CreateOrdonnanceDto, structureId?: string) {
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
      const actor = await this.prisma.user.findUnique({ where: { id: actorId } });
      if (actor) medecinNom = `Dr. ${actor.prenom} ${actor.nom}`;
    }

    const ordonnance = await this.prisma.ordonnance.create({
      data: {
        patientId,
        medecinId: actorId !== patientId ? actorId : null,
        consultationId: dto.consultationId,
        medecinNom: medecinNom?.trim(),
        medicaments: this.encryptionService.encrypt(JSON.stringify(dto.medicaments)),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
        dateExpiration: dto.dateExpiration
          ? new Date(dto.dateExpiration)
          : null,
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'NOUVELLE_ORDONNANCE',
        titre: 'Nouvelle ordonnance',
        message: `${medecinNom || 'Un médecin'} vous a prescrit une nouvelle ordonnance.`,
        lien: `/dashboard/carnet-sante/ordonnances`
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

    await this.prisma.ordonnance.update({ where: { id: ordonnanceId }, data: { deletedAt: new Date() } });

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
      data: analyses.map(a => ({
        ...this.decryptAnalyse(a),
        laboratoire: a.laboratoire || (a.medecin ? `Dr. ${a.medecin.prenom} ${a.medecin.nom}` : null)
      })), 
      message: `${analyses.length} résultat(s)`, 
      success: true 
    };
  }

  async createAnalyse(actorId: string, dto: CreateResultatAnalyseDto, structureId?: string) {

    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    // Déterminer le laboratoire par défaut (nom de la structure de l'acteur)
    let laboratoire = dto.laboratoire;
    if (!laboratoire && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({ 
        where: { id: actorId },
        include: { structure: true }
      });
      if (actor?.structure) laboratoire = actor.structure.nom;
    }

    const analyse = await this.prisma.resultatAnalyse.create({
      data: {
        patientId,
        medecinId: actorId !== patientId ? actorId : null,
        typeAnalyse: this.encryptionService.encrypt(dto.typeAnalyse.trim()),
        laboratoire: this.encryptionService.encrypt(laboratoire?.trim() || ''),
        resultats: this.encryptionService.encrypt(dto.resultats.trim()),
        fichierUrl: dto.fichierUrl,
        dateAnalyse: new Date(dto.dateAnalyse),
        notes: this.encryptionService.encrypt(dto.notes?.trim() || ''),
      },
    });

    // Notification Patient
    if (actorId !== patientId) {
      await this.notificationsService.createNotification({
        userId: patientId,
        type: 'NOUVELLE_ORDONNANCE', // On pourrait utiliser SYSTEME si pas de type ANALYSE
        titre: 'Résultats d\'analyses',
        message: `Vos résultats pour "${analyse.typeAnalyse}" sont disponibles.`,
        lien: `/dashboard/carnet-sante/analyses`
      });
    }

    return { data: analyse, message: 'Résultat ajouté', success: true };
  }

  async deleteAnalyse(userId: string, analyseId: string) {
    const analyse = await this.prisma.resultatAnalyse.findFirst({
      where: { id: analyseId, patientId: userId, deletedAt: null },
    });
    if (!analyse) throw new NotFoundException('Résultat non trouvé');

    await this.prisma.resultatAnalyse.update({ where: { id: analyseId }, data: { deletedAt: new Date() } });
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
      data: vaccinations.map(v => ({
        ...this.decryptVaccination(v),
        administrePar: v.administrePar || (v.medecin ? `Dr. ${v.medecin.prenom} ${v.medecin.nom}` : null)
      })), 
      message: `${vaccinations.length} vaccination(s)`, 
      success: true 
    };
  }

  async createVaccination(actorId: string, dto: CreateVaccinationDto, structureId?: string) {
    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    // Déterminer qui administre (Dr. Nom si pro)
    let administrePar = dto.administrePar;
    if (!administrePar && actorId !== patientId) {
      const actor = await this.prisma.user.findUnique({ 
        where: { id: actorId },
        include: { structure: true }
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
        prochainRappel: dto.prochainRappel ? new Date(dto.prochainRappel) : null,
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
        lien: `/dashboard/carnet-sante/vaccinations`
      });
    }

    return { data: vaccination, message: 'Vaccination enregistrée', success: true };
  }

  async deleteVaccination(userId: string, vaccinationId: string) {
    const vac = await this.prisma.vaccination.findFirst({
      where: { id: vaccinationId, patientId: userId, deletedAt: null },
    });
    if (!vac) throw new NotFoundException('Vaccination non trouvée');

    await this.prisma.vaccination.update({ where: { id: vaccinationId }, data: { deletedAt: new Date() } });
    return { data: null, message: 'Vaccination supprimée', success: true };
  }

  // ─── Rendez-vous ──────────────────────────────────────────────

  async getRendezVous(userId: string, role: string) {
    const where = role === 'PATIENT' ? { patientId: userId } : { medecinId: userId };
    const rv = await this.prisma.rendezVous.findMany({
      where,
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        medecin: { select: { id: true, nom: true, prenom: true, specialite: true } },
        structure: { select: { id: true, nom: true } },
      },
      orderBy: { date: 'asc' },
    });

    return { data: rv, message: `${rv.length} rendez-vous`, success: true };
  }

  async createRendezVous(actorId: string, dto: CreateRendezVousDto, structureId?: string) {
    const rv = await this.prisma.rendezVous.create({
      data: {
        patientId: dto.patientId,
        medecinId: actorId,
        structureId: dto.structureId || structureId,
        date: new Date(dto.date),
        motif: dto.motif.trim(),
        notes: dto.notes?.trim(),
        status: (dto.status as any) || 'PROGRAMME',
      },
      include: {
        patient: { select: { id: true, nom: true, prenom: true } },
        structure: { select: { id: true, nom: true } },
      },
    });

    return { data: rv, message: 'Rendez-vous programmé', success: true };
  }

  async updateRendezVousStatus(rvId: string, status: string) {
    const rv = await this.prisma.rendezVous.update({
      where: { id: rvId },
      data: { status: status as any },
    });
    return { data: rv, message: 'Statut du rendez-vous mis à jour', success: true };
  }



  // ─── Helpers de Décryptage ───────────────────────────────────

  private decryptProfil(profil: any) {
    return {
      ...profil,
      allergies: this.encryptionService.decrypt(profil.allergies || ''),
      pathologies: this.encryptionService.decrypt(profil.pathologies || ''),
      traitements: this.encryptionService.decrypt(profil.traitements || ''),
    };
  }

  private decryptConsultation(c: any) {
    return {
      ...c,
      motif: this.encryptionService.decrypt(c.motif),
      diagnostic: this.encryptionService.decrypt(c.diagnostic),
      notes: this.encryptionService.decrypt(c.notes),
    };
  }

  private decryptOrdonnance(o: any) {
    const decryptedMedicaments = this.encryptionService.decrypt(o.medicaments);
    return {
      ...o,
      medicaments: this.safeJsonParse(decryptedMedicaments),
      notes: this.encryptionService.decrypt(o.notes),
    };
  }

  private decryptAnalyse(a: any) {
    return {
      ...a,
      typeAnalyse: this.encryptionService.decrypt(a.typeAnalyse),
      laboratoire: this.encryptionService.decrypt(a.laboratoire),
      resultats: this.encryptionService.decrypt(a.resultats),
      notes: this.encryptionService.decrypt(a.notes),
    };
  }

  private decryptVaccination(v: any) {
    return {
      ...v,
      vaccin: this.encryptionService.decrypt(v.vaccin),
      notes: this.encryptionService.decrypt(v.notes),
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
    const result = await this.aiService.predictMaladie(dto.symptomes);

    // 3. Mise à jour avec le résultat
    const updated = await this.prisma.autoDiagnostic.update({
      where: { id: diagnostic.id },
      data: {
        analyseia: JSON.stringify(result),
        recommendation: this.encryptionService.encrypt(result.reponse || result.maladie),
      },
    });

    return {
      data: {
        ...updated,
        symptomes: dto.symptomes,
        recommendation: result.reponse || result.maladie,
        analyseia: result
      },
      message: 'Analyse IA terminée avec succès.',
      success: true,
    };
  }

  async getResume(userId: string) {
    const [profilMedical, nbConsultations, nbOrdonnances, nbAnalyses, nbVaccinations, prochainRappel] =
      await Promise.all([
        this.prisma.profilMedical.findUnique({ where: { userId } }),
        this.prisma.consultation.count({ where: { patientId: userId, deletedAt: null } }),
        this.prisma.ordonnance.count({ where: { patientId: userId, deletedAt: null } }),
        this.prisma.resultatAnalyse.count({ where: { patientId: userId, deletedAt: null } }),
        this.prisma.vaccination.count({ where: { patientId: userId, deletedAt: null } }),
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
          vaccinations: nbVaccinations 
        },
        prochainRappelVaccinal: prochainRappel ? {
          ...prochainRappel,
          vaccin: this.encryptionService.decrypt(prochainRappel.vaccin || '')
        } : null,
      },
      message: 'Résumé du carnet de santé',
      success: true,
    };
  }

  private safeJsonParse(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // ─── AI Emergency (First Aid) ─────────────────────────────────

  async getAiEmergencyInstructions(dto: AiEmergencyRequestDto) {
    this.logger.log(`Demande d'instructions de secours IA: "${dto.question}"`);
    const result = await this.aiService.getEmergencyFirstAid(dto.question);
    
    return {
      success: true,
      data: result,
      message: result.certain 
        ? 'Instructions de secours récupérées.' 
        : 'Instructions imprécises. En cas de doute, contactez les secours.'
    };
  }



  async createUrgence(userId: string, dto: CreateUrgenceDto) {
    const urgence = await this.prisma.urgence.create({
      data: {
        patientId: userId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        message: dto.message,
        status: 'LANCE',
      },
      include: {
        patient: {
          select: {
            nom: true,
            prenom: true,
            telephone: true,
            profilMedical: true,
          }
        }
      }
    });

    const contactEmail = urgence.patient.profilMedical?.contactEmail;
    const contactNom = urgence.patient.profilMedical?.contactNom || 'Proche';
    const contactTel = urgence.patient.profilMedical?.contactTelephone;
    const hasLocation = dto.latitude !== undefined && dto.longitude !== undefined && dto.latitude !== null && dto.longitude !== null;
    
    // 1. Email d'alerte → file asynchrone (réponse immédiate, retries automatiques).
    if (contactEmail) {
      await this.queueService.enqueueEmergencyEmail({
        to: contactEmail,
        contactNom,
        patientNom: urgence.patient.nom,
        patientPrenom: urgence.patient.prenom,
        location: hasLocation ? { lat: dto.latitude!, lng: dto.longitude! } : undefined,
        message: dto.message,
      });
    }

    // 2. SMS d'urgence (Nimba) → file asynchrone.
    if (contactTel) {
      const locationStr = hasLocation ? `Position: https://www.google.com/maps?q=${dto.latitude},${dto.longitude}` : undefined;
      await this.queueService.enqueueSos({
        recipients: [String(contactTel)],
        patientName: `${urgence.patient.prenom} ${urgence.patient.nom}`,
        location: locationStr,
      });
    }

    // 3. Notifier les 5 structures les plus proches
    if (hasLocation) {
      const structures = await this.prisma.structure.findMany({
        where: { isActive: true },
        select: { id: true, nom: true, latitude: true, longitude: true, type: true }
      });

      // Calcul de distance simple (euclidienne pour l'exemple)
      const sortedStructures = structures
        .filter(s => s.latitude !== null && s.longitude !== null)
        .map(s => {
          const lat = s.latitude!;
          const lng = s.longitude!;
          const dist = Math.sqrt(
            Math.pow(lat - dto.latitude!, 2) + 
            Math.pow(lng - dto.longitude!, 2)
          );
          return { ...s, dist };
        })
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 5);

      // Ni les coordonnées GPS du patient ni son identité ne sont journalisées :
      // seuls l'ID de l'urgence et les structures notifiées le sont (audit #8).
      this.logger.log(
        `sos.proximite_notifiee urgenceId=${urgence.id} structures=${sortedStructures.length}`,
      );
      const alertData = {
        urgenceId: urgence.id,
        patientId: urgence.patientId,
        patientName: `${urgence.patient.prenom} ${urgence.patient.nom}`,
        latitude: dto.latitude,
        longitude: dto.longitude,
        message: dto.message,
        createdAt: urgence.createdAt,
        profilMedical: urgence.patient.profilMedical ? this.decryptProfil(urgence.patient.profilMedical) : null
      };

      for (const s of sortedStructures) {
        this.logger.debug(
          `sos.structure_notifiee structureId=${s.id} distanceKm=${(s.dist * 111).toFixed(2)}`,
        );

        // Trouver tous les membres de la structure (admin + membres)
        const members = await this.prisma.user.findMany({
          where: {
            OR: [
              { structureId: s.id },
              { administeredStructure: { id: s.id } }
            ],
            isActive: true
          },
          select: { id: true }
        });

        const memberIds = members.map(m => m.id);
        if (memberIds.length > 0) {
          this.chatGateway.sendEmergencyAlert(memberIds, alertData);
          
          // Ajouter une notification persistante
          await this.notificationsService.createManyNotifications(
            memberIds,
            {
              type: 'SOS_ALERTE',
              titre: 'Alerte SOS à proximité',
              message: `URGENCE : Un patient (${alertData.patientName}) a besoin d'aide à proximité.`,
              lien: '/dashboard/urgences'
            }
          );
        }
      }
    }

    // Notification Patient
    await this.notificationsService.createNotification({
      userId: userId,
      type: 'SOS_DECLENCHE',
      titre: 'SOS Lancé',
      message: 'Votre alerte SOS a été transmise aux structures médicales proches. Restez calme.',
    });

    return { success: true, data: urgence, message: "Alerte SOS envoyée avec succès" };
  }

  async takeCharge(urgenceId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { structure: true }
    });

    if (!user) throw new NotFoundException("Utilisateur non trouvé");

    const urgence = await this.prisma.urgence.findUnique({
      where: { id: urgenceId }
    });

    if (!urgence) throw new NotFoundException("Urgence non trouvée");
    if (urgence.status !== UrgenceStatusEnum.LANCE) {
      throw new BadRequestException("Cette urgence est déjà prise en charge ou terminée");
    }

    const updatedUrgence = await this.prisma.urgence.update({
      where: { id: urgenceId },
      data: { status: UrgenceStatusEnum.PRIS_EN_CHARGE },
      include: { patient: true }
    });

    // Notification Patient
    await this.notificationsService.createNotification({
      userId: updatedUrgence.patientId,
      type: 'SOS_PRIS_EN_CHARGE',
      titre: 'SOS Pris en charge',
      message: `${user.structure?.nom || 'Une structure'} a pris en charge votre alerte SOS.`,
    });

    // Broadcast à TOUS les médecins/structures pour informer que c'est pris
    this.chatGateway.server.emit('emergencyHandled', {
      urgenceId: urgenceId,
      structureName: user.structure?.nom || `${user.prenom} ${user.nom}`,
      handledAt: new Date()
    });

    return { 
      success: true, 
      data: updatedUrgence, 
      message: `Vous avez pris en charge l'urgence de ${updatedUrgence.patient.prenom}` 
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
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return { 
      data: urgences.map(u => ({
        ...u,
        patient: {
          ...u.patient,
          profilMedical: u.patient.profilMedical ? this.decryptProfil(u.patient.profilMedical) : null
        }
      })), 
      message: `${urgences.length} alerte(s) active(s)`, 
      success: true 
    };
  }

  async updateUrgenceStatus(id: string, status: any) {
    const urgence = await this.prisma.urgence.update({
      where: { id },
      data: { status },
    });
    return { data: urgence, message: "Statut de l'urgence mis à jour", success: true };
  }
}