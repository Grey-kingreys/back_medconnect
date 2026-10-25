import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CarnetSanteService } from './carnet-sante.service';
import { UpdateRendezVousStatusDto } from './dto/carnet-sante.dto';

/**
 * Régression soft-delete (PLAN §2.1).
 *
 * Les données de santé ne doivent JAMAIS être supprimées physiquement : chaque
 * suppression est un `update({ data: { deletedAt } })` et chaque lecture exclut les
 * enregistrements déjà supprimés (`deletedAt: null`). Ce filtrage est applicatif,
 * il n'y a pas de middleware Prisma qui le garantisse (le `$use` global de Prisma <5
 * n'existe plus en Prisma 7). Ces tests verrouillent donc la règle méthode par
 * méthode : un retour à `delete()` les fait échouer.
 *
 * Seul `prisma` est exercé ; les huit autres dépendances du service sont inertes
 * (les méthodes testées ne les appellent pas).
 */
describe('CarnetSanteService : soft-delete des données de santé', () => {
  const modelMock = () => ({
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn(),
  });

  let prisma: {
    consultation: ReturnType<typeof modelMock>;
    ordonnance: ReturnType<typeof modelMock>;
    resultatAnalyse: ReturnType<typeof modelMock>;
    vaccination: ReturnType<typeof modelMock>;
  };
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      consultation: modelMock(),
      ordonnance: modelMock(),
      resultatAnalyse: modelMock(),
      vaccination: modelMock(),
    };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      {} as never, // chatGateway
      {} as never, // notificationsService
      {} as never, // encryptionService
      {} as never, // smsService
      {} as never, // queueService
      {} as never, // storage
      {} as never, // permissionsService
    );
  });

  const cas = [
    {
      nom: 'consultation',
      modele: 'consultation' as const,
      appel: (s: CarnetSanteService) => s.deleteConsultation('u1', 'x1'),
    },
    {
      nom: 'ordonnance',
      modele: 'ordonnance' as const,
      appel: (s: CarnetSanteService) => s.deleteOrdonnance('u1', 'x1'),
    },
    {
      nom: 'analyse',
      modele: 'resultatAnalyse' as const,
      appel: (s: CarnetSanteService) => s.deleteAnalyse('u1', 'x1'),
    },
    {
      nom: 'vaccination',
      modele: 'vaccination' as const,
      appel: (s: CarnetSanteService) => s.deleteVaccination('u1', 'x1'),
    },
  ];

  describe.each(cas)('$nom', ({ modele, appel }) => {
    it('marque deletedAt via update() et n’appelle jamais delete()', async () => {
      prisma[modele].findFirst.mockResolvedValue({ id: 'x1', patientId: 'u1' });

      await appel(service);

      expect(prisma[modele].update).toHaveBeenCalledTimes(1);
      const [[arg]] = prisma[modele].update.mock.calls as [
        { data: { deletedAt?: unknown } },
      ][];
      expect(arg.data.deletedAt).toBeInstanceOf(Date);
      expect(prisma[modele].delete).not.toHaveBeenCalled();
    });

    it('exclut les enregistrements déjà supprimés du contrôle d’accès', async () => {
      prisma[modele].findFirst.mockResolvedValue({ id: 'x1', patientId: 'u1' });

      await appel(service);

      const [[{ where }]] = prisma[modele].findFirst.mock.calls as [
        { where: { deletedAt?: unknown } },
      ][];
      expect(where.deletedAt).toBeNull();
    });

    it('remonte NotFound si l’enregistrement est absent ou déjà supprimé', async () => {
      prisma[modele].findFirst.mockResolvedValue(null);

      await expect(appel(service)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma[modele].update).not.toHaveBeenCalled();
    });
  });
});

describe('CarnetSanteService : updateRendezVousStatus', () => {
  const rv = {
    id: 'rv1',
    patientId: 'patient1',
    medecinId: 'medecin1',
    structureId: 'struct1',
    status: 'PROGRAMME',
  };

  let prisma: {
    rendezVous: { findUnique: jest.Mock; update: jest.Mock };
  };
  let permissions: { hasPermissions: jest.Mock };
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      rendezVous: {
        findUnique: jest.fn().mockResolvedValue(rv),
        update: jest.fn().mockResolvedValue({ ...rv }),
      },
    };
    permissions = { hasPermissions: jest.fn().mockResolvedValue(true) };
    service = new CarnetSanteService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      permissions as never,
    );
  });

  it('autorise le patient à annuler son rendez-vous', async () => {
    const res = await service.updateRendezVousStatus(
      'rv1',
      'ANNULE',
      'patient1',
    );
    expect(res.success).toBe(true);
    expect(prisma.rendezVous.update).toHaveBeenCalledWith({
      where: { id: 'rv1' },
      data: { status: 'ANNULE' },
    });
  });

  it.each(['TERMINE', 'REFUSE', 'ANNULE'])(
    "refuse au patient d'annuler un rendez-vous au statut %s",
    async (status) => {
      prisma.rendezVous.findUnique.mockResolvedValue({ ...rv, status });
      const erreur = await service
        .updateRendezVousStatus('rv1', 'ANNULE', 'patient1')
        .catch((e: unknown) => e);
      expect(erreur).toBeInstanceOf(ConflictException);
      const corps = (erreur as ConflictException).getResponse() as {
        code: string;
        message: string;
      };
      expect(corps.code).toBe('TRANSITION_INTERDITE');
      expect(typeof corps.message).toBe('string');
      expect(corps.message.length).toBeGreaterThan(0);
      expect(prisma.rendezVous.update).not.toHaveBeenCalled();
    },
  );

  it.each(['PROGRAMME', 'EN_ATTENTE', 'CONFIRME'])(
    'autorise le patient à annuler un rendez-vous au statut %s',
    async (status) => {
      prisma.rendezVous.findUnique.mockResolvedValue({ ...rv, status });
      await service.updateRendezVousStatus('rv1', 'ANNULE', 'patient1');
      expect(prisma.rendezVous.update).toHaveBeenCalledWith({
        where: { id: 'rv1' },
        data: { status: 'ANNULE' },
      });
    },
  );

  it('refuse au patient un autre statut que ANNULE', async () => {
    await expect(
      service.updateRendezVousStatus('rv1', 'TERMINE', 'patient1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rendezVous.update).not.toHaveBeenCalled();
  });

  it('refuse un tiers sans lien avec le rendez-vous', async () => {
    permissions.hasPermissions.mockResolvedValue(false);
    await expect(
      service.updateRendezVousStatus('rv1', 'CONFIRME', 'intrus', null),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rendezVous.update).not.toHaveBeenCalled();
  });

  it('refuse un soignant d’une autre structure, même avec la permission', async () => {
    await expect(
      service.updateRendezVousStatus(
        'rv1',
        'CONFIRME',
        'soignant2',
        'autre-struct',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rendezVous.update).not.toHaveBeenCalled();
  });

  it('autorise le médecin du rendez-vous', async () => {
    await service.updateRendezVousStatus('rv1', 'TERMINE', 'medecin1', null);
    expect(prisma.rendezVous.update).toHaveBeenCalledWith({
      where: { id: 'rv1' },
      data: { status: 'TERMINE' },
    });
  });

  it('autorise un membre de la structure du rendez-vous avec la permission', async () => {
    await service.updateRendezVousStatus(
      'rv1',
      'CONFIRME',
      'agent1',
      'struct1',
    );
    expect(prisma.rendezVous.update).toHaveBeenCalledTimes(1);
  });

  it('refuse un membre de la structure sans la permission', async () => {
    permissions.hasPermissions.mockResolvedValue(false);
    await expect(
      service.updateRendezVousStatus('rv1', 'CONFIRME', 'agent1', 'struct1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.rendezVous.update).not.toHaveBeenCalled();
  });

  it('remonte NotFound si le rendez-vous est introuvable', async () => {
    prisma.rendezVous.findUnique.mockResolvedValue(null);
    await expect(
      service.updateRendezVousStatus('rv1', 'ANNULE', 'patient1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateRendezVousStatusDto', () => {
  it('rejette un statut inconnu', async () => {
    const errors = await validate(
      plainToInstance(UpdateRendezVousStatusDto, { status: 'PIRATE' }),
    );
    expect(errors).toHaveLength(1);
  });

  it('accepte un statut connu', async () => {
    const errors = await validate(
      plainToInstance(UpdateRendezVousStatusDto, { status: 'ANNULE' }),
    );
    expect(errors).toHaveLength(0);
  });
});

/**
 * Contrôle d'accès (backlog point 10).
 *
 * Un soignant n'enregistre une consultation que pour son établissement réel en
 * base, et une structure autorisée ne voit, dans le carnet, que les analyses et
 * vaccinations produites par ses membres.
 */
describe('CarnetSanteService : contrôle d’accès au carnet', () => {
  const MEDECIN = 'm1';
  const PATIENT = 'p1';
  const STRUCTURE_A = 'A';
  const STRUCTURE_B = 'B';

  let prisma: {
    user: { findUnique: jest.Mock };
    autorisationStructure: { findUnique: jest.Mock };
    structure: { findUnique: jest.Mock };
    profilMedical: { findUnique: jest.Mock };
    consultation: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    ordonnance: { findMany: jest.Mock; count: jest.Mock };
    resultatAnalyse: { findMany: jest.Mock; count: jest.Mock };
    vaccination: { findMany: jest.Mock; count: jest.Mock };
  };
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      user: {
        // Patient sans lien de médecin traitant avec m1 : accès via la
        // structure autorisée A, dont m1 est réellement membre en base.
        findUnique: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === PATIENT
              ? {
                  id: PATIENT,
                  nom: 'Diallo',
                  prenom: 'Awa',
                  medecinTraitantId: 'autre',
                }
              : {
                  id: MEDECIN,
                  nom: 'Camara',
                  prenom: 'Ibrahima',
                  structureId: STRUCTURE_A,
                },
          ),
        ),
      },
      autorisationStructure: {
        findUnique: jest.fn().mockResolvedValue({ id: 'auth1' }),
      },
      structure: {
        findUnique: jest.fn().mockResolvedValue({ id: STRUCTURE_B }),
      },
      profilMedical: { findUnique: jest.fn().mockResolvedValue(null) },
      consultation: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 'c1', medecinNom: 'Dr. Ibrahima Camara' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      ordonnance: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      resultatAnalyse: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      vaccination: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      {} as never, // chatGateway
      { createNotification: jest.fn().mockResolvedValue({}) } as never,
      { encrypt: (v: string) => v } as never,
      {} as never, // smsService
      {} as never, // queueService
      {} as never, // storage
      {} as never, // permissionsService
    );
  });

  it('refuse une consultation rattachée à un autre établissement que celui du médecin', async () => {
    await expect(
      service.createConsultation(
        MEDECIN,
        { patientId: PATIENT, motif: 'Fièvre', structureId: STRUCTURE_B },
        STRUCTURE_A,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.consultation.create).not.toHaveBeenCalled();
  });

  it('enregistre la consultation avec l’établissement réel du médecin', async () => {
    await service.createConsultation(
      MEDECIN,
      { patientId: PATIENT, motif: 'Fièvre' },
      STRUCTURE_A,
    );

    const [[{ data }]] = prisma.consultation.create.mock.calls as [
      { data: { structureId?: string | null } },
    ][];
    expect(data.structureId).toBe(STRUCTURE_A);
  });

  it('filtre analyses et vaccinations par établissement de l’auteur pour une structure autorisée', async () => {
    await service.getPatientCarnetForDoctor(MEDECIN, PATIENT, STRUCTURE_A);

    const filtre = { medecin: { structureId: STRUCTURE_A } };
    for (const modele of [prisma.resultatAnalyse, prisma.vaccination]) {
      const [[{ where }]] = modele.findMany.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(where).toMatchObject(filtre);
      const [[{ where: whereCount }]] = modele.count.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      expect(whereCount).toMatchObject(filtre);
    }
  });
});
