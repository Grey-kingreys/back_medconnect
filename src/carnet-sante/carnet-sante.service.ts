import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
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
} from './dto/carnet-sante.dto';
import { AiService } from 'src/common/services/ai.service';

@Injectable()
export class CarnetSanteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) { }

  // ─── Private Helper: Vérifier l'accès au patient ────────────────
  private async checkAccess(actorId: string, patientId: string, structureId?: string) {
    if (actorId === patientId) return; // Le patient accède à son propre dossier

    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: { medecinTraitantId: true }
    });

    if (!patient) throw new NotFoundException('Patient non trouvé');

    const isMedecinTraitant = patient.medecinTraitantId === actorId;

    let hasStructureAccess = false;
    if (structureId) {
      const auth = await this.prisma.autorisationStructure.findFirst({
        where: { patientId, structureId }
      });
      if (auth) hasStructureAccess = true;
    }

    if (!isMedecinTraitant && !hasStructureAccess) {
      throw new ForbiddenException('Vous n\'êtes pas autorisé à modifier le dossier de ce patient.');
    }
  }

  // ─── Vue Médecin : Carnet complet d'un patient ─────────────────

  async getPatientCarnetForDoctor(medecinId: string, patientId: string, structureId?: string) {
    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: { id: true, nom: true, prenom: true, email: true, telephone: true, medecinTraitantId: true }
    });

    if (!patient) throw new NotFoundException('Patient non trouvé');

    const isMedecinTraitant = patient.medecinTraitantId === medecinId;
    
    // Vérifier l'autorisation via la structure (Niveau 2)
    let hasStructureAccess = false;
    if (structureId) {
      const auth = await this.prisma.autorisationStructure.findFirst({
        where: { patientId, structureId }
      });
      if (auth) hasStructureAccess = true;
    }

    if (!isMedecinTraitant && !hasStructureAccess) {
      throw new ForbiddenException('Vous n\'êtes pas autorisé à consulter le dossier de ce patient.');
    }

    // Récupérer le profil UNIQUEMENT pour le Médecin Traitant (Niveau 1)
    let profil: any = null;
    if (isMedecinTraitant) {
      profil = await this.prisma.profilMedical.findUnique({ where: { userId: patientId } });
    }

    // Récupérer les consultations et ordonnances
    // Si Médecin traitant (Niveau 1) -> Tout voir. 
    // Si Structure (Niveau 2) -> Ne voir QUE les consultations et ordonnances de sa structure.
    const consultations = await this.prisma.consultation.findMany({
      where: isMedecinTraitant ? { patientId } : { patientId, structureId: structureId as string },
      include: { structure: { select: { id: true, nom: true, type: true } } },
      orderBy: { dateConsultation: 'desc' },
      take: 50
    });

    const ordonnances = await this.prisma.ordonnance.findMany({
      where: isMedecinTraitant ? { patientId } : { patientId, consultation: { structureId: structureId as string } },
      orderBy: { dateEmission: 'desc' },
      take: 50
    });

    // Analyses et Vaccinations : Uniquement pour le Médecin Traitant (Niveau 1)
    let analyses: any[] = [];
    let vaccinations: any[] = [];
    
    if (isMedecinTraitant) {
      analyses = await this.prisma.resultatAnalyse.findMany({
        where: { patientId },
        orderBy: { dateAnalyse: 'desc' },
        take: 20
      });
      vaccinations = await this.prisma.vaccination.findMany({
        where: { patientId },
        orderBy: { dateVaccin: 'desc' }
      });
    }

    return {
      data: {
        patient: { 
          id: patient.id, 
          nom: patient.nom, 
          prenom: patient.prenom, 
          email: isMedecinTraitant ? patient.email : null, // Cacher l'email au Niveau 2
          telephone: isMedecinTraitant ? patient.telephone : null // Cacher le téléphone au Niveau 2
        },
        isMedecinTraitant,
        profil,
        consultations,
        ordonnances: ordonnances.map(o => ({ ...o, medicaments: this.safeJsonParse(o.medicaments) })),
        analyses,
        vaccinations,
        stats: {
          consultations: consultations.length,
          ordonnances: ordonnances.length,
          analyses: analyses.length,
          vaccinations: vaccinations.length,
        }
      },
      message: 'Carnet du patient récupéré',
      success: true
    };
  }

  // ─── Profil Médical ───────────────────────────────────────────

  async getProfilMedical(userId: string) {
    const profil = await this.prisma.profilMedical.findUnique({
      where: { userId },
    });

    return {
      data: profil || null,
      message: profil ? 'Profil médical trouvé' : 'Aucun profil médical créé',
      success: true,
    };
  }

  async upsertProfilMedical(userId: string, dto: UpsertProfilMedicalDto) {
    const data: any = {};
    if (dto.groupeSanguin !== undefined) data.groupeSanguin = dto.groupeSanguin;
    if (dto.allergies !== undefined) data.allergies = dto.allergies;
    if (dto.pathologies !== undefined) data.pathologies = dto.pathologies;
    if (dto.traitements !== undefined) data.traitements = dto.traitements;
    if (dto.taille !== undefined) data.taille = dto.taille;
    if (dto.poids !== undefined) data.poids = dto.poids;
    if (dto.dateNaissance !== undefined) data.dateNaissance = new Date(dto.dateNaissance);
    if (dto.genre !== undefined) data.genre = dto.genre;
    if (dto.contactUrgence !== undefined) data.contactUrgence = dto.contactUrgence;

    const profil = await this.prisma.profilMedical.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    return {
      data: profil,
      message: 'Profil médical enregistré',
      success: true,
    };
  }

  // ─── Consultations ────────────────────────────────────────────

  async getConsultations(userId: string) {
    const consultations = await this.prisma.consultation.findMany({
      where: { patientId: userId },
      include: {
        structure: { select: { id: true, nom: true, type: true, ville: true } },
        ordonnances: { select: { id: true, dateEmission: true, medecinNom: true } },
      },
      orderBy: { dateConsultation: 'desc' },
    });

    return {
      data: consultations,
      message: `${consultations.length} consultation(s) trouvée(s)`,
      success: true,
    };
  }

  async getConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, patientId: userId },
      include: {
        structure: { select: { id: true, nom: true, type: true, adresse: true, ville: true } },
        ordonnances: true,
      },
    });

    if (!consultation) throw new NotFoundException('Consultation non trouvée');

    return { data: consultation, message: 'Consultation trouvée', success: true };
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

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId,
        motif: dto.motif.trim(),
        medecinNom: dto.medecinNom?.trim(),
        diagnostic: dto.diagnostic?.trim(),
        notes: dto.notes?.trim(),
        structureId: dto.structureId || structureId,
        dateConsultation: dto.dateConsultation
          ? new Date(dto.dateConsultation)
          : new Date(),
      },
      include: {
        structure: { select: { id: true, nom: true, type: true } },
      },
    });

    return {
      data: consultation,
      message: 'Consultation ajoutée au carnet de santé',
      success: true,
    };
  }

  async deleteConsultation(userId: string, consultationId: string) {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, patientId: userId },
    });
    if (!consultation) throw new NotFoundException('Consultation non trouvée');

    await this.prisma.consultation.delete({ where: { id: consultationId } });

    return { data: null, message: 'Consultation supprimée', success: true };
  }

  // ─── Ordonnances ──────────────────────────────────────────────

  async getOrdonnances(userId: string) {
    const ordonnances = await this.prisma.ordonnance.findMany({
      where: { patientId: userId },
      orderBy: { dateEmission: 'desc' },
    });

    return {
      data: ordonnances.map((o) => ({
        ...o,
        medicaments: this.safeJsonParse(o.medicaments),
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
        where: { id: dto.consultationId, patientId },
      });
      if (!c) throw new NotFoundException('Consultation non trouvée');
    }

    const ordonnance = await this.prisma.ordonnance.create({
      data: {
        patientId,
        consultationId: dto.consultationId,
        medecinNom: dto.medecinNom?.trim(),
        medicaments: JSON.stringify(dto.medicaments),
        notes: dto.notes?.trim(),
        dateExpiration: dto.dateExpiration
          ? new Date(dto.dateExpiration)
          : null,
      },
    });

    return {
      data: { ...ordonnance, medicaments: dto.medicaments },
      message: 'Ordonnance enregistrée',
      success: true,
    };
  }

  async deleteOrdonnance(userId: string, ordonnanceId: string) {
    const ordonnance = await this.prisma.ordonnance.findFirst({
      where: { id: ordonnanceId, patientId: userId },
    });
    if (!ordonnance) throw new NotFoundException('Ordonnance non trouvée');

    await this.prisma.ordonnance.delete({ where: { id: ordonnanceId } });

    return { data: null, message: 'Ordonnance supprimée', success: true };
  }

  // ─── Résultats d'analyses ─────────────────────────────────────


  async getAnalyses(userId: string) {
    const analyses = await this.prisma.resultatAnalyse.findMany({
      where: { patientId: userId },
      orderBy: { dateAnalyse: 'desc' },
    });

    return { data: analyses, message: `${analyses.length} résultat(s)`, success: true };
  }

  async createAnalyse(actorId: string, dto: CreateResultatAnalyseDto, structureId?: string) {

    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    const analyse = await this.prisma.resultatAnalyse.create({
      data: {
        patientId,
        typeAnalyse: dto.typeAnalyse.trim(),
        laboratoire: dto.laboratoire?.trim(),
        resultats: dto.resultats.trim(),
        fichierUrl: dto.fichierUrl,
        dateAnalyse: new Date(dto.dateAnalyse),
        notes: dto.notes?.trim(),
      },
    });

    return { data: analyse, message: 'Résultat ajouté', success: true };
  }

  async deleteAnalyse(userId: string, analyseId: string) {
    const analyse = await this.prisma.resultatAnalyse.findFirst({
      where: { id: analyseId, patientId: userId },
    });
    if (!analyse) throw new NotFoundException('Résultat non trouvé');

    await this.prisma.resultatAnalyse.delete({ where: { id: analyseId } });
    return { data: null, message: 'Résultat supprimé', success: true };
  }

  // ─── Vaccinations ─────────────────────────────────────────────


  async getVaccinations(userId: string) {
    const vaccinations = await this.prisma.vaccination.findMany({
      where: { patientId: userId },
      orderBy: { dateVaccin: 'desc' },
    });

    return { data: vaccinations, message: `${vaccinations.length} vaccination(s)`, success: true };
  }

  async createVaccination(actorId: string, dto: CreateVaccinationDto, structureId?: string) {

    const patientId = dto.patientId || actorId;
    await this.checkAccess(actorId, patientId, structureId);

    const vaccination = await this.prisma.vaccination.create({
      data: {
        patientId,
        vaccin: dto.vaccin.trim(),
        dateVaccin: new Date(dto.dateVaccin),
        prochainRappel: dto.prochainRappel ? new Date(dto.prochainRappel) : null,
        lotNumero: dto.lotNumero?.trim(),
        administrePar: dto.administrePar?.trim(),
        notes: dto.notes?.trim(),
      },
    });

    return { data: vaccination, message: 'Vaccination enregistrée', success: true };
  }

  async deleteVaccination(userId: string, vaccinationId: string) {
    const vac = await this.prisma.vaccination.findFirst({
      where: { id: vaccinationId, patientId: userId },
    });
    if (!vac) throw new NotFoundException('Vaccination non trouvée');

    await this.prisma.vaccination.delete({ where: { id: vaccinationId } });
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

  // ─── Auto-diagnostics ─────────────────────────────────────────

  async getAutoDiagnostics(userId: string) {
    const diagnostics = await this.prisma.autoDiagnostic.findMany({
      where: { patientId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: diagnostics.map((d) => ({
        ...d,
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
        symptomes: dto.symptomes.trim(),
      },
    });

    // 2. Appel à l'IA
    const result = await this.aiService.predictMaladie(dto.symptomes);

    // 3. Mise à jour avec le résultat
    const updated = await this.prisma.autoDiagnostic.update({
      where: { id: diagnostic.id },
      data: {
        analyseia: JSON.stringify(result),
        recommendation: result.reponse || result.maladie,
      },
    });

    return {
      data: {
        ...updated,
        analyseia: result
      },
      message: 'Analyse IA terminée avec succès.',
      success: true,
    };
  }

  // Mise à jour de l'auto-diagnostic avec la réponse IA
  async updateAutoDiagnosticWithIA(
    diagnosticId: string,
    analyseia: any,
    recommendation: string,
  ) {
    return this.prisma.autoDiagnostic.update({
      where: { id: diagnosticId },
      data: {
        analyseia: JSON.stringify(analyseia),
        recommendation,
      },
    });
  }

  // ─── Résumé du carnet ─────────────────────────────────────────

  async getResume(userId: string) {
    const [profilMedical, nbConsultations, nbOrdonnances, nbAnalyses, nbVaccinations, prochainRappel] =
      await Promise.all([
        this.prisma.profilMedical.findUnique({ where: { userId } }),
        this.prisma.consultation.count({ where: { patientId: userId } }),
        this.prisma.ordonnance.count({ where: { patientId: userId } }),
        this.prisma.resultatAnalyse.count({ where: { patientId: userId } }),
        this.prisma.vaccination.count({ where: { patientId: userId } }),
        // Prochain rappel vaccinal
        this.prisma.vaccination.findFirst({
          where: {
            patientId: userId,
            prochainRappel: { gt: new Date() },
          },
          orderBy: { prochainRappel: 'asc' },
          select: { vaccin: true, prochainRappel: true },
        }),
      ]);

    return {
      data: {
        profilMedical,
        stats: { nbConsultations, nbOrdonnances, nbAnalyses, nbVaccinations },
        prochainRappelVaccinal: prochainRappel,
      },
      message: 'Résumé du carnet de santé',
      success: true,
    };
  }

  // ─── Helper ───────────────────────────────────────────────────

  private safeJsonParse(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}