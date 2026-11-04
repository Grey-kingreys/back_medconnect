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
import { ClotureController } from './clotures.controller';
import { ClotureService } from './clotures.service';

/**
 * Routes de la clôture journalière : vrai PermissionsGuard et vrai PermissionsService
 * (Redis et Prisma simulés), même ValidationPipe que main.ts, service simulé.
 */
describe('Clôture journalière (HTTP)', () => {
  let app: INestApplication;
  const preparer = jest.fn();
  const cloturer = jest.fn();
  const lister = jest.fn();
  const exporter = jest.fn();
  const services = [preparer, cloturer, lister, exporter];

  const profils: Record<string, { type: string; codes: string[] }> = {
    titulaire: {
      type: 'PHARMACIE',
      codes: ['cloture:gerer', 'caisse:utiliser', 'caisse:superviser'],
    },
    vendeur: {
      type: 'PHARMACIE',
      codes: ['caisse:utiliser', 'caisse:superviser'],
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
      controllers: [ClotureController],
      providers: [
        PermissionsService,
        PermissionsGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: REDIS_CLIENT, useValue: redis },
        {
          provide: ClotureService,
          useValue: { preparer, cloturer, lister, exporter },
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
            role: 'STRUCTURE_ADMIN',
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
    exporter.mockResolvedValue({
      nomFichier: 'cloture-2026-10-30.csv',
      contenu: Buffer.from('\u{FEFF}Jour;Ligne\r\n', 'utf8'),
    });
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];
  const base = '/pharmacie/s1/caisse/clotures';

  interface CorpsErreur {
    code?: string;
    message?: string;
    details?: unknown;
    champs?: { champ: string; contraintes: string[] }[];
  }

  const corps = (res: request.Response) => res.body as CorpsErreur;

  it('1. la préparation exige cloture:gerer : vendeur 403, service non appelé', async () => {
    const res = await request(serveur())
      .get(`${base}/2026-10-30/preparation`)
      .set('x-essai-user', 'vendeur');
    expect(res.status).toBe(403);
    expect(preparer).not.toHaveBeenCalled();
  });

  it('2. le titulaire prépare la clôture', async () => {
    const res = await request(serveur())
      .get(`${base}/2026-10-30/preparation`)
      .set('x-essai-user', 'titulaire');
    expect(res.status).toBe(200);
    expect(preparer).toHaveBeenCalledWith('s1', 'titulaire', '2026-10-30');
  });

  it('3. la clôture rogne le motif et répond 200', async () => {
    const res = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({
        jour: '2026-10-30',
        forcer: true,
        motifForcage: '  Poste D1 en panne  ',
      });
    expect(res.status).toBe(200);
    expect(cloturer).toHaveBeenCalledWith(
      's1',
      'titulaire',
      { jour: '2026-10-30', forcer: true, motifForcage: 'Poste D1 en panne' },
      expect.anything(),
    );
  });

  it('4. un jour mal formé est refusé', async () => {
    const res = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({ jour: '30/10/2026' });
    expect(res.status).toBe(400);
    expect(corps(res).code).toBe('VALIDATION');
    expect(corps(res).champs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ champ: 'jour', contraintes: ['matches'] }),
      ]),
    );
    expect(cloturer).not.toHaveBeenCalled();
  });

  it('5. forcer doit être un booléen et aucun champ inconnu n’est accepté', async () => {
    const res = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({ jour: '2026-10-30', forcer: 'oui' });
    expect(res.status).toBe(400);
    expect(corps(res).code).toBe('VALIDATION');
    expect(corps(res).champs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          champ: 'forcer',
          contraintes: expect.arrayContaining(['isBoolean']) as string[],
        }),
      ]),
    );
    const inconnu = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({ jour: '2026-10-30', autre: 1 });
    expect(inconnu.status).toBe(400);
    expect(cloturer).not.toHaveBeenCalled();
  });

  it('6. la liste valide le mois', async () => {
    const mauvais = await request(serveur())
      .get(`${base}?mois=2026-13`)
      .set('x-essai-user', 'titulaire');
    expect(mauvais.status).toBe(400);
    expect(corps(mauvais).code).toBe('VALIDATION');
    expect(corps(mauvais).champs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ champ: 'mois', contraintes: ['matches'] }),
      ]),
    );
    expect(lister).not.toHaveBeenCalled();
    const bon = await request(serveur())
      .get(`${base}?mois=2026-10`)
      .set('x-essai-user', 'titulaire');
    expect(bon.status).toBe(200);
    expect(lister).toHaveBeenCalledWith('s1', 'titulaire', {
      mois: '2026-10',
    });
  });

  it('7. CLOTURE_INCOMPLETE renvoie les postes assainis', async () => {
    cloturer.mockRejectedValue(
      new ConflictException({
        code: 'CLOTURE_INCOMPLETE',
        message: 'm',
        details: [
          {
            posteId: 'p1',
            posteCode: 'D1',
            libelle: 'Poste D1',
            type: 'DESKTOP',
            raison: 'SESSION_OUVERTE',
            sessionId: 's-1',
            utilisateurNom: 'Mamadou Diallo',
            dernierContactLe: null,
            message: 'La caisse...',
            secret: 'x',
          },
        ],
      }),
    );
    const res = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({ jour: '2026-10-30' });
    expect(res.status).toBe(409);
    expect(corps(res).code).toBe('CLOTURE_INCOMPLETE');
    expect(corps(res).details).toEqual([
      {
        posteId: 'p1',
        posteCode: 'D1',
        libelle: 'Poste D1',
        type: 'DESKTOP',
        raison: 'SESSION_OUVERTE',
        sessionId: 's-1',
        utilisateurNom: 'Mamadou Diallo',
        message: 'La caisse...',
      },
    ]);
  });

  it('8. JOURNEE_DEJA_CLOTUREE garde son message et n’a pas de details', async () => {
    cloturer.mockRejectedValue(
      new ConflictException({
        code: 'JOURNEE_DEJA_CLOTUREE',
        message: 'La journée du 30/10/2026 est déjà clôturée.',
        details: [{ posteId: 'p1' }],
      }),
    );
    const res = await request(serveur())
      .post(base)
      .set('x-essai-user', 'titulaire')
      .send({ jour: '2026-10-30' });
    expect(res.status).toBe(409);
    expect(corps(res).code).toBe('JOURNEE_DEJA_CLOTUREE');
    expect(corps(res).message).toBe(
      'La journée du 30/10/2026 est déjà clôturée.',
    );
    expect(corps(res).details).toBeUndefined();
  });

  it('9. l’export exige cloture:gerer : vendeur 403, service non appelé', async () => {
    const res = await request(serveur())
      .get(`${base}/2026-10-30/export`)
      .set('x-essai-user', 'vendeur');
    expect(res.status).toBe(403);
    expect(exporter).not.toHaveBeenCalled();
  });

  it('10. le titulaire télécharge le fichier CSV', async () => {
    const res = await request(serveur())
      .get(`${base}/2026-10-30/export`)
      .set('x-essai-user', 'titulaire');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/csv');
    expect(String(res.headers['content-disposition'])).toContain(
      'cloture-2026-10-30.csv',
    );
    expect(exporter).toHaveBeenCalledWith('s1', 'titulaire', '2026-10-30');
    expect(preparer).not.toHaveBeenCalled();
  });
});
