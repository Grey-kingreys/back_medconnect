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
import { PointsDeVenteController } from './points-de-vente.controller';
import { PointsDeVenteService } from './points-de-vente.service';

/**
 * Routes de caisse (points de vente, postes, référentiels) : vrai PermissionsGuard et
 * vrai PermissionsService (Redis et Prisma simulés), même ValidationPipe que main.ts,
 * PointsDeVenteService simulé.
 */
describe('Points de vente, postes et référentiels (HTTP)', () => {
  let app: INestApplication;
  const referentiels = jest.fn();
  const parametres = jest.fn();
  const modifierParametres = jest.fn();
  const enregistrerPoste = jest.fn();
  const listerPostes = jest.fn();
  const modifierPoste = jest.fn();
  const attribuerPlage = jest.fn();
  const services = [
    attribuerPlage,
    referentiels,
    parametres,
    modifierParametres,
    enregistrerPoste,
    listerPostes,
    modifierPoste,
  ];

  /** Type de structure et permissions selon l'utilisateur de l'essai. */
  const profils: Record<string, { type: string; codes: string[] }> = {
    hopital: {
      type: 'HOPITAL',
      codes: ['caisse:utiliser', 'caisse:superviser', 'structure:write'],
    },
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
    admin: {
      type: 'PHARMACIE',
      codes: [
        'vente:read',
        'caisse:utiliser',
        'caisse:superviser',
        'structure:write',
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
      controllers: [PointsDeVenteController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: PointsDeVenteService,
          useValue: {
            referentiels,
            parametres,
            modifierParametres,
            enregistrerPoste,
            listerPostes,
            modifierPoste,
            attribuerPlage,
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
  const posteValide = { type: 'WEB', appareilId: 'navigateur-essai-0001' };

  interface CorpsErreur {
    code?: string;
    champs?: { champ: string; contraintes: string[] }[];
  }

  const aContrainte = (
    corps: CorpsErreur,
    champ: string,
    contrainte?: string,
  ): boolean =>
    (corps.champs ?? []).some(
      (c) =>
        c.champ === champ &&
        (contrainte === undefined || c.contraintes.includes(contrainte)),
    );

  it('1. membre d un hôpital avec les permissions de caisse : 403 PERMISSION_REFUSEE', async () => {
    const reponses = [
      await request(serveur())
        .get('/pharmacie/s1/referentiels')
        .set('x-essai-user', 'hopital'),
      await request(serveur())
        .get('/pharmacie/s1/parametres')
        .set('x-essai-user', 'hopital'),
      await request(serveur())
        .post('/pharmacie/s1/postes')
        .set('x-essai-user', 'hopital')
        .send(posteValide),
      await request(serveur())
        .get('/pharmacie/s1/postes')
        .set('x-essai-user', 'hopital'),
    ];
    for (const res of reponses) {
      expect(res.status).toBe(403);
      expect((res.body as CorpsErreur).code).toBe('PERMISSION_REFUSEE');
    }
    for (const m of services) expect(m).not.toHaveBeenCalled();
  });

  it('2. pharmacien : référentiels, paramètres et enregistrement de poste acceptés, 200 même à la création', async () => {
    const ref = await request(serveur())
      .get('/pharmacie/s1/referentiels')
      .set('x-essai-user', 'pharmacien');
    const par = await request(serveur())
      .get('/pharmacie/s1/parametres')
      .set('x-essai-user', 'pharmacien');
    const poste = await request(serveur())
      .post('/pharmacie/s1/postes')
      .set('x-essai-user', 'pharmacien')
      .send(posteValide);

    expect([ref.status, par.status, poste.status]).toEqual([200, 200, 200]);
    expect(referentiels).toHaveBeenCalledWith('s1', 'pharmacien');
    expect(parametres).toHaveBeenCalledWith('s1', 'pharmacien');
    expect(enregistrerPoste).toHaveBeenCalledWith(
      's1',
      'pharmacien',
      expect.objectContaining({
        type: 'WEB',
        appareilId: 'navigateur-essai-0001',
      }),
      expect.any(String),
    );
  });

  it('3. pharmacien : liste des postes, modification d un poste et des paramètres refusées', async () => {
    const reponses = [
      await request(serveur())
        .get('/pharmacie/s1/postes')
        .set('x-essai-user', 'pharmacien'),
      await request(serveur())
        .patch('/pharmacie/s1/postes/p1')
        .set('x-essai-user', 'pharmacien')
        .send({ actif: false }),
      await request(serveur())
        .patch('/pharmacie/s1/parametres')
        .set('x-essai-user', 'pharmacien')
        .send({ seuilStockBas: 5 }),
    ];
    for (const res of reponses) expect(res.status).toBe(403);
    for (const m of services) expect(m).not.toHaveBeenCalled();
  });

  it('4. titulaire : liste des postes, modification d un poste et des paramètres acceptées', async () => {
    const liste = await request(serveur())
      .get('/pharmacie/s1/postes')
      .set('x-essai-user', 'admin');
    const poste = await request(serveur())
      .patch('/pharmacie/s1/postes/p1')
      .set('x-essai-user', 'admin')
      .send({ libelle: '  Caisse 1  ', actif: false });
    const par = await request(serveur())
      .patch('/pharmacie/s1/parametres')
      .set('x-essai-user', 'admin')
      .send({ seuilStockBas: 5 });

    expect([liste.status, poste.status, par.status]).toEqual([200, 200, 200]);
    expect(listerPostes).toHaveBeenCalledWith('s1', 'admin');
    expect(modifierPoste).toHaveBeenCalledWith(
      's1',
      'admin',
      'p1',
      expect.objectContaining({ libelle: 'Caisse 1', actif: false }),
      expect.any(String),
    );
    expect(modifierParametres).toHaveBeenCalledWith(
      's1',
      'admin',
      expect.objectContaining({ seuilStockBas: 5 }),
      expect.any(String),
    );
  });

  it('5. enregistrement de poste : type, appareilId, libellé et champ inconnu refusés (VALIDATION)', async () => {
    const cas: { corps: object; champ: string; contrainte?: string }[] = [
      {
        corps: { type: 'TECHNIQUE', appareilId: 'navigateur-essai-0001' },
        champ: 'type',
        contrainte: 'isIn',
      },
      {
        corps: { type: 'WEB', appareilId: 'court' },
        champ: 'appareilId',
        contrainte: 'matches',
      },
      {
        corps: { ...posteValide, libelle: '   ' },
        champ: 'libelle',
      },
      {
        corps: { ...posteValide, posteId: 'x' },
        champ: 'posteId',
        contrainte: 'whitelistValidation',
      },
    ];
    for (const { corps, champ, contrainte } of cas) {
      const res = await request(serveur())
        .post('/pharmacie/s1/postes')
        .set('x-essai-user', 'pharmacien')
        .send(corps);
      expect(res.status).toBe(400);
      const erreur = res.body as CorpsErreur;
      expect(erreur.code).toBe('VALIDATION');
      expect(aContrainte(erreur, champ, contrainte)).toBe(true);
    }
    expect(enregistrerPoste).not.toHaveBeenCalled();
  });

  it('6. paramètres : valeurs hors bornes et dates non modifiables refusées (VALIDATION)', async () => {
    const cas: { corps: object; champ: string; contrainte: string }[] = [
      {
        corps: { horizonsPeremptionJours: [] },
        champ: 'horizonsPeremptionJours',
        contrainte: 'arrayMinSize',
      },
      {
        corps: { horizonsPeremptionJours: [30, 30] },
        champ: 'horizonsPeremptionJours',
        contrainte: 'arrayUnique',
      },
      {
        corps: { horizonsPeremptionJours: [0] },
        champ: 'horizonsPeremptionJours',
        contrainte: 'min',
      },
      {
        corps: { seuilEcartCaisse: -1 },
        champ: 'seuilEcartCaisse',
        contrainte: 'min',
      },
      {
        corps: { taillePlageTickets: 50 },
        champ: 'taillePlageTickets',
        contrainte: 'min',
      },
      {
        corps: { seuilAvertissementPrixPct: 2.5 },
        champ: 'seuilAvertissementPrixPct',
        contrainte: 'isInt',
      },
      {
        corps: { debutCaisse: '2026-01-01' },
        champ: 'debutCaisse',
        contrainte: 'whitelistValidation',
      },
    ];
    for (const { corps, champ, contrainte } of cas) {
      const res = await request(serveur())
        .patch('/pharmacie/s1/parametres')
        .set('x-essai-user', 'admin')
        .send(corps);
      expect(res.status).toBe(400);
      const erreur = res.body as CorpsErreur;
      expect(erreur.code).toBe('VALIDATION');
      expect(aContrainte(erreur, champ, contrainte)).toBe(true);
    }
    expect(modifierParametres).not.toHaveBeenCalled();
  });

  it('7. modification de poste : actif non booléen refusé', async () => {
    const res = await request(serveur())
      .patch('/pharmacie/s1/postes/p1')
      .set('x-essai-user', 'admin')
      .send({ actif: 'oui' });
    expect(res.status).toBe(400);
    expect(aContrainte(res.body as CorpsErreur, 'actif', 'isBoolean')).toBe(
      true,
    );
    expect(modifierPoste).not.toHaveBeenCalled();
  });

  it('8. plage de tickets : identifiant qui n est pas un UUID refusé (VALIDATION)', async () => {
    const res = await request(serveur())
      .post('/pharmacie/s1/postes/p1/plages')
      .set('x-essai-user', 'pharmacien')
      .send({ id: 'abc' });
    expect(res.status).toBe(400);
    const erreur = res.body as CorpsErreur;
    expect(erreur.code).toBe('VALIDATION');
    expect(aContrainte(erreur, 'id')).toBe(true);
    expect(attribuerPlage).not.toHaveBeenCalled();
  });
});
