import { ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CarnetSanteService,
  SOS_ANTI_DOUBLON_MINUTES,
} from './carnet-sante.service';
import {
  TakeChargeUrgenceDto,
  UrgenceStatusEnum,
} from './dto/carnet-sante.dto';

// Argument n° `i` du premier appel d'un mock, typé pour les assertions.
const argument = <T>(mock: jest.Mock, i = 0): T =>
  (mock.mock.calls[0] as unknown[])[i] as T;

/**
 * Alerte SOS : délai d'arrivée annoncé, anti-relance et diffusion ciblée de la prise
 * en charge. Seules les dépendances appelées par createUrgence et takeCharge sont
 * simulées ; les autres restent inertes.
 */
describe('CarnetSanteService - alerte SOS (délai, anti-relance, diffusion)', () => {
  const MINUTE = 60_000;

  let prisma: {
    urgence: Record<string, jest.Mock>;
    structure: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
  };
  let chatGateway: {
    server: { emit: jest.Mock };
    sendEmergencyAlert: jest.Mock;
    sendEmergencyHandled: jest.Mock;
  };
  let notificationsService: Record<string, jest.Mock>;
  let queueService: Record<string, jest.Mock>;
  let service: CarnetSanteService;

  beforeEach(() => {
    prisma = {
      urgence: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'nouvelle',
          patientId: 'p1',
          createdAt: new Date(),
          patient: {
            nom: 'N',
            prenom: 'P',
            telephone: null,
            profilMedical: null,
          },
        }),
        update: jest.fn(),
      },
      structure: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    chatGateway = {
      server: { emit: jest.fn() },
      sendEmergencyAlert: jest.fn(),
      sendEmergencyHandled: jest.fn(),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({}),
      createManyNotifications: jest.fn().mockResolvedValue({}),
    };
    queueService = {
      enqueueEmergencyEmail: jest.fn(),
      enqueueSos: jest.fn(),
    };
    service = new CarnetSanteService(
      prisma as never,
      {} as never, // aiService
      {} as never, // emailService
      chatGateway as never,
      notificationsService as never,
      {} as never, // encryptionService
      {} as never, // smsService
      queueService as never,
      {} as never, // storage
    );
  });

  describe('createUrgence : anti-relance', () => {
    it('refuse si la prise en charge est en cours et le délai non expiré (temps restant indiqué)', async () => {
      prisma.urgence.findFirst.mockResolvedValue({
        id: 'u0',
        status: UrgenceStatusEnum.PRIS_EN_CHARGE,
        createdAt: new Date(Date.now() - 10 * MINUTE),
        priseEnChargeAt: new Date(Date.now() - 8 * MINUTE),
        delaiArriveeMinutes: 15,
        structurePriseEnCharge: { id: 's1', nom: 'Clinique X' },
      });

      const erreur = await service
        .createUrgence('p1', {})
        .catch((e: unknown) => e);

      expect(erreur).toBeInstanceOf(ConflictException);
      const corps = (erreur as ConflictException).getResponse() as {
        message: string;
        peutRelancerA: string;
      };
      expect(typeof corps.message).toBe('string');
      expect(corps.message).toContain('Clinique X');
      expect(corps.message).toContain('environ 7 minutes');
      expect(new Date(corps.peutRelancerA).toISOString()).toBe(
        corps.peutRelancerA,
      );
      expect(prisma.urgence.create).not.toHaveBeenCalled();
    });

    it('accepte une nouvelle alerte si le délai annoncé est expiré', async () => {
      prisma.urgence.findFirst.mockResolvedValue({
        id: 'u0',
        status: UrgenceStatusEnum.PRIS_EN_CHARGE,
        createdAt: new Date(Date.now() - 30 * MINUTE),
        priseEnChargeAt: new Date(Date.now() - 20 * MINUTE),
        delaiArriveeMinutes: 15,
        structurePriseEnCharge: { id: 's1', nom: 'Clinique X' },
      });

      const res = await service.createUrgence('p1', {});

      expect(res.success).toBe(true);
      expect(prisma.urgence.create).toHaveBeenCalledTimes(1);
      expect(prisma.urgence.update).not.toHaveBeenCalled();
    });

    it(`refuse si une alerte a été lancée il y a moins de ${SOS_ANTI_DOUBLON_MINUTES} minutes`, async () => {
      prisma.urgence.findFirst.mockResolvedValue({
        id: 'u0',
        status: UrgenceStatusEnum.LANCE,
        createdAt: new Date(Date.now() - 2 * MINUTE),
        priseEnChargeAt: null,
        delaiArriveeMinutes: null,
        structurePriseEnCharge: null,
      });

      const erreur = await service
        .createUrgence('p1', {})
        .catch((e: unknown) => e);

      expect(erreur).toBeInstanceOf(ConflictException);
      const corps = (erreur as ConflictException).getResponse() as {
        message: string;
      };
      expect(corps.message).toContain('environ 3 minutes');
      expect(prisma.urgence.create).not.toHaveBeenCalled();
    });

    it(`accepte au-delà de ${SOS_ANTI_DOUBLON_MINUTES} minutes après une alerte lancée`, async () => {
      prisma.urgence.findFirst.mockResolvedValue({
        id: 'u0',
        status: UrgenceStatusEnum.LANCE,
        createdAt: new Date(
          Date.now() - (SOS_ANTI_DOUBLON_MINUTES + 1) * MINUTE,
        ),
        priseEnChargeAt: null,
        delaiArriveeMinutes: null,
        structurePriseEnCharge: null,
      });

      const res = await service.createUrgence('p1', {});

      expect(res.success).toBe(true);
      expect(prisma.urgence.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('takeCharge', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'm1',
        nom: 'Diallo',
        prenom: 'Awa',
        structure: { id: 's1', nom: 'Clinique X' },
        administeredStructure: null,
      });
      prisma.urgence.findUnique.mockResolvedValue({
        id: 'u1',
        patientId: 'p1',
        status: UrgenceStatusEnum.LANCE,
        latitude: 9.5,
        longitude: -13.6,
      });
      prisma.urgence.update.mockResolvedValue({
        id: 'u1',
        patientId: 'p1',
        patient: { prenom: 'Fanta' },
      });
      prisma.structure.findMany.mockResolvedValue([
        {
          id: 's2',
          nom: 'Hôpital Y',
          latitude: 9.51,
          longitude: -13.61,
          type: 'HOPITAL',
        },
      ]);
      prisma.user.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    });

    it('enregistre la structure, le soignant, l’heure et le délai de prise en charge', async () => {
      const avant = Date.now();
      await service.takeCharge('u1', 'm1', { delaiArriveeMinutes: 15 });

      const { data } = argument<{
        data: {
          status: string;
          structurePriseEnChargeId: string | null;
          priseEnChargeParId: string;
          delaiArriveeMinutes: number;
          priseEnChargeAt: Date;
        };
      }>(prisma.urgence.update);
      expect(data.status).toBe(UrgenceStatusEnum.PRIS_EN_CHARGE);
      expect(data.structurePriseEnChargeId).toBe('s1');
      expect(data.priseEnChargeParId).toBe('m1');
      expect(data.delaiArriveeMinutes).toBe(15);
      expect(data.priseEnChargeAt).toBeInstanceOf(Date);
      expect(data.priseEnChargeAt.getTime()).toBeGreaterThanOrEqual(avant);

      const notif = argument<{ userId: string; message: string }>(
        notificationsService.createNotification,
      );
      expect(notif.userId).toBe('p1');
      expect(notif.message).toContain('Clinique X');
      expect(notif.message).toContain('environ 15 minutes');
    });

    it('n’émet plus à tout le monde et cible le patient via sendEmergencyHandled', async () => {
      await service.takeCharge('u1', 'm1', { delaiArriveeMinutes: 15 });

      expect(chatGateway.server.emit).not.toHaveBeenCalled();
      expect(chatGateway.sendEmergencyHandled).toHaveBeenCalledTimes(1);
      const destinataires = argument<string[]>(
        chatGateway.sendEmergencyHandled,
        0,
      );
      const payload = argument<{ handledAt: Date; finDelaiAt: Date }>(
        chatGateway.sendEmergencyHandled,
        1,
      );
      expect(destinataires).toEqual(expect.arrayContaining(['p1', 'm1', 'm2']));
      expect(new Set(destinataires).size).toBe(destinataires.length);
      expect(payload).toMatchObject({
        urgenceId: 'u1',
        structureName: 'Clinique X',
        delaiArriveeMinutes: 15,
      });
      expect(payload.finDelaiAt.getTime() - payload.handledAt.getTime()).toBe(
        15 * MINUTE,
      );
    });
  });

  describe('TakeChargeUrgenceDto', () => {
    const erreurs = (valeur: unknown) =>
      validate(
        plainToInstance(TakeChargeUrgenceDto, { delaiArriveeMinutes: valeur }),
      );

    it.each([0, 241])('refuse %p minutes', async (valeur) => {
      expect((await erreurs(valeur)).length).toBeGreaterThan(0);
    });

    it('accepte 15 minutes', async () => {
      expect(await erreurs(15)).toHaveLength(0);
    });
  });
});
