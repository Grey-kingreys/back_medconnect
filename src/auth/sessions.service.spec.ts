/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- les calls des doublures jest.Mock sont typés any */
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { SessionClientType } from 'generated/prisma/enums';
import {
  DUREE_SESSION_COURTE_MS,
  DUREE_SESSION_LONGUE_MS,
  GRACE_REFRESH_MS,
  PURGE_GRACE_MS,
  dureeSession,
  estSessionsMultiAppareilsActif,
} from './sessions.constants';
import { SessionsService } from './sessions.service';

/**
 * Tests unitaires de SessionsService : aucune base, doublures jest, horloge simulée.
 */
describe('SessionsService', () => {
  const sha256 = (v: string) =>
    crypto.createHash('sha256').update(v).digest('hex');
  const ID = '11111111-2222-3333-4444-555555555555';
  const SECRET = 'a'.repeat(64);
  const MAINTENANT = new Date('2026-10-20T10:00:00.000Z');

  let prisma: {
    session: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    user: { update: jest.Mock; findFirst: jest.Mock };
  };
  let jwtService: { sign: jest.Mock };
  let encryption: { encrypt: jest.Mock; decrypt: jest.Mock };
  let service: SessionsService;

  beforeAll(() => {
    process.env.JWT_SECRET = 'secret-de-test';
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(MAINTENANT);
    prisma = {
      session: {
        create: jest.fn().mockResolvedValue({ id: ID }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn(),
      },
    };
    jwtService = { sign: jest.fn().mockReturnValue('jwt-de-test') };
    encryption = {
      encrypt: jest.fn((v: string) => `chiffre:${v}`),
      decrypt: jest.fn((v: string) => v.replace(/^chiffre:/, '')),
    };
    service = new SessionsService(
      prisma as never,
      jwtService as never,
      encryption as never,
    );
    logWarn = jest
      .spyOn(
        (service as unknown as { logger: { warn: () => void } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
  });

  let logWarn: jest.SpyInstance;

  afterEach(() => {
    delete process.env.SESSIONS_MULTI_APPAREILS;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const session = (surcharge: Record<string, unknown> = {}) => ({
    id: ID,
    userId: 'u1',
    clientType: 'WEB',
    refreshHash: sha256(SECRET),
    previousRefreshHash: null,
    graceUntil: null,
    graceSecretEnc: null,
    expiresAt: new Date(MAINTENANT.getTime() + DUREE_SESSION_LONGUE_MS),
    revokedAt: null,
    user: { id: 'u1', role: 'MEDECIN', structureId: 's1', isActive: true },
    ...surcharge,
  });

  const attendreErreur = async (
    promesse: Promise<unknown>,
    code: string,
  ): Promise<void> => {
    let attrapee: unknown;
    try {
      await promesse;
    } catch (e) {
      attrapee = e;
    }
    expect(attrapee).toBeInstanceOf(UnauthorizedException);
    expect((attrapee as UnauthorizedException).getResponse()).toMatchObject({
      code,
    });
  };

  describe('ouvrir', () => {
    it('web : enregistre le hash du secret, sans champs appareil', async () => {
      const r = await service.ouvrir(
        { id: 'u1', role: 'MEDECIN', structureId: 's1' },
        { type: SessionClientType.WEB, deviceId: 'ignore' },
      );
      const data = prisma.session.create.mock.calls[0][0].data;
      expect(data.clientType).toBe('WEB');
      expect(data.platform).toBeNull();
      expect(data.deviceId).toBeNull();
      expect(data.deviceName).toBeNull();
      expect(data.appVersion).toBeNull();
      expect(r.refreshToken).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
      const secret = r.refreshToken.split('.')[1];
      expect(data.refreshHash).toBe(sha256(secret));
      expect(data.refreshHash).not.toBe(secret);
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sid: ID, userId: 'u1', structureId: 's1' }),
        expect.objectContaining({ expiresIn: '15m' }),
      );
      expect(r.dureeMs).toBe(DUREE_SESSION_LONGUE_MS);
      expect(r.sessionId).toBe(ID);
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('mobile patient : enregistre l’appareil et révoque la session du même appareil', async () => {
      const r = await service.ouvrir(
        { id: 'u1', role: 'PATIENT' },
        {
          type: SessionClientType.MOBILE,
          deviceId: 'appareil-12345',
          plateforme: 'android',
          nomAppareil: 'Pixel',
          versionApp: '1.0.0',
        },
      );
      const data = prisma.session.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        clientType: 'MOBILE',
        platform: 'android',
        deviceId: 'appareil-12345',
        deviceName: 'Pixel',
        appVersion: '1.0.0',
      });
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', deviceId: 'appareil-12345', revokedAt: null },
        data: {
          revokedAt: MAINTENANT,
          revokedReason: 'NOUVELLE_CONNEXION',
          graceSecretEnc: null,
          graceUntil: null,
        },
      });
      expect(r.dureeMs).toBe(DUREE_SESSION_LONGUE_MS);
    });

    it('mobile médecin : session de 12 h', async () => {
      const r = await service.ouvrir(
        { id: 'u1', role: 'MEDECIN' },
        { type: SessionClientType.MOBILE, deviceId: 'appareil-12345' },
      );
      expect(r.dureeMs).toBe(DUREE_SESSION_COURTE_MS);
      expect(prisma.session.create.mock.calls[0][0].data.expiresAt).toEqual(
        new Date(MAINTENANT.getTime() + DUREE_SESSION_COURTE_MS),
      );
    });
  });

  describe('renouveler', () => {
    const refresh = `${ID}.${SECRET}`;

    it('rotation nominale avec fenêtre de grâce', async () => {
      prisma.session.findUnique.mockResolvedValue(session());
      const r = await service.renouveler(refresh, SessionClientType.WEB);
      const appel = prisma.session.updateMany.mock.calls[0][0];
      const nouveau = r.refreshToken.split('.')[1];
      expect(appel.where).toEqual({
        id: ID,
        refreshHash: sha256(SECRET),
        revokedAt: null,
      });
      expect(appel.data.previousRefreshHash).toBe(sha256(SECRET));
      expect(appel.data.refreshHash).toBe(sha256(nouveau));
      expect(appel.data.graceUntil).toEqual(
        new Date(MAINTENANT.getTime() + GRACE_REFRESH_MS),
      );
      expect(appel.data.graceSecretEnc).toBe(`chiffre:${nouveau}`);
      expect(appel.data.expiresAt).toEqual(
        new Date(MAINTENANT.getTime() + DUREE_SESSION_LONGUE_MS),
      );
      expect(r.refreshToken).not.toBe(refresh);
      expect(r.refreshToken.startsWith(`${ID}.`)).toBe(true);
    });

    it('deux refresh simultanés réussissent avec le même refresh', async () => {
      const nouveau = 'b'.repeat(64);
      const tournee: Record<string, unknown> = session({
        refreshHash: sha256(nouveau),
        previousRefreshHash: sha256(SECRET),
        graceUntil: new Date(MAINTENANT.getTime() + GRACE_REFRESH_MS),
        graceSecretEnc: `chiffre:${nouveau}`,
      });
      prisma.session.findUnique
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce(session())
        .mockResolvedValueOnce(tournee);
      prisma.session.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      const premier = await service.renouveler(refresh, SessionClientType.WEB);
      // Le premier appel a tourné vers un secret aléatoire ; on aligne la base sur lui.
      const secretPremier = premier.refreshToken.split('.')[1];
      tournee.refreshHash = sha256(secretPremier);
      tournee.graceSecretEnc = `chiffre:${secretPremier}`;
      const second = await service.renouveler(refresh, SessionClientType.WEB);
      expect(second.refreshToken).toBe(premier.refreshToken);
    });

    it('réponse perdue : ancien refresh rejoué 10 s après, sans révocation', async () => {
      const courant = 'c'.repeat(64);
      jest.setSystemTime(new Date(MAINTENANT.getTime() + 10_000));
      prisma.session.findUnique.mockResolvedValue(
        session({
          refreshHash: sha256(courant),
          previousRefreshHash: sha256(SECRET),
          graceUntil: new Date(MAINTENANT.getTime() + GRACE_REFRESH_MS),
          graceSecretEnc: `chiffre:${courant}`,
        }),
      );
      const r = await service.renouveler(refresh, SessionClientType.WEB);
      expect(r.refreshToken).toBe(`${ID}.${courant}`);
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
      expect(prisma.session.update).toHaveBeenCalledTimes(1);
      expect(prisma.session.update.mock.calls[0][0].data).not.toHaveProperty(
        'revokedAt',
      );
    });

    it('réutilisation hors grâce : session révoquée, REFRESH_REUTILISE', async () => {
      const courant = 'c'.repeat(64);
      jest.setSystemTime(new Date(MAINTENANT.getTime() + 31_000));
      prisma.session.findUnique.mockResolvedValue(
        session({
          refreshHash: sha256(courant),
          previousRefreshHash: sha256(SECRET),
          graceUntil: new Date(MAINTENANT.getTime() + GRACE_REFRESH_MS),
          graceSecretEnc: `chiffre:${courant}`,
        }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'REFRESH_REUTILISE',
      );
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: ID },
        data: expect.objectContaining({
          revokedReason: 'REUTILISATION',
          graceSecretEnc: null,
          graceUntil: null,
        }),
      });
      expect(logWarn).toHaveBeenCalled();
      expect(JSON.stringify(logWarn.mock.calls)).not.toContain(SECRET);
    });

    it('secret inconnu sur une session vivante : même révocation', async () => {
      prisma.session.findUnique.mockResolvedValue(
        session({ refreshHash: sha256('d'.repeat(64)) }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'REFRESH_REUTILISE',
      );
      expect(prisma.session.update.mock.calls[0][0].data.revokedReason).toBe(
        'REUTILISATION',
      );
    });

    it('format invalide : SESSION_EXPIREE sans lecture en base', async () => {
      await attendreErreur(
        service.renouveler('nimporte-quoi', SessionClientType.WEB),
        'SESSION_EXPIREE',
      );
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });

    it('session absente : SESSION_EXPIREE', async () => {
      prisma.session.findUnique.mockResolvedValue(null);
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'SESSION_EXPIREE',
      );
    });

    it('session révoquée : SESSION_REVOQUEE', async () => {
      prisma.session.findUnique.mockResolvedValue(
        session({ revokedAt: MAINTENANT }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'SESSION_REVOQUEE',
      );
    });

    it('session expirée : SESSION_EXPIREE', async () => {
      prisma.session.findUnique.mockResolvedValue(
        session({ expiresAt: new Date(MAINTENANT.getTime() - 1) }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'SESSION_EXPIREE',
      );
    });

    it('compte désactivé : COMPTE_DESACTIVE', async () => {
      prisma.session.findUnique.mockResolvedValue(
        session({
          user: {
            id: 'u1',
            role: 'MEDECIN',
            structureId: null,
            isActive: false,
          },
        }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'COMPTE_DESACTIVE',
      );
    });

    it('session web présentée en mobile : SESSION_EXPIREE sans révocation', async () => {
      prisma.session.findUnique.mockResolvedValue(session());
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.MOBILE),
        'SESSION_EXPIREE',
      );
      expect(prisma.session.update).not.toHaveBeenCalled();
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('grâce avec secret chiffré illisible : SESSION_EXPIREE', async () => {
      encryption.decrypt.mockReturnValue(' [Donnée illisible] ');
      prisma.session.findUnique.mockResolvedValue(
        session({
          refreshHash: sha256('c'.repeat(64)),
          previousRefreshHash: sha256(SECRET),
          graceUntil: new Date(MAINTENANT.getTime() + GRACE_REFRESH_MS),
          graceSecretEnc: 'chiffre:abc',
        }),
      );
      await attendreErreur(
        service.renouveler(refresh, SessionClientType.WEB),
        'SESSION_EXPIREE',
      );
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('web et mobile du même utilisateur se renouvellent 24 h plus tard', async () => {
      const idMobile = '99999999-2222-3333-4444-555555555555';
      const secretMobile = 'e'.repeat(64);
      const web = session();
      const mobile = session({
        id: idMobile,
        clientType: 'MOBILE',
        refreshHash: sha256(secretMobile),
        user: { id: 'u1', role: 'PATIENT', structureId: null, isActive: true },
      });
      prisma.session.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === ID ? web : mobile),
      );
      await service.ouvrir(
        { id: 'u1', role: 'PATIENT' },
        { type: SessionClientType.MOBILE, deviceId: 'appareil-12345' },
      );
      // La révocation à l'ouverture ne vise que le deviceId de l'appareil.
      expect(prisma.session.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'u1',
        deviceId: 'appareil-12345',
        revokedAt: null,
      });
      jest.setSystemTime(new Date(MAINTENANT.getTime() + 24 * 3600 * 1000));
      const rw = await service.renouveler(
        `${ID}.${SECRET}`,
        SessionClientType.WEB,
      );
      const rm = await service.renouveler(
        `${idMobile}.${secretMobile}`,
        SessionClientType.MOBILE,
      );
      expect(rw.sessionId).toBe(ID);
      expect(rm.sessionId).toBe(idMobile);
    });
  });

  describe('fermer', () => {
    const refresh = `${ID}.${SECRET}`;
    const brute = (surcharge: Record<string, unknown> = {}) => {
      const { user, ...reste } = session(surcharge);
      void user;
      return reste;
    };

    it('par refresh valide : révocation DECONNEXION', async () => {
      prisma.session.findUnique.mockResolvedValue(brute());
      await service.fermer({ refresh });
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { id: ID, revokedAt: null },
        data: {
          revokedAt: MAINTENANT,
          revokedReason: 'DECONNEXION',
          graceSecretEnc: null,
          graceUntil: null,
        },
      });
    });

    it('par sid et userId concordants', async () => {
      prisma.session.findUnique.mockResolvedValue(brute());
      await service.fermer({ sid: ID, userId: 'u1' });
      expect(prisma.session.updateMany).toHaveBeenCalledTimes(1);
    });

    it("sid d'un autre utilisateur : rien n'est révoqué", async () => {
      prisma.session.findUnique.mockResolvedValue(brute({ userId: 'autre' }));
      await service.fermer({ sid: ID, userId: 'u1' });
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('refresh inconnu : ne lève rien et ne révoque rien', async () => {
      prisma.session.findUnique.mockResolvedValue(
        brute({ refreshHash: sha256('d'.repeat(64)) }),
      );
      await expect(service.fermer({ refresh })).resolves.toBeUndefined();
      await expect(
        service.fermer({ refresh: 'invalide' }),
      ).resolves.toBeUndefined();
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('purge des secrets de grâce (D20)', () => {
    it('purgerSecretsDeGrace efface les secrets échus et renvoie le nombre', async () => {
      prisma.session.updateMany.mockResolvedValue({ count: 3 });

      const n = await service.purgerSecretsDeGrace();

      expect(n).toBe(3);
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: {
          graceSecretEnc: { not: null },
          graceUntil: { lt: expect.any(Date) },
        },
        data: { graceSecretEnc: null },
      });
    });

    it('onModuleInit avec le drapeau à false : aucun minuteur', () => {
      process.env.SESSIONS_MULTI_APPAREILS = 'false';
      const purge = jest.spyOn(service, 'purgerSecretsDeGrace');

      service.onModuleInit();
      jest.advanceTimersByTime(PURGE_GRACE_MS * 2);

      expect(purge).not.toHaveBeenCalled();
    });

    it('onModuleInit actif : purge après 60 s, onModuleDestroy arrête le minuteur', () => {
      const purge = jest
        .spyOn(service, 'purgerSecretsDeGrace')
        .mockResolvedValue(0);

      service.onModuleInit();
      jest.advanceTimersByTime(PURGE_GRACE_MS);
      expect(purge).toHaveBeenCalledTimes(1);

      service.onModuleDestroy();
      jest.advanceTimersByTime(PURGE_GRACE_MS * 3);
      expect(purge).toHaveBeenCalledTimes(1);
    });
  });

  describe('drapeau SESSIONS_MULTI_APPAREILS=false', () => {
    beforeEach(() => {
      process.env.SESSIONS_MULTI_APPAREILS = 'false';
    });

    it('ouvrir écrit User.refreshToken sans toucher aux sessions', async () => {
      const r = await service.ouvrir(
        { id: 'u1', role: 'MEDECIN' },
        { type: SessionClientType.WEB },
      );
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.refreshToken).toBe(sha256(r.refreshToken));
      expect(r.sessionId).toBeNull();
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(prisma.session.updateMany).not.toHaveBeenCalled();
    });

    it('renouveler passe par user.findFirst', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1',
        role: 'MEDECIN',
        structureId: null,
      });
      const r = await service.renouveler('ancien', SessionClientType.WEB);
      expect(prisma.user.findFirst).toHaveBeenCalled();
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(r.sessionId).toBeNull();
    });

    it('renouveler sans utilisateur : SESSION_EXPIREE', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await attendreErreur(
        service.renouveler('ancien', SessionClientType.WEB),
        'SESSION_EXPIREE',
      );
    });
  });

  describe('constantes', () => {
    it('estSessionsMultiAppareilsActif', () => {
      expect(estSessionsMultiAppareilsActif(undefined)).toBe(true);
      expect(estSessionsMultiAppareilsActif('true')).toBe(true);
      expect(estSessionsMultiAppareilsActif('false')).toBe(false);
      expect(estSessionsMultiAppareilsActif(' FALSE ')).toBe(false);
    });

    it('dureeSession', () => {
      expect(dureeSession(SessionClientType.WEB, 'MEDECIN')).toBe(
        DUREE_SESSION_LONGUE_MS,
      );
      expect(dureeSession(SessionClientType.MOBILE, 'PATIENT')).toBe(
        DUREE_SESSION_LONGUE_MS,
      );
      expect(dureeSession(SessionClientType.MOBILE, 'MEDECIN')).toBe(
        DUREE_SESSION_COURTE_MS,
      );
    });
  });
});
