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
import { CreditController } from './credit.controller';
import { CreditService } from './credit.service';

/** Routes du cahier de crédit : vrai PermissionsGuard, CreditService simulé. */
describe('Cahier de crédit (HTTP)', () => {
  let app: INestApplication;
  const m = {
    lister: jest.fn(),
    creerClient: jest.fn(),
    detail: jest.fn(),
    modifierClient: jest.fn(),
    modifierDateLimite: jest.fn(),
    enregistrerRemboursement: jest.fn(),
  };
  const profils: Record<string, { type: string; codes: string[] }> = {
    lecteur: { type: 'PHARMACIE', codes: ['credit:read'] },
    ecrivain: { type: 'PHARMACIE', codes: ['credit:read', 'credit:write'] },
    sanscredit: { type: 'PHARMACIE', codes: ['vente:read'] },
    hopital: { type: 'HOPITAL', codes: ['credit:read', 'credit:write'] },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve({
          appRole: {
            permissions: profils[where.id].codes.map((code) => ({
              permission: { code },
            })),
          },
          structure: { type: profils[where.id].type },
          administeredStructure: null,
        }),
      ),
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CreditController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        {
          provide: REDIS_CLIENT,
          useValue: {
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn(),
            del: jest.fn(),
          },
        },
        { provide: CreditService, useValue: m },
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
    for (const f of Object.values(m)) {
      f.mockReset().mockResolvedValue({
        data: {},
        message: 'ok',
        success: true,
      });
    }
  });
  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('1. lecture : credit:read suffit, écriture refusée sans credit:write', async () => {
    const lecture = await request(serveur())
      .get('/pharmacie/s1/credits')
      .set('x-essai-user', 'lecteur');
    expect(lecture.status).toBe(200);
    const ecriture = await request(serveur())
      .post('/pharmacie/s1/credits/clients/c1/remboursements')
      .set('x-essai-user', 'lecteur')
      .send({ montant: 1000 });
    expect(ecriture.status).toBe(403);
    expect(m.enregistrerRemboursement).not.toHaveBeenCalled();
  });

  it('2. sans permission de crédit ou dans un hôpital : 403', async () => {
    for (const u of ['sanscredit', 'hopital']) {
      const r = await request(serveur())
        .get('/pharmacie/s1/credits')
        .set('x-essai-user', u);
      expect(r.status).toBe(403);
    }
    expect(m.lister).not.toHaveBeenCalled();
  });

  it('3. remboursement : montant entier supérieur à zéro, verseEnCaisse booléen', async () => {
    for (const corps of [
      { montant: 0 },
      { montant: 10.5 },
      { montant: 'x' },
      { montant: 5, verseEnCaisse: 'oui' },
      {},
    ]) {
      const r = await request(serveur())
        .post('/pharmacie/s1/credits/clients/c1/remboursements')
        .set('x-essai-user', 'ecrivain')
        .send(corps);
      expect(r.status).toBe(400);
    }
    const ok = await request(serveur())
      .post('/pharmacie/s1/credits/clients/c1/remboursements')
      .set('x-essai-user', 'ecrivain')
      .send({ montant: 5000, verseEnCaisse: true, note: 'Payé' });
    expect(ok.status).toBe(201);
    expect(m.enregistrerRemboursement).toHaveBeenCalledWith(
      's1',
      'ecrivain',
      'c1',
      expect.objectContaining({ montant: 5000, verseEnCaisse: true }),
      expect.anything(),
    );
  });

  it('4. client : nom obligatoire, téléphone validé', async () => {
    const post = (corps: object) =>
      request(serveur())
        .post('/pharmacie/s1/credits/clients')
        .set('x-essai-user', 'ecrivain')
        .send(corps);
    expect((await post({ telephone: '621000000' })).status).toBe(400);
    expect(
      (await post({ nomComplet: 'Mamadou Bah', telephone: 'abc' })).status,
    ).toBe(400);
    expect((await post({ nomComplet: 'Mamadou Bah' })).status).toBe(201);
  });

  it('5. date limite : format AAAA-MM-JJ ou null', async () => {
    const patch = (corps: object) =>
      request(serveur())
        .patch('/pharmacie/s1/credits/prises/v1/date-limite')
        .set('x-essai-user', 'ecrivain')
        .send(corps);
    expect((await patch({ dateLimite: '15/12/2026' })).status).toBe(400);
    expect((await patch({ dateLimite: '2026-12-15' })).status).toBe(200);
    expect((await patch({ dateLimite: null })).status).toBe(200);
  });

  it('6. liste : statut filtrable, valeur inconnue refusée', async () => {
    const get = (q: string) =>
      request(serveur())
        .get(`/pharmacie/s1/credits${q}`)
        .set('x-essai-user', 'lecteur');
    expect((await get('?statut=AUTRE')).status).toBe(400);
    expect((await get('?statut=EN_RETARD&q=bah')).status).toBe(200);
  });
});
