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
import { AnomaliesController } from './anomalies.controller';
import { AnomaliesService } from './anomalies.service';

/**
 * Routes de la file d'anomalies : vrai PermissionsGuard et vrai PermissionsService
 * (Redis et Prisma simulés), même ValidationPipe que main.ts, service simulé.
 */
describe("File d'anomalies (HTTP)", () => {
  let app: INestApplication;
  const service = {
    lister: jest.fn(),
    traiter: jest.fn(),
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
      controllers: [AnomaliesController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        { provide: AnomaliesService, useValue: service },
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

  it('permissions : anomalie:gerer exigé', async () => {
    const liste = await request(serveur())
      .get('/pharmacie/s1/anomalies')
      .set('x-essai-user', 'vendeur');
    const patch = await request(serveur())
      .patch('/pharmacie/s1/anomalies/a1')
      .set('x-essai-user', 'vendeur')
      .send({ commentaire: 'Recompté' });
    expect(liste.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(service.lister).not.toHaveBeenCalled();
    expect(service.traiter).not.toHaveBeenCalled();
  });

  it('filtres convertis et validés', async () => {
    const res = await request(serveur())
      .get('/pharmacie/s1/anomalies?statut=TRAITEE&type=STOCK_NEGATIF&page=2')
      .set('x-essai-user', 'titulaire');
    expect(res.status).toBe(200);
    expect(service.lister).toHaveBeenCalledWith('s1', 'titulaire', {
      statut: 'TRAITEE',
      type: 'STOCK_NEGATIF',
      page: 2,
    });
    for (const requete of ['?statut=FERMEE', '?type=AUTRE']) {
      const refus = await request(serveur())
        .get(`/pharmacie/s1/anomalies${requete}`)
        .set('x-essai-user', 'titulaire');
      expect(refus.status).toBe(400);
      expect((refus.body as CorpsErreur).code).toBe('VALIDATION');
    }
  });

  it('traitement : commentaire exigé par le corps', async () => {
    for (const corps of [{}, { commentaire: 'x'.repeat(501) }]) {
      const res = await request(serveur())
        .patch('/pharmacie/s1/anomalies/a1')
        .set('x-essai-user', 'titulaire')
        .send(corps);
      const body = res.body as CorpsErreur;
      expect(res.status).toBe(400);
      expect(body.code).toBe('VALIDATION');
      expect((body.champs ?? []).some((c) => c.champ === 'commentaire')).toBe(
        true,
      );
    }
    expect(service.traiter).not.toHaveBeenCalled();
    const ok = await request(serveur())
      .patch('/pharmacie/s1/anomalies/a1')
      .set('x-essai-user', 'titulaire')
      .send({ commentaire: 'Recompté' });
    expect(ok.status).toBe(200);
    expect(service.traiter).toHaveBeenCalledTimes(1);
  });
});
