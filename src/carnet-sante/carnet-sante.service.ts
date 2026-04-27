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
} from './dto/carnet-sante.dto';

@Injectable()
export class CarnetSanteService {
  constructor(private readonly prisma: PrismaService) { }

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

  async createConsultation(userId: string, dto: CreateConsultationDto) {
    // Vérifier que la structure existe si fournie
    if (dto.structureId) {
      const structure = await this.prisma.structure.findUnique({
        where: { id: dto.structureId },
      });
      if (!structure) throw new NotFoundException('Structure non trouvée');
    }

    const consultation = await this.prisma.consultation.create({
      data: {
        patientId: userId,
        motif: dto.motif.trim(),
        medecinNom: dto.medecinNom?.trim(),
        diagnostic: dto.diagnostic?.trim(),
        notes: dto.notes?.trim(),
        structureId: dto.structureId,
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

  async createOrdonnance(userId: string, dto: CreateOrdonnanceDto) {
    // Vérifier que la consultation appartient bien à cet utilisateur
    if (dto.consultationId) {
      const c = await this.prisma.consultation.findFirst({
        where: { id: dto.consultationId, patientId: userId },
      });
      if (!c) throw new NotFoundException('Consultation non trouvée');
    }

    const ordonnance = await this.prisma.ordonnance.create({
      data: {
        patientId: userId,
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

  async createAnalyse(userId: string, dto: CreateResultatAnalyseDto) {
    const analyse = await this.prisma.resultatAnalyse.create({
      data: {
        patientId: userId,
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

  async createVaccination(userId: string, dto: CreateVaccinationDto) {
    const vaccination = await this.prisma.vaccination.create({
      data: {
        patientId: userId,
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
    // Enregistre d'abord les symptômes
    const diagnostic = await this.prisma.autoDiagnostic.create({
      data: {
        patientId: userId,
        symptomes: dto.symptomes.trim(),
      },
    });

    return {
      data: diagnostic,
      message: 'Symptômes enregistrés. Analyse IA en cours.',
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