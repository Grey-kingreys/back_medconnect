import { Logger } from '@nestjs/common';
import { Prisma } from 'generated/prisma/client';
import { CarnetSanteService } from './carnet-sante.service';
import { messagePositionNonUtilisee } from './sos-position';
import { MESSAGE_SOS_DIFFUSION_EN_COURS } from './sos-idempotence';

/**
 * Qualité de la position et idempotence d'une alerte SOS (TB10b) : la position trop
 * ancienne ou trop imprécise n'est enregistrée mais pas utilisée, une position
 * approximative est signalée, un rejeu (même clé) ne rediffuse rien.
 */
describe('CarnetSanteService : position et idempotence du SOS', () => {
  const CLE = '3f6c2a1e-8b4d-4c7a-9e21-5d0b7f3a6c11';
  const profil = {
    groupeSanguin: 'O_POSITIF',
    allergies: null,
    pathologies: null,
    traitements: null,
    contactNom: 'Ibrahima',
    contactTelephone: null,
    contactEmail: null,
  };
  const position = { latitude: 9.5, longitude: -13.7 };

  let prisma: Record<string, Record<string, jest.Mock>>;
  let chatGateway: { sendEmergencyAlert: jest.Mock };
  let notifications: Record<string, jest.Mock>;
  let queue: { enqueueEmergencyEmail: jest.Mock; enqueueSos: jest.Mock };
  let service: CarnetSanteService;

  const construireService = (profilMedical: Record<string, unknown>) => {
    prisma.urgence.create.mockResolvedValue({
      id: 'u1',
      patientId: 'p1',
      createdAt: new Date(),
      patient: {
        nom: 'Diallo',
        prenom: 'Aminata',
        telephone: null,
        profilMedical,
      },
    });
  };

  const donneesCreees = (): Record<string, unknown> =>
    (
      prisma.urgence.create.mock.calls[0] as [{ data: Record<string, unknown> }]
    )[0].data;

  const alerte = (extra: Record<string, unknown>) => ({
    id: 'ancienne',
    patientId: 'p1',
    cleIdempotence: CLE,
    createdAt: new Date(),
    ...extra,
  });

  beforeEach(() => {
    prisma = {
      urgence: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
      },
      structure: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 's1', nom: 'Donka', latitude: 9.53, longitude: -13.68 },
          ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'medecin' }]) },
    };
    construireService(profil);
    chatGateway = { sendEmergencyAlert: jest.fn() };
    notifications = {
      createNotification: jest.fn().mockResolvedValue({}),
      createManyNotifications: jest.fn().mockResolvedValue({}),
    };
    queue = { enqueueEmergencyEmail: jest.fn(), enqueueSos: jest.fn() };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      chatGateway as never,
      notifications as never,
      { decrypt: (v: string) => v } as never,
      {} as never, // smsService
      queue as never,
      {} as never, // storage
      { hasPermissions: jest.fn().mockResolvedValue(true) } as never,
    );
  });

  it('traite un ancien client (position seule) comme avant', async () => {
    const res = await service.createUrgence('p1', position);

    expect(chatGateway.sendEmergencyAlert).toHaveBeenCalledTimes(1);
    expect(res.data.qualitePosition).toBe('non_qualifiee');
    expect(res.data.positionUtilisee).toBe(true);
    expect(res.data.rejeu).toBe(false);
    expect(prisma.urgence.findUnique).not.toHaveBeenCalled();
    expect(prisma.urgence.update).not.toHaveBeenCalled();
  });

  it('enregistre mais n’utilise pas une position trop imprécise', async () => {
    const res = await service.createUrgence('p1', {
      ...position,
      precision: 3000,
    });

    expect(prisma.structure.findMany).not.toHaveBeenCalled();
    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
    expect(donneesCreees()).toMatchObject({
      precisionMetres: 3000,
      latitude: 9.5,
      longitude: -13.7,
    });
    expect(res.data.positionTransmise).toBe(true);
    expect(res.data.positionUtilisee).toBe(false);
    expect(res.data.qualitePosition).toBe('trop_imprecise');
    expect(res.message).toBe(messagePositionNonUtilisee('trop_imprecise', ''));
  });

  it('n’utilise pas une position de plus de 15 minutes', async () => {
    const res = await service.createUrgence('p1', {
      ...position,
      precision: 20,
      horodatagePosition: new Date(Date.now() - 20 * 60_000).toISOString(),
    });

    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
    expect(res.data.qualitePosition).toBe('trop_ancienne');
    expect(res.message).toContain('plus de 15 minutes');
  });

  it('signale une position approximative aux soignants et au patient', async () => {
    const res = await service.createUrgence('p1', {
      ...position,
      precision: 900,
      horodatagePosition: new Date().toISOString(),
      source: 'gps' as never,
    });

    expect(chatGateway.sendEmergencyAlert).toHaveBeenCalledTimes(1);
    const [, charge] = chatGateway.sendEmergencyAlert.mock.calls[0] as [
      string[],
      Record<string, unknown>,
    ];
    expect(charge).toMatchObject({
      positionApproximative: true,
      precisionMetres: 900,
      avertissementPosition: 'Position approximative, environ 900 m',
    });
    const [, notification] = notifications.createManyNotifications.mock
      .calls[0] as [string[], { message: string }];
    expect(
      notification.message.endsWith('Position approximative, environ 900 m.'),
    ).toBe(true);
    expect(res.message).toContain(
      'Votre position est approximative (environ 900 m)',
    );
    expect(donneesCreees()).toMatchObject({ sourcePosition: 'gps' });
  });

  it('n’envoie le lien de position au proche que si la position sert', async () => {
    construireService({ ...profil, contactTelephone: '+224620000000' });

    await service.createUrgence('p1', { ...position, precision: 3000 });
    expect(queue.enqueueSos).toHaveBeenLastCalledWith(
      expect.objectContaining({ location: undefined }),
    );

    await service.createUrgence('p1', { ...position, precision: 900 });
    const dernier = queue.enqueueSos.mock.calls.at(-1) as [
      { location: string },
    ];
    expect(
      dernier[0].location.startsWith(
        'Position: https://www.google.com/maps?q=',
      ),
    ).toBe(true);
  });

  it('autorise la relance si la position de la dernière alerte n’a pas servi', async () => {
    const recente = (precisionMetres: number) => ({
      id: 'avant',
      status: 'LANCE',
      createdAt: new Date(Date.now() - 60_000),
      priseEnChargeAt: null,
      delaiArriveeMinutes: null,
      ...position,
      precisionMetres,
    });

    prisma.urgence.findFirst.mockResolvedValue(recente(3000));
    await service.createUrgence('p1', position);
    expect(prisma.urgence.create).toHaveBeenCalledTimes(1);

    prisma.urgence.findFirst.mockResolvedValue(recente(100));
    await expect(service.createUrgence('p1', position)).rejects.toMatchObject({
      response: { code: 'SOS_DEJA_ACTIF' },
    });
    expect(prisma.urgence.create).toHaveBeenCalledTimes(1);
  });

  it('rejoue la même réponse sans rien rediffuser', async () => {
    const message =
      'Alerte envoyée à 1 établissement de santé proche. Restez calme, un soignant va prendre en charge votre alerte.';
    prisma.urgence.findUnique.mockResolvedValue(
      alerte({
        createdAt: new Date(Date.now() - 3_600_000),
        bilanDiffusion: {
          structuresAlertees: 1,
          soignantsAlertes: 1,
          procheAlerte: false,
          positionTransmise: true,
          positionUtilisee: true,
          qualitePosition: 'non_qualifiee',
          precisionMetres: null,
          message,
        },
      }),
    );

    const res = await service.createUrgence('p1', position, CLE);

    expect(res.data.id).toBe('ancienne');
    expect(res.data.rejeu).toBe(true);
    expect(res.message).toBe(message);
    expect(res.data).not.toHaveProperty('cleIdempotence');
    expect(res.data).not.toHaveProperty('bilanDiffusion');
    expect(prisma.urgence.create).not.toHaveBeenCalled();
    expect(prisma.urgence.findFirst).not.toHaveBeenCalled();
    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
    expect(notifications.createManyNotifications).not.toHaveBeenCalled();
    expect(queue.enqueueSos).not.toHaveBeenCalled();
    expect(queue.enqueueEmergencyEmail).not.toHaveBeenCalled();
  });

  it('libère une clé réutilisée après 24 h', async () => {
    prisma.urgence.findUnique.mockResolvedValue(
      alerte({ createdAt: new Date(Date.now() - 25 * 3_600_000) }),
    );

    await service.createUrgence('p1', position, CLE);

    expect(prisma.urgence.update).toHaveBeenCalledWith({
      where: { id: 'ancienne' },
      data: { cleIdempotence: null },
    });
    expect(donneesCreees()).toMatchObject({ cleIdempotence: CLE });
  });

  it('enregistre la clé et le bilan d’une nouvelle alerte', async () => {
    const res = await service.createUrgence('p1', position, CLE);

    expect(donneesCreees()).toMatchObject({ cleIdempotence: CLE });
    const appel = prisma.urgence.update.mock.calls[0] as [
      { data: { bilanDiffusion: { message: string } } },
    ];
    expect(appel[0].data.bilanDiffusion.message).toBe(res.message);
  });

  it('répond « en cours d’envoi » à un rejeu concurrent', async () => {
    prisma.urgence.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on (patientId,cleIdempotence)',
        { code: 'P2002', clientVersion: '7.0.0' },
      ),
    );
    prisma.urgence.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(alerte({}));

    const res = await service.createUrgence('p1', position, CLE);

    expect(res.data.diffusionEnCours).toBe(true);
    expect(res.data.rejeu).toBe(true);
    expect(res.message).toBe(MESSAGE_SOS_DIFFUSION_EN_COURS);
    expect(chatGateway.sendEmergencyAlert).not.toHaveBeenCalled();
  });

  it('ignore un en-tête mal formé', async () => {
    await service.createUrgence('p1', position, 'abc');

    expect(prisma.urgence.findUnique).not.toHaveBeenCalled();
    const appel = prisma.urgence.create.mock.calls[0] as [
      { data: { cleIdempotence?: string } },
    ];
    expect(appel[0].data.cleIdempotence).toBeUndefined();
  });

  describe('journaux', () => {
    const espions: jest.SpyInstance[] = [];
    afterEach(() => {
      espions.splice(0).forEach((e) => e.mockRestore());
    });

    it('ne contient aucune coordonnée', async () => {
      for (const niveau of ['log', 'warn', 'error', 'debug'] as const) {
        espions.push(
          jest.spyOn(Logger.prototype, niveau).mockImplementation(() => {}),
        );
      }

      await service.createUrgence(
        'p1',
        {
          latitude: 9.51234,
          longitude: -13.74567,
          precision: 900,
        },
        CLE,
      );

      const lignes = espions
        .flatMap((e) => e.mock.calls as unknown[][])
        .map((appel) => JSON.stringify(appel));
      expect(lignes.length).toBeGreaterThan(0);
      for (const ligne of lignes) {
        expect(ligne).not.toContain('9.51234');
        expect(ligne).not.toContain('13.74567');
      }
    });
  });
});
