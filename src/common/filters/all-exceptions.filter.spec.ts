import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from 'generated/prisma/client';
import { AllExceptionsFilter, MESSAGES } from './all-exceptions.filter';

/**
 * Tests unitaires du filtre global : ArgumentsHost et Response simulés.
 * On vérifie le message renvoyé au front et l'absence de fuite technique.
 */
describe('AllExceptionsFilter', () => {
  let filtre: AllExceptionsFilter;
  let status: jest.Mock;
  let json: jest.Mock;
  let host: ArgumentsHost;
  let logError: jest.SpyInstance;

  const creerHost = (type = 'http'): ArgumentsHost => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    const request = { method: 'POST', path: '/carnet/consultations' };
    return {
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;
  };

  const corpsRenvoye = () =>
    (json.mock.calls[0] as [Record<string, unknown>])[0];

  beforeEach(() => {
    filtre = new AllExceptionsFilter();
    host = creerHost();
    logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('conserve un message rédigé par le projet', () => {
    const message = "Vous n'êtes pas autorisé à modifier ce carnet.";
    filtre.catch(new ForbiddenException(message), host);
    expect(status).toHaveBeenCalledWith(403);
    expect(corpsRenvoye()).toEqual({
      statusCode: 403,
      message,
      error: 'Accès refusé',
    });
  });

  it('remplace les erreurs de validation en tableau et garde le détail hors production', () => {
    const details = ['motif should not be empty'];
    filtre.catch(new BadRequestException(details), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(corpsRenvoye()).toEqual({
      statusCode: 400,
      message: MESSAGES.validation,
      error: 'Saisie invalide',
      details,
    });
  });

  it("n'ajoute pas le détail de validation en production", () => {
    const ancien = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      filtre.catch(new BadRequestException(['x should not exist']), host);
      expect(corpsRenvoye()).not.toHaveProperty('details');
    } finally {
      process.env.NODE_ENV = ancien;
    }
  });

  it('traduit la limite de débit (429)', () => {
    filtre.catch(new ThrottlerException(), host);
    expect(status).toHaveBeenCalledWith(429);
    expect(corpsRenvoye().message).toBe(MESSAGES.tropDeTentatives);
    expect(corpsRenvoye().error).toBe('Trop de tentatives');
  });

  it('traduit une route inconnue', () => {
    filtre.catch(new NotFoundException('Cannot GET /inconnue'), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(corpsRenvoye().message).toBe(MESSAGES.introuvableRoute);
  });

  it('traduit le 403 anglais par défaut', () => {
    filtre.catch(new ForbiddenException('Forbidden resource'), host);
    expect(status).toHaveBeenCalledWith(403);
    expect(corpsRenvoye().message).toBe(MESSAGES.acces);
  });

  it('traduit le 401 anglais par défaut', () => {
    filtre.catch(new UnauthorizedException(), host);
    expect(corpsRenvoye().message).toBe(MESSAGES.connexion);
  });

  it('traduit le 413', () => {
    filtre.catch(new PayloadTooLargeException(), host);
    expect(status).toHaveBeenCalledWith(413);
    expect(corpsRenvoye().message).toBe(MESSAGES.tropVolumineux);
  });

  it('transforme P2002 en 409 sans code Prisma', () => {
    const erreur = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: '7.0.0' },
    );
    filtre.catch(erreur, host);
    expect(status).toHaveBeenCalledWith(409);
    expect(corpsRenvoye()).toEqual({
      statusCode: 409,
      message: MESSAGES.existeDeja,
      error: 'Déjà existant',
    });
    expect(JSON.stringify(corpsRenvoye())).not.toContain('P2002');
  });

  it('renvoie un 500 générique sans fuite pour une erreur inconnue et la journalise', () => {
    filtre.catch(new TypeError('secret interne: colonne x introuvable'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(corpsRenvoye()).toEqual({
      statusCode: 500,
      message: MESSAGES.indisponible,
      error: 'Erreur interne',
    });
    const texte = JSON.stringify(corpsRenvoye());
    expect(texte).not.toContain('secret interne');
    expect(texte).not.toContain('TypeError');
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String((logError.mock.calls[0] as unknown[])[0])).toContain(
      'POST /carnet/consultations',
    );
  });

  it("n'écrit rien hors contexte HTTP", () => {
    const hostWs = creerHost('ws');
    filtre.catch(new Error('x'), hostWs);
    expect(status).not.toHaveBeenCalled();
  });
});
