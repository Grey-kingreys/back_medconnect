/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- les calls des doublures jest.Mock sont typés any */
import { ConflictException, UnauthorizedException } from '@nestjs/common';
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
  let jwtService: { sign: jest.Mock };
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
    jwtService = { sign: jest.fn().mockReturnValue('jwt-de-test') };
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
    res = { cookie: jest.fn(), clearCookie: jest.fn() };

    service = new AuthService(
      prisma as never,
      jwtService as never,
      emailService as never,
      loginThrottle as never,
      rolesService as never,
      {} as never, // permissionsService
    );
  });

  describe('login', () => {
    const dto = { email: 'Awa@Example.com', password: MOT_DE_PASSE };

    it('refuse un email inconnu et compte l échec', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(dto, res as never, '1.2.3.4'),
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
        service.login({ ...dto, password: 'faux' }, res as never, '1.2.3.4'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(loginThrottle.registerFailure).toHaveBeenCalledTimes(1);
      expect(loginThrottle.reset).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('envoie l email d alerte seulement quand le blocage dur vient de s activer', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());
      loginThrottle.registerFailure.mockResolvedValue(true);

      await expect(
        service.login({ ...dto, password: 'faux' }, res as never, '1.2.3.4'),
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
        service.login(dto, res as never, '1.2.3.4'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      // Comportement actuel : un compte désactivé n'incrémente pas le compteur d'échecs.
      expect(loginThrottle.registerFailure).not.toHaveBeenCalled();
    });

    it('propage le refus du service anti-brute-force avant toute lecture en base', async () => {
      const blocage = new Error('bloqué');
      loginThrottle.guard.mockRejectedValue(blocage);

      await expect(service.login(dto, res as never, '1.2.3.4')).rejects.toBe(
        blocage,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('réussit : tokens, cookie de refresh, remise à zéro du compteur', async () => {
      prisma.user.findUnique.mockResolvedValue(utilisateur());

      const out = await service.login(dto, res as never, '1.2.3.4');

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

      const [nom, valeur, options] = res.cookie.mock.calls[0];
      expect(nom).toBe('refresh_token');
      expect(options).toMatchObject({ httpOnly: true });

      // Le refresh token n'est ni dans le JSON, ni stocké en clair en base.
      expect(JSON.stringify(out)).not.toContain(valeur);
      const maj = prisma.user.update.mock.calls[0][0];
      expect(maj.where).toEqual({ id: 'u1' });
      expect(maj.data.refreshToken).toBe(sha256(valeur));
      expect(maj.data.refreshToken).not.toBe(valeur);
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
        service.register(dto as never, res as never),
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

      const out = await service.register(dto as never, res as never);

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
      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        expect.any(String),
        expect.objectContaining({ httpOnly: true }),
      );
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

      await service.register(dto as never, res as never);

      // Comportement actuel : appRoleId vaut undefined, un backfill rattrape plus tard.
      expect(
        prisma.user.create.mock.calls[0][0].data.appRoleId,
      ).toBeUndefined();
    });
  });

  describe('refreshAccessToken', () => {
    it('refuse un refresh token invalide, expiré ou révoqué', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.refreshAccessToken('inconnu', res as never),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const { where } = prisma.user.findFirst.mock.calls[0][0];
      expect(where.refreshToken).toBe(sha256('inconnu'));
      expect(where.isActive).toBe(true);
      expect(where.refreshTokenExpires.gt).toBeInstanceOf(Date);
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('fait tourner le refresh token et renvoie un nouvel access token', async () => {
      prisma.user.findFirst.mockResolvedValue(utilisateur());

      const out = await service.refreshAccessToken('ancien', res as never);

      expect(out.data).toEqual({ access_token: 'jwt-de-test' });
      const [nom, nouveau] = res.cookie.mock.calls[0];
      expect(nom).toBe('refresh_token');
      expect(nouveau).not.toBe('ancien');
      const maj = prisma.user.update.mock.calls[0][0];
      expect(maj.data.refreshToken).toBe(sha256(nouveau));
    });
  });

  describe('logout', () => {
    it('révoque le refresh token en base et efface le cookie', async () => {
      const out = await service.logout('u1', res as never);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { refreshToken: null, refreshTokenExpires: null },
      });
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(out.success).toBe(true);
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
    });
  });

  describe('generateTokens', () => {
    it('signe le payload avec le secret et 15 minutes de validité', () => {
      const payload = { userId: 'u1', role: 'MEDECIN', structureId: 's1' };

      const out = service.generateTokens(payload);

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
      const a = service.generateTokens({ userId: 'u1', role: 'PATIENT' });
      const b = service.generateTokens({ userId: 'u1', role: 'PATIENT' });

      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });
});
