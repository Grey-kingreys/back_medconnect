import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { PharmacieService, MIME_XLSX } from './pharmacie.service';
import { FichierImport } from './dto/pharmacie.dto';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';

/** Forme minimale d'un appel à stockMedicament.upsert observé par les tests. */
type OperationUpsert = {
  where: { medicamentId_structureId: { medicamentId: string } };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

/**
 * Tests de l'import Excel du stock (aperçu et import) : classeur construit en
 * mémoire avec exceljs, Prisma et les notifications simulés (aucune infra).
 */
describe('PharmacieService, import Excel du stock', () => {
  const STRUCTURE_ID = 'structure-1';
  const USER_ID = 'pharmacien-1';
  const ENTETES = [
    'Médicament',
    'Quantité',
    'Prix unitaire (GNF)',
    "Date d'expiration (AAAA-MM-JJ)",
    'Notes',
  ];

  let prisma: Record<string, unknown>;
  let upsert: jest.Mock<OperationUpsert, [OperationUpsert]>;
  let transaction: jest.Mock<Promise<unknown[]>, [OperationUpsert[]]>;
  let notifications: { createManyNotifications: jest.Mock };
  let service: PharmacieService;

  async function construireFichier(
    lignes: unknown[][],
    entetes: string[] = ENTETES,
    options: Partial<FichierImport> = {},
  ): Promise<FichierImport> {
    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Stock');
    feuille.addRow(entetes);
    lignes.forEach((ligne) => feuille.addRow(ligne));
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return {
      buffer,
      size: buffer.length,
      mimetype: MIME_XLSX,
      originalname: 'stock.xlsx',
      ...options,
    };
  }

  beforeEach(() => {
    upsert = jest.fn((args: OperationUpsert) => args);
    transaction = jest.fn((operations: OperationUpsert[]) =>
      Promise.resolve(operations),
    );
    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: USER_ID,
          role: 'PHARMACIEN',
          structureId: STRUCTURE_ID,
        }),
        findMany: jest.fn().mockResolvedValue([{ id: USER_ID }]),
      },
      structure: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: STRUCTURE_ID, type: 'PHARMACIE' }),
      },
      medicament: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'med-para',
            nom: 'Paracétamol 500 mg',
            nomGenerique: 'Paracétamol',
          },
          { id: 'med-amox', nom: 'Amoxicilline 500 mg', nomGenerique: null },
          {
            id: 'med-coartem',
            nom: 'Coartem 20mg/120mg',
            nomGenerique: 'Artéméther/Luméfantrine',
          },
        ]),
      },
      stockMedicament: { upsert },
      $transaction: transaction,
    };
    notifications = { createManyNotifications: jest.fn() };
    service = new PharmacieService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );
  });

  it('accepte une ligne valide et retrouve le médicament sans tenir compte des accents ni de la casse', async () => {
    const fichier = await construireFichier([
      ['  PARACETAMOL   500 MG ', 40, 1500, '2027-12-31', 'Lot A'],
      ['artemether/lumefantrine', 12],
    ]);

    const { data, message } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(data.totalLignes).toBe(2);
    expect(data.acceptees).toBe(2);
    expect(data.rejetees).toBe(0);
    expect(data.lignes[0]).toMatchObject({
      ligne: 2,
      statut: 'acceptee',
      medicamentId: 'med-para',
      medicamentNom: 'Paracétamol 500 mg',
      quantite: 40,
      prixUnitaire: 1500,
      dateExpiration: '2027-12-31T00:00:00.000Z',
      notes: 'Lot A',
    });
    expect(data.lignes[1]).toMatchObject({
      ligne: 3,
      statut: 'acceptee',
      medicamentId: 'med-coartem',
    });
    expect(message).toBe(
      '2 lignes prêtes à être importées, aucune ligne à corriger.',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejette un médicament absent du catalogue', async () => {
    const fichier = await construireFichier([['Doliprane inconnu', 10]]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(data.lignes[0].statut).toBe('rejetee');
    expect(data.lignes[0].raison).toContain('Médicament absent du catalogue');
  });

  it('rejette une quantité négative ou non numérique', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', -5],
      ['Amoxicilline 500 mg', 'beaucoup'],
      ['Coartem 20mg/120mg', 2.5],
    ]);

    const { data, message } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(data.rejetees).toBe(3);
    data.lignes.forEach((ligne) => {
      expect(ligne.statut).toBe('rejetee');
      expect(ligne.raison).toContain('La quantité doit être un nombre entier');
    });
    expect(message).toBe(
      'Aucune ligne prête à être importée, 3 lignes à corriger.',
    );
  });

  it('rejette la deuxième occurrence d’un même médicament', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 10],
      ['Amoxicilline 500 mg', 20],
      ['paracetamol', 30],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(data.lignes[0].statut).toBe('acceptee');
    expect(data.lignes[2]).toMatchObject({
      ligne: 4,
      statut: 'rejetee',
      raison: 'Médicament déjà présent à la ligne 2.',
    });
  });

  it('refuse un fichier sans colonne Quantité en nommant la colonne manquante', async () => {
    const fichier = await construireFichier(
      [['Paracétamol 500 mg', 'Lot A']],
      ['Medicament', 'Notes'],
    );

    const appel = service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier);

    await expect(appel).rejects.toThrow(BadRequestException);
    await expect(appel).rejects.toThrow('« Quantité »');
  });

  it('refuse un fichier qui n’est pas un classeur .xlsx', async () => {
    const csv = Buffer.from('Médicament;Quantité\nParacétamol;10');
    const fichier: FichierImport = {
      buffer: csv,
      size: csv.length,
      mimetype: 'text/csv',
      originalname: 'stock.csv',
    };

    await expect(
      service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier),
    ).rejects.toThrow('Le fichier doit être un classeur Excel (.xlsx).');
  });

  it('refuse l’envoi sans fichier', async () => {
    await expect(
      service.apercuImportStock(STRUCTURE_ID, USER_ID, undefined),
    ).rejects.toThrow('Choisissez un fichier Excel à importer.');
  });

  it("n'écrit que les lignes acceptées, en une seule transaction, et envoie une seule alerte groupée", async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 5],
      ['Inconnu', 10],
      ['Amoxicilline 500 mg', 0, 2000],
      ['Coartem 20mg/120mg', -1],
      ['Coartem 20mg/120mg', 50],
    ]);

    const { data, message } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(transaction).toHaveBeenCalledTimes(1);
    const operations = transaction.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(
      operations.map((op) => op.where.medicamentId_structureId.medicamentId),
    ).toEqual(['med-para', 'med-amox']);
    expect(operations[1]).toMatchObject({
      create: {
        medicamentId: 'med-amox',
        structureId: STRUCTURE_ID,
        quantite: 0,
        prixUnitaire: 2000,
        disponible: false,
        dateExpiration: null,
      },
      update: { quantite: 0, disponible: false },
    });

    expect(data.importees).toBe(2);
    expect(data.acceptees).toBe(2);
    expect(data.rejetees).toBe(3);
    expect(message).toBe(
      '2 lignes importées dans votre stock, 3 lignes à corriger.',
    );

    expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.createManyNotifications).toHaveBeenCalledWith(
      [USER_ID],
      expect.objectContaining({
        type: 'STOCK_ALERTE',
        titre: 'Stock critique',
        message: expect.stringContaining('2 médicaments') as string,
      }),
    );
  });
});
