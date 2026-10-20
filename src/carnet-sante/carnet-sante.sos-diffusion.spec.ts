import { CarnetSanteService } from './carnet-sante.service';

/**
 * Diffusion d'une alerte SOS (correctifs de sécurité) :
 * 1. seuls les membres ayant la permission sos:respond reçoivent l'alerte, avec une
 *    fiche d'urgence réduite (jamais le profil médical complet) ;
 * 2. la réponse dit exactement qui a été prévenu, sans faux succès.
 */
describe('CarnetSanteService : diffusion d’une alerte SOS', () => {
  const chiffrer = (v: string) => `CHIFFRE:${v}`;
  const encryption = {
    decrypt: (v: string) => (v.startsWith('CHIFFRE:') ? v.slice(8) : v),
  };
  const profil = {
    groupeSanguin: 'O_POSITIF',
    allergies: chiffrer('Pénicilline'),
    pathologies: chiffrer('Hypertension'),
    traitements: chiffrer('Amlodipine'),
    taille: 164,
    poids: 68,
    dateNaissance: new Date('1986-03-12'),
    contactNom: 'Ibrahima',
    contactTelephone: null,
    contactEmail: null,
  };

  let prisma: Record<string, Record<string, jest.Mock>>;
  let chatGateway: { sendEmergencyAlert: jest.Mock };
  let notifications: Record<string, jest.Mock>;
  let permissions: { hasPermissions: jest.Mock };
  let queue: { enqueueEmergencyEmail: jest.Mock; enqueueSos: jest.Mock };
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      urgence: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'u1',
          patientId: 'p1',
          createdAt: new Date(),
          patient: {
            nom: 'Diallo',
            prenom: 'Aminata',
            telephone: null,
            profilMedical: profil,
          },
        }),
      },
      structure: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 's1', nom: 'Donka', latitude: 9.53, longitude: -13.68 },
          ]),
      },
      user: {
        // Membres de la structure : un médecin, un agent d'accueil, un admin.
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'medecin' },
            { id: 'accueil' },
            { id: 'admin' },
          ]),
      },
    };
    chatGateway = { sendEmergencyAlert: jest.fn() };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({}),
      createManyNotifications: jest.fn().mockResolvedValue({}),
    };
    // Seul le médecin a la permission de traiter les SOS.
    permissions = {
      hasPermissions: jest.fn((id: string) =>
        Promise.resolve(id === 'medecin'),
      ),
    };
    queue = { enqueueEmergencyEmail: jest.fn(), enqueueSos: jest.fn() };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      chatGateway as never,
      notifications as never,
      encryption as never,
      {} as never, // smsService
      queue as never,
      {} as never, // storage
      permissions as never,
    );
  });

  it('n’alerte que les soignants ayant la permission sos:respond', async () => {
    await service.createUrgence('p1', { latitude: 9.5, longitude: -13.7 });

    expect(chatGateway.sendEmergencyAlert).toHaveBeenCalledTimes(1);
    const [destinataires] = chatGateway.sendEmergencyAlert.mock.calls[0] as [
      string[],
    ];
    expect(destinataires).toEqual(['medecin']);
    const [notifies] = notifications.createManyNotifications.mock.calls[0] as [
      string[],
    ];
    expect(notifies).toEqual(['medecin']);
  });

  it('transmet une fiche d’urgence réduite et déchiffrée, jamais le profil complet', async () => {
    await service.createUrgence('p1', { latitude: 9.5, longitude: -13.7 });

    const [, alerte] = chatGateway.sendEmergencyAlert.mock.calls[0] as [
      string[],
      { profilMedical: Record<string, unknown> },
    ];
    expect(alerte.profilMedical).toEqual({
      groupeSanguin: 'O_POSITIF',
      allergies: 'Pénicilline',
      pathologies: 'Hypertension',
      traitements: 'Amlodipine',
    });
  });

  it('annonce le nombre d’établissements réellement alertés', async () => {
    const res = await service.createUrgence('p1', {
      latitude: 9.5,
      longitude: -13.7,
    });

    expect(res.data.structuresAlertees).toBe(1);
    expect(res.data.soignantsAlertes).toBe(1);
    expect(res.message).toContain('1 établissement');
    expect(res.data).not.toHaveProperty('patient');
  });

  it('sans position, ne prétend pas avoir alerté et invite à appeler les secours', async () => {
    const res = await service.createUrgence('p1', {});

    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
    expect(res.data.structuresAlertees).toBe(0);
    expect(res.data.positionTransmise).toBe(false);
    expect(res.message).toMatch(/aucun établissement de santé n'a été alerté/);
    expect(res.message).toMatch(/Appelez immédiatement les secours/);
    expect(res.message).not.toMatch(/avec succès/);
  });

  it('avec position mais sans soignant habilité, le dit clairement', async () => {
    permissions.hasPermissions.mockResolvedValue(false);

    const res = await service.createUrgence('p1', {
      latitude: 9.5,
      longitude: -13.7,
    });

    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
    expect(res.data.structuresAlertees).toBe(0);
    expect(res.message).toMatch(/Aucun soignant disponible/);
  });

  describe('compte de démonstration', () => {
    const avecProche = (email: string) =>
      prisma.urgence.create.mockResolvedValue({
        id: 'u1',
        patientId: 'p1',
        createdAt: new Date(),
        patient: {
          nom: 'Diallo',
          prenom: 'Aminata',
          telephone: null,
          email,
          profilMedical: {
            ...profil,
            contactEmail: 'proche@exemple.gn',
            contactTelephone: '+224622112233',
          },
        },
      });

    it('n’envoie ni email ni SMS au proche et le dit au patient', async () => {
      avecProche('aminata.diallo@demo.medconnecte.gn');

      const res = await service.createUrgence('p1', {
        latitude: 9.5,
        longitude: -13.7,
      });

      expect(queue.enqueueEmergencyEmail).not.toHaveBeenCalled();
      expect(queue.enqueueSos).not.toHaveBeenCalled();
      expect(res.data.procheAlerte).toBe(false);
      expect(res.message).toMatch(/votre proche n'a pas été prévenu/);
      // La diffusion interne aux soignants reste active.
      expect(chatGateway.sendEmergencyAlert).toHaveBeenCalledTimes(1);
    });

    it('prévient le proche pour un vrai compte', async () => {
      avecProche('aminata@exemple.gn');

      const res = await service.createUrgence('p1', {
        latitude: 9.5,
        longitude: -13.7,
      });

      expect(queue.enqueueEmergencyEmail).toHaveBeenCalledTimes(1);
      expect(queue.enqueueSos).toHaveBeenCalledTimes(1);
      expect(res.data.procheAlerte).toBe(true);
    });
  });
});
