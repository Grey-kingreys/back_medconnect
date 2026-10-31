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
import { RapportsController } from './rapports.controller';
import { RapportsService } from './rapports.service';

/**
 * Routes d'alertes et de marge : vrai PermissionsGuard et vrai PermissionsService
 * (Redis et Prisma simulés), même ValidationPipe que main.ts, RapportsService simulé.
 */
describe('Rapports de pharmacie (HTTP)', () => {
  let app: INestApplication;
  const service = {
    alertesPeremption: jest.fn(),
    rapportMarge: jest.fn(),
  };

  const profils: Record<string, { type: string; codes: string[] }> = {
    titulaire: { type: 'PHARMACIE', codes: ['stock:read', 'marge:read'] },
    vendeur: {
      type: 'PHARMACIE',
      codes: ['stock:read', 'vente:write', 'caisse:utiliser'],
    },
    caissier: { type: 'PHARMACIE', codes: ['caisse:utiliser'] },
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
      controllers: [RapportsController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: RapportsService, useValue: service },
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

  it('le vendeur avec stock:read lit les alertes de péremption', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/stock/alertes-peremption')
      .set('x-essai-user', 'vendeur');
    expect(res.status).toBe(200);
    expect(service.alertesPeremption).toHaveBeenCalledWith('s1', 'vendeur');
  });

  it('le caissier sans stock:read est refusé sur les alertes', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/stock/alertes-peremption')
      .set('x-essai-user', 'caissier');
    expect(res.status).toBe(403);
    expect(service.alertesPeremption).not.toHaveBeenCalled();
  });

  it('le vendeur sans marge:read est refusé sur le rapport de marge', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/rapports/marge')
      .set('x-essai-user', 'vendeur');
    expect(res.status).toBe(403);
    expect(service.rapportMarge).not.toHaveBeenCalled();
  });

  it('le titulaire lit le rapport de marge avec sa période', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/rapports/marge?du=2026-10-01&au=2026-10-27')
      .set('x-essai-user', 'titulaire');
    expect(res.status).toBe(200);
    expect(service.rapportMarge).toHaveBeenCalledWith('s1', 'titulaire', {
      du: '2026-10-01',
      au: '2026-10-27',
    });
  });

  it('une date mal formée est refusée', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/rapports/marge?du=2026-1-1')
      .set('x-essai-user', 'titulaire');
    const body = res.body as CorpsErreur;
    expect(res.status).toBe(400);
    expect(body.code).toBe('VALIDATION');
    expect(body.champs).toContainEqual({
      champ: 'du',
      contraintes: ['matches'],
    });
    expect(service.rapportMarge).not.toHaveBeenCalled();
  });
});
