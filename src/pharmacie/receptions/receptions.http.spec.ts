import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { fabriquerErreurValidation } from 'src/common/filters/erreur-validation';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { REDIS_CLIENT } from 'src/common/redis/redis.module';
import { PrismaService } from 'src/common/services/prisma.service';
import { ReceptionsController } from './receptions.controller';
import { ReceptionsService } from './receptions.service';

/**
 * Routes de réception : vrai PermissionsGuard et vrai PermissionsService (Redis
 * et Prisma simulés), même ValidationPipe que main.ts, ReceptionsService simulé.
 */
describe('Réceptions (HTTP)', () => {
  let app: INestApplication;
  const service = {
    listerFournisseurs: jest.fn(),
    creerFournisseur: jest.fn(),
    enregistrer: jest.fn(),
    lister: jest.fn(),
    detail: jest.fn(),
    listerLots: jest.fn(),
    corrigerDateLot: jest.fn(),
  };

  const profils: Record<string, { type: string; codes: string[] }> = {
    titulaire: {
      type: 'PHARMACIE',
      codes: ['stock:read', 'stock:write', 'reception:write', 'marge:read'],
    },
    vendeur: {
      type: 'PHARMACIE',
      codes: ['stock:read', 'stock:write', 'vente:write', 'caisse:utiliser'],
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) => {
        const profil = profils[where.id];
        return Promise.resolve({
          appRole: {
            permissions: profil.codes.map((code) => ({ permission: { code } })),
          },
          structure: { type: profil.type },
          administeredStructure: null,
        });
      }),
    },
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ReceptionsController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: ReceptionsService, useValue: service },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{
            headers: Record<string, string>;
            user?: unknown;
          }>();
          req.user = {
            userId: req.headers['x-essai-user'],
            role: 'PHARMACIEN',
            structureId: 's1',
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: fabriquerErreurValidation,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    for (const methode of Object.values(service)) {
      methode.mockReset().mockResolvedValue({
        data: {},
        message: 'ok',
        success: true,
      });
    }
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

  interface CorpsErreur {
    code?: string;
    champs?: { champ: string; contraintes: string[] }[];
  }

  const ligneValide = { stockId: 'stk1', nombreBoites: 1 };

  it('permissions : le vendeur sans reception:write est refusé sur les routes de réception', async () => {
    const cas: [string, string, Record<string, unknown>?][] = [
      ['get', '/pharmacie/s1/fournisseurs'],
      ['post', '/pharmacie/s1/fournisseurs', { nom: 'Sopharma' }],
      ['post', '/pharmacie/s1/receptions', { lignes: [ligneValide] }],
      ['get', '/pharmacie/s1/receptions'],
      ['get', '/pharmacie/s1/receptions/r1'],
      [
        'patch',
        '/pharmacie/s1/lots/l1',
        { dateExpiration: '2027-01-01', motif: 'Erreur de saisie' },
      ],
    ];
    for (const [methode, chemin, corps] of cas) {
      const appel = request(serveur())
        [methode as 'get' | 'post' | 'patch'](chemin)
        .set('x-essai-user', 'vendeur');
      const res = await (corps ? appel.send(corps) : appel);
      expect(res.status).toBe(403);
    }
    for (const methode of Object.values(service)) {
      expect(methode).not.toHaveBeenCalled();
    }
  });

  it('permissions : la liste des lots exige stock:read seulement', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/stock/stk1/lots')
      .set('x-essai-user', 'vendeur');
    expect(res.status).toBe(200);
    expect(service.listerLots).toHaveBeenCalledWith('s1', 'vendeur', 'stk1');
  });

  it('réception valide transmise au service', async () => {
    const res = await request(serveur())
      .post('/pharmacie/s1/receptions')
      .set('x-essai-user', 'titulaire')
      .send({
        lignes: [
          {
            stockId: 'stk1',
            nombreBoites: 10,
            dateExpiration: '2027-12-31',
            coutAchatBoite: 1000,
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(service.enregistrer).toHaveBeenCalledWith(
      's1',
      'titulaire',
      expect.objectContaining({
        lignes: [
          expect.objectContaining({ stockId: 'stk1', nombreBoites: 10 }),
        ],
      }),
      expect.anything(),
    );
  });

  it('validation du corps de réception', async () => {
    const cas: [Record<string, unknown>, string, string][] = [
      [{ lignes: [] }, 'lignes', 'arrayMinSize'],
      [{}, 'lignes', 'isArray'],
      [
        { lignes: [{ stockId: 'stk1', nombreBoites: 0 }] },
        'lignes.0.nombreBoites',
        'min',
      ],
      [
        { lignes: [{ stockId: 'stk1', nombreBoites: 1.5 }] },
        'lignes.0.nombreBoites',
        'isInt',
      ],
      [
        {
          lignes: [
            { stockId: 'stk1', nombreBoites: 1, dateExpiration: '31/12/2027' },
          ],
        },
        'lignes.0.dateExpiration',
        'matches',
      ],
      [
        {
          lignes: [{ stockId: 'stk1', nombreBoites: 1, coutAchatBoite: -1 }],
        },
        'lignes.0.coutAchatBoite',
        'min',
      ],
      [{ id: 'abc', lignes: [ligneValide] }, 'id', 'isUuid'],
      [{ recueLe: 'hier', lignes: [ligneValide] }, 'recueLe', 'isIso8601'],
      [
        { lignes: [{ stockId: 'stk1', nombreBoites: 1, prix: 5 }] },
        'lignes.0.prix',
        'whitelistValidation',
      ],
    ];
    for (const [corps, champ, contrainte] of cas) {
      const res = await request(serveur())
        .post('/pharmacie/s1/receptions')
        .set('x-essai-user', 'titulaire')
        .send(corps);
      const body = res.body as CorpsErreur;
      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect(body.champs).toContainEqual({
        champ,
        contraintes: expect.arrayContaining([contrainte]) as string[],
      });
    }
    expect(service.enregistrer).not.toHaveBeenCalled();
  });

  it('validation du fournisseur', async () => {
    const cas: [Record<string, unknown>, string, string][] = [
      [{ nom: 'A' }, 'nom', 'isLength'],
      [{ nom: 'Sopharma', telephone: 'abc' }, 'telephone', 'matches'],
    ];
    for (const [corps, champ, contrainte] of cas) {
      const res = await request(serveur())
        .post('/pharmacie/s1/fournisseurs')
        .set('x-essai-user', 'titulaire')
        .send(corps);
      const body = res.body as CorpsErreur;
      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect(body.champs).toContainEqual({
        champ,
        contraintes: expect.arrayContaining([contrainte]) as string[],
      });
    }
    expect(service.creerFournisseur).not.toHaveBeenCalled();
  });

  it('page de la liste convertie en nombre', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/receptions?page=2')
      .set('x-essai-user', 'titulaire');
    expect(res.status).toBe(200);
    expect(service.lister).toHaveBeenCalledWith('s1', 'titulaire', { page: 2 });

    const refus = await request(serveur())
      .get('/pharmacie/s1/receptions?page=0')
      .set('x-essai-user', 'titulaire');
    const body = refus.body as CorpsErreur;
    expect(refus.status).toBe(400);
    expect(body.code).toBe('VALIDATION');
    expect((body.champs ?? []).some((c) => c.champ === 'page')).toBe(true);
  });
});
