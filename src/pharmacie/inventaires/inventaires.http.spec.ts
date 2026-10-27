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
import { InventairesController } from './inventaires.controller';
import { SortiesStockService } from './sorties.service';

/**
 * Routes de sortie de stock : vrai PermissionsGuard et vrai PermissionsService
 * (Redis et Prisma simulés), même ValidationPipe que main.ts, service simulé.
 */
describe('Sorties de stock (HTTP)', () => {
  let app: INestApplication;
  const service = {
    enregistrer: jest.fn(),
  };

  const profils: Record<string, { type: string; codes: string[] }> = {
    titulaire: {
      type: 'PHARMACIE',
      codes: [
        'stock:read',
        'stock:write',
        'inventaire:write',
        'anomalie:gerer',
      ],
    },
    lecteur: { type: 'PHARMACIE', codes: ['stock:read'] },
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
      controllers: [InventairesController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: SortiesStockService, useValue: service },
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

  const corpsValide = {
    stockId: 's',
    lotId: 'l',
    unite: 'BOITE',
    quantite: 2,
    raison: 'PERIME',
  };

  it('permissions : stock:write exigé pour une sortie', async () => {
    const res = await request(serveur())
      .post('/pharmacie/s1/stock/sorties')
      .set('x-essai-user', 'lecteur')
      .send(corpsValide);
    expect(res.status).toBe(403);
    expect((res.body as CorpsErreur).code).toBe('PERMISSION_REFUSEE');
    expect(service.enregistrer).not.toHaveBeenCalled();
  });

  it('sortie valide transmise au service', async () => {
    const res = await request(serveur())
      .post('/pharmacie/s1/stock/sorties')
      .set('x-essai-user', 'titulaire')
      .send(corpsValide);
    expect(res.status).toBe(200);
    expect(service.enregistrer).toHaveBeenCalledWith(
      's1',
      'titulaire',
      expect.objectContaining(corpsValide),
      expect.anything(),
    );
  });

  it('validation du corps de sortie', async () => {
    const cas: [Record<string, unknown>, string][] = [
      [{ ...corpsValide, unite: 'CARTON' }, 'unite'],
      [{ ...corpsValide, quantite: 0 }, 'quantite'],
      [{ ...corpsValide, raison: 'VOLE' }, 'raison'],
      [{ ...corpsValide, type: 'PERTE' }, 'type'],
    ];
    for (const [corps, champ] of cas) {
      const res = await request(serveur())
        .post('/pharmacie/s1/stock/sorties')
        .set('x-essai-user', 'titulaire')
        .send(corps);
      const body = res.body as CorpsErreur;
      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect((body.champs ?? []).some((c) => c.champ === champ)).toBe(true);
    }
    expect(service.enregistrer).not.toHaveBeenCalled();

    const res = await request(serveur())
      .post('/pharmacie/s1/stock/sorties')
      .set('x-essai-user', 'titulaire')
      .send({ ...corpsValide, raison: undefined });
    expect(res.status).toBe(200);
  });
});
