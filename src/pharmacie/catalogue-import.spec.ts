import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Workbook } from 'exceljs';
import { CatalogueImportService } from './catalogue-import.service';
import { PharmacieController } from './pharmacie.controller';
import { MIME_XLSX } from './import-excel';
import { FichierImport } from './dto/pharmacie.dto';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PermissionsGuard } from 'src/common/rbac/permissions.guard';
import { PermissionsService } from 'src/common/rbac/permissions.service';
import { PERMISSIONS_KEY } from 'src/common/rbac/require-permissions.decorator';
import { PERMISSIONS } from 'src/common/rbac/permissions.constants';

/** Forme minimale d'un appel à medicament.create observé par les tests. */
type OperationCreation = { data: Record<string, unknown> };

/**
 * Tests de l'import Excel du catalogue (modèle, aperçu, import) : classeur
 * construit en mémoire avec exceljs, Prisma et les notifications simulés.
 */
describe('CatalogueImportService, import Excel du catalogue', () => {
  const USER_ID = 'admin-1';
  const ENTETES = [
    'Nom',
    'Nom générique',
    'Catégorie',
    'Description',
    'Ordonnance requise',
    'Formes',
  ];

  let create: jest.Mock<OperationCreation, [OperationCreation]>;
  let transaction: jest.Mock<Promise<unknown[]>, [OperationCreation[]]>;
  let notifications: { createManyNotifications: jest.Mock };
  let service: CatalogueImportService;

  async function construireFichier(
    lignes: unknown[][],
    entetes: string[] = ENTETES,
    options: Partial<FichierImport> = {},
  ): Promise<FichierImport> {
    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Catalogue');
    feuille.addRow(entetes);
    lignes.forEach((ligne) => feuille.addRow(ligne));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      size: buffer.length,
      mimetype: MIME_XLSX,
      originalname: 'catalogue.xlsx',
      ...options,
    };
  }

  beforeEach(() => {
    create = jest.fn((args: OperationCreation) => args);
    transaction = jest.fn((operations: OperationCreation[]) =>
      Promise.resolve(operations),
    );
    const prisma = {
      medicament: {
        findMany: jest.fn().mockResolvedValue([
          { nom: 'Paracétamol 500 mg', categorie: 'Antalgique' },
          { nom: 'Coartem 20mg/120mg', categorie: 'Antipaludéen' },
        ]),
        create,
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          prenom: 'Aïssatou',
          nom: 'Diallo',
          structure: null,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: 'super-1' }]),
      },
      $transaction: transaction,
    };
    notifications = { createManyNotifications: jest.fn() };
    service = new CatalogueImportService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('fournit un modèle avec les en-têtes en français, une ligne d’exemple et une notice', async () => {
    const contenu = await service.getModeleImportCatalogue();

    const workbook = new Workbook();
    await workbook.xlsx.load(contenu as unknown as ArrayBuffer);
    const feuille = workbook.getWorksheet('Catalogue');
    expect(feuille).toBeDefined();
    expect((feuille?.getRow(1).values as unknown[]).slice(1)).toEqual(ENTETES);
    expect(feuille?.getRow(2).getCell(1).value).toBe('Coartem 20mg/120mg');
    expect(workbook.getWorksheet("Mode d'emploi")?.rowCount).toBeGreaterThan(0);

    // Le modèle téléchargé est accepté tel quel par l'aperçu
    const fichier: FichierImport = {
      buffer: contenu,
      size: contenu.length,
      mimetype: MIME_XLSX,
      originalname: 'modele-import-catalogue.xlsx',
    };
    const { data } = await service.apercuImportCatalogue(fichier);
    expect(data.totalLignes).toBe(1);
  });

  it('refuse un fichier sans les colonnes obligatoires en les nommant', async () => {
    const fichier = await construireFichier(
      [['Amoxicilline', 'Antibiotique']],
      ['Nom générique', 'Description'],
    );

    const appel = service.apercuImportCatalogue(fichier);

    await expect(appel).rejects.toThrow(BadRequestException);
    await expect(appel).rejects.toThrow('« Nom » et « Catégorie »');
  });

  it('rejette une ligne sans nom ou sans catégorie, avec la raison', async () => {
    const fichier = await construireFichier([
      ['', 'Amoxicilline', 'Antibiotique'],
      ['Amoxicilline 500 mg', '', ''],
      ['A', '', 'Antibiotique'],
    ]);

    const { data, message } = await service.apercuImportCatalogue(fichier);

    expect(data.rejetees).toBe(3);
    expect(data.lignes[0].raison).toContain('Indiquez le nom du médicament.');
    expect(data.lignes[1].raison).toContain('Indiquez la catégorie');
    expect(data.lignes[2].raison).toContain('entre 2 et 200 caractères');
    expect(message).toBe(
      'Aucun médicament prêt à être ajouté au catalogue, 3 lignes écartées.',
    );
  });

  it('lit oui et non dans toutes leurs écritures, vide valant non', async () => {
    const fichier = await construireFichier([
      ['Méd A', '', 'Antibiotique', '', 'Oui'],
      ['Méd B', '', 'Antibiotique', '', 'OUI'],
      ['Méd C', '', 'Antibiotique', '', 'o'],
      ['Méd D', '', 'Antibiotique', '', 'non'],
      ['Méd E', '', 'Antibiotique', '', 'n'],
      ['Méd F', '', 'Antibiotique', '', ''],
      ['Méd G', '', 'Antibiotique', '', 'peut-être'],
    ]);

    const { data } = await service.apercuImportCatalogue(fichier);

    expect(data.lignes.map((l) => l.ordonnanceRequise)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      undefined,
    ]);
    expect(data.lignes[6]).toMatchObject({
      statut: 'rejetee',
      raison: expect.stringContaining('écrivez oui ou non') as string,
    });
  });

  it('découpe les formes séparées par des virgules, sans doublons ni cases vides', async () => {
    const fichier = await construireFichier([
      [
        'Amoxicilline 500 mg',
        'Amoxicilline',
        'antibiotique',
        'Infections',
        'oui',
        ' comprimé , sirop,, Sirop ,injectable ',
      ],
    ]);

    const { data } = await service.apercuImportCatalogue(fichier);

    expect(data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      nom: 'Amoxicilline 500 mg',
      nomGenerique: 'Amoxicilline',
      categorie: 'antibiotique',
      description: 'Infections',
      ordonnanceRequise: true,
      formes: ['comprimé', 'sirop', 'injectable'],
    });
  });

  it('reprend l’orthographe d’une catégorie déjà connue du catalogue', async () => {
    const fichier = await construireFichier([['Fansidar', '', 'ANTIPALUDEEN']]);

    const { data } = await service.apercuImportCatalogue(fichier);

    expect(data.lignes[0].categorie).toBe('Antipaludéen');
  });

  it('ignore un médicament déjà au catalogue, sans tenir compte des espaces, de la casse ni des accents', async () => {
    const fichier = await construireFichier([
      ['  PARACETAMOL   500 MG ', '', 'Antalgique'],
    ]);

    const { data } = await service.apercuImportCatalogue(fichier);

    expect(data.lignes[0].statut).toBe('rejetee');
    expect(data.lignes[0].raison).toContain('Déjà au catalogue');
  });

  it('signale un doublon dans le fichier sur la seconde occurrence', async () => {
    const fichier = await construireFichier([
      ['Ibuprofène 400 mg', '', 'Anti-inflammatoire'],
      ['Amoxicilline 500 mg', '', 'Antibiotique'],
      ['ibuprofene  400 MG', '', 'Anti-inflammatoire'],
    ]);

    const { data } = await service.apercuImportCatalogue(fichier);

    expect(data.lignes[0].statut).toBe('acceptee');
    expect(data.lignes[2]).toMatchObject({
      ligne: 4,
      statut: 'rejetee',
      raison: 'Médicament déjà présent à la ligne 2.',
    });
  });

  it("l'aperçu n'écrit rien en base", async () => {
    const fichier = await construireFichier([
      ['Ibuprofène 400 mg', '', 'Anti-inflammatoire'],
    ]);

    const { data, message } = await service.apercuImportCatalogue(fichier);

    expect(data.acceptees).toBe(1);
    expect(message).toBe(
      '1 médicament prêt à être ajouté au catalogue, aucune ligne écartée.',
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(notifications.createManyNotifications).not.toHaveBeenCalled();
  });

  it('refuse un fichier qui n’est pas un classeur .xlsx', async () => {
    const csv = Buffer.from('Nom;Catégorie\nIbuprofène;Antalgique');
    const fichier: FichierImport = {
      buffer: csv,
      size: csv.length,
      mimetype: 'text/csv',
      originalname: 'catalogue.csv',
    };

    await expect(service.apercuImportCatalogue(fichier)).rejects.toThrow(
      'Le fichier doit être un classeur Excel (.xlsx).',
    );
  });

  it("l'import crée seulement les lignes acceptées, en une transaction, et prévient des nouvelles catégories", async () => {
    const fichier = await construireFichier([
      ['Ibuprofène 400 mg', 'Ibuprofène', 'Anti-inflammatoire', '', 'non'],
      ['Paracétamol 500 mg', '', 'Antalgique'],
      ['Fansidar', '', 'antipaludeen', '', 'oui', 'comprimé'],
      ['Sans catégorie', '', ''],
    ]);

    const { data, message } = await service.importerCatalogue(fichier, USER_ID);

    expect(transaction).toHaveBeenCalledTimes(1);
    const operations = transaction.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations[0].data).toEqual({
      nom: 'Ibuprofène 400 mg',
      nomGenerique: 'Ibuprofène',
      categorie: 'Anti-inflammatoire',
      description: undefined,
      ordonnanceRequise: false,
      formes: [],
    });
    expect(operations[1].data).toMatchObject({
      nom: 'Fansidar',
      categorie: 'Antipaludéen',
      ordonnanceRequise: true,
      formes: ['comprimé'],
    });

    expect(data.importees).toBe(2);
    expect(data.rejetees).toBe(2);
    expect(message).toBe(
      '2 médicaments ajoutés au catalogue, 2 lignes écartées.',
    );

    // Seule « Anti-inflammatoire » est une nouvelle catégorie
    expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.createManyNotifications).toHaveBeenCalledWith(
      ['super-1'],
      expect.objectContaining({
        type: 'CATALOGUE_MODIF',
        message: expect.stringContaining(
          'Aïssatou Diallo a ajouté la catégorie "Anti-inflammatoire"',
        ) as string,
      }),
    );
  });

  it("n'écrit rien quand aucune ligne n'est acceptée", async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', '', 'Antalgique'],
    ]);

    const { data } = await service.importerCatalogue(fichier, USER_ID);

    expect(data.importees).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('PharmacieController, permissions de l’import du catalogue', () => {
  const routes = [
    'getModeleImportCatalogue',
    'apercuImportCatalogue',
    'importerCatalogue',
  ] as const;

  it.each(routes)(
    'la route %s exige la permission catalogue:write et le garde des permissions',
    (route) => {
      const handler = PharmacieController.prototype[route];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
        PERMISSIONS.CATALOGUE_WRITE,
      ]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(
        PermissionsGuard,
      );
    },
  );

  it('refuse l’import à un utilisateur sans la permission', async () => {
    const permissionsService = {
      hasPermissions: jest.fn().mockResolvedValue(false),
    };
    const garde = new PermissionsGuard(
      new Reflector(),
      permissionsService as unknown as PermissionsService,
    );
    const handler: unknown = Reflect.get(
      PharmacieController.prototype,
      'importerCatalogue',
    );
    const contexte = {
      getHandler: () => handler,
      getClass: () => PharmacieController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: 'pharmacien-1' } }),
      }),
    } as unknown as ExecutionContext;

    await expect(garde.canActivate(contexte)).rejects.toThrow(
      ForbiddenException,
    );
    expect(permissionsService.hasPermissions).toHaveBeenCalledWith(
      'pharmacien-1',
      [PERMISSIONS.CATALOGUE_WRITE],
    );
  });
});
