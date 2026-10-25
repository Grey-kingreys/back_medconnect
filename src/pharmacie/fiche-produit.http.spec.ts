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
import { FicheProduitController } from './fiche-produit.controller';
import { FicheProduitService } from './fiche-produit.service';

/**
 * Route de modification de la fiche produit : vrai PermissionsGuard et vrai
 * PermissionsService (Redis et Prisma simulés), même ValidationPipe que main.ts,
 * FicheProduitService simulé.
 */
describe('Fiche produit (HTTP)', () => {
  let app: INestApplication;
  const modifierFiche = jest.fn();

  /** Type de structure et permissions selon l'utilisateur de l'essai. */
  const profils: Record<string, { type: string; codes: string[] }> = {
    // Le filtre B10 retire les permissions de vente et de caisse aux hôpitaux, pas stock:write
    // (le refus d'une fiche d'hôpital est alors celui d'AccesPharmacieService, testé en base).
    hopital: {
      type: 'HOPITAL',
      codes: ['stock:read', 'vente:write', 'caisse:utiliser'],
    },
    lecteur: { type: 'PHARMACIE', codes: ['stock:read', 'vente:read'] },
    pharmacien: {
      type: 'PHARMACIE',
      codes: [
        'stock:read',
        'stock:write',
        'vente:read',
        'vente:write',
        'caisse:utiliser',
      ],
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
      controllers: [FicheProduitController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: FicheProduitService, useValue: { modifierFiche } },
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
    modifierFiche.mockReset().mockResolvedValue({
      data: {},
      message: 'ok',
      success: true,
    });
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];
  const route = '/pharmacie/s1/stock/k1/fiche';

  interface CorpsErreur {
    code?: string;
    champs?: { champ: string; contraintes: string[] }[];
  }

  it('1. membre d un hôpital : 403 PERMISSION_REFUSEE', async () => {
    const res = await request(serveur())
      .patch(route)
      .set('x-essai-user', 'hopital')
      .send({ prixUnite: 100 });
    expect(res.status).toBe(403);
    expect((res.body as CorpsErreur).code).toBe('PERMISSION_REFUSEE');
    expect(modifierFiche).not.toHaveBeenCalled();
  });

  it('2. pharmacie sans stock:write : 403', async () => {
    const res = await request(serveur())
      .patch(route)
      .set('x-essai-user', 'lecteur')
      .send({ prixUnite: 100 });
    expect(res.status).toBe(403);
    expect(modifierFiche).not.toHaveBeenCalled();
  });

  it('3. pharmacien : tous les champs transmis au service, null compris', async () => {
    const res = await request(serveur())
      .patch(route)
      .set('x-essai-user', 'pharmacien')
      .send({
        prixUnitaire: 2000,
        prixUnite: null,
        coefficientBoite: 10,
        uniteMinimale: 'COMPRIME',
        deconditionnable: true,
        toleranceInventaire: 2,
        qualifie: true,
      });
    expect(res.status).toBe(200);
    expect(modifierFiche).toHaveBeenCalledTimes(1);
    expect(modifierFiche).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      'k1',
      expect.objectContaining({
        prixUnitaire: 2000,
        prixUnite: null,
        coefficientBoite: 10,
        uniteMinimale: 'COMPRIME',
        deconditionnable: true,
        toleranceInventaire: 2,
        qualifie: true,
      }),
      expect.any(String),
    );
  });

  it('4. corps vide accepté', async () => {
    const res = await request(serveur())
      .patch(route)
      .set('x-essai-user', 'pharmacien')
      .send({});
    expect(res.status).toBe(200);
    expect(modifierFiche).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      'k1',
      expect.any(Object),
      expect.any(String),
    );
  });

  it('5. valeurs refusées (VALIDATION), aucun appel', async () => {
    const cas: [Record<string, unknown>, string, string][] = [
      [{ prixUnite: 0 }, 'prixUnite', 'min'],
      [{ prixUnite: 12.5 }, 'prixUnite', 'isInt'],
      [{ prixUnitaire: -1 }, 'prixUnitaire', 'min'],
      [{ coefficientBoite: 0 }, 'coefficientBoite', 'min'],
      [{ coefficientBoite: 10001 }, 'coefficientBoite', 'max'],
      [{ coefficientBoite: null }, 'coefficientBoite', 'isInt'],
      [{ uniteMinimale: 'BOITE' }, 'uniteMinimale', 'isIn'],
      [{ deconditionnable: 'oui' }, 'deconditionnable', 'isBoolean'],
      [{ toleranceInventaire: -1 }, 'toleranceInventaire', 'min'],
      [{ qualifie: false }, 'qualifie', 'isIn'],
      [
        { conversionStock: 'MULTIPLIER' },
        'conversionStock',
        'whitelistValidation',
      ],
      [{ quantite: 5 }, 'quantite', 'whitelistValidation'],
    ];
    for (const [corps, champ, contrainte] of cas) {
      const res = await request(serveur())
        .patch(route)
        .set('x-essai-user', 'pharmacien')
        .send(corps);
      const body = res.body as CorpsErreur;
      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect(
        (body.champs ?? []).some(
          (c) => c.champ === champ && c.contraintes.includes(contrainte),
        ),
      ).toBe(true);
    }
    expect(modifierFiche).not.toHaveBeenCalled();
  });
});
