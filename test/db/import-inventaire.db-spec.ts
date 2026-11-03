import { HttpException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  MESSAGE_IMPORT_INVENTAIRE_INTERDIT,
  messageAnomaliesImportInventaire,
  MIME_XLSX,
  PharmacieService,
} from 'src/pharmacie/pharmacie.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type {
  FichierImport,
  ModeImportStock,
} from 'src/pharmacie/dto/pharmacie.dto';
import type { CreerReceptionDto } from 'src/pharmacie/dto/receptions.dto';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import { VenteService } from 'src/pharmacie/vente.service';
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
  raison?: string;
  lotId?: string;
  nouveauLot?: boolean;
  quantiteAvant?: number;
  quantiteApres?: number;
  quantiteComptee?: number;
  quantiteTheorique?: number;
  ecart?: number;
  sousTolerance?: boolean;
}
interface ImportRep {
  data: {
    mode: string;
    importees: number;
    receptionId: string | null;
    inventaireId: string | null;
    lignes: LigneRep[];
  };
  message: string;
}
interface ReceptionRep {
  data: { id: string; lots: { id: string; numeroLot: string | null }[] };
}
interface VenteRep {
  data: { id: string };
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

const ENTETES = [
  'Médicament',
  'Quantité comptée (boîtes)',
  'Unités en plus (boîte entamée)',
  'Lot',
  "Date d'expiration (AAAA-MM-JJ)",
];
const ENTETES_LIVRAISON = [
  'Médicament',
  'Quantité (boîtes)',
  'Prix de la boîte (GNF)',
  "Date d'expiration (AAAA-MM-JJ)",
];

describe("Import Excel d'un inventaire, sur base de test (PB15c)", () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
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
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
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
                'inventaire:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    venteParRejeu = rejeuParDefaut({
      synchro: new SynchroService(prisma, acces, mouvements, sessions),
      postes: new PointsDeVenteService(prisma, acces),
      structureId: PHARMACIE,
      vendeurId: VENDEUR,
      responsableId: RESPONSABLE,
      appareilId: 'desktop-pb20-import-inventaire',
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
    const nom = `Produit import inventaire ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB15c', false, now())`,
      [`med-invimp-${n}`, nom],
    );
    return { medicamentId: `med-invimp-${n}`, nom };
  }

  async function nouvelleFiche(
    o: { coef?: number; tolerance?: number } = {},
  ): Promise<{ stockId: string; nom: string; medicamentId: string }> {
    const { medicamentId, nom } = await nouveauMedicament();
    const stockId = `stk-${medicamentId.slice('med-'.length)}`;
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "toleranceInventaire", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, $5, true, now())`,
      [stockId, medicamentId, PHARMACIE, o.coef ?? 1, o.tolerance ?? null],
    );
    return { stockId, nom, medicamentId };
  }

  async function recevoir(dto: CreerReceptionDto): Promise<ReceptionRep> {
    return (await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      dto,
      '127.0.0.1',
    )) as unknown as ReceptionRep;
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
      originalname: 'inventaire.xlsx',
    };
  }

  async function importer(
    fichier: FichierImport,
    user = RESPONSABLE,
    mode?: ModeImportStock,
  ): Promise<ImportRep> {
    return (await (mode === undefined
      ? pharmacie.importerStock(PHARMACIE, user, fichier)
      : pharmacie.importerStock(
          PHARMACIE,
          user,
          fichier,
          mode,
        ))) as unknown as ImportRep;
  }

  async function apercu(
    fichier: FichierImport,
    user = RESPONSABLE,
  ): Promise<ImportRep> {
    return (await pharmacie.apercuImportStock(
      PHARMACIE,
      user,
      fichier,
    )) as unknown as ImportRep;
  }

  async function vendre(stockId: string, quantite: number) {
    const dto: CreerVenteDto = { lignes: [{ stockId, quantite }] };
    return (await service.creerVente(
      PHARMACIE,
      VENDEUR,
      dto,
      undefined,
      '127.0.0.1',
    )) as unknown as VenteRep;
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

  async function soldeLot(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  const nombreInventaires = () =>
    compter('SELECT count(*) AS n FROM "Inventaire"');
  const nombreLots = () => compter('SELECT count(*) AS n FROM "LotStock"');
  const nombreMouvements = () =>
    compter('SELECT count(*) AS n FROM "MouvementStock"');

  async function compteurs() {
    return (
      await sql(
        `SELECT "medicamentId", "quantite", "disponible" FROM "StockMedicament" WHERE "structureId" = $1 AND "medicamentId" LIKE 'med-invimp-%' ORDER BY "medicamentId"`,
        [PHARMACIE],
      )
    ).rows;
  }

  async function anomaliesDe(inventaireId: string) {
    return (
      await sql(
        `SELECT "type"::text AS "type", "attribueeAId", "pieceType", "pieceId" FROM "Anomalie" WHERE "pieceId" = $1`,
        [inventaireId],
      )
    ).rows;
  }

  it('mode absent : inventaire, comptage absolu par lot', async () => {
    const f = await nouvelleFiche({ coef: 10, tolerance: 5 });
    const lotId = (
      await recevoir({
        lignes: [
          {
            stockId: f.stockId,
            nombreBoites: 3,
            numeroLot: 'L-1',
            dateExpiration: jour(300),
          },
        ],
      })
    ).data.lots[0].id;

    const r = await importer(
      await construireFichier([[f.nom, 2, 7, null, null]]),
    );

    expect(r.data.mode).toBe('inventaire');
    expect(r.data.inventaireId).not.toBeNull();
    const inventaire = (
      await sql(`SELECT "commentaire" FROM "Inventaire" WHERE "id" = $1`, [
        r.data.inventaireId,
      ])
    ).rows;
    expect(inventaire).toEqual([{ commentaire: 'Import Excel' }]);
    expect(r.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      quantiteComptee: 27,
      quantiteTheorique: 30,
      ecart: -3,
      sousTolerance: true,
      quantiteAvant: 30,
      quantiteApres: 27,
    });
    expect(await soldeLot(lotId)).toBe(27);
    const mouvements = (
      await sql(
        `SELECT "quantite", "pieceOrigineType"::text AS "pieceOrigineType" FROM "MouvementStock" WHERE "lotId" = $1 AND "type" = 'INVENTAIRE'`,
        [lotId],
      )
    ).rows;
    expect(mouvements).toEqual([
      { quantite: -3, pieceOrigineType: 'INVENTAIRE' },
    ]);
  });

  it("au-delà de la tolérance : anomalie attribuée à l'auteur, message complété", async () => {
    const f = await nouvelleFiche({ coef: 10, tolerance: 0 });
    await recevoir({
      lignes: [
        { stockId: f.stockId, nombreBoites: 3, dateExpiration: jour(300) },
      ],
    });

    const r = await importer(
      await construireFichier([[f.nom, 2, null, null, null]]),
    );

    expect(r.data.lignes[0]).toMatchObject({
      ecart: -10,
      sousTolerance: false,
    });
    const anomalies = await anomaliesDe(String(r.data.inventaireId));
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      type: 'ECART_INVENTAIRE',
      attribueeAId: RESPONSABLE,
      pieceId: r.data.inventaireId,
    });
    expect(r.message.endsWith(messageAnomaliesImportInventaire(1))).toBe(true);
  });

  it('fiche à plusieurs lots : ligne sans lot rejetée avec la liste, ligne par lot acceptée', async () => {
    const f = await nouvelleFiche();
    const rec = await recevoir({
      lignes: [
        {
          stockId: f.stockId,
          nombreBoites: 5,
          numeroLot: 'A1',
          dateExpiration: jour(100),
        },
        {
          stockId: f.stockId,
          nombreBoites: 5,
          numeroLot: 'B2',
          dateExpiration: jour(200),
        },
      ],
    });
    const lotA = rec.data.lots.find((l) => l.numeroLot === 'A1')?.id as string;
    const lotB = rec.data.lots.find((l) => l.numeroLot === 'B2')?.id as string;

    const r = await importer(
      await construireFichier([
        [f.nom, 1, null, null, null],
        [f.nom, 4, null, 'A1', null],
        [f.nom, 2, null, null, jour(200)],
      ]),
    );

    expect(r.data.lignes[0].statut).toBe('rejetee');
    expect(
      r.data.lignes[0].raison?.startsWith(
        'Ce médicament a plusieurs lots en stock (A1 (péremption ',
      ),
    ).toBe(true);
    expect(r.data.lignes[1].statut).toBe('acceptee');
    expect(r.data.lignes[2].statut).toBe('acceptee');
    expect(await soldeLot(lotA)).toBe(4);
    expect(await soldeLot(lotB)).toBe(2);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "LigneInventaire" WHERE "inventaireId" = $1`,
        [r.data.inventaireId],
      ),
    ).toBe(2);
    expect(
      await compter(`SELECT count(*) AS n FROM "Inventaire" WHERE "id" = $1`, [
        r.data.inventaireId,
      ]),
    ).toBe(1);
  });

  it('médicament absent du stock : fiche créée et nouveau lot, ou rejet', async () => {
    const a = await nouveauMedicament();
    const b = await nouveauMedicament();

    const r = await importer(
      await construireFichier([
        [a.nom, 3, null, null, jour(200)],
        [b.nom, 0, null, null, jour(200)],
      ]),
    );

    expect(r.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      nouveauLot: true,
      quantiteComptee: 3,
    });
    expect(r.data.lignes[1].statut).toBe('rejetee');
    const ficheA = (
      await sql(
        `SELECT "id", "coefficientBoite" FROM "StockMedicament" WHERE "medicamentId" = $1 AND "structureId" = $2`,
        [a.medicamentId, PHARMACIE],
      )
    ).rows;
    expect(ficheA).toHaveLength(1);
    expect(ficheA[0].coefficientBoite).toBe(1);
    const mouvements = (
      await sql(
        `SELECT "quantite" FROM "MouvementStock" WHERE "stockMedicamentId" = $1 AND "type" = 'INVENTAIRE'`,
        [ficheA[0].id],
      )
    ).rows;
    expect(mouvements).toEqual([{ quantite: 3 }]);
    expect(
      (await anomaliesDe(String(r.data.inventaireId))).map((x) => x.type),
    ).toEqual(['ECART_INVENTAIRE']);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "StockMedicament" WHERE "medicamentId" = $1`,
        [b.medicamentId],
      ),
    ).toBe(0);
  });

  it("ventes faites sans stock rattachées par l'import", async () => {
    const f = await nouvelleFiche({ coef: 1 });
    const lotId = (
      await recevoir({
        lignes: [
          {
            stockId: f.stockId,
            nombreBoites: 2,
            numeroLot: 'L-5',
            dateExpiration: jour(300),
          },
        ],
      })
    ).data.lots[0].id;
    await vendre(f.stockId, 2);
    // Vente sans stock : seul le rejeu d'un poste l'accepte
    const v2 = await venteParRejeu({ stockId: f.stockId, nombre: 1 });
    expect(await soldeProduit(f.stockId)).toBe(-1);

    // Le lot est épuisé : la ligne le désigne par son numéro
    const r = await importer(
      await construireFichier([[f.nom, 4, null, 'L-5', null]]),
    );

    expect(r.data.lignes[0].statut).toBe('acceptee');
    expect(await soldeLot(lotId)).toBe(4);
    expect(await soldeProduit(f.stockId)).toBe(4);
    const alloc = await allocations(v2.data.id);
    expect(alloc.map((x) => [x.statut, Number(x.quantite)])).toEqual([
      ['REMPLACEE', 1],
      ['DEFINITIVE', 1],
    ]);
  });

  it('D600 : stock négatif compté sans lot ni date, le lot unique finit au comptage', async () => {
    const f = await nouvelleFiche({ coef: 1 });
    const lotId = (
      await recevoir({
        lignes: [
          { stockId: f.stockId, nombreBoites: 2, dateExpiration: jour(300) },
        ],
      })
    ).data.lots[0].id;
    await vendre(f.stockId, 2);
    const v2 = await venteParRejeu({ stockId: f.stockId, nombre: 3 });
    expect(await soldeProduit(f.stockId)).toBe(-3);
    expect(await soldeLot(lotId)).toBe(0);
    const lotsAvant = await nombreLots();
    const fichier = await construireFichier([[f.nom, 5, null, null, null]]);

    const a = await apercu(fichier);
    expect(a.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      lotId,
      nouveauLot: false,
      // Jamais négatif en sortie (D717) ; l'écart reste signé
      quantiteTheorique: 0,
      quantiteARegulariser: 3,
      quantiteComptee: 5,
      ecart: 8,
    });

    const r = await importer(fichier);

    expect(r.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      lotId,
      nouveauLot: false,
      quantiteAvant: 0,
      quantiteApres: 5,
      quantiteTheorique: 0,
      quantiteARegulariser: 3,
      ecart: 8,
    });
    expect(await nombreLots()).toBe(lotsAvant);
    expect(await soldeLot(lotId)).toBe(5);
    expect(await soldeProduit(f.stockId)).toBe(5);
    const alloc = await allocations(v2.data.id);
    expect(alloc.map((x) => [x.statut, Number(x.quantite)])).toEqual([
      ['REMPLACEE', 3],
      ['DEFINITIVE', 3],
    ]);
  });

  it("aperçu : rien n'est écrit, mêmes valeurs que l'import", async () => {
    const f = await nouvelleFiche({ coef: 10, tolerance: 5 });
    await recevoir({
      lignes: [
        { stockId: f.stockId, nombreBoites: 3, dateExpiration: jour(300) },
      ],
    });
    const fichier = await construireFichier([[f.nom, 2, 7, null, null]]);
    const inventairesAvant = await nombreInventaires();
    const mouvementsAvant = await nombreMouvements();
    const lotsAvant = await nombreLots();

    const a = await apercu(fichier);

    expect(a.data.lignes[0]).toMatchObject({
      statut: 'acceptee',
      quantiteTheorique: 30,
      ecart: -3,
    });
    expect(await nombreInventaires()).toBe(inventairesAvant);
    expect(await nombreMouvements()).toBe(mouvementsAvant);
    expect(await nombreLots()).toBe(lotsAvant);

    const r = await importer(fichier);
    expect(r.data.lignes[0]).toMatchObject({
      quantiteTheorique: 30,
      ecart: -3,
    });
  });

  it('sans inventaire:write : 403 avant toute lecture', async () => {
    const f = await nouvelleFiche();
    const fichier = await construireFichier([[f.nom, 2, null, null, null]]);
    const inventairesAvant = await nombreInventaires();
    const mouvementsAvant = await nombreMouvements();
    const lotsAvant = await nombreLots();

    const importe = await refus(importer(fichier, VENDEUR));
    const vu = await refus(apercu(fichier, VENDEUR));

    for (const r of [importe, vu]) {
      expect(r.statut).toBe(403);
      expect(r.corps).toMatchObject({
        message: MESSAGE_IMPORT_INVENTAIRE_INTERDIT,
      });
    }
    expect(await nombreInventaires()).toBe(inventairesAvant);
    expect(await nombreMouvements()).toBe(mouvementsAvant);
    expect(await nombreLots()).toBe(lotsAvant);
  });

  it('toutes les lignes rejetées : aucun inventaire', async () => {
    const inventairesAvant = await nombreInventaires();

    const r = await importer(
      await construireFichier([['Médicament qui n’existe pas', 2]]),
    );

    expect(r.data.importees).toBe(0);
    expect(r.data.inventaireId).toBeNull();
    expect(await nombreInventaires()).toBe(inventairesAvant);
  });

  it('livraison inchangée', async () => {
    const f = await nouvelleFiche();

    const r = await importer(
      await construireFichier([[f.nom, 5, null, jour(200)]], ENTETES_LIVRAISON),
      RESPONSABLE,
      'livraison',
    );

    expect(r.data.receptionId).not.toBeNull();
    expect(r.data.inventaireId).toBeNull();
  });

  it('compteur gelé jamais écrit', async () => {
    const f = await nouvelleFiche({ coef: 10 });
    await recevoir({
      lignes: [
        { stockId: f.stockId, nombreBoites: 2, dateExpiration: jour(300) },
      ],
    });
    const avant = await compteurs();

    await importer(await construireFichier([[f.nom, 1, 3, null, null]]));

    const apres = await compteurs();
    expect(apres).toEqual(avant);
    apres.forEach((x) => expect(Number(x.quantite)).toBe(0));
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const verif = await verifierStock(base.client);
    expect(verif.totalAnomalies).toBe(0);
  });
});
