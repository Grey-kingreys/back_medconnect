import type { Logger } from '@nestjs/common';
import { RevocationService } from './revocation.service';

/** Contrôle de révocation : doublures Redis et Prisma, aucune connexion réelle. */
describe('RevocationService', () => {
  let redis: {
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    multi: jest.Mock;
  };
  let multi: { set: jest.Mock; exec: jest.Mock };
  let prisma: {
    session: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let service: RevocationService;

  const vivante = (surcharge: Record<string, unknown> = {}) => ({
    userId: 'u1',
    revokedAt: null,
    revokedReason: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { isActive: true },
    ...surcharge,
  });

  beforeEach(() => {
    multi = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      multi: jest.fn().mockReturnValue(multi),
    };
    prisma = {
      session: { findUnique: jest.fn().mockResolvedValue(vivante()) },
      user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    };
    service = new RevocationService(redis as never, prisma as never);
    const logger = (service as unknown as { logger: Logger }).logger;
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('verifier', () => {
    it('« ok » en cache : null sans lecture Prisma', async () => {
      redis.get.mockResolvedValue('ok');
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBeNull();
      expect(redis.get).toHaveBeenCalledWith('auth:etat:session:s1');
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });

    it('code en cache : renvoyé sans lecture Prisma', async () => {
      redis.get.mockResolvedValue('SESSION_REVOQUEE');
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBe(
        'SESSION_REVOQUEE',
      );
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
    });

    it('clé absente et session valide : lecture Prisma puis set NX 30 s', async () => {
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBeNull();
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(
        'auth:etat:session:s1',
        'ok',
        'EX',
        30,
        'NX',
      );
    });

    it('clé absente et session révoquée : set sans NX, 960 s', async () => {
      prisma.session.findUnique.mockResolvedValue(
        vivante({ revokedAt: new Date(), revokedReason: 'DECONNEXION' }),
      );
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBe(
        'SESSION_REVOQUEE',
      );
      expect(redis.set).toHaveBeenCalledWith(
        'auth:etat:session:s1',
        'SESSION_REVOQUEE',
        'EX',
        960,
      );
    });

    it('révocation pour compte désactivé : COMPTE_DESACTIVE', async () => {
      prisma.session.findUnique.mockResolvedValue(
        vivante({ revokedAt: new Date(), revokedReason: 'COMPTE_DESACTIVE' }),
      );
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBe(
        'COMPTE_DESACTIVE',
      );
    });

    it('session absente ou d’un autre utilisateur : SESSION_EXPIREE', async () => {
      prisma.session.findUnique.mockResolvedValue(vivante({ userId: 'autre' }));
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBe(
        'SESSION_EXPIREE',
      );
      prisma.session.findUnique.mockResolvedValue(null);
      expect(await service.verifier({ userId: 'u1', sid: 's2' })).toBe(
        'SESSION_EXPIREE',
      );
    });

    it('session expirée : SESSION_EXPIREE', async () => {
      prisma.session.findUnique.mockResolvedValue(
        vivante({ expiresAt: new Date(Date.now() - 1000) }),
      );
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBe(
        'SESSION_EXPIREE',
      );
    });

    it('jeton sans sid : contrôle par compte', async () => {
      prisma.user.findUnique.mockResolvedValue({ isActive: false });
      expect(await service.verifier({ userId: 'u1' })).toBe('COMPTE_DESACTIVE');
      expect(redis.get).toHaveBeenCalledWith('auth:etat:compte:u1');
      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      prisma.user.findUnique.mockResolvedValue(null);
      expect(await service.verifier({ userId: 'u1' })).toBe('SESSION_EXPIREE');
    });

    it('get qui rejette : lecture Prisma, aucun set', async () => {
      redis.get.mockRejectedValue(new Error('coupé'));
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBeNull();
      expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('get qui ne répond jamais : résultat de Prisma après le délai', async () => {
      jest.useFakeTimers();
      redis.get.mockReturnValue(new Promise(() => undefined));
      prisma.session.findUnique.mockResolvedValue(
        vivante({ revokedAt: new Date(), revokedReason: 'DECONNEXION' }),
      );
      const attente = service.verifier({ userId: 'u1', sid: 's1' });
      await jest.advanceTimersByTimeAsync(250);
      expect(await attente).toBe('SESSION_REVOQUEE');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('erreur Prisma : remonte', async () => {
      prisma.session.findUnique.mockRejectedValue(new Error('base'));
      await expect(
        service.verifier({ userId: 'u1', sid: 's1' }),
      ).rejects.toThrow('base');
    });

    it('set qui échoue : le résultat est quand même renvoyé', async () => {
      redis.set.mockRejectedValue(new Error('coupé'));
      expect(await service.verifier({ userId: 'u1', sid: 's1' })).toBeNull();
    });
  });

  describe('signaler', () => {
    it('écrit chaque session en 960 s et appelle les diffuseurs', async () => {
      const diffuseur = jest.fn();
      service.enregistrerDiffuseur(diffuseur);
      const evt = {
        userId: 'u1',
        sessionIds: ['a', 'b'],
        code: 'SESSION_REVOQUEE' as const,
      };
      await service.signaler(evt);
      expect(multi.set).toHaveBeenCalledWith(
        'auth:etat:session:a',
        'SESSION_REVOQUEE',
        'EX',
        960,
      );
      expect(multi.set).toHaveBeenCalledWith(
        'auth:etat:session:b',
        'SESSION_REVOQUEE',
        'EX',
        960,
      );
      expect(redis.set).not.toHaveBeenCalled();
      expect(diffuseur).toHaveBeenCalledWith(evt);
    });

    it('COMPTE_DESACTIVE : écrit aussi la clé de compte', async () => {
      await service.signaler({
        userId: 'u1',
        sessionIds: [],
        code: 'COMPTE_DESACTIVE',
      });
      expect(redis.multi).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'auth:etat:compte:u1',
        'COMPTE_DESACTIVE',
        'EX',
        960,
      );
    });

    it('ne lève pas si Redis rejette, et appelle quand même les diffuseurs', async () => {
      multi.exec.mockRejectedValue(new Error('coupé'));
      redis.set.mockRejectedValue(new Error('coupé'));
      const diffuseur = jest.fn();
      service.enregistrerDiffuseur(diffuseur);
      await expect(
        service.signaler({
          userId: 'u1',
          sessionIds: ['a'],
          code: 'COMPTE_DESACTIVE',
        }),
      ).resolves.toBeUndefined();
      expect(diffuseur).toHaveBeenCalledTimes(1);
    });

    it('un diffuseur qui échoue n’empêche pas les suivants', async () => {
      const suivant = jest.fn();
      service.enregistrerDiffuseur(() => {
        throw new Error('boum');
      });
      service.enregistrerDiffuseur(suivant);
      await service.signaler({
        userId: 'u1',
        sessionIds: ['a'],
        code: 'SESSION_REVOQUEE',
      });
      expect(suivant).toHaveBeenCalledTimes(1);
    });
  });

  describe('effacerCompte', () => {
    it('supprime la clé de compte et avale une erreur Redis', async () => {
      await service.effacerCompte('u1');
      expect(redis.del).toHaveBeenCalledWith('auth:etat:compte:u1');
      redis.del.mockRejectedValue(new Error('coupé'));
      await expect(service.effacerCompte('u1')).resolves.toBeUndefined();
    });
  });
});
