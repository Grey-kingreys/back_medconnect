/* eslint-disable @typescript-eslint/unbound-method */
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import request from 'supertest';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { AllExceptionsFilter } from 'src/common/filters/all-exceptions.filter';
import { fabriquerErreurValidation } from 'src/common/filters/erreur-validation';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PharmacieController } from './pharmacie.controller';
import {
  COLONNES_MODELE_LIVRAISON,
  MIME_XLSX,
  PharmacieService,
  normaliserPourFichier,
} from './pharmacie.service';
import { CatalogueImportService } from './catalogue-import.service';
import {
  AccesPharmacieService,
  MESSAGE_ACCES_PHARMACIE_REFUSE,
} from './acces-pharmacie.service';
import { MouvementsStockService } from './stock/mouvements-stock.service';
import type { ReceptionsService } from './receptions/receptions.service';
import type { InventairesService } from './inventaires/inventaires.service';
import { jourConakry } from './jour-metier';
import { PERMISSIONS_KEY } from 'src/common/rbac/require-permissions.decorator';

const STRUCTURE_ID = 'structure-1';
const USER_ID = 'pharmacien-1';

function fiche(
  id: string,
  nom: string,
  quantite: number,
  lots: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    medicament: { id: `med-${id}`, nom, nomGenerique: null },
    quantite,
    coefficientBoite: 10,
    prixUnitaire: 5000,
    notes: null,
    qualifie: true,
    uniteMinimale: 'GELULE',
    lots,
    ...extra,
  };
}

const FICHES = [
  fiche('a', 'Amoxicilline 500 mg', 50, [
    {
      id: 'l1',
      numeroLot: 'L1',
      dateExpiration: new Date(Date.UTC(2027, 5, 30)),
      quantite: 30,
      coefficientReception: 10,
      lotTechnique: false,
      coutUnitaire: 300,
    },
    {
      id: 'l2',
      numeroLot: null,
      dateExpiration: null,
      quantite: 25,
      coefficientReception: 10,
      lotTechnique: false,
      coutUnitaire: 0,
    },
  ]),
  fiche('b', 'Paracétamol 500 mg', 3, [
    {
      id: 'l3',
      numeroLot: 'P9',
      dateExpiration: new Date(Date.UTC(2028, 0, 31)),
      quantite: 3,
      coefficientReception: 10,
      lotTechnique: false,
      coutUnitaire: 200,
    },
  ]),
  fiche('c', 'Coartem', 0, [], { qualifie: false, notes: 'À qualifier' }),
];

describe('PharmacieService, export du stock', () => {
  let permissionsDuTest: string[];
  let structureTrouvee: Record<string, unknown>;
  let service: PharmacieService;

  async function lire(contenu: Buffer) {
    const classeur = new Workbook();
    await classeur.xlsx.load(contenu as unknown as ArrayBuffer);
    const feuille = classeur.getWorksheet('Stock');
    const lignes: unknown[][] = [];
    feuille?.eachRow((row) => lignes.push((row.values as unknown[]).slice(1)));
    return lignes;
  }

  beforeEach(() => {
    permissionsDuTest = ['stock:read', 'stock:write', 'marge:read'];
    structureTrouvee = {
      id: STRUCTURE_ID,
      type: 'PHARMACIE',
      adminId: null,
      isActive: true,
      nom: 'Pharmacie Étoile du Matin',
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          nom: 'A',
          prenom: 'B',
          structureId: STRUCTURE_ID,
        }),
      },
      structure: {
        findUnique: jest.fn(() => Promise.resolve(structureTrouvee)),
      },
      parametresPharmacie: {
        findUnique: jest.fn().mockResolvedValue({ seuilStockBas: 1 }),
      },
    };
    service = new PharmacieService(
      prisma as unknown as PrismaService,
      {} as unknown as NotificationsService,
      new AccesPharmacieService(prisma as unknown as PrismaService),
      new MouvementsStockService(),
      {
        getUserPermissions: () => Promise.resolve(permissionsDuTest),
      } as unknown as PermissionsService,
      {} as unknown as ReceptionsService,
      {} as unknown as InventairesService,
    );
    jest
      .spyOn(
        service as unknown as { lireFichesStock: () => Promise<unknown> },
        'lireFichesStock',
      )
      .mockResolvedValue(FICHES);
  });

  it('1. mêmes titres de colonnes que le modèle d’import', async () => {
    const { contenu } = await service.exporterStock(STRUCTURE_ID, USER_ID);
    const lignes = await lire(contenu);
    expect(lignes[0]).toEqual(COLONNES_MODELE_LIVRAISON.map((c) => c.header));
    expect(lignes[0]).toEqual([
      'Médicament',
      'Quantité (boîtes)',
      'Prix de la boîte (GNF)',
      "Date d'expiration (AAAA-MM-JJ)",
      'Lot',
      "Coût d'achat de la boîte (GNF)",
      'Notes',
    ]);
  });

  it('2. une ligne par lot, une ligne sans péremption pour un produit sans lot, coûts avec marge:read', async () => {
    const { contenu } = await service.exporterStock(STRUCTURE_ID, USER_ID);
    const lignes = await lire(contenu);
    expect(lignes[1]).toEqual([
      'Amoxicilline 500 mg',
      3,
      5000,
      new Date(Date.UTC(2027, 5, 30)),
      'L1',
      3000,
    ]);
    // Lot sans date ni coût connu
    expect(lignes[2][1]).toBe(2);
    // Boîte entamée : boîtes entières, reste dans les notes (jamais de quantité décimale)
    expect(lignes[2][6]).toBe('Boîte entamée : 5 gélules en plus');
    // Aucune boîte entière : ligne gardée avec la quantité 0 et la note
    expect(lignes[3][1]).toBe(0);
    expect(lignes[3][6]).toBe('Boîte entamée : 3 gélules en plus');
    for (const l of lignes.slice(1)) {
      expect(Number.isInteger(l[1])).toBe(true);
    }
    expect(lignes[2][3] ?? null).toBeNull();
    expect(lignes[2][5] ?? null).toBeNull();
    // Produit sans lot : une ligne sans péremption
    expect(lignes[4][0]).toBe('Coartem');
    expect(lignes[4][3] ?? null).toBeNull();
    expect(lignes[4][6]).toBe('À qualifier');
  });

  it('3. sans marge:read, la colonne de coût est vide', async () => {
    permissionsDuTest = ['stock:read', 'stock:write'];
    const { contenu } = await service.exporterStock(STRUCTURE_ID, USER_ID);
    const lignes = await lire(contenu);
    expect(lignes.slice(1).every((l) => (l[5] ?? null) === null)).toBe(true);
  });

  it('4. filtres : alertes, rupture, qualifier et recherche', async () => {
    const noms = async (options: Parameters<typeof service.exporterStock>[2]) =>
      (
        await lire(
          (await service.exporterStock(STRUCTURE_ID, USER_ID, options)).contenu,
        )
      )
        .slice(1)
        .map((l) => l[0]);
    expect(await noms({ filtre: 'alertes' })).toEqual(['Paracétamol 500 mg']);
    expect(await noms({ filtre: 'rupture' })).toEqual(['Coartem']);
    expect(await noms({ filtre: 'qualifier' })).toEqual(['Coartem']);
    expect(await noms({ q: 'amox' })).toEqual([
      'Amoxicilline 500 mg',
      'Amoxicilline 500 mg',
    ]);
  });

  it('5b. stock négatif : quantité 0 et note explicite, sans coût', async () => {
    jest
      .spyOn(
        service as unknown as { lireFichesStock: () => Promise<unknown> },
        'lireFichesStock',
      )
      .mockResolvedValue([
        fiche('n', 'Ventoline', 0, [], { quantiteARegulariser: 4 }),
      ]);
    const { contenu } = await service.exporterStock(STRUCTURE_ID, USER_ID);
    const lignes = await lire(contenu);
    expect(lignes).toHaveLength(2);
    expect(lignes[1][1]).toBe(0);
    expect(lignes[1][5] ?? null).toBeNull();
    expect(lignes[1][6]).toBe('Stock négatif dans MedConnecte : -4 gélules');
  });

  it('5. nom du fichier normalisé avec la date du jour', async () => {
    const { nomFichier } = await service.exporterStock(STRUCTURE_ID, USER_ID);
    expect(nomFichier).toBe(
      `stock-pharmacie-etoile-du-matin-${jourConakry(new Date())}.xlsx`,
    );
    expect(normaliserPourFichier('  ÉÈ  ')).toBe('ee');
    expect(normaliserPourFichier('***')).toBe('pharmacie');
  });

  it('6. structure étrangère refusée', async () => {
    structureTrouvee = { ...structureTrouvee, id: 'autre' };
    const prismaEtrangere = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          nom: 'A',
          prenom: 'B',
          structureId: 'ma-structure',
        }),
      },
      structure: {
        findUnique: jest.fn(() => Promise.resolve(structureTrouvee)),
      },
    };
    const acces = new AccesPharmacieService(
      prismaEtrangere as unknown as PrismaService,
    );
    await expect(acces.verifier('autre', USER_ID)).rejects.toThrow(
      new ForbiddenException(MESSAGE_ACCES_PHARMACIE_REFUSE),
    );
  });
});

describe("Route d'export du stock (HTTP)", () => {
  let app: INestApplication;
  const exporterStock = jest.fn();
  let refuser = false;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PharmacieController],
      providers: [
        { provide: PharmacieService, useValue: { exporterStock } },
        { provide: CatalogueImportService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest<{ user?: unknown }>();
          req.user = { userId: USER_ID, role: 'PHARMACIEN' };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => !refuser })
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
    refuser = false;
    exporterStock.mockReset().mockResolvedValue({
      contenu: Buffer.from('xlsx'),
      nomFichier: 'stock-demo-2027-01-01.xlsx',
    });
  });

  const serveur = () => app.getHttpServer() as Parameters<typeof request>[0];

  it('7. flux xlsx avec Content-Disposition, filtre et recherche transmis', async () => {
    const res = await request(serveur()).get(
      `/pharmacie/stock/${STRUCTURE_ID}/export?filtre=alertes&q=para`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(MIME_XLSX);
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="stock-demo-2027-01-01.xlsx"',
    );
    expect(exporterStock).toHaveBeenCalledWith(STRUCTURE_ID, USER_ID, {
      filtre: 'alertes',
      q: 'para',
    });
  });

  it('8. filtre inconnu : 400 VALIDATION', async () => {
    const res = await request(serveur()).get(
      `/pharmacie/stock/${STRUCTURE_ID}/export?filtre=tout`,
    );
    expect(res.status).toBe(400);
    expect(exporterStock).not.toHaveBeenCalled();
  });

  it('9. sans la permission : refus, rien exporté', async () => {
    refuser = true;
    const res = await request(serveur()).get(
      `/pharmacie/stock/${STRUCTURE_ID}/export`,
    );
    expect(res.status).toBe(403);
    expect(exporterStock).not.toHaveBeenCalled();
  });

  it('10. mêmes permissions que la lecture du stock', () => {
    const lire = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PharmacieController.prototype.getStock,
    ) as unknown;
    const exporter = Reflect.getMetadata(
      PERMISSIONS_KEY,
      PharmacieController.prototype.exporterStock,
    ) as unknown;
    expect(lire).toBeDefined();
    expect(exporter).toBeDefined();
    expect(exporter).toEqual(lire);
  });
});
