import {
  ConflictException,
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
import { VenteController } from './vente.controller';
import { VenteService } from './vente.service';

/**
 * Routes de vente : vrai PermissionsGuard et vrai PermissionsService (Redis et Prisma
 * simulés), même ValidationPipe que main.ts, VenteService simulé.
 */
describe('Ventes en pharmacie (HTTP)', () => {
  let app: INestApplication;
  const creerVente = jest.fn();
  const listerVentes = jest.fn();
  const detailVente = jest.fn();
  const annulerVente = jest.fn();

  /** Rôle et type de structure selon l'utilisateur de l'essai. */
  const profils: Record<string, { type: string; codes: string[] }> = {
    hopital: {
      type: 'HOPITAL',
      codes: ['vente:read', 'vente:write', 'vente:annuler', 'carnet:read'],
    },
    pharmacien: { type: 'PHARMACIE', codes: ['vente:read', 'vente:write'] },
    admin: {
      type: 'PHARMACIE',
      codes: ['vente:read', 'vente:write', 'vente:annuler'],
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
      controllers: [VenteController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: VenteService,
          useValue: { creerVente, listerVentes, detailVente, annulerVente },
        },
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
    for (const m of [creerVente, listerVentes, detailVente, annulerVente]) {
      m.mockReset().mockResolvedValue({
        data: {},
        message: 'ok',
        success: true,
      });
    }
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];
  const corpsValide = { lignes: [{ stockId: 'st1', quantite: 2 }] };

  it("1. membre d'un hôpital avec les permissions de vente : 403 PERMISSION_REFUSEE", async () => {
    const lecture = await request(serveur())
      .get('/pharmacie/s1/ventes')
      .set('x-essai-user', 'hopital');
    const ecriture = await request(serveur())
      .post('/pharmacie/s1/ventes')
      .set('x-essai-user', 'hopital')
      .send(corpsValide);

    for (const res of [lecture, ecriture]) {
      expect(res.status).toBe(403);
      expect((res.body as { code?: string }).code).toBe('PERMISSION_REFUSEE');
    }
    expect(listerVentes).not.toHaveBeenCalled();
    expect(creerVente).not.toHaveBeenCalled();
  });

  it("2. pharmacien : annulation refusée, création acceptée avec l'en-tête Idempotency-Key", async () => {
    const annulation = await request(serveur())
      .post('/pharmacie/s1/ventes/v1/annuler')
      .set('x-essai-user', 'pharmacien')
      .send({ motif: 'Erreur de quantité' });
    expect(annulation.status).toBe(403);
    expect((annulation.body as { code?: string }).code).toBe(
      'PERMISSION_REFUSEE',
    );
    expect(annulerVente).not.toHaveBeenCalled();

    const creation = await request(serveur())
      .post('/pharmacie/s1/ventes')
      .set('x-essai-user', 'pharmacien')
      .set('Idempotency-Key', 'cle-panier-0001')
      .send(corpsValide);
    expect(creation.status).toBe(201);
    expect(creerVente).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      corpsValide,
      'cle-panier-0001',
      expect.anything(),
    );
  });

  it('2b. administrateur : annulation acceptée (200), motif nettoyé', async () => {
    const res = await request(serveur())
      .post('/pharmacie/s1/ventes/v1/annuler')
      .set('x-essai-user', 'admin')
      .send({ motif: '  Erreur de quantité  ' });
    expect(res.status).toBe(200);
    expect(annulerVente).toHaveBeenCalledWith(
      's1',
      'v1',
      'admin',
      { motif: 'Erreur de quantité' },
      expect.anything(),
    );
  });

  describe('3. corps invalides : 400 VALIDATION', () => {
    const cas: [string, 'post' | 'get' | 'annuler', object, string][] = [
      ['lignes vide', 'post', { lignes: [] }, 'lignes'],
      [
        'quantité 0',
        'post',
        { lignes: [{ stockId: 'st1', quantite: 0 }] },
        'lignes',
      ],
      [
        'quantité 1.5',
        'post',
        { lignes: [{ stockId: 'st1', quantite: 1.5 }] },
        'lignes',
      ],
      [
        'champ inconnu',
        'post',
        { ...corpsValide, prixUnitaire: 1 },
        'prixUnitaire',
      ],
      ['motif de 2 caractères', 'annuler', { motif: 'ab' }, 'motif'],
      ['date 22-10-2026', 'get', {}, 'date'],
    ];

    it.each(cas)('%s', async (_nom, type, corps, champ) => {
      const test =
        type === 'post'
          ? request(serveur()).post('/pharmacie/s1/ventes').send(corps)
          : type === 'annuler'
            ? request(serveur())
                .post('/pharmacie/s1/ventes/v1/annuler')
                .send(corps)
            : request(serveur()).get('/pharmacie/s1/ventes?date=22-10-2026');

      const res = await test.set(
        'x-essai-user',
        type === 'annuler' ? 'admin' : 'pharmacien',
      );

      const reponse = res.body as {
        code: string;
        champs: { champ: string }[];
      };
      expect(res.status).toBe(400);
      expect(reponse.code).toBe('VALIDATION');
      expect(reponse.champs.map((c) => c.champ).join(' ')).toContain(champ);
      expect(creerVente).not.toHaveBeenCalled();
      expect(annulerVente).not.toHaveBeenCalled();
      expect(listerVentes).not.toHaveBeenCalled();
    });
  });

  it('4. 409 STOCK_INSUFFISANT : la réponse porte details filtré', async () => {
    creerVente.mockRejectedValue(
      new ConflictException({
        message: 'Le stock ne suffit plus pour « Doliprane » : il en reste 0.',
        code: 'STOCK_INSUFFISANT',
        details: [
          {
            stockId: 'st1',
            nom: 'Doliprane',
            disponible: 0,
            demande: 2,
            interne: 'à ne pas exposer',
          },
        ],
      }),
    );

    const res = await request(serveur())
      .post('/pharmacie/s1/ventes')
      .set('x-essai-user', 'pharmacien')
      .send(corpsValide);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'STOCK_INSUFFISANT',
      details: [
        { stockId: 'st1', nom: 'Doliprane', disponible: 0, demande: 2 },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain('interne');
  });

  it('liste et détail : la permission vente:read suffit', async () => {
    const liste = await request(serveur())
      .get('/pharmacie/s1/ventes?date=2026-10-22&page=2')
      .set('x-essai-user', 'pharmacien');
    expect(liste.status).toBe(200);
    expect(listerVentes).toHaveBeenCalledWith('s1', 'pharmacien', {
      date: '2026-10-22',
      page: 2,
    });

    const detail = await request(serveur())
      .get('/pharmacie/s1/ventes/v1')
      .set('x-essai-user', 'pharmacien');
    expect(detail.status).toBe(200);
    expect(detailVente).toHaveBeenCalledWith('s1', 'v1', 'pharmacien');
  });
});
