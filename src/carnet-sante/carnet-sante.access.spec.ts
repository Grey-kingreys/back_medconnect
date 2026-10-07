import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CarnetSanteService } from './carnet-sante.service';

/**
 * Tests du contrôle d'accès au carnet (`checkAccess`).
 *
 * Ces tests figent le comportement actuel au 2026-10-06. Ils devront suivre la
 * correction du point 10 du backlog (structure non membre, filtrage des analyses
 * et vaccinations) : toute évolution volontaire du contrôle d'accès doit
 * s'accompagner de la mise à jour de ce fichier.
 *
 * Seul `prisma` est exercé ; les huit autres dépendances sont inertes.
 */
describe('CarnetSanteService : contrôle d’accès au carnet (checkAccess)', () => {
  let prisma: {
    user: { findUnique: jest.Mock };
    autorisationStructure: { findUnique: jest.Mock };
  };
  let service: CarnetSanteService;

  type Mode = 'lecture' | 'ecriture';
  const checkAccess = (
    actorId: string,
    patientId: string,
    structureId?: string,
    mode?: Mode,
  ) =>
    (
      service as unknown as {
        checkAccess: (
          actorId: string,
          patientId: string,
          structureId?: string,
          mode?: Mode,
        ) => Promise<{ isMedecinTraitant: boolean }>;
      }
    ).checkAccess(actorId, patientId, structureId, mode);

  // Simule les deux lectures utilisateur : le patient, puis l'acteur.
  const mockUsers = (
    patient: { medecinTraitantId: string | null } | null,
    actor: { structureId: string | null } | null,
  ) => {
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'patient1' ? patient : actor),
    );
  };

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn() },
      autorisationStructure: { findUnique: jest.fn() },
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

  it('autorise le patient sur son propre dossier sans requête Prisma', async () => {
    await expect(checkAccess('patient1', 'patient1')).resolves.toEqual({
      isMedecinTraitant: false,
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.autorisationStructure.findUnique).not.toHaveBeenCalled();
  });

  it('lève NotFoundException si le patient est inexistant', async () => {
    mockUsers(null, { structureId: null });
    await expect(checkAccess('med1', 'patient1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('autorise le médecin traitant', async () => {
    mockUsers({ medecinTraitantId: 'med1' }, { structureId: null });
    await expect(checkAccess('med1', 'patient1')).resolves.toEqual({
      isMedecinTraitant: true,
      actorStructureId: null,
    });
  });

  it('autorise un acteur d’une structure autorisée par le patient', async () => {
    mockUsers({ medecinTraitantId: 'autre' }, { structureId: 'struct1' });
    prisma.autorisationStructure.findUnique.mockResolvedValue({ id: 'aut1' });

    await expect(checkAccess('agent1', 'patient1', 'struct1')).resolves.toEqual(
      { isMedecinTraitant: false, actorStructureId: 'struct1' },
    );
    expect(prisma.autorisationStructure.findUnique).toHaveBeenCalledWith({
      where: {
        patientId_structureId: {
          patientId: 'patient1',
          structureId: 'struct1',
        },
      },
    });
  });

  it('refuse si le structureId du token diffère de l’appartenance réelle (membre retiré)', async () => {
    mockUsers({ medecinTraitantId: 'autre' }, { structureId: 'struct2' });
    prisma.autorisationStructure.findUnique.mockResolvedValue({ id: 'aut1' });

    await expect(checkAccess('agent1', 'patient1', 'struct1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.autorisationStructure.findUnique).not.toHaveBeenCalled();
  });

  it('refuse si la structure de l’acteur n’a pas d’autorisation du patient', async () => {
    mockUsers({ medecinTraitantId: 'autre' }, { structureId: 'struct1' });
    prisma.autorisationStructure.findUnique.mockResolvedValue(null);

    await expect(checkAccess('agent1', 'patient1', 'struct1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.autorisationStructure.findUnique).toHaveBeenCalledTimes(1);
  });

  it('refuse sans structureId quand l’acteur n’est pas médecin traitant', async () => {
    mockUsers({ medecinTraitantId: 'autre' }, { structureId: 'struct1' });

    await expect(checkAccess('agent1', 'patient1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.autorisationStructure.findUnique).not.toHaveBeenCalled();
  });

  describe('message de refus selon le mode', () => {
    beforeEach(() => {
      mockUsers({ medecinTraitantId: 'autre' }, { structureId: null });
    });

    it('mode lecture : le message parle de consulter', async () => {
      await expect(
        checkAccess('agent1', 'patient1', undefined, 'lecture'),
      ).rejects.toThrow(/consulter/);
    });

    it('mode ecriture : le message parle de modifier', async () => {
      await expect(
        checkAccess('agent1', 'patient1', undefined, 'ecriture'),
      ).rejects.toThrow(/modifier/);
    });

    it('mode par défaut : ecriture', async () => {
      await expect(checkAccess('agent1', 'patient1')).rejects.toThrow(
        /modifier/,
      );
    });
  });

  describe('via une méthode publique', () => {
    it('getPatientCarnetForDoctor remonte le refus (lecture) à un acteur hors périmètre', async () => {
      prisma.user.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === 'patient1'
              ? { id: 'patient1', medecinTraitantId: 'autre' }
              : { structureId: null },
          ),
      );

      await expect(
        service.getPatientCarnetForDoctor('agent1', 'patient1'),
      ).rejects.toThrow(/consulter/);
    });

    it('getPatientCarnetForDoctor lève NotFoundException si le patient est inexistant', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.getPatientCarnetForDoctor('med1', 'patient1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
