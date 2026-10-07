import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CarnetSanteService } from './carnet-sante.service';
import { UpdateRendezVousStatusDto } from './dto/carnet-sante.dto';

/**
 * Régression soft-delete (PLAN §2.1).
 *
 * Les données de santé ne doivent JAMAIS être supprimées physiquement : chaque
 * suppression est un `update({ data: { deletedAt } })` et chaque lecture exclut les
 * enregistrements déjà supprimés (`deletedAt: null`). Ce filtrage est applicatif —
 * il n'y a pas de middleware Prisma qui le garantisse (le `$use` global de Prisma <5
 * n'existe plus en Prisma 7). Ces tests verrouillent donc la règle méthode par
 * méthode : un retour à `delete()` les fait échouer.
 *
 * Seul `prisma` est exercé ; les huit autres dépendances du service sont inertes
 * (les méthodes testées ne les appellent pas).
 */
describe('CarnetSanteService — soft-delete des données de santé', () => {
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
