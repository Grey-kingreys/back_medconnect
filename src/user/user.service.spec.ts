/* eslint-disable @typescript-eslint/no-unsafe-member-access -- les calls des doublures jest.Mock sont typés any */
import { UserService } from './user.service';

/**
 * Fuite du dossier médical à l'accueil : sans CARNET_READ, la liste des patients
 * de la structure ne doit contenir aucune donnée médicale, pas même chiffrée.
 */
type ArgFindMany = { include: { patient: { select: object } } };

describe('UserService.getPatientsForDoctor - données médicales', () => {
  const patientBase = { id: 'p1', nom: 'Diallo', prenom: 'Mariama' };
  const profil = { groupeSanguin: 'O+', allergies: 'chiffre:pollen' };

  let prisma: {
    consultation: { findMany: jest.Mock };
    autorisationStructure: { findMany: jest.Mock };
  };
  let encryption: { decrypt: jest.Mock };
  let service: UserService;

  beforeEach(() => {
    // Comme Prisma : profilMedical n'est renvoyé que s'il est demandé dans le select.
    const selonSelect = (patient: object) => (arg: ArgFindMany) =>
      'profilMedical' in arg.include.patient.select
        ? { ...patient, profilMedical: profil }
        : patient;
    const p2 = { id: 'p2', nom: 'Barry', prenom: 'Oumar' };
    prisma = {
      consultation: {
        findMany: jest.fn((arg: ArgFindMany) =>
          Promise.resolve([
            {
              patientId: 'p1',
              dateConsultation: new Date('2026-01-01'),
              motif: 'chiffre:toux',
              patient: selonSelect(patientBase)(arg),
            },
          ]),
        ),
      },
      autorisationStructure: {
        findMany: jest.fn((arg: ArgFindMany) =>
          Promise.resolve([{ patientId: 'p2', patient: selonSelect(p2)(arg) }]),
        ),
      },
    };
    encryption = { decrypt: jest.fn((v: string) => v.replace('chiffre:', '')) };
    service = new UserService(
      prisma as never,
      {} as never, // emailService
      encryption as never,
      {} as never, // rolesService
      {} as never, // storage
      {} as never, // sessions
    );
  });

  it("sans carnet : ne sélectionne pas profilMedical et n'en renvoie aucun", async () => {
    const res = await service.getPatientsForDoctor('s1', false);

    for (const appel of [
      prisma.consultation.findMany,
      prisma.autorisationStructure.findMany,
    ]) {
      const [arg] = appel.mock.calls[0] as [ArgFindMany];
      const select = arg.include.patient.select;
      expect(select).not.toHaveProperty('profilMedical');
    }
    expect(res.data).toHaveLength(2);
    for (const patient of res.data) {
      expect(patient).not.toHaveProperty('profilMedical');
    }
  });

  it('avec carnet : renvoie les allergies déchiffrées pour consultations et autorisations', async () => {
    const res = await service.getPatientsForDoctor('s1', true);

    for (const appel of [
      prisma.consultation.findMany,
      prisma.autorisationStructure.findMany,
    ]) {
      const [arg] = appel.mock.calls[0] as [ArgFindMany];
      const select = arg.include.patient.select;
      expect(select).toHaveProperty('profilMedical');
    }
    expect(res.data).toHaveLength(2);
    for (const patient of res.data as Array<{ profilMedical?: unknown }>) {
      expect(patient.profilMedical).toEqual({
        groupeSanguin: 'O+',
        allergies: 'pollen',
      });
    }
  });
});

describe('UserService.toggleActive : sessions', () => {
  const construire = (isActive: boolean) => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'u1', isActive }),
        update: jest.fn().mockResolvedValue({ id: 'u1', isActive: !isActive }),
      },
    };
    const sessions = {
      desactiverCompte: jest.fn().mockResolvedValue(undefined),
      reactiverCompte: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UserService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      sessions as never,
    );
    return { service, sessions };
  };

  it('vers inactif : desactiverCompte', async () => {
    const { service, sessions } = construire(true);
    await service.toggleActive('u1');
    expect(sessions.desactiverCompte).toHaveBeenCalledWith('u1');
    expect(sessions.reactiverCompte).not.toHaveBeenCalled();
  });

  it('vers actif : reactiverCompte', async () => {
    const { service, sessions } = construire(false);
    await service.toggleActive('u1');
    expect(sessions.reactiverCompte).toHaveBeenCalledWith('u1');
    expect(sessions.desactiverCompte).not.toHaveBeenCalled();
  });
});

describe('UserService : téléphone unique (TB17)', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: UserService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'u9',
          email: 'nouveau@b.gn',
          nom: 'Camara',
          prenom: 'Fanta',
          role: 'MEDECIN',
          isActive: true,
          createdAt: new Date(),
        }),
        update: jest.fn().mockResolvedValue({ id: 'u1' }),
      },
    };
    const emailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    const rolesService = {
      resolveAssignableRoleId: jest.fn().mockResolvedValue(null),
    };
    service = new UserService(
      prisma as never,
      emailService as never,
      {} as never, // encryption
      rolesService as never,
      {} as never, // storage
      {} as never, // sessions
    );
  });

  const dtoCreation = (telephone: string) =>
    ({
      nom: 'Camara',
      prenom: 'Fanta',
      email: 'nouveau@b.gn',
      password: 'MotDePasse-de-test-3',
      role: 'MEDECIN',
      telephone,
    }) as never;

  it('createByAdmin : 409 si le numéro est déjà pris, aucun compte créé', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'autre' });

    await expect(
      service.createByAdmin(dtoCreation('622-98-87-76')),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        message: 'Ce numéro est déjà utilisé par un autre compte.',
        code: 'TELEPHONE_DEJA_UTILISE',
      },
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('createByAdmin : enregistre le numéro normalisé quand il est libre', async () => {
    await service.createByAdmin(dtoCreation('622-98-87-76'));

    const { data } = prisma.user.create.mock.calls[0][0] as {
      data: { telephone: string };
    };
    expect(data.telephone).toBe('+224622988776');
  });

  it('update : exclut le compte lui-même du contrôle et normalise le numéro', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.gn' });

    await service.update('u1', { telephone: '00224622988776' } as never);

    const { where } = prisma.user.findFirst.mock.calls[0][0] as {
      where: { id: { not: string } };
    };
    expect(where.id).toEqual({ not: 'u1' });
    const { data } = prisma.user.update.mock.calls[0][0] as {
      data: { telephone: string };
    };
    expect(data.telephone).toBe('+224622988776');
  });
});
