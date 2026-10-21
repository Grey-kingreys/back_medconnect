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

type FonctionTransaction = (tx: unknown) => Promise<unknown>;

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
  let upsert: jest.Mock<Promise<{ quantite: number }>, [OperationUpsert]>;
  let findMany: jest.Mock;
  let transaction: jest.Mock<Promise<unknown>, [FonctionTransaction, unknown?]>;
  /** Stock vu par l'écriture (upsert) et stock vu par la lecture (findMany). */
  let stockSimule: Map<string, number>;
  let stockLu: Map<string, number>;
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

  /** Pose une quantité en stock, vue à la lecture comme à l'écriture. */
  function poserStock(medicamentId: string, quantite: number) {
    stockSimule.set(medicamentId, quantite);
    stockLu.set(medicamentId, quantite);
  }

  beforeEach(() => {
    stockSimule = new Map();
    stockLu = new Map();
    findMany = jest.fn(() =>
      Promise.resolve(
        [...stockLu].map(([medicamentId, quantite]) => ({
          medicamentId,
          quantite,
        })),
      ),
    );
    upsert = jest.fn((args: OperationUpsert) => {
      const id = args.where.medicamentId_structureId.medicamentId;
      const update = args.update.quantite;
      let quantite: number;
      if (!stockSimule.has(id)) {
        quantite = args.create.quantite as number;
      } else if (typeof update === 'number') {
        quantite = update;
      } else {
        quantite =
          (stockSimule.get(id) as number) +
          (update as { increment: number }).increment;
      }
      stockSimule.set(id, quantite);
      return Promise.resolve({ quantite });
    });
    const stockMedicament = { findMany, upsert };
    transaction = jest.fn((fn: FonctionTransaction) => fn({ stockMedicament }));
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
        findFirst: jest.fn().mockResolvedValue({ nom: 'Amoxicilline 500 mg' }),
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
      stockMedicament,
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
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 60_000,
    });
    const operations = upsert.mock.calls.map(([args]) => args);
    expect(operations).toHaveLength(2);
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
    expect(operations[1].update.dateExpiration).toBeUndefined();

    expect(data.mode).toBe('inventaire');
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

  it('conserve la date, le prix et les notes enregistrés quand les cases sont vides', async () => {
    poserStock('med-para', 30);
    const fichier = await construireFichier([['Paracétamol 500 mg', 40]]);

    const { data } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    const { update } = upsert.mock.calls[0][0];
    expect(update.quantite).toBe(40);
    expect(update.dateExpiration).toBeUndefined();
    expect(update.prixUnitaire).toBeUndefined();
    expect(update.notes).toBeUndefined();
    expect(data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      quantiteAvant: 30,
      quantiteApres: 40,
    });
  });

  it("aperçu : le mode inventaire est le mode par défaut et n'écrit rien", async () => {
    poserStock('med-para', 30);
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 40],
      ['Amoxicilline 500 mg', 5],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
    );

    expect(data.mode).toBe('inventaire');
    expect(data.lignes[0]).toMatchObject({
      quantiteAvant: 30,
      quantiteApres: 40,
    });
    expect(data.lignes[1]).toMatchObject({
      quantiteAvant: 0,
      quantiteApres: 5,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        structureId: STRUCTURE_ID,
        medicamentId: { in: ['med-para', 'med-amox'] },
      },
      select: { medicamentId: true, quantite: true },
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("aperçu en mode livraison : la quantité du fichier s'ajoute au stock", async () => {
    poserStock('med-para', 30);
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 40],
      ['Amoxicilline 500 mg', 5],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.mode).toBe('livraison');
    expect(data.lignes[0]).toMatchObject({
      quantiteAvant: 30,
      quantiteApres: 70,
    });
    expect(data.lignes[1]).toMatchObject({
      quantiteAvant: 0,
      quantiteApres: 5,
    });
  });

  it('import en mode livraison : incrément, création des absents, une seule alerte', async () => {
    poserStock('med-para', 30);
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 40],
      ['Amoxicilline 500 mg', 5],
    ]);

    const { data } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    const [premier, second] = upsert.mock.calls.map(([args]) => args);
    expect(premier.update.quantite).toEqual({ increment: 40 });
    expect(premier.update.disponible).toBe(true);
    expect(second.create.quantite).toBe(5);
    expect(data.lignes[0]).toMatchObject({
      quantiteAvant: 30,
      quantiteApres: 70,
    });
    expect(data.lignes[1]).toMatchObject({
      quantiteAvant: 0,
      quantiteApres: 5,
    });
    expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.createManyNotifications).toHaveBeenCalledWith(
      [USER_ID],
      expect.objectContaining({
        message: expect.stringContaining('1 médicament') as string,
      }),
    );
  });

  it("livraison de 0 : le stock ne bouge pas et la disponibilité n'est pas touchée", async () => {
    poserStock('med-para', 30);
    const fichier = await construireFichier([['Paracétamol 500 mg', 0]]);

    const { data } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    const { update } = upsert.mock.calls[0][0];
    expect(update.quantite).toEqual({ increment: 0 });
    expect(update).not.toHaveProperty('disponible');
    expect(data.lignes[0]).toMatchObject({
      quantiteAvant: 30,
      quantiteApres: 30,
    });
  });

  it("livraison : l'incrément résiste à un import simultané", async () => {
    poserStock('med-para', 30);
    // Un autre import a déjà ajouté 20 entre la lecture et l'écriture
    stockSimule.set('med-para', 50);
    const fichier = await construireFichier([['Paracétamol 500 mg', 40]]);

    const { data } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(upsert.mock.calls[0][0].update.quantite).toEqual({ increment: 40 });
    expect(data.lignes[0]).toMatchObject({
      quantiteAvant: 50,
      quantiteApres: 90,
    });
  });

  it('livraison : refuse une ligne dont le total dépasserait la borne entière', async () => {
    poserStock('med-para', 2147483600);
    const fichier = await construireFichier([['Paracétamol 500 mg', 100]]);
    const raison =
      'Avec cette livraison, la quantité en stock deviendrait trop grande. Vérifiez la quantité.';

    const { data: apercu } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );
    expect(apercu.lignes[0]).toMatchObject({ statut: 'rejetee', raison });

    const { data } = await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );
    expect(data.lignes[0]).toMatchObject({ statut: 'rejetee', raison });
    expect(upsert).not.toHaveBeenCalled();
    expect(data.importees).toBe(0);

    const { data: inventaire } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'inventaire',
    );
    expect(inventaire.lignes[0]).toMatchObject({
      statut: 'acceptee',
      quantiteApres: 100,
    });
  });

  it("l'alerte de stock bas se calcule sur la quantité après l'import", async () => {
    poserStock('med-para', 5);
    const fichier = await construireFichier([['Paracétamol 500 mg', 10]]);

    await service.importerStock(STRUCTURE_ID, USER_ID, fichier, 'livraison');
    expect(notifications.createManyNotifications).not.toHaveBeenCalled();

    await service.importerStock(STRUCTURE_ID, USER_ID, fichier, 'inventaire');
    expect(notifications.createManyNotifications).not.toHaveBeenCalled();

    poserStock('med-amox', 2);
    const fichierAmox = await construireFichier([['Amoxicilline 500 mg', 3]]);
    await service.importerStock(
      STRUCTURE_ID,
      USER_ID,
      fichierAmox,
      'livraison',
    );
    expect(notifications.createManyNotifications).toHaveBeenCalledTimes(1);
    expect(notifications.createManyNotifications).toHaveBeenCalledWith(
      [USER_ID],
      expect.objectContaining({
        message: expect.stringContaining('1 médicament') as string,
      }),
    );
  });

  it("le modèle téléchargeable explique l'inventaire et la livraison", async () => {
    const buffer = await service.getModeleImportStock(STRUCTURE_ID, USER_ID);
    const classeur = new Workbook();
    await classeur.xlsx.load(buffer as unknown as ArrayBuffer);
    const aide = classeur.getWorksheet("Mode d'emploi");
    if (!aide) throw new Error("Feuille « Mode d'emploi » absente");

    const textes: string[] = [];
    aide.eachRow((ligne) => textes.push(ligne.getCell(1).text));
    expect(textes).toHaveLength(9);
    expect(textes.some((t) => t.startsWith('Inventaire :'))).toBe(true);
    expect(textes.some((t) => t.startsWith('Livraison :'))).toBe(true);
    expect(
      textes[7].endsWith(
        'Une case laissée vide ne change pas ce qui est déjà enregistré.',
      ),
    ).toBe(true);
  });
});
