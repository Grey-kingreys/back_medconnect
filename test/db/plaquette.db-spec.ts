import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  FicheProduitService,
  MESSAGE_CONVERSION_REQUISE,
  MESSAGE_UNITE_CHANGEMENT_AVEC_STOCK,
} from 'src/pharmacie/fiche-produit.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { SortiesStockService } from 'src/pharmacie/inventaires/sorties.service';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import type { CreerReceptionDto } from 'src/pharmacie/dto/receptions.dto';
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

interface AllocationRep {
  lotId: string;
  quantite: number;
}
interface LigneRep {
  quantite: number;
  sousTotal: number;
  uniteAffichee: string;
  coefficientApplique: number;
  allocations: AllocationRep[];
}
interface VenteRep {
  data: { id: string; total: number; lignes: LigneRep[] };
}
interface ReceptionRep {
  data: { lots: { id: string }[] };
}
interface EntreeStock {
  id: string;
  quantite: number;
  uniteMinimale: string;
  reliquat: { lotId: string; unitesRestantes: number }[];
  lots: { id: string; quantite: number; coefficientReception: number }[];
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Unité PLAQUETTE et parcours du porteur, sur base de test (PB21)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let fiches: FicheProduitService;
  let pharmacie: PharmacieService;
  let receptions: ReceptionsService;
  let inventaires: InventairesService;
  let sorties: SortiesStockService;
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
    fiches = new FicheProduitService(prisma, acces, mouvements);
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    inventaires = new InventairesService(prisma, acces, mouvements);
    sorties = new SortiesStockService(prisma, acces, mouvements);
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      mouvements,
      permissions,
      receptions,
      inventaires,
    );
    const pvs = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = String(pvs.rows[0].id);
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

  async function nouvelleFiche(
    o: { unite?: string; coef?: number } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Paracétamol plaquette ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB21', false, now())`,
      [`med-plaq-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "uniteMinimale", "updatedAt") VALUES ($1, $2, $3, 0, false, 25000, $4, $5::"UniteMinimale", now())`,
      [
        `stk-plaq-${n}`,
        `med-plaq-${n}`,
        PHARMACIE,
        o.coef ?? 1,
        o.unite ?? 'UNITE',
      ],
    );
    return { stockId: `stk-plaq-${n}`, nom };
  }

  const modifier = (
    stockId: string,
    dto: Parameters<FicheProduitService['modifierFiche']>[3],
  ) => fiches.modifierFiche(PHARMACIE, RESPONSABLE, stockId, dto, '127.0.0.1');

  const recevoir = (dto: CreerReceptionDto) =>
    receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      dto,
      '127.0.0.1',
    ) as unknown as Promise<ReceptionRep>;

  const recevoirBoites = (stockId: string, nombreBoites: number) =>
    recevoir({
      lignes: [{ stockId, nombreBoites, dateExpiration: jour(300) }],
    });

  async function vendre(dto: CreerVenteDto) {
    return (await service.creerVente(
      PHARMACIE,
      VENDEUR,
      dto,
      undefined,
      '127.0.0.1',
    )) as unknown as VenteRep;
  }

  async function lire(stockId: string): Promise<EntreeStock> {
    const lecture = (await pharmacie.getStockPharmacie(
      PHARMACIE,
      RESPONSABLE,
    )) as unknown as { data: { stocks: EntreeStock[] } };
    const entree = lecture.data.stocks.find((s) => s.id === stockId);
    if (!entree) throw new Error('Fiche absente de la lecture.');
    return entree;
  }

  async function soldeLot(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function soldeProduit(stockId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1 AND "pointDeVenteId" = $2',
      [stockId, pv1],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function lotTechnique(stockId: string, quantite: number) {
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(200)),
        quantite,
        coutUnitaire: 0,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: true,
        auteurId: null,
        pieceOrigineType: 'MIGRATION',
        pieceOrigineId: 'test-pb21',
        motif: 'Reprise du stock existant',
      }),
    );
    return lot.id;
  }

  const uniteDeFiche = async (stockId: string) =>
    (
      await sql(
        'SELECT "uniteMinimale"::text AS u, "coefficientBoite" AS c, "qualifie" AS q FROM "StockMedicament" WHERE "id" = $1',
        [stockId],
      )
    ).rows[0];

  it('parcours du porteur : paracétamol, boîte de 10 plaquettes à 25 000, plaquette à 3 000', async () => {
    const { stockId } = await nouvelleFiche();

    // 1. Fiche : plaquette, 10 par boîte, déconditionnable, prix de la plaquette
    const fiche = await modifier(stockId, {
      uniteMinimale: 'PLAQUETTE',
      coefficientBoite: 10,
      deconditionnable: true,
      prixUnite: 3000,
      qualifie: true,
    });
    expect(fiche.data).toMatchObject({
      uniteMinimale: 'PLAQUETTE',
      coefficientBoite: 10,
      deconditionnable: true,
      prixUnitaire: 25000,
      prixUnite: 3000,
      qualifie: true,
    });
    expect(fiche.data.avertissements).toEqual([]);

    // 2. Réception de 2 boîtes : 20 plaquettes, lot à coefficient 10
    const recu = await recevoirBoites(stockId, 2);
    const lotA = recu.data.lots[0].id;
    expect(await soldeLot(lotA)).toBe(20);
    expect(await soldeProduit(stockId)).toBe(20);
    const apresReception = await lire(stockId);
    expect(apresReception.uniteMinimale).toBe('PLAQUETTE');
    expect(apresReception.quantite).toBe(20);
    expect(apresReception.lots).toMatchObject([
      { id: lotA, quantite: 20, coefficientReception: 10 },
    ]);

    // 3. Vente d'une plaquette : 3 000, 19 au stock, boîte entamée, reliquat 9
    const unePlaquette = await vendre({
      lignes: [{ stockId, quantite: 1, unite: 'UNITE' }],
    });
    expect(unePlaquette.data.total).toBe(3000);
    expect(unePlaquette.data.lignes[0]).toMatchObject({
      quantite: 1,
      sousTotal: 3000,
      uniteAffichee: 'UNITE',
      coefficientApplique: 1,
    });
    expect(await soldeProduit(stockId)).toBe(19);
    expect(await soldeLot(lotA)).toBe(19);
    const ouverts = await sql(
      'SELECT count(*)::int AS n FROM "ConditionnementOuvert" WHERE "stockMedicamentId" = $1',
      [stockId],
    );
    expect(Number(ouverts.rows[0].n)).toBe(1);
    const apresUne = await lire(stockId);
    expect(apresUne.quantite).toBe(19);
    expect(apresUne.reliquat).toEqual([{ lotId: lotA, unitesRestantes: 9 }]);

    // 4. Vente d'une boîte : 25 000, prend les 10 d'une boîte fermée, reliquat 9 intact
    const uneBoite = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(uneBoite.data.total).toBe(25000);
    expect(uneBoite.data.lignes[0]).toMatchObject({
      quantite: 10,
      sousTotal: 25000,
      uniteAffichee: 'BOITE',
      coefficientApplique: 10,
    });
    expect(uneBoite.data.lignes[0].allocations).toEqual([
      expect.objectContaining({ lotId: lotA, quantite: 10 }),
    ]);
    expect(await soldeLot(lotA)).toBe(9);
    expect((await lire(stockId)).reliquat).toEqual([
      { lotId: lotA, unitesRestantes: 9 },
    ]);

    // 5. Vente de 10 plaquettes : les 9 de la boîte entamée puis 1 d'une boîte reçue ensuite
    const lotB = (await recevoirBoites(stockId, 1)).data.lots[0].id;
    expect(await soldeProduit(stockId)).toBe(19);
    const dix = await vendre({
      lignes: [{ stockId, quantite: 10, unite: 'UNITE' }],
    });
    expect(dix.data.total).toBe(30000);
    const allocations = dix.data.lignes[0].allocations;
    expect(allocations).toHaveLength(2);
    expect(allocations.map((a) => [a.lotId, a.quantite]).sort()).toEqual(
      [
        [lotA, 9],
        [lotB, 1],
      ].sort(),
    );
    expect(await soldeLot(lotA)).toBe(0);
    expect(await soldeLot(lotB)).toBe(9);
    const apresDix = await lire(stockId);
    expect(apresDix.quantite).toBe(9);
    expect(apresDix.reliquat).toEqual([{ lotId: lotB, unitesRestantes: 9 }]);

    const trop = await refus(
      vendre({ lignes: [{ stockId, quantite: 10, unite: 'UNITE' }] }),
    );
    expect(trop.statut).toBe(409);
    expect(trop.corps.code).toBe('STOCK_INSUFFISANT');
    expect(String(trop.corps.message)).toContain('il reste 9 plaquettes');
    expect(await soldeProduit(stockId)).toBe(9);

    // 6. Correction, inventaire et sortie en boîtes : quantités justes
    const lotC = (await recevoirBoites(stockId, 2)).data.lots[0].id;
    expect(await soldeLot(lotC)).toBe(20);
    await pharmacie.updateStockQuantite(PHARMACIE, stockId, RESPONSABLE, {
      variation: 10,
      lotId: lotC,
      motif: 'Une boîte retrouvée au rangement',
    });
    expect(await soldeLot(lotC)).toBe(30);
    await pharmacie.updateStockQuantite(PHARMACIE, stockId, RESPONSABLE, {
      variation: -10,
      lotId: lotC,
      motif: 'Une boîte abîmée au rangement',
    });
    expect(await soldeLot(lotC)).toBe(20);
    await inventaires.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      { lignes: [{ stockId, lotId: lotC, nombreBoites: 3, unitesEnPlus: 0 }] },
      '127.0.0.1',
    );
    expect(await soldeLot(lotC)).toBe(30);
    await sorties.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      { stockId, lotId: lotC, unite: 'BOITE', quantite: 1, raison: 'CASSE' },
      '127.0.0.1',
    );
    expect(await soldeLot(lotC)).toBe(20);
    expect(await soldeLot(lotB)).toBe(9);
    expect(await soldeProduit(stockId)).toBe(29);
    const final = await lire(stockId);
    expect(final.quantite).toBe(29);
    expect(
      final.lots.map((l) => [l.id, l.quantite, l.coefficientReception]),
    ).toEqual(
      expect.arrayContaining([
        [lotB, 9, 10],
        [lotC, 20, 10],
      ]),
    );

    // 7. Écart de prix : référence 25 000 / 10 = 2 500 la plaquette, seuil de 25 %
    const sous = await modifier(stockId, { prixUnite: 3100 });
    expect(sous.data.avertissements).toEqual([]);
    const sur = await modifier(stockId, { prixUnite: 3200 });
    expect(sur.data.avertissements).toEqual([
      { code: 'ECART_PRIX', ecartPct: 28 },
    ]);
  });

  it('la photographie du poste desktop porte une fiche PLAQUETTE et le coefficient de son lot', async () => {
    const { stockId } = await nouvelleFiche();
    await modifier(stockId, {
      uniteMinimale: 'PLAQUETTE',
      coefficientBoite: 10,
      deconditionnable: true,
      prixUnite: 3000,
      qualifie: true,
    });
    const lot = (await recevoirBoites(stockId, 2)).data.lots[0].id;
    const acces = new AccesPharmacieService(prisma);
    const poste = await new PointsDeVenteService(
      prisma,
      acces,
    ).enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'DESKTOP',
      appareilId: 'desktop-pb21-plaquette',
    });
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const photo = await new CatalogueSynchroService(
      prisma,
      acces,
      stockage,
    ).photographier(PHARMACIE, RESPONSABLE, poste.data.id);
    const fiche = photo.fiches.find((f) => f.stockId === stockId);
    expect(fiche).toMatchObject({
      uniteMinimale: 'PLAQUETTE',
      coefficientBoite: 10,
      prixUnite: 3000,
      quantite: 20,
    });
    expect(fiche?.lots).toMatchObject([
      { id: lot, solde: 20, coefficientReception: 10 },
    ]);
  });

  describe('changement d unité sur une fiche (D724)', () => {
    it('refusé avec du stock : 409 UNITE_CHANGEMENT_AVEC_STOCK, fiche inchangée', async () => {
      const { stockId } = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      await modifier(stockId, { qualifie: true });
      await recevoirBoites(stockId, 1);

      const r = await refus(modifier(stockId, { uniteMinimale: 'PLAQUETTE' }));
      expect(r.statut).toBe(409);
      expect(r.corps.code).toBe('UNITE_CHANGEMENT_AVEC_STOCK');
      expect(r.corps.message).toBe(MESSAGE_UNITE_CHANGEMENT_AVEC_STOCK);
      expect(await uniteDeFiche(stockId)).toMatchObject({
        u: 'COMPRIME',
        c: 10,
        q: true,
      });
    });

    it('fiche non qualifiée avec du stock : conversion exigée d abord, puis refus si l unité de départ n est pas UNITE', async () => {
      const { stockId } = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      await recevoirBoites(stockId, 1);
      const r = await refus(
        modifier(stockId, { uniteMinimale: 'PLAQUETTE', coefficientBoite: 20 }),
      );
      // Fiche non qualifiée avec du stock : la conversion est d'abord exigée (PB13)
      expect(r.statut).toBe(400);
      expect(r.corps.message).toBe(MESSAGE_CONVERSION_REQUISE);

      const avecConversion = await refus(
        modifier(stockId, {
          uniteMinimale: 'PLAQUETTE',
          coefficientBoite: 20,
          conversionStock: 'CONSERVER',
        }),
      );
      expect(avecConversion.statut).toBe(409);
      expect(avecConversion.corps.code).toBe('UNITE_CHANGEMENT_AVEC_STOCK');
    });

    it('accepté sans stock', async () => {
      const { stockId } = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      const r = await modifier(stockId, { uniteMinimale: 'PLAQUETTE' });
      expect(r.data.uniteMinimale).toBe('PLAQUETTE');
      expect(await uniteDeFiche(stockId)).toMatchObject({ u: 'PLAQUETTE' });
    });

    it('accepté une fois le stock compté à 0 par un inventaire', async () => {
      const { stockId } = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      await modifier(stockId, { qualifie: true });
      const lot = (await recevoirBoites(stockId, 1)).data.lots[0].id;
      const refuse = await refus(
        modifier(stockId, { uniteMinimale: 'PLAQUETTE' }),
      );
      expect(refuse.statut).toBe(409);
      await inventaires.enregistrer(
        PHARMACIE,
        RESPONSABLE,
        { lignes: [{ stockId, lotId: lot, quantiteComptee: 0 }] },
        '127.0.0.1',
      );
      expect(await soldeLot(lot)).toBe(0);
      const r = await modifier(stockId, { uniteMinimale: 'PLAQUETTE' });
      expect(r.data.uniteMinimale).toBe('PLAQUETTE');
    });

    it('accepté par la conversion PB13 : fiche non qualifiée de UNITE avec 1 par boîte, lot technique multiplié', async () => {
      const { stockId } = await nouvelleFiche();
      const lot = await lotTechnique(stockId, 3);
      const r = await modifier(stockId, {
        uniteMinimale: 'PLAQUETTE',
        coefficientBoite: 10,
        conversionStock: 'MULTIPLIER',
      });
      expect(r.data.uniteMinimale).toBe('PLAQUETTE');
      expect(r.data.qualifie).toBe(true);
      expect(r.data.conversion).toMatchObject({
        mode: 'MULTIPLIER',
        quantiteAvant: 3,
        quantiteApres: 30,
      });
      expect(await soldeLot(lot)).toBe(30);
    });

    it('accepté par la conversion PB13 CONSERVER : fiche non qualifiée de UNITE avec 1 par boîte, quantités inchangées', async () => {
      const { stockId } = await nouvelleFiche();
      const lot = await lotTechnique(stockId, 3);
      const r = await modifier(stockId, {
        uniteMinimale: 'PLAQUETTE',
        coefficientBoite: 10,
        conversionStock: 'CONSERVER',
      });
      expect(r.data).toMatchObject({
        uniteMinimale: 'PLAQUETTE',
        coefficientBoite: 10,
        qualifie: true,
      });
      expect(r.data.conversion).toMatchObject({
        mode: 'CONSERVER',
        quantiteAvant: 3,
        quantiteApres: 3,
      });
      expect(await soldeLot(lot)).toBe(3);
    });

    it('qualification d une reprise : fiche non qualifiée, UNITE, coefficient 1, avec stock, passée en COMPRIME puis en PLAQUETTE à coefficient 1 conservé (accepté, quantités inchangées, audit)', async () => {
      for (const unite of ['COMPRIME', 'PLAQUETTE'] as const) {
        const { stockId } = await nouvelleFiche();
        const lot = await lotTechnique(stockId, 3);
        const r = await modifier(stockId, {
          uniteMinimale: unite,
          qualifie: true,
        });
        expect(r.data).toMatchObject({
          uniteMinimale: unite,
          coefficientBoite: 1,
          qualifie: true,
          conversion: null,
        });
        expect(await uniteDeFiche(stockId)).toMatchObject({
          u: unite,
          c: 1,
          q: true,
        });
        expect(await soldeLot(lot)).toBe(3);
        expect(await soldeProduit(stockId)).toBe(3);
        const audit = await sql(
          `SELECT "action", "metadata" FROM "AuditLog" WHERE "entityType" = 'StockMedicament' AND "entityId" = $1`,
          [stockId],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0].action).toBe('update');
        expect(audit.rows[0].metadata).toEqual({
          avant: { uniteMinimale: 'UNITE', qualifie: false },
          apres: { uniteMinimale: unite, qualifie: true },
        });
      }
    });

    it('refusé : fiche à -1 ou à régulariser de COMPRIME vers PLAQUETTE, fiche qualifiée en UNITE, fiche non qualifiée en UNITE à coefficient 10', async () => {
      // -1 : une vente sans lot sur une fiche vide
      const negative = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      await prisma.$transaction((tx) =>
        mouvements.ecrire(tx, {
          pointDeVenteId: pv1,
          stockMedicamentId: negative.stockId,
          lotId: null,
          type: 'VENTE',
          quantite: -1,
          pieceOrigineType: 'VENTE',
          pieceOrigineId: `piece-${negative.stockId}`,
          motif: null,
          auteurId: VENDEUR,
        }),
      );
      expect(await soldeProduit(negative.stockId)).toBe(-1);
      // À régulariser : un lot de 10 et un agrégat ramené à 0 par une vente sans lot
      const aRegulariser = await nouvelleFiche({ unite: 'COMPRIME', coef: 10 });
      await recevoirBoites(aRegulariser.stockId, 1);
      await prisma.$transaction((tx) =>
        mouvements.ecrire(tx, {
          pointDeVenteId: pv1,
          stockMedicamentId: aRegulariser.stockId,
          lotId: null,
          type: 'VENTE',
          quantite: -10,
          pieceOrigineType: 'VENTE',
          pieceOrigineId: `piece-${aRegulariser.stockId}`,
          motif: null,
          auteurId: VENDEUR,
        }),
      );
      expect(await soldeProduit(aRegulariser.stockId)).toBe(0);
      expect((await lire(aRegulariser.stockId)).quantite).toBe(0);

      const qualifiee = await nouvelleFiche();
      await modifier(qualifiee.stockId, { qualifie: true });
      await lotTechnique(qualifiee.stockId, 2);
      const coef10 = await nouvelleFiche({ coef: 10 });
      await lotTechnique(coef10.stockId, 2);

      for (const { stockId, unite } of [
        { stockId: negative.stockId, unite: 'COMPRIME' },
        { stockId: aRegulariser.stockId, unite: 'COMPRIME' },
        { stockId: qualifiee.stockId, unite: 'UNITE' },
        { stockId: coef10.stockId, unite: 'UNITE' },
      ]) {
        const r = await refus(
          modifier(stockId, { uniteMinimale: 'PLAQUETTE', qualifie: true }),
        );
        expect(r.statut).toBe(409);
        expect(r.corps.code).toBe('UNITE_CHANGEMENT_AVEC_STOCK');
        expect(await uniteDeFiche(stockId)).toMatchObject({ u: unite });
      }
    });

    it('message de refus de vente au singulier : il reste 1 plaquette', async () => {
      const { stockId } = await nouvelleFiche();
      await modifier(stockId, {
        uniteMinimale: 'PLAQUETTE',
        coefficientBoite: 10,
        deconditionnable: true,
        prixUnite: 3000,
        qualifie: true,
      });
      await recevoirBoites(stockId, 1);
      await vendre({ lignes: [{ stockId, quantite: 9, unite: 'UNITE' }] });
      const r = await refus(
        vendre({ lignes: [{ stockId, quantite: 2, unite: 'UNITE' }] }),
      );
      expect(r.statut).toBe(409);
      expect(r.corps.code).toBe('STOCK_INSUFFISANT');
      expect(String(r.corps.message)).toContain('il reste 1 plaquette.');
    });

    it('une fiche qui ne change pas d unité garde le coefficient libre : chaque lot garde le sien (D709)', async () => {
      const { stockId } = await nouvelleFiche({ unite: 'PLAQUETTE', coef: 10 });
      await modifier(stockId, { qualifie: true });
      const lot = (await recevoirBoites(stockId, 1)).data.lots[0].id;
      const r = await modifier(stockId, { coefficientBoite: 20 });
      expect(r.data.coefficientBoite).toBe(20);
      const lu = await lire(stockId);
      expect(lu.lots).toMatchObject([
        { id: lot, quantite: 10, coefficientReception: 10 },
      ]);
    });
  });
});
