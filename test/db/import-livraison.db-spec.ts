import { HttpException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  MESSAGE_IMPORT_INVENTAIRE_INTERDIT,
  MESSAGE_IMPORT_LIVRAISON_INTERDIT,
  messageAlerteImportLivraison,
  MIME_XLSX,
  PharmacieService,
} from 'src/pharmacie/pharmacie.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { FichierImport } from 'src/pharmacie/dto/pharmacie.dto';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import { chargerFormatActuel } from './fixtures/format-actuel';
import { rejeuParDefaut } from './rejeu-provisoire';

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      const reponse = erreur.getResponse();
      return {
        statut: erreur.getStatus(),
        corps:
          typeof reponse === 'string'
            ? { message: reponse }
            : (reponse as Record<string, unknown>),
      };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

interface LigneRep {
  statut: string;
  lotId?: string;
  unitesRecues?: number;
  quantiteAvant?: number;
  quantiteApres?: number;
}
interface ImportRep {
  data: {
    importees: number;
    receptionId: string | null;
    lignes: LigneRep[];
  };
}
const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

const ENTETES = [
  'Médicament',
  'Quantité (boîtes)',
  'Prix de la boîte (GNF)',
  "Date d'expiration (AAAA-MM-JJ)",
  'Lot',
  "Coût d'achat de la boîte (GNF)",
  'Notes',
];

describe('Import livraison vers réception, sur base de test (PB14c)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let venteParRejeu: ReturnType<typeof rejeuParDefaut>;
  let receptions: ReceptionsService;
  let pharmacie: PharmacieService;
  let pv1: string;
  let compteurFiche = 0;
  const alertes = jest.fn().mockResolvedValue(undefined);

  const jour = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
    const notifications = {
      createManyNotifications: alertes,
    } as unknown as NotificationsService;
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? [
                'vente:write',
                'caisse:utiliser',
                'caisse:superviser',
                'stock:write',
                'reception:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    venteParRejeu = rejeuParDefaut({
      synchro: new SynchroService(prisma, acces, mouvements, sessions),
      postes: new PointsDeVenteService(prisma, acces),
      structureId: PHARMACIE,
      vendeurId: VENDEUR,
      responsableId: RESPONSABLE,
      appareilId: 'desktop-pb20-import-livraison',
    });
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      mouvements,
      permissions,
      receptions,
      new InventairesService(prisma, acces, mouvements),
    );
    pv1 = await pointDeVente(PHARMACIE);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await fermerPrismaDeTest(prisma);
      }
    } finally {
      if (base) {
        await supprimerBaseDeTest(base);
      }
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function pointDeVente(structureId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [structureId],
    );
    return String(res.rows[0].id);
  }

  /** Médicament du catalogue sans fiche dans la pharmacie. */
  async function nouveauMedicament(): Promise<{
    medicamentId: string;
    nom: string;
  }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit import ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB14c', false, now())`,
      [`med-import-${n}`, nom],
    );
    return { medicamentId: `med-import-${n}`, nom };
  }

  async function nouvelleFiche(
    o: { coef?: number; qualifie?: boolean } = {},
  ): Promise<{ stockId: string; nom: string }> {
    const { medicamentId, nom } = await nouveauMedicament();
    const stockId = `stk-${medicamentId.slice('med-'.length)}`;
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, $5, now())`,
      [stockId, medicamentId, PHARMACIE, o.coef ?? 1, o.qualifie ?? true],
    );
    return { stockId, nom };
  }

  async function construireFichier(
    lignes: unknown[][],
    entetes: string[] = ENTETES,
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
      originalname: 'livraison.xlsx',
    };
  }

  async function importer(
    fichier: FichierImport,
    user = RESPONSABLE,
    mode: 'livraison' | 'inventaire' = 'livraison',
  ): Promise<ImportRep> {
    return (await pharmacie.importerStock(
      PHARMACIE,
      user,
      fichier,
      mode,
    )) as unknown as ImportRep;
  }

  async function allocations(venteId: string) {
    return (
      await sql(
        `SELECT a."statut"::text AS "statut", a."quantite" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."createdAt", a."id"`,
        [venteId],
      )
    ).rows;
  }

  async function soldeProduit(stockId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1 AND "pointDeVenteId" = $2',
      [stockId, pv1],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  const nombreReceptions = () =>
    compter(
      'SELECT count(*) AS n FROM "Reception" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
  const nombreLots = () => compter('SELECT count(*) AS n FROM "LotStock"');
  const nombreMouvements = () =>
    compter('SELECT count(*) AS n FROM "MouvementStock"');

  async function compteurs(medicamentIds: string[]) {
    return (
      await sql(
        `SELECT "medicamentId", "quantite", "disponible" FROM "StockMedicament" WHERE "structureId" = $1 AND "medicamentId" = ANY($2) ORDER BY "medicamentId"`,
        [PHARMACIE, medicamentIds],
      )
    ).rows;
  }

  it('une réception, un lot par ligne, coût par unité, fiche absente créée', async () => {
    const a = await nouvelleFiche({ coef: 10, qualifie: true });
    const b = await nouveauMedicament();
    const fichier = await construireFichier([
      [a.nom, 2, 15000, jour(200), 'L-1', 20000, 'Note A'],
      [b.nom, 3, null, 'sans péremption', null, null, null],
    ]);

    const r = await importer(fichier);

    expect(r.data.importees).toBe(2);
    expect(r.data.receptionId).not.toBeNull();
    const receptionId = String(r.data.receptionId);
    const lots = (
      await sql(
        `SELECT l."stockMedicamentId", l."quantiteRecue", l."coefficientReception", l."coutUnitaire", l."coutAchatBoite", l."numeroLot", l."dateExpiration" FROM "LotStock" l WHERE l."receptionId" = $1`,
        [receptionId],
      )
    ).rows;
    expect(lots).toHaveLength(2);
    const ficheB = (
      await sql(
        `SELECT "id", "coefficientBoite", "qualifie" FROM "StockMedicament" WHERE "medicamentId" = $1 AND "structureId" = $2`,
        [b.medicamentId, PHARMACIE],
      )
    ).rows[0];
    expect(ficheB).toMatchObject({ coefficientBoite: 1, qualifie: false });

    const lotA = lots.find((l) => l.stockMedicamentId === a.stockId);
    const lotB = lots.find((l) => l.stockMedicamentId === ficheB.id);
    expect(lotA).toMatchObject({
      quantiteRecue: 20,
      coefficientReception: 10,
      coutUnitaire: 2000,
      coutAchatBoite: 20000,
      numeroLot: 'L-1',
    });
    expect(lotB).toMatchObject({
      quantiteRecue: 3,
      dateExpiration: null,
      coutUnitaire: 0,
      coutAchatBoite: null,
    });

    const ficheA = (
      await sql(
        `SELECT "prixUnitaire", "notes" FROM "StockMedicament" WHERE "id" = $1`,
        [a.stockId],
      )
    ).rows[0];
    expect(ficheA).toMatchObject({ prixUnitaire: 15000, notes: 'Note A' });

    const idLotA = (
      await sql(`SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1`, [
        a.stockId,
      ])
    ).rows[0].id;
    expect(r.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      unitesRecues: 20,
      quantiteAvant: 0,
      quantiteApres: 20,
      lotId: idLotA,
    });
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "type"::text = 'RECEPTION' AND "pieceOrigineType"::text = 'RECEPTION' AND "pieceOrigineId" = $1`,
        [receptionId],
      ),
    ).toBe(2);
  });

  it('résout une vente faite sans stock', async () => {
    const c = await nouvelleFiche({ coef: 1, qualifie: true });
    // Vente sans stock : seul le rejeu d'un poste l'accepte
    const v = await venteParRejeu({ stockId: c.stockId, nombre: 2 });
    expect(await soldeProduit(c.stockId)).toBe(-2);

    const r = await importer(
      await construireFichier([[c.nom, 5, null, jour(200)]]),
    );

    const alloc = await allocations(v.data.id);
    expect(alloc.map((x) => [x.statut, Number(x.quantite)])).toEqual([
      ['REMPLACEE', 2],
      ['DEFINITIVE', 2],
    ]);
    expect(await soldeProduit(c.stockId)).toBe(3);
    // La réponse n'expose jamais un stock négatif (D717) ; la part à régulariser est à part
    expect(r.data.lignes[0]).toMatchObject({
      quantiteAvant: 0,
      quantiteARegulariserAvant: 2,
      quantiteApres: 3,
    });
  });

  it('fiche archivée désarchivée, compteur gelé jamais écrit', async () => {
    const d = await nouvelleFiche({ coef: 1, qualifie: true });
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1`,
      [d.stockId],
    );
    const medicaments = (
      await sql(
        `SELECT "id" AS "medicamentId" FROM "Medicament" WHERE "id" LIKE 'med-import-%'`,
      )
    ).rows.map((x) => String(x.medicamentId));
    const avant = await compteurs(medicaments);

    await importer(await construireFichier([[d.nom, 4, null, jour(200)]]));

    const archive = (
      await sql(`SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1`, [
        d.stockId,
      ])
    ).rows[0].archiveLe;
    expect(archive).toBeNull();
    const apres = await compteurs(medicaments);
    expect(apres).toEqual(avant);
    apres.forEach((f) => expect(Number(f.quantite)).toBe(0));
  });

  it('aucune ligne acceptée : aucune réception', async () => {
    const e = await nouvelleFiche();
    const avant = await nombreReceptions();

    const r = await importer(await construireFichier([[e.nom, 1]]));

    expect(r.data.importees).toBe(0);
    expect(r.data.receptionId).toBeNull();
    expect(await nombreReceptions()).toBe(avant);
  });

  it('inventaire sans inventaire:write refusé sans rien écrire', async () => {
    const f = await nouvelleFiche();
    const fichier = await construireFichier([[f.nom, 4, null, jour(200)]]);
    const receptionsAvant = await nombreReceptions();
    const lotsAvant = await nombreLots();
    const mouvementsAvant = await nombreMouvements();

    const importe = await refus(importer(fichier, RESPONSABLE, 'inventaire'));
    const apercu = await refus(
      pharmacie.apercuImportStock(
        PHARMACIE,
        RESPONSABLE,
        fichier,
        'inventaire',
      ),
    );

    for (const r of [importe, apercu]) {
      expect(r.statut).toBe(403);
      expect(r.corps).toMatchObject({
        message: MESSAGE_IMPORT_INVENTAIRE_INTERDIT,
      });
    }
    expect(await nombreReceptions()).toBe(receptionsAvant);
    expect(await nombreLots()).toBe(lotsAvant);
    expect(await nombreMouvements()).toBe(mouvementsAvant);
  });

  it('livraison sans reception:write refusée', async () => {
    const f = await nouvelleFiche();
    const fichier = await construireFichier([[f.nom, 4, null, jour(200)]]);

    const r = await refus(importer(fichier, VENDEUR));

    expect(r.statut).toBe(403);
    expect(r.corps).toMatchObject({
      message: MESSAGE_IMPORT_LIVRAISON_INTERDIT,
    });
  });

  it('alerte groupée sur l’état après l’import', async () => {
    const e = await nouvelleFiche({ coef: 1, qualifie: true });
    alertes.mockClear();

    await importer(await construireFichier([[e.nom, 3, null, jour(200)]]));
    expect(alertes).toHaveBeenCalledTimes(1);
    const [, contenu] = alertes.mock.calls[0] as [unknown, unknown];
    expect(contenu).toMatchObject({
      message: messageAlerteImportLivraison(1),
    });

    alertes.mockClear();
    await importer(await construireFichier([[e.nom, 50, null, jour(200)]]));
    expect(alertes).not.toHaveBeenCalled();
  });

  it('aperçu : quantités avant et après depuis le stock calculé, rien n’est écrit', async () => {
    const f = await nouvelleFiche({ coef: 1, qualifie: true });
    await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        lignes: [
          { stockId: f.stockId, nombreBoites: 30, dateExpiration: jour(200) },
        ],
      },
      '127.0.0.1',
    );
    const receptionsAvant = await nombreReceptions();
    const lotsAvant = await nombreLots();

    const r = (await pharmacie.apercuImportStock(
      PHARMACIE,
      RESPONSABLE,
      await construireFichier([[f.nom, 40, null, jour(200)]]),
      'livraison',
    )) as unknown as ImportRep;

    expect(r.data.lignes[0]).toMatchObject({
      quantiteAvant: 30,
      quantiteApres: 70,
      unitesRecues: 40,
    });
    expect(await nombreReceptions()).toBe(receptionsAvant);
    expect(await nombreLots()).toBe(lotsAvant);
  });

  it('import mixte : une ligne rejetée entre deux lignes acceptées', async () => {
    const x = await nouvelleFiche();
    const y = await nouvelleFiche();
    const z = await nouvelleFiche();

    const r = await importer(
      await construireFichier([
        [x.nom, 2, null, jour(200)],
        [y.nom, 4],
        [z.nom, 3, null, jour(200)],
      ]),
    );

    expect(r.data.importees).toBe(2);
    expect(r.data.lignes.map((l) => l.statut)).toEqual([
      'acceptee',
      'rejetee',
      'acceptee',
    ]);
    for (const [index, fiche, unites] of [
      [0, x, 2],
      [2, z, 3],
    ] as const) {
      const lot = (
        await sql(
          `SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1`,
          [fiche.stockId],
        )
      ).rows;
      expect(lot).toHaveLength(1);
      expect(r.data.lignes[index]).toMatchObject({
        lotId: lot[0].id,
        unitesRecues: unites,
      });
    }
    expect(r.data.lignes[1].lotId).toBeUndefined();
    expect(
      await compter(
        `SELECT count(*) AS n FROM "LotStock" WHERE "stockMedicamentId" = $1`,
        [y.stockId],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "stockMedicamentId" = $1`,
        [y.stockId],
      ),
    ).toBe(0);
  });

  it('cases vides : prix de la boîte et notes de la fiche inchangés', async () => {
    const f = await nouvelleFiche();
    await sql(
      `UPDATE "StockMedicament" SET "prixUnitaire" = 4200, "notes" = 'Note existante' WHERE "id" = $1`,
      [f.stockId],
    );

    await importer(await construireFichier([[f.nom, 2, null, jour(200)]]));

    const fiche = (
      await sql(
        `SELECT "prixUnitaire", "notes" FROM "StockMedicament" WHERE "id" = $1`,
        [f.stockId],
      )
    ).rows[0];
    expect(fiche).toMatchObject({
      prixUnitaire: 4200,
      notes: 'Note existante',
    });
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const verif = await verifierStock(base.client);
    expect(verif.totalAnomalies).toBe(0);
  });
});
