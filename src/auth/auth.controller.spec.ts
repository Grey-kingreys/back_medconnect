/* eslint-disable @typescript-eslint/no-unsafe-member-access -- les calls des doublures jest.Mock sont typés any */
import { AuthController } from './auth.controller';

/** Contrat des routes refresh et logout : web par cookie, mobile par le corps. */
describe('AuthController (refresh et logout)', () => {
  let authService: { refreshAccessToken: jest.Mock; logout: jest.Mock };
  let sessions: {
    revoquerUne: jest.Mock;
    revoquerAutres: jest.Mock;
    effacerCookie: jest.Mock;
  };
  let controller: AuthController;
  const res = {} as never;
  const valeurInitiale = process.env.SESSIONS_MULTI_APPAREILS;

  beforeEach(() => {
    delete process.env.SESSIONS_MULTI_APPAREILS;
    authService = {
      refreshAccessToken: jest.fn().mockResolvedValue({ success: true }),
      logout: jest.fn().mockResolvedValue({ success: true }),
    };
    sessions = {
      revoquerUne: jest.fn().mockResolvedValue(undefined),
      revoquerAutres: jest.fn().mockResolvedValue(1),
      effacerCookie: jest.fn(),
    };
    controller = new AuthController(authService as never, sessions as never);
  });

  afterEach(() => {
    if (valeurInitiale === undefined)
      delete process.env.SESSIONS_MULTI_APPAREILS;
    else process.env.SESSIONS_MULTI_APPAREILS = valeurInitiale;
  });

  it('refresh web : le cookie est transmis, le refreshToken du corps est ignoré', async () => {
    const req = { headers: {}, cookies: { refresh_token: 'depuis-cookie' } };

    await controller.refresh(req, { refreshToken: 'depuis-corps' }, res);

    expect(authService.refreshAccessToken).toHaveBeenCalledWith(
      'depuis-cookie',
      res,
      'WEB',
    );
  });

  it('refresh mobile : le corps est transmis, un cookie présent est ignoré', async () => {
    const req = {
      headers: { 'x-client': 'mobile' },
      cookies: { refresh_token: 'depuis-cookie' },
    };

    await controller.refresh(req, { refreshToken: 'depuis-corps' }, res);

    expect(authService.refreshAccessToken).toHaveBeenCalledWith(
      'depuis-corps',
      res,
      'MOBILE',
    );
  });

  it('logout : extrait le jeton après Bearer', async () => {
    const req = {
      headers: { authorization: 'Bearer jeton-acces' },
      cookies: { refresh_token: 'depuis-cookie' },
    };

    await controller.logout(req, {}, res);

    expect(authService.logout).toHaveBeenCalledWith(
      { refresh: 'depuis-cookie', jetonAcces: 'jeton-acces' },
      res,
      'WEB',
    );
  });

  it('logout : fonctionne sans en-tête Authorization (mobile, refresh seul)', async () => {
    const req = { headers: { 'x-client': 'mobile' } };

    await controller.logout(req, { refreshToken: 'depuis-corps' }, res);

    expect(authService.logout).toHaveBeenCalledWith(
      { refresh: 'depuis-corps', jetonAcces: undefined },
      res,
      'MOBILE',
    );
  });

  it("logout : un schéma autre que Bearer n'est pas pris pour un jeton", async () => {
    const req = { headers: { authorization: 'Basic abc' } };

    await controller.logout(req, {}, res);

    expect(authService.logout.mock.calls[0][0].jetonAcces).toBeUndefined();
  });

  it('DELETE de la session courante en web : le cookie est effacé', async () => {
    const req = { headers: {}, user: { userId: 'u1', sid: 's1' } };

    const out = await controller.revoquerSession('s1', req, res);

    expect(sessions.revoquerUne).toHaveBeenCalledWith('u1', 's1');
    expect(sessions.effacerCookie).toHaveBeenCalledWith(res);
    expect(out.data).toEqual({ id: 's1' });
  });

  it('DELETE de la session courante en mobile : aucun cookie touché', async () => {
    const req = {
      headers: { 'x-client': 'mobile' },
      user: { userId: 'u1', sid: 's1' },
    };

    await controller.revoquerSession('s1', req, res);

    expect(sessions.effacerCookie).not.toHaveBeenCalled();
  });

  it('DELETE d’un autre appareil en web : le cookie reste', async () => {
    const req = { headers: {}, user: { userId: 'u1', sid: 's1' } };

    await controller.revoquerSession('s2', req, res);

    expect(sessions.effacerCookie).not.toHaveBeenCalled();
  });

  it('revoquer-autres : message selon le nombre', async () => {
    const req = { headers: {}, user: { userId: 'u1', sid: 's1' } };

    const avec = await controller.revoquerAutres(req);
    expect(sessions.revoquerAutres).toHaveBeenCalledWith(
      'u1',
      's1',
      'REVOCATION_UTILISATEUR',
    );
    expect(avec).toEqual({
      data: { nombre: 1 },
      message: 'Vos autres appareils ont été déconnectés.',
      success: true,
    });

    sessions.revoquerAutres.mockResolvedValue(0);
    const sans = await controller.revoquerAutres(req);
    expect(sans.message).toBe("Aucun autre appareil n'était connecté.");
  });

  it('logout est une route publique (aucune garde)', () => {
    // La métadonnée de garde est posée sur la fonction elle-même : la lecture est valide.
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata('__guards__', AuthController.prototype.logout),
    ).toBeUndefined();
  });
});
