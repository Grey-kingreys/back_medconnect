import { ConflictException, HttpException } from '@nestjs/common';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import {
  FicheProduitService,
  MESSAGE_FICHE_INTROUVABLE,
} from 'src/pharmacie/fiche-produit.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import {
  MESSAGE_DATE_PEREMPTION_REQUISE,
  MESSAGE_LOT_INTROUVABLE,
  MESSAGE_LOT_REQUIS_CHOIX,
  MESSAGE_LOT_REQUIS_DATE,
  MESSAGE_LOT_REQUIS_QUANTITE,
  MESSAGE_MEDICAMENT_UTILISE,
  messageStockLotNegatif,
  PharmacieService,
} from 'src/pharmacie/pharmacie.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import {
  MESSAGE_CONDITIONNEMENT_DEJA_OUVERT,
  MESSAGE_STOCK_LOT_INSUFFISANT,
  MouvementsStockService,
} from 'src/pharmacie/stock/mouvements-stock.service';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: Record<string, unknown> }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      return {
        statut: erreur.getStatus(),
        corps: erreur.getResponse() as Record<string, unknown>,
      };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

interface LotLu {
  id: string;
  lotTechnique: boolean;
  numeroLot: string | null;
  quantite: number;
  coutUnitaire?: number;
  dateExpiration: Date | null;
}
interface FicheLue {
  id: string;
  quantite: number;
  quantiteVendable: number;
  disponible: boolean;
  dateExpiration: Date | null;
  reliquat: Array<{ lotId: string; unitesRestantes: number }>;
  lots: LotLu[];
  prixUnitaire: number | null;
  notes: string | null;
  avertissements?: unknown[];
}
interface ReponseStock {
  data: { stocks: FicheLue[]; alertes: { stockBas: Array<{ id: string }> } };
}
interface ReponseFiche {
  data: FicheLue;
  message: string;
}
interface FichePublique {
  id: string;
  quantite: number;
  disponible: boolean;
  dateExpiration: Date | null;
}

function jourDe(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

describe('Mouvements de stock et lectures recâblées sur base de test (PB08)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let resume: ResumeFormatActuel;
  let acces: AccesPharmacieService;
  let mouvements: MouvementsStockService;
  let notifications: NotificationsService;
  let pharmacie: PharmacieService;
  let fiches: FicheProduitService;
  let J: Date;
  let pv1: string;
  let pv2: string;

  const jour = (n: number) =>
    new Date(J.getTime() + n * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
    acces = new AccesPharmacieService(prisma);
    mouvements = new MouvementsStockService();
    notifications = new NotificationsService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          ['usr-admin-p1', 'usr-admin-p2'].includes(id) ? ['marge:read'] : [],
        ),
    } as unknown as PermissionsService;
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      mouvements,
      permissions,
      new ReceptionsService(prisma, acces, mouvements, permissions),
    );
    fiches = new FicheProduitService(prisma, acces, mouvements);
    J = resume.aujourdhui;
    const pvs = await sql(
      'SELECT "id", "structureId" FROM "PointDeVente" WHERE "ordre" = 1',
    );
    pv1 = String(pvs.rows.find((r) => r.structureId === 'str-pharma-1')?.id);
    pv2 = String(pvs.rows.find((r) => r.structureId === 'str-pharma-2')?.id);
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

  async function lotTechnique(stockId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique" = true',
      [stockId],
    );
    return String(res.rows[0].id);
  }

  async function mouvementsDe(stockId: string) {
    const res = await sql(
      `SELECT "type"::text AS "type", "quantite", "pieceOrigineType"::text AS "pieceOrigineType", "motif", "auteurId", "lotId"
       FROM "MouvementStock" WHERE "stockMedicamentId" = $1 ORDER BY "horodatageServeur", "id"`,
      [stockId],
    );
    return res.rows;
  }

  async function ouverts(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT count(*)::int AS "n" FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
      [lotId],
    );
    return Number(res.rows[0].n);
  }

  async function audits(entityType: string, entityId: string) {
    const res = await sql(
      'SELECT "action", "metadata" FROM "AuditLog" WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "createdAt", "id"',
      [entityType, entityId],
    );
    return res.rows;
  }

  const lireStock = async (userId = 'usr-admin-p1') =>
    (await pharmacie.getStockPharmacie(
      'str-pharma-1',
      userId,
    )) as unknown as ReponseStock;

  const upsert = (
    structureId: string,
    userId: string,
    dto: Parameters<PharmacieService['upsertStock']>[2],
  ) =>
    pharmacie.upsertStock(
      structureId,
      userId,
      dto,
    ) as unknown as Promise<ReponseFiche>;

  const corriger = (
    stockId: string,
    dto: Parameters<PharmacieService['updateStockQuantite']>[3],
    userId = 'usr-admin-p1',
  ) =>
    pharmacie.updateStockQuantite(
      'str-pharma-1',
      stockId,
      userId,
      dto,
    ) as unknown as Promise<ReponseFiche>;

  it('1. lecture : quantité, lots et date calculés depuis le journal, coûts masqués sans marge:read', async () => {
    const r = await lireStock();
    const s06 = r.data.stocks.find((s) => s.id === 'stk-06');
    expect(s06?.quantite).toBe(240);
    expect(s06?.quantiteVendable).toBe(240);
    expect(s06?.disponible).toBe(true);
    expect(s06?.reliquat).toEqual([]);
    expect(s06?.lots).toHaveLength(1);
    expect(s06?.lots[0]).toMatchObject({
      lotTechnique: true,
      numeroLot: null,
      quantite: 240,
      coutUnitaire: 0,
    });
    expect(jourDe(s06?.dateExpiration ?? null)).toBe(jour(0));
    const s01 = r.data.stocks.find((s) => s.id === 'stk-01');
    expect(s01?.quantite).toBe(0);
    expect(s01?.lots).toEqual([]);
    expect(s01?.dateExpiration).toBeNull();
    expect(s01?.disponible).toBe(false);
    expect(cheminsCout(r).length).toBeGreaterThan(0);

    const sansMarge = await lireStock('usr-pharm-p1');
    expect(cheminsCout(sansMarge)).toEqual([]);
  });

  it('2. upsert d une fiche nouvelle avec stock : lot non technique sans coût et mouvement RECEPTION', async () => {
    const r = await upsert('str-pharma-2', 'usr-admin-p2', {
      medicamentId: 'med-16',
      quantite: 12,
      prixUnitaire: 3000,
      dateExpiration: jour(200),
    });
    expect(r.message).toBe('Stock mis à jour');
    expect(r.data.quantite).toBe(12);
    expect(r.data.disponible).toBe(true);
    expect(r.data.avertissements).toEqual([]);
    expect(r.data.lots[0].coutUnitaire).toBe(0);

    const fiche = await sql(
      'SELECT "id", "quantite" FROM "StockMedicament" WHERE "structureId" = $1 AND "medicamentId" = $2',
      ['str-pharma-2', 'med-16'],
    );
    expect(fiche.rows).toHaveLength(1);
    expect(fiche.rows[0].quantite).toBe(0);
    const ficheId = String(fiche.rows[0].id);
    const lots = await sql(
      `SELECT "lotTechnique", "coutUnitaire", "numeroLot", "coefficientReception", "quantiteRecue", "dateExpiration"::text AS "date", "auteurId", "pointDeVenteId"
       FROM "LotStock" WHERE "stockMedicamentId" = $1`,
      [ficheId],
    );
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0]).toMatchObject({
      lotTechnique: false,
      coutUnitaire: 0,
      numeroLot: null,
      coefficientReception: 1,
      quantiteRecue: 12,
      date: jour(200),
      auteurId: 'usr-admin-p2',
      pointDeVenteId: pv2,
    });
    const journal = await mouvementsDe(ficheId);
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      type: 'RECEPTION',
      pieceOrigineType: 'AJUSTEMENT',
      quantite: 12,
      motif: 'Quantité saisie sur la fiche de stock',
      auteurId: 'usr-admin-p2',
    });
  });

  it('3. création de lot sans date : 400 DATE_PEREMPTION_REQUISE sans rien écrire ; sansPeremption l autorise ; quantité nulle sans lot', async () => {
    const e = await refus(
      upsert('str-pharma-1', 'usr-admin-p1', {
        medicamentId: 'med-01',
        quantite: 5,
        prixUnitaire: 999,
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('DATE_PEREMPTION_REQUISE');
    expect(e.corps.message).toBe(MESSAGE_DATE_PEREMPTION_REQUISE);
    const avant = await sql(
      'SELECT "prixUnitaire" FROM "StockMedicament" WHERE "id" = $1',
      ['stk-01'],
    );
    expect(avant.rows[0].prixUnitaire).toBe(1500);
    expect(await mouvementsDe('stk-01')).toHaveLength(0);

    const r = await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-01',
      quantite: 5,
      sansPeremption: true,
    });
    const lots = await sql(
      'SELECT "dateExpiration" FROM "LotStock" WHERE "stockMedicamentId" = $1',
      ['stk-01'],
    );
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0].dateExpiration).toBeNull();
    expect(r.data.quantite).toBe(5);
    expect(r.data.dateExpiration).toBeNull();

    const zero = await upsert('str-pharma-2', 'usr-admin-p2', {
      medicamentId: 'med-17',
      quantite: 0,
    });
    const nouvelle = await sql(
      'SELECT "id" FROM "StockMedicament" WHERE "structureId" = $1 AND "medicamentId" = $2',
      ['str-pharma-2', 'med-17'],
    );
    expect(nouvelle.rows).toHaveLength(1);
    const id = String(nouvelle.rows[0].id);
    expect(await mouvementsDe(id)).toHaveLength(0);
    const lotsZero = await sql(
      'SELECT 1 FROM "LotStock" WHERE "stockMedicamentId" = $1',
      [id],
    );
    expect(lotsZero.rows).toHaveLength(0);
    expect(zero.data.quantite).toBe(0);
    expect(zero.data.dateExpiration).toBeNull();
  });

  it('4. un seul lot : INVENTAIRE vers la quantité saisie, rien à quantité égale, date du lot corrigée et auditée', async () => {
    await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-02',
      quantite: 1,
      prixUnitaire: 1800,
    });
    expect(await mouvementsDe('stk-02')).toHaveLength(1);
    const prix = await sql(
      'SELECT "prixUnitaire" FROM "StockMedicament" WHERE "id" = $1',
      ['stk-02'],
    );
    expect(prix.rows[0].prixUnitaire).toBe(1800);

    const r = await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-02',
      quantite: 5,
    });
    const journal = await mouvementsDe('stk-02');
    expect(journal).toHaveLength(2);
    expect(journal[1]).toMatchObject({
      type: 'INVENTAIRE',
      pieceOrigineType: 'AJUSTEMENT',
      quantite: 4,
      motif: 'Quantité corrigée sur la fiche de stock',
    });
    expect(r.data.quantite).toBe(5);

    const r2 = await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-02',
      quantite: 5,
      dateExpiration: jour(30),
    });
    expect(await mouvementsDe('stk-02')).toHaveLength(2);
    const lotId = await lotTechnique('stk-02');
    const date = await sql(
      'SELECT "dateExpiration"::text AS "date" FROM "LotStock" WHERE "id" = $1',
      [lotId],
    );
    expect(date.rows[0].date).toBe(jour(30));
    const audit = await audits('LotStock', lotId);
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('update');
    expect(audit[0].metadata).toEqual({
      avant: { dateExpiration: jour(0) },
      apres: { dateExpiration: jour(30) },
    });
    expect(jourDe(r2.data.dateExpiration)).toBe(jour(30));
  });

  it('5. plusieurs lots : LOT_REQUIS pour une autre quantité ou une autre date, prix seul accepté', async () => {
    await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: 'stk-06',
        pointDeVenteId: pv1,
        numeroLot: 'L-TEST',
        dateExpiration: jourVersDate(jour(60)),
        quantite: 20,
        coutUnitaire: 150,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: 'usr-admin-p1',
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: null,
      }),
    );

    const e1 = await refus(
      upsert('str-pharma-1', 'usr-admin-p1', {
        medicamentId: 'med-06',
        quantite: 250,
      }),
    );
    expect(e1.statut).toBe(409);
    expect(e1.corps.code).toBe('LOT_REQUIS');
    expect(e1.corps.message).toBe(MESSAGE_LOT_REQUIS_QUANTITE);

    const ok = await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-06',
      quantite: 260,
      prixUnitaire: 4000,
    });
    expect(ok.data.quantite).toBe(260);
    expect(ok.data.lots).toHaveLength(2);
    expect(ok.data.lots[0].lotTechnique).toBe(true);
    expect(ok.data.prixUnitaire).toBe(4000);

    const e2 = await refus(
      upsert('str-pharma-1', 'usr-admin-p1', {
        medicamentId: 'med-06',
        quantite: 260,
        dateExpiration: jour(10),
      }),
    );
    expect(e2.statut).toBe(409);
    expect(e2.corps.code).toBe('LOT_REQUIS');
    expect(e2.corps.message).toBe(MESSAGE_LOT_REQUIS_DATE);

    await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-06',
      quantite: 260,
      dateExpiration: jour(0),
    });

    const e3 = await refus(
      corriger('stk-06', { variation: -1, motif: 'Casse' }),
    );
    expect(e3.statut).toBe(409);
    expect(e3.corps.code).toBe('LOT_REQUIS');
    expect(e3.corps.message).toBe(MESSAGE_LOT_REQUIS_CHOIX);

    expect(await mouvementsDe('stk-06')).toHaveLength(2);
  });

  it('6. PATCH : motif requis, lot inconnu, lot jamais négatif', async () => {
    const sansMotif = await refus(
      corriger('stk-04', { variation: -1 }, 'usr-pharm-p1'),
    );
    expect(sansMotif.statut).toBe(400);
    expect(sansMotif.corps.code).toBe('MOTIF_REQUIS');
    const motifCourt = await refus(
      corriger('stk-04', { variation: -1, motif: 'ab' }, 'usr-pharm-p1'),
    );
    expect(motifCourt.statut).toBe(400);
    expect(motifCourt.corps.code).toBe('MOTIF_REQUIS');

    const inconnu = await refus(
      corriger(
        'stk-04',
        { variation: -1, motif: 'Casse', lotId: 'lot-inconnu' },
        'usr-pharm-p1',
      ),
    );
    expect(inconnu.statut).toBe(404);
    expect(inconnu.corps.message).toBe(MESSAGE_LOT_INTROUVABLE);

    const negatif = await refus(
      corriger('stk-04', { variation: -11, motif: 'Casse' }, 'usr-pharm-p1'),
    );
    expect(negatif.statut).toBe(409);
    expect(negatif.corps.code).toBe('STOCK_LOT_NEGATIF');
    expect(negatif.corps.message).toBe(messageStockLotNegatif(10));

    const lotId = await lotTechnique('stk-04');
    const filet = await prisma
      .$transaction((tx) =>
        mouvements.ecrire(tx, {
          pointDeVenteId: pv1,
          stockMedicamentId: 'stk-04',
          lotId,
          type: 'PERTE',
          quantite: -1000,
          pieceOrigineType: 'SORTIE_MANUELLE',
          motif: 'Test',
          auteurId: 'usr-admin-p1',
        }),
      )
      .then(
        () => null,
        (erreur: unknown) => erreur,
      );
    expect(filet).toBeInstanceOf(ConflictException);
    const reponse = (filet as ConflictException).getResponse() as Record<
      string,
      unknown
    >;
    expect(reponse.code).toBe('STOCK_LOT_NEGATIF');
    expect(reponse.message).toBe(MESSAGE_STOCK_LOT_INSUFFISANT);
    expect(await mouvementsDe('stk-04')).toHaveLength(1);
  });

  it('7. PATCH : mouvement CORRECTION motivé et attribué, alerte au seul franchissement du seuil', async () => {
    const espion = jest.spyOn(notifications, 'createManyNotifications');
    const r = await corriger(
      'stk-04',
      { variation: -1, motif: 'Boîte abîmée' },
      'usr-pharm-p1',
    );
    expect(r.message).toBe('Stock réduit (nouvelle quantité : 9)');
    const journal = await mouvementsDe('stk-04');
    expect(journal[journal.length - 1]).toMatchObject({
      type: 'CORRECTION',
      pieceOrigineType: 'AJUSTEMENT',
      quantite: -1,
      motif: 'Boîte abîmée',
      auteurId: 'usr-pharm-p1',
      lotId: await lotTechnique('stk-04'),
    });
    expect(espion).toHaveBeenCalledTimes(1);
    expect(espion.mock.calls[0][1].message).toContain(
      'est descendu à 9 unités.',
    );
    espion.mockClear();

    await corriger(
      'stk-04',
      { variation: -1, motif: 'Boîte abîmée' },
      'usr-pharm-p1',
    );
    expect(espion).not.toHaveBeenCalled();

    const r3 = await corriger(
      'stk-04',
      { variation: 5, motif: 'Retour client', notes: 'Retour du 25' },
      'usr-pharm-p1',
    );
    expect(r3.message).toBe('Stock augmenté (nouvelle quantité : 13)');
    const notes = await sql(
      'SELECT "notes" FROM "StockMedicament" WHERE "id" = $1',
      ['stk-04'],
    );
    expect(notes.rows[0].notes).toBe('Retour du 25');
    espion.mockRestore();
  });

  it('8. PATCH concurrents sur un même lot : aucune mise à jour perdue', async () => {
    const lotId = await lotTechnique('stk-06');
    const appels = [1, 2, 3].map(() =>
      corriger('stk-06', {
        variation: -100,
        lotId,
        motif: 'Inventaire tournant',
      }),
    );
    const resultats = await Promise.allSettled(appels);
    const reussis = resultats.filter((x) => x.status === 'fulfilled');
    const rejetes = resultats.filter(
      (x): x is PromiseRejectedResult => x.status === 'rejected',
    );
    expect(reussis).toHaveLength(2);
    expect(rejetes).toHaveLength(1);
    const reponse = (
      rejetes[0].reason as ConflictException
    ).getResponse() as Record<string, unknown>;
    expect(reponse.code).toBe('STOCK_LOT_NEGATIF');
    const agregat = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    expect(agregat.rows[0].quantite).toBe(40);
    const somme = await sql(
      `SELECT COALESCE(sum("quantite"), 0)::int AS "s" FROM "MouvementStock" WHERE "lotId" = $1 AND "type" = 'CORRECTION'`,
      [lotId],
    );
    expect(somme.rows[0].s).toBe(-200);
  });

  it('9. conditionnement ouvert tenu par le service, seconde ouverture refusée (CA6)', async () => {
    await sql(
      'UPDATE "StockMedicament" SET "coefficientBoite" = 10 WHERE "id" = $1',
      ['stk-07'],
    );
    await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-07',
      quantite: 30,
      dateExpiration: jour(100),
    });
    const lots = await sql(
      'SELECT "id", "coefficientReception" FROM "LotStock" WHERE "stockMedicamentId" = $1',
      ['stk-07'],
    );
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0].coefficientReception).toBe(10);
    const lotId = String(lots.rows[0].id);
    expect(await ouverts(lotId)).toBe(0);

    await corriger('stk-07', {
      variation: -3,
      lotId,
      motif: 'Vente au détail',
    });
    expect(await ouverts(lotId)).toBe(1);
    const ligne = await sql(
      'SELECT "unitesParConditionnement", "ouvertParId" FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
      [lotId],
    );
    expect(ligne.rows[0]).toMatchObject({
      unitesParConditionnement: 10,
      ouvertParId: 'usr-admin-p1',
    });
    const s07 = (await lireStock()).data.stocks.find((s) => s.id === 'stk-07');
    expect(s07?.reliquat).toEqual([{ lotId, unitesRestantes: 7 }]);

    await corriger('stk-07', {
      variation: -7,
      lotId,
      motif: 'Vente au détail',
    });
    const total1 = await sql(
      'SELECT "fermeLe" FROM "ConditionnementOuvert" WHERE "lotId" = $1',
      [lotId],
    );
    expect(total1.rows).toHaveLength(1);
    expect(total1.rows[0].fermeLe).not.toBeNull();
    expect(await ouverts(lotId)).toBe(0);
    const s07b = (await lireStock()).data.stocks.find((s) => s.id === 'stk-07');
    expect(s07b?.reliquat).toEqual([]);

    await corriger('stk-07', {
      variation: -5,
      lotId,
      motif: 'Vente au détail',
    });
    const total2 = await sql(
      'SELECT 1 FROM "ConditionnementOuvert" WHERE "lotId" = $1',
      [lotId],
    );
    expect(total2.rows).toHaveLength(2);
    expect(await ouverts(lotId)).toBe(1);

    const doublon = await prisma
      .$transaction((tx) =>
        mouvements.ouvrirConditionnement(tx, {
          stockMedicamentId: 'stk-07',
          lotId,
          pointDeVenteId: pv1,
          unitesParConditionnement: 10,
          ouvertParId: 'usr-admin-p1',
          ouvertParPieceId: null,
        }),
      )
      .then(
        () => null,
        (erreur: unknown) => erreur,
      );
    expect(doublon).toBeInstanceOf(ConflictException);
    const reponse = (doublon as ConflictException).getResponse() as Record<
      string,
      unknown
    >;
    expect(reponse.code).toBe('CONDITIONNEMENT_DEJA_OUVERT');
    expect(reponse.message).toBe(MESSAGE_CONDITIONNEMENT_DEJA_OUVERT);
    expect(await ouverts(lotId)).toBe(1);
  });

  it('10. périmés : quantité vendable, date calculée, recherche et détail sans le lot périmé', async () => {
    await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: 'stk-05',
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(90)),
        quantite: 5,
        coutUnitaire: 0,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: 'usr-admin-p1',
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: null,
      }),
    );
    const s05 = (await lireStock()).data.stocks.find((s) => s.id === 'stk-05');
    expect(s05?.quantite).toBe(16);
    expect(s05?.quantiteVendable).toBe(5);
    expect(s05?.disponible).toBe(true);
    expect(jourDe(s05?.dateExpiration ?? null)).toBe(jour(90));
    expect(s05?.lots).toHaveLength(2);
    expect(jourDe(s05?.lots[0].dateExpiration ?? null)).toBe(jour(-30));

    const recherche = await pharmacie.rechercherDisponibilite(
      undefined,
      undefined,
      undefined,
      undefined,
      'str-pharma-1',
    );
    const publics = recherche.data as unknown as FichePublique[];
    const p05 = publics.find((s) => s.id === 'stk-05');
    expect(p05?.quantite).toBe(5);
    expect(p05?.disponible).toBe(true);
    expect(jourDe(p05?.dateExpiration ?? null)).toBe(jour(90));
    expect(p05).not.toHaveProperty('lots');
    expect(p05).not.toHaveProperty('reliquat');
    expect(p05).not.toHaveProperty('quantiteVendable');
    expect(cheminsCout(recherche)).toEqual([]);

    const detail = await pharmacie.getMedicament('med-05');
    const d05 = (
      detail.data as unknown as { stocks: FichePublique[] }
    ).stocks.find((s) => s.id === 'stk-05');
    expect(d05?.quantite).toBe(5);
    expect(cheminsCout(detail)).toEqual([]);
  });

  it('11. archivage : DELETE archive, la fiche sort des lectures, 404 aux corrections, l upsert désarchive', async () => {
    const r = await pharmacie.removeStockItem(
      'str-pharma-1',
      'stk-08',
      'usr-admin-p1',
    );
    expect(r.message).toBe('Médicament retiré du stock');
    const enBase = await sql(
      'SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1',
      ['stk-08'],
    );
    expect(enBase.rows).toHaveLength(1);
    expect(enBase.rows[0].archiveLe).not.toBeNull();
    expect(await mouvementsDe('stk-08')).toHaveLength(1);
    const audit = await audits('StockMedicament', 'stk-08');
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('update');
    expect((audit[0].metadata as { avant: unknown }).avant).toEqual({
      archiveLe: null,
    });

    const stock = await lireStock();
    expect(stock.data.stocks).toHaveLength(19);
    expect(stock.data.stocks.some((s) => s.id === 'stk-08')).toBe(false);
    expect(stock.data.alertes.stockBas.some((s) => s.id === 'stk-08')).toBe(
      false,
    );
    const recherche = await pharmacie.rechercherDisponibilite(
      undefined,
      undefined,
      undefined,
      undefined,
      'str-pharma-1',
    );
    expect(
      (recherche.data as unknown as FichePublique[]).some(
        (s) => s.id === 'stk-08',
      ),
    ).toBe(false);
    const detail = await pharmacie.getMedicament('med-08');
    expect(
      (detail.data as unknown as { stocks: FichePublique[] }).stocks.some(
        (s) => s.id === 'stk-08',
      ),
    ).toBe(false);

    const correction = await refus(
      corriger('stk-08', { variation: 1, motif: 'Retour' }),
    );
    expect(correction.statut).toBe(404);
    expect(correction.corps.message).toBe('Stock non trouvé');
    const fiche = await refus(
      fiches.modifierFiche(
        'str-pharma-1',
        'usr-admin-p1',
        'stk-08',
        { prixUnitaire: 10 },
        '127.0.0.1',
      ),
    );
    expect(fiche.statut).toBe(404);
    expect(fiche.corps.message).toBe(MESSAGE_FICHE_INTROUVABLE);

    const encore = await pharmacie.removeStockItem(
      'str-pharma-1',
      'stk-08',
      'usr-admin-p1',
    );
    expect(encore.message).toBe('Médicament retiré du stock');
    expect(await audits('StockMedicament', 'stk-08')).toHaveLength(1);

    const retour = await upsert('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-08',
      quantite: 1,
    });
    const apres = await sql(
      'SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1',
      ['stk-08'],
    );
    expect(apres.rows[0].archiveLe).toBeNull();
    expect((await lireStock()).data.stocks).toHaveLength(20);
    expect(retour.data.quantite).toBe(1);
    expect(await mouvementsDe('stk-08')).toHaveLength(1);
    const audits2 = await audits('StockMedicament', 'stk-08');
    expect(audits2).toHaveLength(2);
    expect((audits2[1].metadata as { apres: unknown }).apres).toEqual({
      archiveLe: null,
    });
  });

  it('12. catalogue : MEDICAMENT_UTILISE si lot ou ligne de vente, suppression sinon', async () => {
    const utilise = await refus(
      pharmacie.deleteMedicament('med-06', 'usr-admin-p1'),
    );
    expect(utilise.statut).toBe(409);
    expect(utilise.corps.code).toBe('MEDICAMENT_UTILISE');
    expect(utilise.corps.message).toBe(MESSAGE_MEDICAMENT_UTILISE);
    const existe = await sql('SELECT 1 FROM "Medicament" WHERE "id" = $1', [
      'med-06',
    ]);
    expect(existe.rows).toHaveLength(1);

    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "updatedAt") VALUES ('med-test-vendu', 'Médicament vendu (test)', 'Test PB08', now())`,
    );
    await sql(
      `INSERT INTO "LigneVente" ("id", "venteId", "medicamentId", "stockMedicamentId", "nomMedicament", "prixUnitaire", "quantite", "sousTotal", "nombreAffiche") VALUES ('lv-test-vendu', 'vte-p1-1', 'med-test-vendu', 'stk-inexistant', 'Médicament vendu (test)', 100, 1, 100, 1)`,
    );
    const vendu = await refus(
      pharmacie.deleteMedicament('med-test-vendu', 'usr-admin-p1'),
    );
    expect(vendu.statut).toBe(409);
    expect(vendu.corps.code).toBe('MEDICAMENT_UTILISE');

    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "updatedAt") VALUES ('med-test-libre', 'Médicament libre (test)', 'Test PB08 libre', now())`,
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "updatedAt") VALUES ('stk-test-libre', 'med-test-libre', 'str-pharma-2', 0, false, now())`,
    );
    const libre = await pharmacie.deleteMedicament(
      'med-test-libre',
      'usr-admin-p1',
    );
    expect(libre.message).toBe('Médicament supprimé du catalogue');
    const med = await sql('SELECT 1 FROM "Medicament" WHERE "id" = $1', [
      'med-test-libre',
    ]);
    const fiche = await sql('SELECT 1 FROM "StockMedicament" WHERE "id" = $1', [
      'stk-test-libre',
    ]);
    expect(med.rows).toHaveLength(0);
    expect(fiche.rows).toHaveLength(0);
  });

  it('13. journal cohérent après le scénario', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
