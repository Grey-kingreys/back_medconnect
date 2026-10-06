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
