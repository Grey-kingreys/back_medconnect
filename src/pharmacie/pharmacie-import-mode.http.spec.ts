import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { fabriquerErreurValidation } from 'src/common/filters/erreur-validation';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PharmacieController } from './pharmacie.controller';
import { PharmacieService } from './pharmacie.service';
import { CatalogueImportService } from './catalogue-import.service';

/**
 * Mode de l'import du stock (inventaire ou livraison) : requêtes multipart
 * réelles, avec le même ValidationPipe que main.ts et le service simulé.
 */
describe('Import du stock, champ « mode » (HTTP)', () => {
  let app: INestApplication;
  const apercuImportStock = jest.fn();
  const importerStock = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PharmacieController],
      providers: [
        {
          provide: PharmacieService,
          useValue: { apercuImportStock, importerStock },
        },
        { provide: CatalogueImportService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
          req.user = {
            userId: 'pharmacien-1',
            role: 'PHARMACIEN',
            structureId: 'structure-1',
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
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
    apercuImportStock
      .mockReset()
      .mockResolvedValue({ data: {}, message: 'ok', success: true });
    importerStock
      .mockReset()
      .mockResolvedValue({ data: {}, message: 'ok', success: true });
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('1. aperçu sans champ mode : inventaire par défaut', async () => {
    const res = await request(serveur())
      .post('/pharmacie/stock/structure-1/import/apercu')
      .attach('fichier', Buffer.from('x'), 'stock.xlsx');

    expect(res.status).toBe(200);
    expect(apercuImportStock).toHaveBeenCalledWith(
      'structure-1',
      'pharmacien-1',
      expect.anything(),
      'inventaire',
    );
  });

  it('2. aperçu avec mode livraison', async () => {
    const res = await request(serveur())
      .post('/pharmacie/stock/structure-1/import/apercu')
      .field('mode', 'livraison')
      .attach('fichier', Buffer.from('x'), 'stock.xlsx');

    expect(res.status).toBe(200);
    expect(apercuImportStock).toHaveBeenCalledWith(
      'structure-1',
      'pharmacien-1',
      expect.anything(),
      'livraison',
    );
  });

  it('3. import avec mode livraison', async () => {
    const res = await request(serveur())
      .post('/pharmacie/stock/structure-1/import')
      .field('mode', 'livraison')
      .attach('fichier', Buffer.from('x'), 'stock.xlsx');

    expect(res.status).toBe(200);
    expect(importerStock).toHaveBeenCalledWith(
      'structure-1',
      'pharmacien-1',
      expect.anything(),
      'livraison',
    );
  });

  it.each([
    '/pharmacie/stock/structure-1/import/apercu',
    '/pharmacie/stock/structure-1/import',
  ])(
    '4. mode inconnu sur %s : 400 VALIDATION sur le champ mode',
    async (route) => {
      const res = await request(serveur())
        .post(route)
        .field('mode', 'retour')
        .attach('fichier', Buffer.from('x'), 'stock.xlsx');

      const corps = res.body as {
        code: string;
        champs: { champ: string }[];
      };
      expect(res.status).toBe(400);
      expect(corps.code).toBe('VALIDATION');
      expect(corps.champs).toEqual(
        expect.arrayContaining([expect.objectContaining({ champ: 'mode' })]),
      );
      expect(apercuImportStock).not.toHaveBeenCalled();
      expect(importerStock).not.toHaveBeenCalled();
    },
  );
});
