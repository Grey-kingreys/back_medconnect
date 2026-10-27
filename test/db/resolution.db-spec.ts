import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import {
  MESSAGE_VENTES_RATTACHEES,
  messageReceptionEnregistree,
  ReceptionsService,
} from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { ResolutionEcrite } from 'src/pharmacie/stock/resolution-provisoires';
import type { CreerReceptionDto } from 'src/pharmacie/dto/receptions.dto';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
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

interface LotRep {
  id: string;
  stockId: string;
  dateExpiration: string | null;
}
interface ReceptionRep {
  data: {
    id: string;
    lots: LotRep[];
    resolutions: ResolutionEcrite[];
  };
  message: string;
}
interface VenteRep {
  data: { id: string };
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Résolution des allocations provisoires, sur base de test (PB14b)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let receptions: ReceptionsService;
  let mouvements: MouvementsStockService;
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
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    mouvements = new MouvementsStockService();
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
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
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

  async function nouvelleFiche(): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit résolution ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB14b', false, now())`,
      [`med-resol-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, 1, true, now())`,
      [`stk-resol-${n}`, `med-resol-${n}`, PHARMACIE],
    );
    return { stockId: `stk-resol-${n}`, nom };
  }

  async function recevoir(dto: CreerReceptionDto): Promise<ReceptionRep> {
    return (await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      dto,
      '127.0.0.1',
    )) as unknown as ReceptionRep;
  }

  /** Réception de N boîtes, péremption dans `joursAvant` jours, coût de boîte facultatif. */
  const recevoirBoites = (
    stockId: string,
    nombreBoites: number,
    o: { dans?: number; cout?: number } = {},
  ) =>
    recevoir({
      lignes: [
        {
          stockId,
          nombreBoites,
          dateExpiration: jour(o.dans ?? 300),
          ...(o.cout === undefined ? {} : { coutAchatBoite: o.cout }),
        },
      ],
    });

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

  async function annuler(venteId: string) {
    return await service.annulerVente(
      PHARMACIE,
      venteId,
      VENDEUR,
      { motif: 'Erreur de quantité' },
      '127.0.0.1',
    );
  }

  async function numeroDe(venteId: string): Promise<string> {
    const res = await sql('SELECT "numero" FROM "Vente" WHERE "id" = $1', [
      venteId,
    ]);
    return String(res.rows[0].numero);
  }

  async function pieceAnnulation(venteId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "Vente" WHERE "venteOrigineId" = $1',
      [venteId],
    );
    return String(res.rows[0].id);
  }

  async function allocations(venteId: string) {
    return (
      await sql(
        `SELECT a."id", a."statut"::text AS "statut", a."quantite", a."lotId", a."coutUnitaire", a."remplaceeParPieceId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."createdAt", a."id"`,
        [venteId],
      )
    ).rows;
  }

  async function mouvementsResolution(receptionId: string) {
    return (
      await sql(
        `SELECT "type"::text AS "type", "quantite", "lotId", "evenementId", "motif" FROM "MouvementStock" WHERE "pieceOrigineType" = 'RESOLUTION' AND "pieceOrigineId" = $1 ORDER BY "horodatageServeur", "evenementId"`,
        [receptionId],
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

  async function sommeLots(stockId: string): Promise<number> {
    const res = await sql(
      `SELECT COALESCE(SUM(g."quantite"), 0) AS n FROM "AgregatStockLot" g JOIN "LotStock" l ON l."id" = g."lotId" WHERE l."stockMedicamentId" = $1`,
      [stockId],
    );
    return Number(res.rows[0].n);
  }

  const attentesConsultatives = () =>
    compter(
      `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    );

  async function attendreAttentes(n: number): Promise<void> {
    const debut = Date.now();
    while ((await attentesConsultatives()) < n) {
      if (Date.now() - debut > 4_000) {
        throw new Error('Attente non observée.');
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  function tenirFiche(stockId: string) {
    let signaler: () => void = () => undefined;
    const tenu = new Promise<void>((r) => (signaler = r));
    let liberer: () => void = () => undefined;
    const libere = new Promise<void>((r) => (liberer = r));
    const fin = prisma.$transaction(
      async (tx) => {
        await mouvements.verrouillerFiches(tx, [stockId]);
        signaler();
        await libere;
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    return { tenu, liberer, fin };
  }

  it('résolution complète : provisoire remplacée, allocation définitive au coût du lot, pièce RESOLUTION, agrégats cohérents', async () => {
    const { stockId, nom } = await nouvelleFiche();
    const v = await vendre(stockId, 2);
    expect(await soldeProduit(stockId)).toBe(-2);
    const numero = await numeroDe(v.data.id);

    const r = await recevoirBoites(stockId, 10, { dans: 200, cout: 700 });
    const lotId = r.data.lots[0].id;
    const a = (await allocations(v.data.id)).find(
      (x) => x.statut === 'REMPLACEE',
    );
    expect(a).toBeDefined();
    const allocationId = String(a?.id);

    expect(r.data.resolutions).toEqual([
      {
        allocationId,
        venteId: v.data.id,
        numeroVente: numero,
        stockId,
        nom,
        quantiteProvisoire: 2,
        quantiteResolue: 2,
        resteProvisoire: 0,
      },
    ]);
    expect(r.message).toBe(
      messageReceptionEnregistree(1) + ' ' + MESSAGE_VENTES_RATTACHEES,
    );

    const alloc = await allocations(v.data.id);
    expect(alloc).toHaveLength(2);
    expect(alloc[0]).toMatchObject({
      statut: 'REMPLACEE',
      quantite: 2,
      lotId: null,
      remplaceeParPieceId: r.data.id,
    });
    expect(alloc[1]).toMatchObject({
      statut: 'DEFINITIVE',
      quantite: 2,
      lotId,
      coutUnitaire: 700,
    });

    const mvts = await mouvementsResolution(r.data.id);
    expect(mvts).toHaveLength(2);
    expect(mvts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'VENTE',
          quantite: -2,
          lotId,
          evenementId: `resolution:${allocationId}:${lotId}`,
          motif: `Résolution de la vente ${numero}`,
        }),
        expect.objectContaining({
          type: 'VENTE',
          quantite: 2,
          lotId: null,
          evenementId: `resolution:${allocationId}:contrepartie`,
        }),
      ]),
    );

    expect(await soldeLot(lotId)).toBe(8);
    expect(await soldeProduit(stockId)).toBe(8);
    expect(await sommeLots(stockId)).toBe(8);

    const detail = (
      await service.detailVente(PHARMACIE, v.data.id, RESPONSABLE)
    ).data as unknown as { provisoire: boolean };
    expect(detail.provisoire).toBe(false);
    const anomalie = await sql(
      `SELECT "statut"::text AS "statut" FROM "Anomalie" WHERE "pieceId" = $1 AND "type"::text = 'STOCK_NEGATIF'`,
      [v.data.id],
    );
    expect(anomalie.rows).toEqual([{ statut: 'OUVERTE' }]);
  });

  it('résolution partielle puis seconde réception qui termine', async () => {
    const { stockId } = await nouvelleFiche();
    const v = await vendre(stockId, 5);

    const r1 = await recevoirBoites(stockId, 3);
    expect(r1.data.resolutions).toHaveLength(1);
    expect(r1.data.resolutions[0]).toMatchObject({
      quantiteProvisoire: 5,
      quantiteResolue: 3,
      resteProvisoire: 2,
    });
    const apres1 = (await allocations(v.data.id)).map((x) => [
      x.statut,
      x.quantite,
    ]);
    expect(apres1).toEqual(
      expect.arrayContaining([
        ['REMPLACEE', 5],
        ['DEFINITIVE', 3],
        ['PROVISOIRE', 2],
      ]),
    );
    expect(apres1).toHaveLength(3);
    expect(await soldeProduit(stockId)).toBe(-2);
    expect(await sommeLots(stockId)).toBe(0);

    const r2 = await recevoirBoites(stockId, 10);
    expect(r2.data.resolutions).toHaveLength(1);
    expect(r2.data.resolutions[0]).toMatchObject({
      quantiteProvisoire: 2,
      quantiteResolue: 2,
      resteProvisoire: 0,
    });
    const apres2 = (await allocations(v.data.id)).map((x) => [
      x.statut,
      x.quantite,
    ]);
    expect(apres2).toHaveLength(4);
    expect(apres2.filter((x) => x[0] === 'REMPLACEE')).toEqual([
      ['REMPLACEE', 5],
      ['REMPLACEE', 2],
    ]);
    expect(apres2.filter((x) => x[0] === 'DEFINITIVE')).toEqual([
      ['DEFINITIVE', 3],
      ['DEFINITIVE', 2],
    ]);
    expect(await soldeProduit(stockId)).toBe(8);
    expect(await sommeLots(stockId)).toBe(8);
  });

  it("ordre : ventes les plus anciennes d'abord, lots en FEFO, lot périmé jamais pris", async () => {
    const { stockId } = await nouvelleFiche();
    const v1 = await vendre(stockId, 3);
    const v2 = await vendre(stockId, 3);
    const r = await recevoir({
      lignes: [
        { stockId, nombreBoites: 2, dateExpiration: jour(300) },
        { stockId, nombreBoites: 2, dateExpiration: jour(100) },
      ],
    });
    const lotTard = String(
      r.data.lots.find((l) => l.dateExpiration === jour(300))?.id,
    );
    const lotTot = String(
      r.data.lots.find((l) => l.dateExpiration === jour(100))?.id,
    );
    expect(r.data.resolutions).toHaveLength(2);

    const definitives = async (venteId: string) =>
      (await allocations(venteId))
        .filter((x) => x.statut === 'DEFINITIVE')
        .map((x) => [x.lotId, x.quantite]);
    expect(await definitives(v1.data.id)).toEqual(
      expect.arrayContaining([
        [lotTot, 2],
        [lotTard, 1],
      ]),
    );
    expect(await definitives(v1.data.id)).toHaveLength(2);
    expect(await definitives(v2.data.id)).toEqual([[lotTard, 1]]);
    const reste2 = r.data.resolutions.find((x) => x.venteId === v2.data.id);
    expect(reste2?.resteProvisoire).toBe(2);

    // Lot périmé jamais pris, le jour même vendable
    const autre = await nouvelleFiche();
    const w = await vendre(autre.stockId, 2);
    const lotPerime = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: autre.stockId,
        pointDeVenteId: pv1,
        numeroLot: 'E',
        dateExpiration: jourVersDate(jour(-1)),
        quantite: 5,
        coutUnitaire: 0,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: RESPONSABLE,
        pieceOrigineType: 'AJUSTEMENT',
        pieceOrigineId: null,
        motif: 'Lot périmé du test',
      }),
    );
    const idPerime = lotPerime.lot.id;
    const rw = await recevoirBoites(autre.stockId, 1, { dans: 0 });
    const lotDuJour = rw.data.lots[0].id;
    expect(rw.data.resolutions).toHaveLength(1);
    expect(rw.data.resolutions[0].resteProvisoire).toBe(1);
    const defW = (await allocations(w.data.id)).filter(
      (x) => x.statut === 'DEFINITIVE',
    );
    expect(defW.map((x) => [x.lotId, x.quantite])).toEqual([[lotDuJour, 1]]);
    expect(await soldeLot(idPerime)).toBe(5);
  });

  it("ventes annulées et pièces d'annulation jamais résolues (D548)", async () => {
    const { stockId } = await nouvelleFiche();
    const v = await vendre(stockId, 2);
    await annuler(v.data.id);
    const piece = await pieceAnnulation(v.data.id);

    const r = await recevoirBoites(stockId, 10);
    expect(r.data.resolutions).toEqual([]);
    expect((await allocations(v.data.id)).map((x) => x.statut)).toEqual([
      'PROVISOIRE',
    ]);
    expect((await allocations(piece)).map((x) => x.statut)).toEqual([
      'PROVISOIRE',
    ]);
    expect(await soldeProduit(stockId)).toBe(10);
    expect(await sommeLots(stockId)).toBe(10);
  });

  it('vente résolue puis annulée : stock rendu au lot de la résolution', async () => {
    const { stockId } = await nouvelleFiche();
    const v = await vendre(stockId, 2);
    const r = await recevoirBoites(stockId, 10);
    const lotId = r.data.lots[0].id;
    expect(await soldeLot(lotId)).toBe(8);

    await annuler(v.data.id);
    const piece = await pieceAnnulation(v.data.id);
    expect(
      (await allocations(piece)).map((x) => [x.statut, x.quantite, x.lotId]),
    ).toEqual([['DEFINITIVE', -2, lotId]]);
    expect(await soldeLot(lotId)).toBe(10);
    expect(await soldeProduit(stockId)).toBe(10);
    expect(await sommeLots(stockId)).toBe(10);
  });

  it('détail de la réception : résolutions relues, coûts masqués', async () => {
    const { stockId } = await nouvelleFiche();
    await vendre(stockId, 2);
    const r = await recevoirBoites(stockId, 10, { dans: 200, cout: 700 });
    expect(r.data.resolutions).toHaveLength(1);

    const detail = (await receptions.detail(
      PHARMACIE,
      RESPONSABLE,
      r.data.id,
    )) as unknown as ReceptionRep;
    expect(detail.data.resolutions).toEqual(r.data.resolutions);

    const detailVendeur = (await receptions.detail(
      PHARMACIE,
      VENDEUR,
      r.data.id,
    )) as unknown as ReceptionRep;
    expect(cheminsCout(detailVendeur.data)).toEqual([]);
  });

  it('concurrence : vente provisoire en attente puis réception, la réception la résout', async () => {
    const { stockId } = await nouvelleFiche();
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let vente: Promise<VenteRep> | undefined;
    let reception: Promise<ReceptionRep> | undefined;
    try {
      await tenu;
      vente = vendre(stockId, 2);
      await attendreAttentes(1);
      reception = recevoirBoites(stockId, 10);
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [v, r] = await Promise.allSettled([vente, reception]);

    expect(v.status).toBe('fulfilled');
    expect(r.status).toBe('fulfilled');
    if (r.status === 'fulfilled') {
      expect(r.value.data.resolutions).toHaveLength(1);
      expect(r.value.data.resolutions[0].quantiteResolue).toBe(2);
      expect(await soldeLot(r.value.data.lots[0].id)).toBe(8);
    }
    expect(await soldeProduit(stockId)).toBe(8);
    expect(await sommeLots(stockId)).toBe(8);
  });

  it("concurrence : réception en attente puis annulation, l'annulation relit les allocations", async () => {
    const { stockId } = await nouvelleFiche();
    const v = await vendre(stockId, 2);
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let reception: Promise<ReceptionRep> | undefined;
    let annulation: Promise<unknown> | undefined;
    try {
      await tenu;
      reception = recevoirBoites(stockId, 10);
      await attendreAttentes(1);
      annulation = annuler(v.data.id);
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [r, a] = await Promise.allSettled([reception, annulation]);

    expect(r.status).toBe('fulfilled');
    expect(a.status).toBe('fulfilled');
    if (r.status === 'fulfilled') {
      expect(r.value.data.resolutions).toHaveLength(1);
      expect(r.value.data.resolutions[0].venteId).toBe(v.data.id);
      const piece = await pieceAnnulation(v.data.id);
      const alloc = await allocations(piece);
      expect(alloc.map((x) => [x.statut, x.quantite, x.lotId])).toEqual([
        ['DEFINITIVE', -2, r.value.data.lots[0].id],
      ]);
      expect(await soldeLot(r.value.data.lots[0].id)).toBe(10);
    }
    expect(await soldeProduit(stockId)).toBe(10);
    expect(await sommeLots(stockId)).toBe(10);
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
