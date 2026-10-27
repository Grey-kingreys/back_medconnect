import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Workbook } from 'exceljs';
import {
  PharmacieService,
  MIME_XLSX,
  MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE,
  MESSAGE_IMPORT_LIVRAISON_INTERDIT,
} from './pharmacie.service';
import { FichierImport } from './dto/pharmacie.dto';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from './acces-pharmacie.service';
import { MouvementsStockService } from './stock/mouvements-stock.service';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import type { ReceptionsService } from './receptions/receptions.service';
import { jourConakry } from './jour-metier';
import { cheminsCout } from './masquer-couts';

type FonctionTransaction = (tx: unknown) => Promise<unknown>;

/**
 * Tests de l'import Excel du stock (aperçu et import en mode livraison) :
 * classeur construit en mémoire avec exceljs, Prisma et les notifications
 * simulés (aucune infra).
 */
describe('PharmacieService, import Excel du stock', () => {
  const STRUCTURE_ID = 'structure-1';
  const USER_ID = 'pharmacien-1';
  const DATE = '2027-12-31';
  const ENTETES = [
    'Médicament',
    'Quantité',
    'Prix unitaire (GNF)',
    "Date d'expiration (AAAA-MM-JJ)",
    'Notes',
  ];
  const TITRES_MODELE = [
    'Médicament',
    'Quantité (boîtes)',
    'Prix de la boîte (GNF)',
    "Date d'expiration (AAAA-MM-JJ)",
    'Lot',
    "Coût d'achat de la boîte (GNF)",
    'Notes',
  ];

  let prisma: Record<string, unknown>;
  let findMany: jest.Mock;
  let medicamentFindMany: jest.Mock;
  let transaction: jest.Mock<Promise<unknown>, [FonctionTransaction, unknown?]>;
  let stockLu: Map<string, { quantite: number; coefficientBoite: number }>;
  let permissionsDuTest: string[];
  let notifications: { createManyNotifications: jest.Mock };
  let receptions: { enregistrerDansTransaction: jest.Mock };
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
    stockLu = new Map();
    permissionsDuTest = ['reception:write'];
    findMany = jest.fn(() =>
      Promise.resolve(
        [...stockLu].map(([medicamentId, { quantite, coefficientBoite }]) => ({
          medicamentId,
          coefficientBoite,
          agregatsProduit: [{ quantite }],
        })),
      ),
    );
    const stockMedicament = { findMany };
    transaction = jest.fn((fn: FonctionTransaction) => fn({ stockMedicament }));
    medicamentFindMany = jest.fn().mockResolvedValue([
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
    ]);
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
        findUnique: jest.fn().mockResolvedValue({
          id: STRUCTURE_ID,
          type: 'PHARMACIE',
          adminId: null,
          isActive: true,
        }),
      },
      medicament: {
        findFirst: jest.fn().mockResolvedValue({ nom: 'Amoxicilline 500 mg' }),
        findMany: medicamentFindMany,
      },
      stockMedicament,
      $transaction: transaction,
    };
    notifications = { createManyNotifications: jest.fn() };
    receptions = { enregistrerDansTransaction: jest.fn() };
    service = new PharmacieService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
      new AccesPharmacieService(prisma as unknown as PrismaService),
      new MouvementsStockService(),
      {
        getUserPermissions: () => Promise.resolve(permissionsDuTest),
      } as unknown as PermissionsService,
      receptions as unknown as ReceptionsService,
    );
  });

  it('accepte une ligne valide et retrouve le médicament sans tenir compte des accents ni de la casse', async () => {
    const fichier = await construireFichier([
      ['  PARACETAMOL   500 MG ', 40, 1500, DATE, 'Lot A'],
      ['artemether/lumefantrine', 12, null, DATE],
    ]);

    const { data, message } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
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
      sansPeremption: false,
      unitesRecues: 40,
      quantiteAvant: 0,
      quantiteApres: 40,
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

  it('reconnaît les titres courants des pharmacies, le lot et le coût d’achat', async () => {
    permissionsDuTest = ['reception:write', 'marge:read'];
    const fichier = await construireFichier(
      [['Paracétamol 500 mg', 'Sopharma', 30, 1200, '2027-06-30', 'B-77', 900]],
      [
        'Désignation',
        'Fournisseur',
        'Qté',
        'P.U. (GNF)',
        'Péremption',
        'N° lot',
        "Prix d'achat",
      ],
    );

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      quantite: 30,
      prixUnitaire: 1200,
      numeroLot: 'B-77',
      coutAchatBoite: 900,
    });
    expect(data.colonnes).toEqual({
      ligneTitres: 1,
      reconnues: [
        { titre: 'Désignation', colonne: 'Médicament' },
        { titre: 'Qté', colonne: 'Quantité' },
        { titre: 'P.U. (GNF)', colonne: 'Prix' },
        { titre: 'Péremption', colonne: "Date d'expiration" },
        { titre: 'N° lot', colonne: 'Lot' },
        { titre: "Prix d'achat", colonne: "Coût d'achat" },
      ],
      ignorees: ['Fournisseur'],
    });
  });

  it('trouve les titres sous un en-tête (nom de la pharmacie, ligne vide)', async () => {
    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Stock');
    feuille.addRow(['Pharmacie de Kaloum, livraison du 22/10/2026']);
    feuille.addRow([]);
    feuille.addRow(['Produit', 'Quantité en stock', 'Date de péremption']);
    feuille.addRow(['Amoxicilline 500 mg', 15, DATE]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      {
        buffer,
        size: buffer.length,
        mimetype: MIME_XLSX,
        originalname: 'livraison.xlsx',
      },
      'livraison',
    );

    expect(data.colonnes.ligneTitres).toBe(3);
    expect(data.totalLignes).toBe(1);
    expect(data.lignes[0]).toMatchObject({
      ligne: 4,
      statut: 'acceptee',
      medicamentId: 'med-amox',
      quantite: 15,
    });
  });

  it('ne prend pas un seuil d’alerte pour la quantité en stock', async () => {
    const fichier = await construireFichier(
      [['Paracétamol 500 mg', 5, 40, DATE]],
      ['Médicament', 'Quantité minimale', 'Stock', 'Date'],
    );

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({ statut: 'acceptee', quantite: 40 });
    expect(data.colonnes.ignorees).toEqual(['Quantité minimale']);
  });

  it('rejette un médicament absent du catalogue', async () => {
    const fichier = await construireFichier([
      ['Doliprane inconnu', 10, null, DATE],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0].statut).toBe('rejetee');
    expect(data.lignes[0].raison).toContain('Médicament absent du catalogue');
  });

  it('rejette une quantité négative, nulle ou non numérique', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', -5, null, DATE],
      ['Amoxicilline 500 mg', 0, null, DATE],
      ['Coartem 20mg/120mg', 'beaucoup', null, DATE],
      ['Paracétamol 500 mg', 2.5, null, DATE],
    ]);

    const { data, message } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.rejetees).toBe(4);
    data.lignes.forEach((ligne) => {
      expect(ligne.statut).toBe('rejetee');
      expect(ligne.raison).toContain(
        'La quantité reçue doit être un nombre entier de boîtes',
      );
    });
    expect(message).toBe(
      'Aucune ligne prête à être importée, 4 lignes à corriger.',
    );
  });

  it('rejette la deuxième occurrence d’un même médicament', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 10, null, DATE],
      ['Amoxicilline 500 mg', 20, null, DATE],
      ['paracetamol', 30, null, DATE],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
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

    const appel = service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

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
      service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier, 'livraison'),
    ).rejects.toThrow('Le fichier doit être un classeur Excel (.xlsx).');
  });

  it('refuse l’envoi sans fichier', async () => {
    await expect(
      service.apercuImportStock(STRUCTURE_ID, USER_ID, undefined, 'livraison'),
    ).rejects.toThrow('Choisissez un fichier Excel à importer.');
  });

  it('date obligatoire sauf « sans péremption », date passée refusée', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 1],
      ['Amoxicilline 500 mg', 1, null, 'Sans Péremption'],
      ['Coartem 20mg/120mg', 1, null, '2020-01-01'],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({
      statut: 'rejetee',
      raison:
        "Indiquez la date de péremption (AAAA-MM-JJ), ou écrivez « sans péremption » si ce médicament n'en a pas.",
    });
    expect(data.lignes[1]).toMatchObject({
      statut: 'acceptee',
      sansPeremption: true,
    });
    expect(data.lignes[1].dateExpiration).toBeUndefined();
    expect(data.lignes[2]).toMatchObject({
      statut: 'rejetee',
      raison:
        'Cette date de péremption est déjà passée : vérifiez-la. Un médicament périmé ne doit pas entrer en stock.',
    });

    const aujourdhui = await construireFichier([
      ['Paracétamol 500 mg', 1, null, jourConakry(new Date())],
    ]);
    const { data: dujour } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      aujourdhui,
      'livraison',
    );
    expect(dujour.lignes[0].statut).toBe('acceptee');
  });

  it('lot et coût d’achat : lecture, arrondi et rejets', async () => {
    permissionsDuTest = ['reception:write', 'marge:read'];
    const entetes = [...ENTETES, 'Lot', "Coût d'achat"];
    const fichier = await construireFichier(
      [
        ['Paracétamol 500 mg', 1, null, DATE, null, '  A123 ', 25000.4],
        ['Amoxicilline 500 mg', 1, null, DATE, null, 4521, -3],
        ['Coartem 20mg/120mg', 1, null, DATE, null, 'x'.repeat(65), 3000000000],
      ],
      entetes,
    );

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      numeroLot: 'A123',
      coutAchatBoite: 25000,
    });
    expect(data.lignes[1]).toMatchObject({
      statut: 'rejetee',
      raison:
        "Le coût d'achat doit être un nombre, 0 ou plus, sans texte (exemple : 25000).",
    });
    expect(data.lignes[2].statut).toBe('rejetee');
    expect(data.lignes[2].raison).toContain(
      'Le numéro de lot est trop long (64 caractères au plus).',
    );
    expect(data.lignes[2].raison).toContain(
      "Le coût d'achat est trop grand. Vérifiez le montant (exemple : 25000).",
    );

    const numerique = await construireFichier(
      [['Amoxicilline 500 mg', 1, null, DATE, null, 4521]],
      entetes,
    );
    const { data: lot } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      numerique,
      'livraison',
    );
    expect(lot.lignes[0]).toMatchObject({
      statut: 'acceptee',
      numeroLot: '4521',
    });
  });

  it('quantités en unités depuis le stock calculé', async () => {
    stockLu.set('med-para', { quantite: 30, coefficientBoite: 10 });
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 4, null, DATE],
      ['Amoxicilline 500 mg', 5, null, DATE],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({
      unitesRecues: 40,
      quantiteAvant: 30,
      quantiteApres: 70,
    });
    expect(data.lignes[1]).toMatchObject({
      unitesRecues: 5,
      quantiteAvant: 0,
      quantiteApres: 5,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        structureId: STRUCTURE_ID,
        medicamentId: { in: ['med-para', 'med-amox'] },
      },
      select: {
        medicamentId: true,
        coefficientBoite: true,
        agregatsProduit: { select: { quantite: true } },
      },
    });
  });

  it('refuse une ligne dont le total dépasserait la borne entière', async () => {
    stockLu.set('med-para', { quantite: 2147483600, coefficientBoite: 1 });
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 100, null, DATE],
    ]);
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
    expect(data.importees).toBe(0);
    expect(data.receptionId).toBeNull();
    expect(receptions.enregistrerDansTransaction).not.toHaveBeenCalled();
  });

  it('arrondit un prix décimal à l’entier et rejette un prix trop grand', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 10, 1500.6, DATE],
      ['Amoxicilline 500 mg', 10, 3000000000, DATE],
    ]);

    const { data } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );

    expect(data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      prixUnitaire: 1501,
    });
    expect(data.lignes[1].statut).toBe('rejetee');
    expect(data.lignes[1].raison).toBe(
      'Le prix unitaire est trop grand. Vérifiez le montant (exemple : 35000).',
    );
  });

  it('inventaire refusé avant toute lecture du fichier', async () => {
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 10, null, DATE],
    ]);

    const appels = [
      service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier, 'inventaire'),
      service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier),
      service.importerStock(STRUCTURE_ID, USER_ID, fichier, 'inventaire'),
    ];
    for (const appel of appels) {
      await expect(appel).rejects.toThrow(ConflictException);
      const erreur = (await appel.catch(
        (e: unknown) => e,
      )) as ConflictException;
      expect(erreur.getResponse()).toMatchObject({
        code: 'IMPORT_INVENTAIRE_INDISPONIBLE',
        message: MESSAGE_IMPORT_INVENTAIRE_INDISPONIBLE,
      });
    }
    expect(medicamentFindMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('livraison sans reception:write refusée', async () => {
    permissionsDuTest = [];
    const fichier = await construireFichier([
      ['Paracétamol 500 mg', 10, null, DATE],
    ]);

    for (const appel of [
      service.apercuImportStock(STRUCTURE_ID, USER_ID, fichier, 'livraison'),
      service.importerStock(STRUCTURE_ID, USER_ID, fichier, 'livraison'),
    ]) {
      await expect(appel).rejects.toThrow(ForbiddenException);
      await expect(appel).rejects.toThrow(MESSAGE_IMPORT_LIVRAISON_INTERDIT);
    }
    expect(medicamentFindMany).not.toHaveBeenCalled();
  });

  it('coût d’achat retiré sans marge:read', async () => {
    const fichier = await construireFichier(
      [['Paracétamol 500 mg', 1, null, DATE, null, 'L1', 25000]],
      [...ENTETES, 'Lot', "Coût d'achat"],
    );

    permissionsDuTest = ['reception:write'];
    const { data: sans } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );
    expect(cheminsCout(sans)).toEqual([]);

    permissionsDuTest = ['reception:write', 'marge:read'];
    const { data: avec } = await service.apercuImportStock(
      STRUCTURE_ID,
      USER_ID,
      fichier,
      'livraison',
    );
    expect(avec.lignes[0].coutAchatBoite).toBe(25000);
  });

  it('le modèle téléchargeable décrit la livraison et ses colonnes', async () => {
    const buffer = await service.getModeleImportStock(STRUCTURE_ID, USER_ID);
    const classeur = new Workbook();
    await classeur.xlsx.load(buffer as unknown as ArrayBuffer);

    const stock = classeur.getWorksheet('Stock');
    if (!stock) throw new Error('Feuille « Stock » absente');
    const titres = TITRES_MODELE.map(
      (_, i) => stock.getRow(1).getCell(i + 1).text,
    );
    expect(titres).toEqual(TITRES_MODELE);

    const aide = classeur.getWorksheet("Mode d'emploi");
    if (!aide) throw new Error("Feuille « Mode d'emploi » absente");
    const textes: string[] = [];
    aide.eachRow((ligne) => textes.push(ligne.getCell(1).text));
    expect(textes).toEqual([
      'Remplissez la feuille « Stock » : une ligne par médicament reçu, à partir de la ligne 2. Ne modifiez pas les titres de la ligne 1.',
      "Écrivez le nom du médicament tel qu'il apparaît dans le catalogue MedConnecte (les majuscules et les accents ne comptent pas).",
      'La quantité est le nombre de boîtes reçues : un nombre entier, 1 ou plus.',
      "Au moment d'envoyer le fichier, choisissez « Livraison » : la quantité du fichier s'ajoute à votre stock. Exemple : 20 en stock et 50 dans le fichier, il y aura 70. Un médicament qui n'est pas encore dans votre stock y est ajouté.",
      "La date d'expiration est obligatoire, au format AAAA-MM-JJ (par exemple 2027-12-31). Pour un produit qui n'en a pas, écrivez « sans péremption ».",
      "Le lot (numéro inscrit sur la boîte) et le coût d'achat d'une boîte (en GNF) sont facultatifs. Sans coût d'achat, la marge de ces boîtes ne pourra pas être calculée.",
      "Le prix de la boîte (en GNF) et les notes sont facultatifs. Une case laissée vide ne change pas ce qui est déjà enregistré. Avant d'enregistrer, l'aperçu affiche pour chaque médicament la quantité avant et après.",
      "Un même fichier peut contenir jusqu'à 1000 médicaments. Remplacez la ligne d'exemple par vos propres médicaments.",
    ]);
  });
});
