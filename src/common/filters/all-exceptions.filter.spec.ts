import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from 'generated/prisma/client';
import { UpdateRendezVousStatusDto } from 'src/carnet-sante/dto/carnet-sante.dto';
import { AllExceptionsFilter, MESSAGES } from './all-exceptions.filter';
import { fabriquerErreurValidation } from './erreur-validation';

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
      code: 'PERMISSION_REFUSEE',
    });
  });

  it('attribue PERMISSION_REFUSEE à un 403 anglais par défaut', () => {
    filtre.catch(new ForbiddenException(), host);
    expect(corpsRenvoye().code).toBe('PERMISSION_REFUSEE');
  });

  it("conserve le code d'un 403 qui en porte un", () => {
    filtre.catch(
      new ForbiddenException({
        message: 'Message projet',
        code: 'SOS_ROLE_INTERDIT',
      }),
      host,
    );
    expect(corpsRenvoye().code).toBe('SOS_ROLE_INTERDIT');
  });

  it('recopie peutRelancerA dans donnees et ignore les autres clés', () => {
    filtre.catch(
      new ConflictException({
        message: 'Message projet',
        code: 'SOS_DEJA_ACTIF',
        peutRelancerA: '2026-10-20T10:00:00.000Z',
        autre: 'x',
      }),
      host,
    );
    expect(corpsRenvoye()).toEqual({
      statusCode: 409,
      message: 'Message projet',
      error: 'Déjà existant',
      code: 'SOS_DEJA_ACTIF',
      donnees: { peutRelancerA: '2026-10-20T10:00:00.000Z' },
    });
  });

  it("n'ajoute pas donnees sans clé autorisée", () => {
    filtre.catch(
      new ConflictException({ message: 'Message projet', autre: 'x' }),
      host,
    );
    expect(corpsRenvoye()).not.toHaveProperty('donnees');
  });

  it('ignore champs si le code n’est pas VALIDATION', () => {
    filtre.catch(
      new BadRequestException({
        message: 'Message projet',
        champs: [{ champ: 'a', contraintes: ['b'] }],
      }),
      host,
    );
    expect(corpsRenvoye()).not.toHaveProperty('champs');
  });

  it('assainit champs : ni valeur ni élément invalide', () => {
    filtre.catch(
      new BadRequestException({
        message: ['x'],
        code: 'VALIDATION',
        champs: [{ champ: 'a', contraintes: ['b', 3], valeur: 'SECRET' }, 'x'],
      }),
      host,
    );
    expect(corpsRenvoye().champs).toEqual([{ champ: 'a', contraintes: ['b'] }]);
  });

  describe('avec le vrai ValidationPipe', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: fabriquerErreurValidation,
    });
    const rejet = () =>
      pipe
        .transform(
          { status: 'PIRATE', intrus: 'SECRET-789' },
          { type: 'body', metatype: UpdateRendezVousStatusDto },
        )
        .then(
          () => {
            throw new Error('Le pipe aurait dû rejeter la saisie.');
          },
          (e: unknown) => e,
        );

    const verifier = (corps: Record<string, unknown>) => {
      expect(corps.statusCode).toBe(400);
      expect(corps.message).toBe(MESSAGES.validation);
      expect(corps.code).toBe('VALIDATION');
      expect(corps.champs).toEqual(
        expect.arrayContaining([
          { champ: 'status', contraintes: ['isEnum'] },
          { champ: 'intrus', contraintes: ['whitelistValidation'] },
        ]),
      );
      const sansDetails = { ...corps };
      delete sansDetails.details;
      const texte = JSON.stringify(sansDetails);
      expect(texte).not.toContain('PIRATE');
      expect(texte).not.toContain('SECRET-789');
    };

    it('renvoie code et champs, sans la valeur saisie', async () => {
      filtre.catch(await rejet(), host);
      verifier(corpsRenvoye());
      expect(corpsRenvoye()).toHaveProperty('details');
    });

    it('renvoie code et champs en production, sans details', async () => {
      const ancien = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        filtre.catch(await rejet(), host);
        verifier(corpsRenvoye());
        expect(corpsRenvoye()).not.toHaveProperty('details');
      } finally {
        process.env.NODE_ENV = ancien;
      }
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

  it('ajoute le code machine du catalogue au corps', () => {
    filtre.catch(
      new UnauthorizedException({
        message: 'Message projet',
        code: 'REFRESH_REUTILISE',
      }),
      host,
    );
    expect(corpsRenvoye()).toEqual({
      statusCode: 401,
      message: 'Message projet',
      error: 'Connexion expirée',
      code: 'REFRESH_REUTILISE',
    });
  });

  it("n'ajoute pas un code hors catalogue", () => {
    filtre.catch(
      new UnauthorizedException({ message: 'Message projet', code: 'INCONNU' }),
      host,
    );
    expect(corpsRenvoye()).not.toHaveProperty('code');
  });

  it("n'ajoute pas de code pour un message texte simple", () => {
    filtre.catch(new UnauthorizedException('Message projet'), host);
    expect(corpsRenvoye()).not.toHaveProperty('code');
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

  it("conserve le message et le code d'une 503 portant un code du catalogue", () => {
    filtre.catch(
      new ServiceUnavailableException({
        message: 'Envoi impossible pour le moment.',
        code: 'EMAIL_INDISPONIBLE',
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(503);
    expect(corpsRenvoye()).toEqual({
      statusCode: 503,
      message: 'Envoi impossible pour le moment.',
      error: 'Service indisponible',
      code: 'EMAIL_INDISPONIBLE',
    });
  });

  it('traite une 503 sans code comme une erreur interne', () => {
    filtre.catch(new ServiceUnavailableException(), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(corpsRenvoye()).toEqual({
      statusCode: 500,
      message: MESSAGES.indisponible,
      error: 'Erreur interne',
    });
  });

  it("n'écrit rien hors contexte HTTP", () => {
    const hostWs = creerHost('ws');
    filtre.catch(new Error('x'), hostWs);
    expect(status).not.toHaveBeenCalled();
  });
});
