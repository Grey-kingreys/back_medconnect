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
import { SessionsCaisseController } from './sessions-caisse.controller';
import { SessionsCaisseService } from './sessions-caisse.service';

/**
 * Routes des sessions de caisse : vrai PermissionsGuard et vrai PermissionsService
 * (Redis et Prisma simulés), même ValidationPipe que main.ts, service simulé.
 */
describe('Sessions de caisse (HTTP)', () => {
  let app: INestApplication;
  const ouvrir = jest.fn();
  const courante = jest.fn();
  const listerDuJour = jest.fn();
  const saisirComptage = jest.fn();
  const enregistrerMouvement = jest.fn();
  const bilan = jest.fn();
  const fermer = jest.fn();
  const services = [
    ouvrir,
    courante,
    listerDuJour,
    saisirComptage,
    enregistrerMouvement,
    bilan,
    fermer,
  ];

  const profils: Record<string, { type: string; codes: string[] }> = {
    hopital: {
      type: 'HOPITAL',
      codes: ['caisse:utiliser', 'caisse:superviser'],
    },
    pharmacien: {
      type: 'PHARMACIE',
      codes: ['stock:read', 'vente:read', 'vente:write', 'caisse:utiliser'],
    },
    admin: {
      type: 'PHARMACIE',
      codes: ['vente:read', 'caisse:utiliser', 'caisse:superviser'],
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
      controllers: [SessionsCaisseController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: SessionsCaisseService,
          useValue: {
            ouvrir,
            courante,
            listerDuJour,
            saisirComptage,
            enregistrerMouvement,
            bilan,
            fermer,
          },
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
    for (const m of services) {
      m.mockReset().mockResolvedValue({
        data: {},
        message: 'ok',
        success: true,
      });
    }
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];
  const ID = '11111111-1111-4111-8111-111111111111';
  const base = '/pharmacie/s1/caisse/sessions';

  interface CorpsErreur {
    code?: string;
    champs?: { champ: string; contraintes: string[] }[];
  }

  const aChamp = (corps: CorpsErreur, champ: string): boolean =>
    (corps.champs ?? []).some(
      (c) => c.champ === champ || c.champ.startsWith(`${champ}.`),
    );

  it('1. les sept routes répondent 200 et appellent le service avec les bons arguments', async () => {
    const coupures = [{ valeurFaciale: 20000, nombre: 3 }];
    const reponses = [
      await request(serveur())
        .post(base)
        .set('x-essai-user', 'pharmacien')
        .send({ posteId: ID, comptage: { coupures } }),
      await request(serveur())
        .get(`${base}/courante?posteId=${ID}`)
        .set('x-essai-user', 'pharmacien'),
      await request(serveur())
        .get(`${base}?jour=2026-10-25`)
        .set('x-essai-user', 'admin'),
      await request(serveur())
        .post(`${base}/${ID}/comptages`)
        .set('x-essai-user', 'pharmacien')
        .send({ moment: 'FERMETURE', coupures }),
      await request(serveur())
        .post(`${base}/${ID}/mouvements`)
        .set('x-essai-user', 'pharmacien')
        .send({ type: 'PRELEVEMENT', montant: 1000, motif: 'Dépôt' }),
      await request(serveur())
        .get(`${base}/${ID}/bilan`)
        .set('x-essai-user', 'pharmacien'),
      await request(serveur())
        .post(`${base}/${ID}/fermer`)
        .set('x-essai-user', 'pharmacien')
        .send({ comptageFermeture: { coupures }, commentaire: '  ok ok  ' }),
    ];
    expect(reponses.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200, 200,
    ]);
    expect(ouvrir).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      expect.objectContaining({ posteId: ID }),
    );
    expect(courante).toHaveBeenCalledWith('s1', 'pharmacien', ID);
    expect(listerDuJour).toHaveBeenCalledWith(
      's1',
      'admin',
      expect.objectContaining({ jour: '2026-10-25' }),
    );
    expect(saisirComptage).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      ID,
      expect.objectContaining({ moment: 'FERMETURE' }),
    );
    expect(enregistrerMouvement).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      ID,
      expect.objectContaining({ type: 'PRELEVEMENT', montant: 1000 }),
    );
    expect(bilan).toHaveBeenCalledWith('s1', 'pharmacien', ID);
    expect(fermer).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      ID,
      expect.objectContaining({ commentaire: 'ok ok' }),
    );
  });

  it('2. GET /caisse/sessions exige caisse:superviser : pharmacien 403 PERMISSION_REFUSEE', async () => {
    const res = await request(serveur())
      .get(base)
      .set('x-essai-user', 'pharmacien');
    expect(res.status).toBe(403);
    expect((res.body as CorpsErreur).code).toBe('PERMISSION_REFUSEE');
    expect(listerDuJour).not.toHaveBeenCalled();
  });

  it('3. hôpital refusé partout (403)', async () => {
    const ouverture = await request(serveur())
      .post(base)
      .set('x-essai-user', 'hopital')
      .send({ posteId: ID });
    const lecture = await request(serveur())
      .get(`${base}/${ID}/bilan`)
      .set('x-essai-user', 'hopital');
    expect(ouverture.status).toBe(403);
    expect(lecture.status).toBe(403);
    expect(ouvrir).not.toHaveBeenCalled();
    expect(bilan).not.toHaveBeenCalled();
  });

  it('4. validation 400 VALIDATION, service jamais appelé', async () => {
    const ok = [{ valeurFaciale: 20000, nombre: 1 }];
    const cas: {
      methode: 'post' | 'get';
      chemin: string;
      corps?: object;
      champ: string;
    }[] = [
      { methode: 'post', chemin: base, corps: {}, champ: 'posteId' },
      {
        methode: 'post',
        chemin: base,
        corps: { posteId: 'pas-un-uuid' },
        champ: 'posteId',
      },
      {
        methode: 'post',
        chemin: base,
        corps: { posteId: ID, id: 'x' },
        champ: 'id',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/comptages`,
        corps: {
          moment: 'FERMETURE',
          coupures: [{ valeurFaciale: 1.5, nombre: 1 }],
        },
        champ: 'coupures',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/comptages`,
        corps: {
          moment: 'FERMETURE',
          coupures: [{ valeurFaciale: 500, nombre: -1 }],
        },
        champ: 'coupures',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/comptages`,
        corps: { moment: 'MILIEU', coupures: ok },
        champ: 'moment',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/mouvements`,
        corps: { type: 'RETRAIT', montant: 1000, motif: 'abc' },
        champ: 'type',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/mouvements`,
        corps: { type: 'APPORT', montant: 0, motif: 'abc' },
        champ: 'montant',
      },
      {
        methode: 'post',
        chemin: `${base}/${ID}/comptages`,
        corps: {
          moment: 'FERMETURE',
          coupures: ok,
          releves: [{ mode: 'orange', montant: 1 }],
        },
        champ: 'releves',
      },
      {
        methode: 'get',
        chemin: `${base}?jour=25-10-2026`,
        champ: 'jour',
      },
      { methode: 'get', chemin: `${base}/courante`, champ: 'posteId' },
      {
        methode: 'post',
        chemin: `${base}/${ID}/comptages`,
        corps: { moment: 'FERMETURE', coupures: ok, pieces: 3 },
        champ: 'pieces',
      },
    ];
    for (const { methode, chemin, corps, champ } of cas) {
      const appel =
        methode === 'post'
          ? request(serveur())
              .post(chemin)
              .set('x-essai-user', champ === 'jour' ? 'admin' : 'pharmacien')
              .send(corps)
          : request(serveur())
              .get(chemin)
              .set('x-essai-user', champ === 'jour' ? 'admin' : 'pharmacien');
      const res = await appel;
      expect(res.status).toBe(400);
      const erreur = res.body as CorpsErreur;
      expect(erreur.code).toBe('VALIDATION');
      expect(aChamp(erreur, champ)).toBe(true);
    }
    for (const m of services) expect(m).not.toHaveBeenCalled();
  });

  it('5. motif absent accepté par le DTO (le service répond MOTIF_REQUIS)', async () => {
    const res = await request(serveur())
      .post(`${base}/${ID}/mouvements`)
      .set('x-essai-user', 'pharmacien')
      .send({ type: 'APPORT', montant: 1000 });
    expect(res.status).toBe(200);
    expect(enregistrerMouvement).toHaveBeenCalledTimes(1);
  });
});
