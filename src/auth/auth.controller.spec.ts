/* eslint-disable @typescript-eslint/no-unsafe-member-access -- les calls des doublures jest.Mock sont typés any */
import { AuthController } from './auth.controller';

/** Contrat des routes refresh et logout : web par cookie, mobile par le corps. */
describe('AuthController (refresh et logout)', () => {
  let authService: { refreshAccessToken: jest.Mock; logout: jest.Mock };
  let controller: AuthController;
  const res = {} as never;
  const valeurInitiale = process.env.SESSIONS_MULTI_APPAREILS;

  beforeEach(() => {
    delete process.env.SESSIONS_MULTI_APPAREILS;
    authService = {
      refreshAccessToken: jest.fn().mockResolvedValue({ success: true }),
      logout: jest.fn().mockResolvedValue({ success: true }),
    };
    controller = new AuthController(authService as never);
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

  it('logout est une route publique (aucune garde)', () => {
    // La métadonnée de garde est posée sur la fonction elle-même : la lecture est valide.
    expect(
      // eslint-disable-next-line @typescript-eslint/unbound-method
      Reflect.getMetadata('__guards__', AuthController.prototype.logout),
    ).toBeUndefined();
  });
});
