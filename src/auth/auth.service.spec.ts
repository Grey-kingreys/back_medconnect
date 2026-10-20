/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- les calls des doublures jest.Mock sont typés any */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';

/**
 * Tests unitaires de AuthService (comportement actuel).
 *
 * Aucune base, aucun réseau, aucun module Nest : le service est instancié
 * directement avec des doublures. bcrypt est réel (hash de test à coût faible).
 */
describe('AuthService', () => {
  const sha256 = (v: string) =>
    crypto.createHash('sha256').update(v).digest('hex');

  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let jwtService: { sign: jest.Mock; verifyAsync: jest.Mock };
  let emailService: {
    sendSuspiciousLoginEmail: jest.Mock;
    sendWelcomeEmail: jest.Mock;
    sendPasswordResetEmail: jest.Mock;
  };
  let loginThrottle: {
    guard: jest.Mock;
    registerFailure: jest.Mock;
    reset: jest.Mock;
  };
  let rolesService: { resolveAssignableRoleId: jest.Mock };
  let sessions: {
    ouvrir: jest.Mock;
    poserCookie: jest.Mock;
    effacerCookie: jest.Mock;
    renouveler: jest.Mock;
    fermer: jest.Mock;
    revoquerAutres: jest.Mock;
    revoquerToutes: jest.Mock;
  };
  const WEB = { type: 'WEB' } as never;
  const MOBILE = {
    type: 'MOBILE',
    deviceId: 'appareil-test-1',
    plateforme: 'android',
  } as never;
  let service: AuthService;
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  const MOT_DE_PASSE = 'MotDePasse-de-test-1';
  let hashValide: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'secret-de-test';
    hashValide = await bcrypt.hash(MOT_DE_PASSE, 4);
  });

  const utilisateur = (surcharge: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'awa@example.com',
    nom: 'Diallo',
    prenom: 'Awa',
    password: hashValide,
    role: 'MEDECIN',
    isActive: true,
    structureId: 's1',
    dateNaissance: null,
    taille: null,
    poids: null,
    ...surcharge,
  });

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('jwt-de-test'),
      verifyAsync: jest.fn(),
    };
    emailService = {
      sendSuspiciousLoginEmail: jest.fn().mockResolvedValue(undefined),
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
      sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    };
    loginThrottle = {
      guard: jest.fn().mockResolvedValue(undefined),
      registerFailure: jest.fn().mockResolvedValue(false),
      reset: jest.fn().mockResolvedValue(undefined),
    };
    rolesService = {
      resolveAssignableRoleId: jest.fn().mockResolvedValue('role-1'),
    };
    sessions = {
      ouvrir: jest.fn().mockResolvedValue({
        access_token: 'jwt-de-test',
        refreshToken: 'sid-1.' + 'a'.repeat(64),
        expiresIn: 900,
        sessionId: 'sid-1',
        dureeMs: 30 * 24 * 3600 * 1000,
      }),
      poserCookie: jest.fn(),
      effacerCookie: jest.fn(),
      renouveler: jest.fn(),
      fermer: jest.fn(),
      revoquerAutres: jest.fn().mockResolvedValue(2),
      revoquerToutes: jest.fn().mockResolvedValue(2),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    service = new AuthService(
      prisma as never,
      jwtService as never,
      emailService as never,
      loginThrottle as never,
      rolesService as never,
      {} as never, // permissionsService
      sessions as never,
    );
  });

  describe('login', () => {
    const dto = { email: 'Awa@Example.com', password: MOT_DE_PASSE };

    it('refuse un email inconnu et compte l échec', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(dto, res as never, '1.2.3.4', WEB),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(loginThrottle.guard).toHaveBeenCalledWith(
        dto.email,
        '1.2.3.4',
        res,
      );
      expect(loginThrottle.registerFailure).toHaveBeenCalledWith(
        dto.email,
        '1.2.3.4',
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('refuse un mauvais mot de passe et compte l échec', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      await expect(
        service.login(
          { ...dto, password: 'faux' },
          res as never,
          '1.2.3.4',
          WEB,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(loginThrottle.registerFailure).toHaveBeenCalledTimes(1);
      expect(loginThrottle.reset).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('envoie l email d alerte seulement quand le blocage dur vient de s activer', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());
      loginThrottle.registerFailure.mockResolvedValue(true);

      await expect(
        service.login(
          { ...dto, password: 'faux' },
          res as never,
          '1.2.3.4',
          WEB,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(emailService.sendSuspiciousLoginEmail).toHaveBeenCalledWith(
        'awa@example.com',
        'Diallo',
        'Awa',
        '1.2.3.4',
      );
    });

    it('refuse un compte désactivé sans compter d échec anti-brute-force', async () => {
      prisma.user.findUnique.mockResolvedValue(
        utilisateur({ isActive: false }),
      );

      await expect(
        service.login(dto, res as never, '1.2.3.4', WEB),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Comportement actuel : un compte désactivé n'incrémente pas le compteur d'échecs.
      expect(loginThrottle.registerFailure).not.toHaveBeenCalled();
    });

    it('propage le refus du service anti-brute-force avant toute lecture en base', async () => {
      const blocage = new Error('bloqué');
      loginThrottle.guard.mockRejectedValue(blocage);

      await expect(
        service.login(dto, res as never, '1.2.3.4', WEB),
      ).rejects.toBe(blocage);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('réussit : session web, cookie de refresh, remise à zéro du compteur', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      const out = await service.login(dto, res as never, '1.2.3.4', WEB);

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'awa@example.com' } }),
      );
      expect(loginThrottle.reset).toHaveBeenCalledWith(dto.email, '1.2.3.4');
      expect(out.success).toBe(true);
      expect(out.data.access_token).toBe('jwt-de-test');
      expect(out.data.user).toMatchObject({
        id: 'u1',
        role: 'MEDECIN',
        structureId: 's1',
      });

      expect(sessions.ouvrir).toHaveBeenCalledWith(
        { id: 'u1', role: 'MEDECIN', structureId: 's1' },
        { type: 'WEB' },
      );
      expect(sessions.poserCookie).toHaveBeenCalledWith(
        res,
        'sid-1.' + 'a'.repeat(64),
        30 * 24 * 3600 * 1000,
      );

      // Le refresh token n'est jamais dans le JSON web et plus écrit dans User.
      expect(out.data).not.toHaveProperty('refreshToken');
      expect(out.data).not.toHaveProperty('sessionId');
      expect(JSON.stringify(out)).not.toContain('a'.repeat(64));
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('mobile : refresh et sessionId dans le JSON, aucun cookie', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      const out = await service.login(dto, res as never, '1.2.3.4', MOBILE);

      expect(sessions.ouvrir).toHaveBeenCalledWith(
        { id: 'u1', role: 'MEDECIN', structureId: 's1' },
        MOBILE,
      );
      expect(sessions.poserCookie).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(out.data).toMatchObject({
        access_token: 'jwt-de-test',
        refreshToken: 'sid-1.' + 'a'.repeat(64),
        expiresIn: 900,
        sessionId: 'sid-1',
      });
      expect(out.data.user).toMatchObject({ id: 'u1' });
    });
  });

  describe('register', () => {
    const dto = {
      nom: ' Barry ',
      prenom: ' Mamadou ',
      email: 'Mamadou@Example.com',
      password: 'MotDePasse-de-test-2',
    };

    it('refuse un email déjà pris', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existant' });

      await expect(
        service.register(dto as never, res as never, WEB),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('crée un patient actif avec mot de passe haché', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u2',
        email: 'mamadou@example.com',
        nom: 'Barry',
        prenom: 'Mamadou',
        role: 'PATIENT',
        createdAt: new Date(),
      });

      const out = await service.register(dto as never, res as never, WEB);

      const { data } = prisma.user.create.mock.calls[0][0];
      expect(data.role).toBe('PATIENT');
      expect(data.isActive).toBe(true);
      expect(data.email).toBe('mamadou@example.com');
      expect(data.nom).toBe('Barry');
      expect(data.appRoleId).toBe('role-1');
      expect(data.password).not.toBe(dto.password);
      expect(await bcrypt.compare(dto.password, data.password)).toBe(true);

      expect(out.success).toBe(true);
      expect(out.data.user.role).toBe('PATIENT');
      expect(sessions.ouvrir).toHaveBeenCalledWith(
        { id: 'u2', role: 'PATIENT', structureId: null },
        { type: 'WEB' },
      );
      expect(sessions.poserCookie).toHaveBeenCalledTimes(1);
      expect(out.data).not.toHaveProperty('refreshToken');
      expect(out.data).not.toHaveProperty('sessionId');
      expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
        'mamadou@example.com',
        'Barry',
        'Mamadou',
      );
    });

    it('crée le compte même si la résolution du rôle applicatif échoue', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      rolesService.resolveAssignableRoleId.mockRejectedValue(
        new Error('indisponible'),
      );
      prisma.user.create.mockResolvedValue({
        id: 'u2',
        email: 'mamadou@example.com',
        nom: 'Barry',
        prenom: 'Mamadou',
        role: 'PATIENT',
        createdAt: new Date(),
      });

      await service.register(dto as never, res as never, WEB);

      // Comportement actuel : appRoleId vaut undefined, un backfill rattrape plus tard.
      expect(
        prisma.user.create.mock.calls[0][0].data.appRoleId,
      ).toBeUndefined();
    });
  });

  describe('register mobile', () => {
    it('refresh et sessionId dans le JSON, aucun cookie', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'u2',
        email: 'mamadou@example.com',
        nom: 'Barry',
        prenom: 'Mamadou',
        role: 'PATIENT',
        createdAt: new Date(),
      });

      const out = await service.register(
        {
          nom: 'Barry',
          prenom: 'Mamadou',
          email: 'mamadou@example.com',
          password: 'MotDePasse-de-test-2',
        } as never,
        res as never,
        MOBILE,
      );

      expect(sessions.poserCookie).not.toHaveBeenCalled();
      expect(out.data).toMatchObject({
        access_token: 'jwt-de-test',
        refreshToken: 'sid-1.' + 'a'.repeat(64),
        expiresIn: 900,
        sessionId: 'sid-1',
      });
      expect(out.data.user).toMatchObject({ id: 'u2', role: 'PATIENT' });
    });
  });

  describe('refreshAccessToken', () => {
    const jetons = {
      access_token: 'jwt-renouvele',
      refreshToken: 'sid-1.' + 'b'.repeat(64),
      expiresIn: 900,
      sessionId: 'sid-1',
      dureeMs: 30 * 24 * 3600 * 1000,
    };

    it('refresh absent : 401 SESSION_EXPIREE, cookie effacé en web', async () => {
      let erreur: unknown;
      try {
        await service.refreshAccessToken(
          undefined,
          res as never,
          'WEB' as never,
        );
      } catch (e) {
        erreur = e;
      }
      expect(erreur).toBeInstanceOf(UnauthorizedException);
      expect((erreur as UnauthorizedException).getResponse()).toMatchObject({
        code: 'SESSION_EXPIREE',
      });
      expect(sessions.effacerCookie).toHaveBeenCalledWith(res);
      expect(sessions.renouveler).not.toHaveBeenCalled();
    });

    it('refresh absent en mobile : 401 sans toucher au cookie', async () => {
      await expect(
        service.refreshAccessToken(undefined, res as never, 'MOBILE' as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessions.effacerCookie).not.toHaveBeenCalled();
    });

    it('web : cookie posé, data ne contient que access_token', async () => {
      sessions.renouveler.mockResolvedValue(jetons);

      const out = await service.refreshAccessToken(
        'ancien',
        res as never,
        'WEB' as never,
      );

      expect(sessions.renouveler).toHaveBeenCalledWith('ancien', 'WEB');
      expect(sessions.poserCookie).toHaveBeenCalledWith(
        res,
        jetons.refreshToken,
        jetons.dureeMs,
      );
      expect(out.data).toEqual({ access_token: 'jwt-renouvele' });
      expect(JSON.stringify(out)).not.toContain('b'.repeat(64));
    });

    it('mobile : refresh, expiresIn et sessionId dans le JSON, aucun cookie', async () => {
      sessions.renouveler.mockResolvedValue(jetons);

      const out = await service.refreshAccessToken(
        'ancien',
        res as never,
        'MOBILE' as never,
      );

      expect(sessions.renouveler).toHaveBeenCalledWith('ancien', 'MOBILE');
      expect(out.data).toEqual({
        access_token: 'jwt-renouvele',
        refreshToken: jetons.refreshToken,
        expiresIn: 900,
        sessionId: 'sid-1',
      });
      expect(sessions.poserCookie).not.toHaveBeenCalled();
      expect(sessions.effacerCookie).not.toHaveBeenCalled();
    });

    it('échec de renouveler en web : cookie effacé, erreur propagée telle quelle', async () => {
      const refus = new UnauthorizedException({
        message: 'réutilisé',
        code: 'REFRESH_REUTILISE',
      });
      sessions.renouveler.mockRejectedValue(refus);

      await expect(
        service.refreshAccessToken('ancien', res as never, 'WEB' as never),
      ).rejects.toBe(refus);
      expect(sessions.effacerCookie).toHaveBeenCalledWith(res);
      expect(sessions.poserCookie).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it("jeton d'accès valide : fermer reçoit sid et userId", async () => {
      jwtService.verifyAsync.mockResolvedValue({ userId: 'u1', sid: 'sid-1' });

      const out = await service.logout(
        { jetonAcces: 'jwt-valide' },
        res as never,
        'WEB' as never,
      );

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('jwt-valide', {
        secret: 'secret-de-test',
      });
      expect(sessions.fermer).toHaveBeenCalledWith({
        refresh: undefined,
        sid: 'sid-1',
        userId: 'u1',
      });
      expect(out).toEqual({
        data: null,
        message: 'Déconnexion réussie',
        success: true,
      });
    });

    it("jeton d'accès invalide et refresh mobile : fermer reçoit le refresh, réponse 200", async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('expiré'));

      const out = await service.logout(
        { refresh: 'sid-1.refresh', jetonAcces: 'jwt-expire' },
        res as never,
        'MOBILE' as never,
      );

      expect(sessions.fermer).toHaveBeenCalledWith({
        refresh: 'sid-1.refresh',
        sid: undefined,
        userId: undefined,
      });
      expect(out.success).toBe(true);
    });

    it('web : cookie effacé', async () => {
      await service.logout({ refresh: 'r' }, res as never, 'WEB' as never);

      expect(sessions.effacerCookie).toHaveBeenCalledWith(res);
    });

    it('mobile : cookie jamais touché', async () => {
      await service.logout({ refresh: 'r' }, res as never, 'MOBILE' as never);

      expect(sessions.effacerCookie).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('renvoie la même réponse que l email existe ou non', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const inconnu = await service.forgotPassword({ email: 'x@example.com' });

      prisma.user.findUnique.mockResolvedValueOnce(utilisateur());
      const connu = await service.forgotPassword({ email: 'awa@example.com' });

      expect(connu).toEqual(inconnu);
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    });

    it('stocke seulement le hash du jeton et l envoie en clair par email', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      await service.forgotPassword({ email: 'awa@example.com' });

      const jeton = emailService.sendPasswordResetEmail.mock.calls[0][3];
      const { data } = prisma.user.update.mock.calls[0][0];
      expect(data.resetPasswordToken).toBe(sha256(jeton));
      expect(data.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('n envoie rien pour un compte désactivé, avec la même réponse', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const inconnu = await service.forgotPassword({ email: 'x@example.com' });

      prisma.user.findUnique.mockResolvedValueOnce(
        utilisateur({ isActive: false }),
      );
      const inactif = await service.forgotPassword({
        email: 'awa@example.com',
      });

      expect(inactif).toEqual(inconnu);
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('refuse un jeton expiré ou inconnu', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'expire',
          newPassword: 'Nouveau-mdp-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const { where } = prisma.user.findFirst.mock.calls[0][0];
      expect(where.resetPasswordToken).toBe(sha256('expire'));
      expect(where.resetPasswordExpires.gt).toBeInstanceOf(Date);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('change le mot de passe haché et invalide le jeton', async () => {
      prisma.user.findFirst.mockResolvedValue(utilisateur());

      await service.resetPassword({
        token: 'valide',
        newPassword: 'Nouveau-mdp-1',
      });

      const { data } = prisma.user.update.mock.calls[0][0];
      expect(await bcrypt.compare('Nouveau-mdp-1', data.password)).toBe(true);
      expect(data.resetPasswordToken).toBeNull();
      expect(data.resetPasswordExpires).toBeNull();
      expect(sessions.revoquerToutes).toHaveBeenCalledWith(
        'u1',
        'MOT_DE_PASSE_REINITIALISE',
      );
    });
  });

  describe('changePassword : révocation des autres appareils', () => {
    const dto = {
      currentPassword: MOT_DE_PASSE,
      newPassword: 'Nouveau-mdp-1',
    };

    it('révoque les autres appareils par défaut', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      const out = await service.changePassword('u1', dto, 'sid-1');

      expect(sessions.revoquerAutres).toHaveBeenCalledWith(
        'u1',
        'sid-1',
        'MOT_DE_PASSE_MODIFIE',
      );
      expect(out).toEqual({
        data: { appareilsDeconnectes: 2 },
        message:
          'Mot de passe modifié. Vos autres appareils ont été déconnectés.',
        success: true,
      });
    });

    it('ne révoque pas avec deconnecterAutresAppareils à false', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      const out = await service.changePassword(
        'u1',
        { ...dto, deconnecterAutresAppareils: false },
        'sid-1',
      );

      expect(sessions.revoquerAutres).not.toHaveBeenCalled();
      expect(out).toEqual({
        data: { appareilsDeconnectes: 0 },
        message: 'Mot de passe modifié avec succès',
        success: true,
      });
    });
  });

  describe('generateTokens', () => {
    it('signe le payload avec le secret et 15 minutes de validité', () => {
      const payload = { userId: 'u1', role: 'MEDECIN', structureId: 's1' };

      const out = service['generateTokens'](payload);

      expect(jwtService.sign).toHaveBeenCalledWith(payload, {
        secret: 'secret-de-test',
        expiresIn: '15m',
      });
      expect(out.access_token).toBe('jwt-de-test');
      expect(out.refreshToken).toMatch(/^[0-9a-f]{80}$/);
      const dans30Jours = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(
        Math.abs(out.refreshTokenExpires.getTime() - dans30Jours),
      ).toBeLessThan(5000);
    });

    it('génère un refresh token différent à chaque appel', () => {
      const a = service['generateTokens']({ userId: 'u1', role: 'PATIENT' });
      const b = service['generateTokens']({ userId: 'u1', role: 'PATIENT' });

      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('connexionDemo (mode démo)', () => {
    const ID_DEMO = '3f1c2a7e-8d4b-4c1e-9a55-2b7f0c9e6d10';
    const compteDemo = (surcharge: Record<string, unknown> = {}) => {
      // La connexion démo ne lit jamais le mot de passe.
      const compte: Record<string, unknown> = utilisateur({
        id: ID_DEMO,
        email: 'dr.mamadou.diallo@demo.medconnecte.gn',
        ...surcharge,
      });
      delete compte.password;
      return compte;
    };
    const valeurInitiale = process.env.DEMO_MODE;

    beforeEach(() => {
      process.env.DEMO_MODE = 'true';
    });
    afterEach(() => {
      if (valeurInitiale === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = valeurInitiale;
    });

    it.each([undefined, 'false', 'oui'])(
      'mode inactif (DEMO_MODE=%s) : 404 sans lecture en base',
      async (valeur) => {
        if (valeur === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = valeur;

        await expect(
          service.connexionDemo(ID_DEMO, res as never, WEB),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
        expect(res.cookie).not.toHaveBeenCalled();
      },
    );

    it('refuse (403) un vrai compte, hors domaine démo', async () => {
      prisma.user.findUnique.mockResolvedValue(
        compteDemo({ email: 'awa@example.com' }),
      );

      await expect(
        service.connexionDemo(ID_DEMO, res as never, WEB),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(res.cookie).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('refuse (403) un compte absent', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.connexionDemo(ID_DEMO, res as never, WEB),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('refuse (403) un compte démo désactivé', async () => {
      prisma.user.findUnique.mockResolvedValue(compteDemo({ isActive: false }));

      await expect(
        service.connexionDemo(ID_DEMO, res as never, WEB),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('compte démo : même réponse et mêmes effets que login', async () => {
      // Référence : connexion classique du même compte
      prisma.user.findUnique.mockResolvedValue({
        ...compteDemo(),
        password: hashValide,
      });
      const viaLogin = await service.login(
        {
          email: 'dr.mamadou.diallo@demo.medconnecte.gn',
          password: MOT_DE_PASSE,
        },
        res as never,
        '1.2.3.4',
        WEB,
      );

      sessions.ouvrir.mockClear();
      sessions.poserCookie.mockClear();
      prisma.user.findUnique.mockResolvedValue(compteDemo());

      const viaDemo = await service.connexionDemo(ID_DEMO, res as never, WEB);

      expect(prisma.user.findUnique).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id: ID_DEMO } }),
      );
      expect(viaDemo).toEqual(viaLogin);
      expect(JSON.stringify(viaDemo)).not.toContain('password');

      expect(sessions.ouvrir).toHaveBeenCalledWith(
        { id: ID_DEMO, role: 'MEDECIN', structureId: 's1' },
        { type: 'WEB' },
      );
      expect(sessions.poserCookie).toHaveBeenCalledTimes(1);
      expect(viaDemo.data).not.toHaveProperty('refreshToken');
      expect(viaDemo.data).not.toHaveProperty('sessionId');
      expect(prisma.user.update).not.toHaveBeenCalled();
      // Pas de remise à zéro anti-brute-force ici : aucun mot de passe en jeu.
      expect(loginThrottle.reset).toHaveBeenCalledTimes(1);
    });

    it('mobile : refresh et sessionId dans le JSON, aucun cookie', async () => {
      prisma.user.findUnique.mockResolvedValue(compteDemo());

      const out = await service.connexionDemo(ID_DEMO, res as never, MOBILE);

      expect(sessions.ouvrir).toHaveBeenCalledWith(
        { id: ID_DEMO, role: 'MEDECIN', structureId: 's1' },
        MOBILE,
      );
      expect(sessions.poserCookie).not.toHaveBeenCalled();
      expect(out.data).toMatchObject({
        access_token: 'jwt-de-test',
        refreshToken: 'sid-1.' + 'a'.repeat(64),
        expiresIn: 900,
        sessionId: 'sid-1',
      });
      expect(out.data.user).toMatchObject({ id: ID_DEMO });
    });
  });

  describe('comptes démo : identifiants verrouillés', () => {
    const demo = () =>
      utilisateur({ id: 'd1', email: 'aminata.diallo@demo.medconnecte.gn' });

    it('refuse le changement de mot de passe', async () => {
      prisma.user.findUnique.mockResolvedValue(demo());

      await expect(
        service.changePassword('d1', {
          currentPassword: MOT_DE_PASSE,
          newPassword: 'Nouveau-mot-de-passe-1',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuse le changement d'email", async () => {
      prisma.user.findUnique.mockResolvedValue(demo());

      await expect(
        service.editProfile('d1', { email: 'moi@exemple.com' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("n'envoie aucun lien de réinitialisation", async () => {
      prisma.user.findUnique.mockResolvedValue(demo());

      const out = await service.forgotPassword({
        email: 'aminata.diallo@demo.medconnecte.gn',
      });

      expect(out.success).toBe(true);
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
