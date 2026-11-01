import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { MESSAGE_LOT_INTROUVABLE } from 'src/pharmacie/pharmacie.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import {
  jourVersDate,
  lireEtatsStock,
} from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
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
  lotId: string | null;
  numeroLot: string | null;
  dateExpiration: string | null;
  quantite: number;
  statut: string;
  sortieManuelle: boolean;
  motif: string | null;
  lotTechnique: boolean;
  coutUnitaire?: number;
}
interface LigneRep {
  id: string;
  stockId: string;
  quantite: number;
  prixUnitaire: number;
  sousTotal: number;
  uniteAffichee: string;
  nombreAffiche: number;
  coefficientApplique: number;
  allocations: AllocationRep[];
}
interface PaiementRep {
  id: string;
  mode: string;
  libelle: string;
  montant: number;
  reference: string | null;
  montantRecu: number | null;
  rendu: number | null;
}
interface VenteRep {
  id: string;
  numero: string;
  numeroTicket: number;
  typePiece: string;
  provisoire: boolean;
  annulation: unknown;
  jourMetier: string;
  statut: string;
  total: number;
  ordonnanceVerifiee: boolean;
  rejeu?: boolean;
  poste: { id: string; code: string };
  session: { id: string; ouverteAutomatiquement: boolean };
  paiements: PaiementRep[];
  lignes: LigneRep[];
}
interface Reponse {
  data: VenteRep;
  message: string;
  success: boolean;
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Vente recâblée sur lots, prix et caisse, sur base de test (PB11)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
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
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    postes = new PointsDeVenteService(prisma, acces);
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

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function nouvelleFiche(
    o: {
      coef?: number;
      prixBoite?: number | null;
      prixUnite?: number | null;
      decond?: boolean;
      ordonnance?: boolean;
    } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit vente ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB11', $3, now())`,
      [`med-vente-${n}`, nom, o.ordonnance ?? false],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "prixUnite", "coefficientBoite", "deconditionnable", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, $7, now())`,
      [
        `stk-vente-${n}`,
        `med-vente-${n}`,
        PHARMACIE,
        o.prixBoite === undefined ? 1000 : o.prixBoite,
        o.prixUnite ?? null,
        o.coef ?? 1,
        o.decond ?? false,
      ],
    );
    return { stockId: `stk-vente-${n}`, nom };
  }

  async function nouveauLot(
    stockId: string,
    o: {
      quantite: number;
      coef?: number;
      exp?: string | null;
      cout?: number;
      numero?: string | null;
    },
  ): Promise<string> {
    const exp = o.exp === undefined ? jour(200) : o.exp;
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: o.numero ?? null,
        dateExpiration: exp ? jourVersDate(exp) : null,
        quantite: o.quantite,
        coutUnitaire: o.cout ?? 0,
        coutAchatBoite: null,
        coefficientReception: o.coef ?? 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: RESPONSABLE,
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: null,
      }),
    );
    return lot.id;
  }

  async function vendre(
    dto: CreerVenteDto,
    utilisateur = VENDEUR,
    cle?: string,
  ): Promise<Reponse> {
    return (await service.creerVente(
      PHARMACIE,
      utilisateur,
      dto,
      cle,
      '127.0.0.1',
    )) as unknown as Reponse;
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

  async function prochainNumero(): Promise<number> {
    const res = await sql(
      'SELECT "prochainNumero" FROM "CompteurTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    return Number(res.rows[0].prochainNumero);
  }

  const nombreVentes = () =>
    compter('SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1', [
      PHARMACIE,
    ]);

  it('1. vente de 6 unités : prix de l’unité, journal et numéro de ticket', async () => {
    const { stockId } = await nouvelleFiche({
      coef: 20,
      prixBoite: 10000,
      prixUnite: 600,
      decond: true,
    });
    const lotId = await nouveauLot(stockId, {
      quantite: 40,
      coef: 20,
      cout: 300,
    });

    const { data, message } = await vendre({
      lignes: [{ stockId, quantite: 6, unite: 'UNITE' }],
    });

    expect(data.total).toBe(3600);
    expect(data.lignes[0]).toMatchObject({
      quantite: 6,
      prixUnitaire: 600,
      sousTotal: 3600,
      uniteAffichee: 'UNITE',
      nombreAffiche: 6,
      coefficientApplique: 1,
    });
    expect(await soldeProduit(stockId)).toBe(34);
    const mvts = await sql(
      `SELECT "type", "quantite", "lotId", "auteurId", "posteId" FROM "MouvementStock" WHERE "pieceOrigineType" = 'VENTE' AND "pieceOrigineId" = $1`,
      [data.id],
    );
    expect(mvts.rows).toEqual([
      {
        type: 'VENTE',
        quantite: -6,
        lotId,
        auteurId: VENDEUR,
        posteId: data.poste.id,
      },
    ]);
    expect(data.numero).toMatch(/^T1-\d{7}$/);
    expect(message).toBe(`Vente enregistrée (${data.numero}).`);
    expect(data.typePiece).toBe('VENTE');
    expect(data.provisoire).toBe(false);
    expect(data.annulation).toBeNull();
  });

  it('2. reliquat de 14 unités : conditionnement ouvert', async () => {
    const { stockId } = await nouvelleFiche({
      coef: 20,
      prixBoite: 10000,
      prixUnite: 600,
      decond: true,
    });
    const lotId = await nouveauLot(stockId, { quantite: 20, coef: 20 });

    const { data } = await vendre({
      lignes: [{ stockId, quantite: 6, unite: 'UNITE' }],
    });

    const etats = await lireEtatsStock(prisma, [stockId], jour(0));
    expect(etats.get(stockId)?.reliquat).toEqual([
      { lotId, unitesRestantes: 14 },
    ]);
    const ouverts = await sql(
      `SELECT "unitesParConditionnement", "ouvertParId", "ouvertParPieceId" FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "pointDeVenteId" = $2 AND "fermeLe" IS NULL`,
      [lotId, pv1],
    );
    expect(ouverts.rows).toEqual([
      {
        unitesParConditionnement: 20,
        ouvertParId: VENDEUR,
        ouvertParPieceId: data.id,
      },
    ]);
  });

  it('3. vente à la boîte : prix de la boîte, aucun conditionnement ouvert', async () => {
    const { stockId } = await nouvelleFiche({
      coef: 20,
      prixBoite: 10000,
      prixUnite: 600,
      decond: true,
    });
    const lotId = await nouveauLot(stockId, { quantite: 40, coef: 20 });

    const { data } = await vendre({ lignes: [{ stockId, quantite: 1 }] });

    expect(data.lignes[0]).toMatchObject({
      quantite: 20,
      prixUnitaire: 500,
      sousTotal: 10000,
      uniteAffichee: 'BOITE',
      nombreAffiche: 1,
      coefficientApplique: 20,
    });
    expect(data.total).toBe(10000);
    expect(await soldeProduit(stockId)).toBe(20);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
        [lotId],
      ),
    ).toBe(0);
  });

  it('4. fiche non déconditionnable : vente à l’unité refusée', async () => {
    const { stockId, nom } = await nouvelleFiche({
      coef: 10,
      prixBoite: 5000,
    });
    await nouveauLot(stockId, { quantite: 30, coef: 10 });
    const numeroAvant = await prochainNumero();
    const ventesAvant = await nombreVentes();

    const e = await refus(
      vendre({ lignes: [{ stockId, quantite: 3, unite: 'UNITE' }] }),
    );
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('VENTE_UNITE_INTERDITE');
    expect(String(e.corps.message)).toContain('uniquement à la boîte');
    expect(e.corps.details).toEqual([{ stockId, nom }]);
    expect(await prochainNumero()).toBe(numeroAvant);
    expect(await nombreVentes()).toBe(ventesAvant);
    expect(await soldeProduit(stockId)).toBe(30);

    const { data } = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(data.lignes[0].quantite).toBe(10);
  });

  it('5. prix manquants', async () => {
    const a = await nouvelleFiche({ coef: 10, prixBoite: 5000, decond: true });
    await nouveauLot(a.stockId, { quantite: 10, coef: 10 });
    const sansUnite = await refus(
      vendre({ lignes: [{ stockId: a.stockId, quantite: 2, unite: 'UNITE' }] }),
    );
    expect(sansUnite.statut).toBe(400);
    expect(sansUnite.corps.code).toBe('PRIX_UNITE_MANQUANT');
    expect(sansUnite.corps.details).toEqual([
      { stockId: a.stockId, nom: a.nom },
    ]);

    const b = await nouvelleFiche({ prixBoite: null });
    await nouveauLot(b.stockId, { quantite: 10 });
    const sansPrix = await refus(
      vendre({ lignes: [{ stockId: b.stockId, quantite: 1 }] }),
    );
    expect(sansPrix.statut).toBe(400);
    expect(sansPrix.corps.code).toBe('PRIX_MANQUANT');
  });

  it('6. reliquat avant FEFO, sortie manuelle motivée', async () => {
    const { stockId } = await nouvelleFiche({
      coef: 20,
      prixBoite: 10000,
      prixUnite: 600,
      decond: true,
    });
    const lotA = await nouveauLot(stockId, {
      quantite: 20,
      coef: 20,
      exp: jour(30),
      cout: 100,
      numero: 'A',
    });
    const lotB = await nouveauLot(stockId, {
      quantite: 20,
      coef: 20,
      exp: jour(90),
      cout: 200,
      numero: 'B',
    });

    const a = await vendre({
      lignes: [
        {
          stockId,
          quantite: 6,
          unite: 'UNITE',
          sortieManuelle: { lotId: lotB, motif: 'Plaquette B déjà entamée' },
        },
      ],
    });
    expect(a.data.lignes[0].allocations).toMatchObject([
      {
        lotId: lotB,
        quantite: 6,
        sortieManuelle: true,
        motif: 'Plaquette B déjà entamée',
      },
    ]);
    const motifMvt = await sql(
      `SELECT "motif" FROM "MouvementStock" WHERE "pieceOrigineId" = $1`,
      [a.data.id],
    );
    expect(motifMvt.rows).toEqual([{ motif: 'Plaquette B déjà entamée' }]);

    const b = await vendre({
      lignes: [{ stockId, quantite: 10, unite: 'UNITE' }],
    });
    expect(b.data.lignes[0].allocations).toMatchObject([
      { lotId: lotB, quantite: 10, sortieManuelle: false, motif: null },
    ]);

    const c = await vendre({
      lignes: [{ stockId, quantite: 6, unite: 'UNITE' }],
    });
    const parLot = new Map(
      c.data.lignes[0].allocations.map((x) => [x.lotId, x.quantite]),
    );
    expect(parLot.get(lotB)).toBe(4);
    expect(parLot.get(lotA)).toBe(2);
    expect(await soldeLot(lotB)).toBe(0);
    expect(await soldeLot(lotA)).toBe(18);
    const etats = await lireEtatsStock(prisma, [stockId], jour(0));
    expect(etats.get(stockId)?.reliquat).toEqual([
      { lotId: lotA, unitesRestantes: 18 },
    ]);
  });

  it('7. deux lots à 30 et 90 jours : FEFO, coûts copiés et masqués', async () => {
    const { stockId } = await nouvelleFiche();
    const l30 = await nouveauLot(stockId, {
      quantite: 10,
      exp: jour(30),
      cout: 400,
      numero: 'L30',
    });
    const l90 = await nouveauLot(stockId, {
      quantite: 10,
      exp: jour(90),
      cout: 450,
      numero: 'L90',
    });

    const { data } = await vendre({ lignes: [{ stockId, quantite: 15 }] });

    expect(
      data.lignes[0].allocations.map((a) => [a.lotId, a.quantite, a.statut]),
    ).toEqual([
      [l30, 10, 'DEFINITIVE'],
      [l90, 5, 'DEFINITIVE'],
    ]);
    expect(await soldeLot(l30)).toBe(0);
    expect(await soldeLot(l90)).toBe(5);
    const enBase = await sql(
      `SELECT a."numeroLot", a."coutUnitaire", to_char(a."dateExpiration", 'YYYY-MM-DD') AS "date" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."coutUnitaire"`,
      [data.id],
    );
    expect(enBase.rows).toEqual([
      { numeroLot: 'L30', coutUnitaire: 400, date: jour(30) },
      { numeroLot: 'L90', coutUnitaire: 450, date: jour(90) },
    ]);
    expect(cheminsCout(data)).toEqual([]);

    const detailResponsable = await service.detailVente(
      PHARMACIE,
      data.id,
      RESPONSABLE,
    );
    const vu = detailResponsable.data as unknown as VenteRep;
    expect(vu.lignes[0].allocations.map((a) => a.coutUnitaire)).toEqual([
      400, 450,
    ]);
    const detailVendeur = await service.detailVente(
      PHARMACIE,
      data.id,
      VENDEUR,
    );
    expect(cheminsCout(detailVendeur.data)).toEqual([]);
  });

  it('8. un lot sans date passe avant un lot daté', async () => {
    const { stockId } = await nouvelleFiche();
    await nouveauLot(stockId, { quantite: 5, exp: jour(5), numero: 'DATE' });
    const sansDate = await nouveauLot(stockId, {
      quantite: 5,
      exp: null,
      numero: 'SANS',
    });

    const { data } = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(data.lignes[0].allocations).toMatchObject([
      { lotId: sansDate, quantite: 1 },
    ]);
  });

  it('9. un lot périmé n’est jamais pris seul : sortie manuelle motivée', async () => {
    const { stockId, nom } = await nouvelleFiche();
    const perime = await nouveauLot(stockId, {
      quantite: 10,
      exp: jour(-3),
      numero: 'P',
    });
    const ventesAvant = await nombreVentes();
    const mvtsAvant = await compter(
      'SELECT count(*) AS n FROM "MouvementStock" WHERE "stockMedicamentId" = $1',
      [stockId],
    );
    const numeroAvant = await prochainNumero();
    const sessionsAvant = await compter(
      `SELECT count(*) AS n FROM "SessionCaisse" WHERE "utilisateurId" = $1 AND "statut" = 'OUVERTE'`,
      [VENDEUR],
    );

    const a = await refus(vendre({ lignes: [{ stockId, quantite: 2 }] }));
    expect(a.statut).toBe(409);
    expect(a.corps.code).toBe('SORTIE_MANUELLE_REQUISE');
    expect(a.corps.details).toEqual([
      {
        stockId,
        nom,
        disponible: 0,
        demande: 2,
        lots: [
          {
            lotId: perime,
            numeroLot: 'P',
            dateExpiration: jour(-3),
            quantite: 10,
          },
        ],
      },
    ]);
    expect(await nombreVentes()).toBe(ventesAvant);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementStock" WHERE "stockMedicamentId" = $1',
        [stockId],
      ),
    ).toBe(mvtsAvant);
    expect(await prochainNumero()).toBe(numeroAvant);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "SessionCaisse" WHERE "utilisateurId" = $1 AND "statut" = 'OUVERTE'`,
        [VENDEUR],
      ),
    ).toBe(sessionsAvant);

    const b = await refus(
      vendre({
        lignes: [
          {
            stockId,
            quantite: 2,
            sortieManuelle: { lotId: perime, motif: '  ' },
          },
        ],
      }),
    );
    expect(b.statut).toBe(400);
    expect(b.corps.code).toBe('MOTIF_REQUIS');

    const c = await vendre({
      lignes: [
        {
          stockId,
          quantite: 2,
          sortieManuelle: {
            lotId: perime,
            motif: '  Client informé, produit périmé  ',
          },
        },
      ],
    });
    expect(c.data.lignes[0].allocations).toMatchObject([
      {
        lotId: perime,
        quantite: 2,
        sortieManuelle: true,
        motif: 'Client informé, produit périmé',
      },
    ]);
    const auteur = await sql(
      `SELECT a."auteurId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1`,
      [c.data.id],
    );
    expect(auteur.rows).toEqual([{ auteurId: VENDEUR }]);
    expect(await soldeLot(perime)).toBe(8);

    const frais = await nouveauLot(stockId, {
      quantite: 10,
      exp: jour(100),
      numero: 'F',
    });
    const d = await vendre({ lignes: [{ stockId, quantite: 3 }] });
    expect(d.data.lignes[0].allocations).toMatchObject([
      { lotId: frais, quantite: 3 },
    ]);
    expect(await soldeLot(perime)).toBe(8);

    const autre = await nouvelleFiche();
    const lotAutre = await nouveauLot(autre.stockId, { quantite: 5 });
    const e = await refus(
      vendre({
        lignes: [
          {
            stockId,
            quantite: 1,
            sortieManuelle: { lotId: lotAutre, motif: 'Motif valable' },
          },
        ],
      }),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_LOT_INTROUVABLE);

    const epuise = await nouveauLot(stockId, {
      quantite: 1,
      exp: jour(150),
      numero: 'EPUISE',
    });
    await vendre({
      lignes: [
        {
          stockId,
          quantite: 1,
          sortieManuelle: { lotId: epuise, motif: 'Dernier de ce lot' },
        },
      ],
    });
    expect(await soldeLot(epuise)).toBe(0);
    const f = await refus(
      vendre({
        lignes: [
          {
            stockId,
            quantite: 1,
            sortieManuelle: { lotId: epuise, motif: 'Lot déjà vide' },
          },
        ],
      }),
    );
    expect(f.statut).toBe(409);
    expect(f.corps.code).toBe('STOCK_LOT_NEGATIF');
  });

  it('10. vente en négatif : allocation provisoire et anomalie, sans refus', async () => {
    const { stockId, nom } = await nouvelleFiche();
    const lotId = await nouveauLot(stockId, { quantite: 3 });

    const { data } = await vendre(
      {
        lignes: [{ stockId, quantite: 5 }],
        clientNom: 'Client essai',
        clientTelephone: '+224620000000',
      },
      RESPONSABLE,
    );

    expect(data.provisoire).toBe(true);
    expect(data.lignes[0].allocations).toMatchObject([
      { lotId, quantite: 3, statut: 'DEFINITIVE' },
      { lotId: null, quantite: 2, statut: 'PROVISOIRE', coutUnitaire: 0 },
    ]);
    const mvts = await sql(
      `SELECT "quantite", "lotId" FROM "MouvementStock" WHERE "pieceOrigineId" = $1 ORDER BY "quantite"`,
      [data.id],
    );
    expect(mvts.rows).toEqual([
      { quantite: -3, lotId },
      { quantite: -2, lotId: null },
    ]);
    expect(await soldeProduit(stockId)).toBe(-2);
    expect(await soldeLot(lotId)).toBe(0);

    const anomalies = await sql(
      `SELECT "type", "statut", "pieceType", "attribueeAId", "details" FROM "Anomalie" WHERE "pieceId" = $1`,
      [data.id],
    );
    expect(anomalies.rows).toHaveLength(1);
    const anomalie = anomalies.rows[0];
    expect(anomalie).toMatchObject({
      type: 'STOCK_NEGATIF',
      statut: 'OUVERTE',
      pieceType: 'VENTE',
      attribueeAId: 'usr-admin-p1',
    });
    const details = anomalie.details as Record<string, unknown>;
    expect(details.stockId).toBe(stockId);
    expect(details.nom).toBe(nom);
    expect(details.quantiteProvisoire).toBe(2);
    expect(details.soldeProduit).toBe(-2);
    expect(details.message).toBe(
      `${nom} : 2 unité(s) vendue(s) sans stock disponible (vente ${data.numero}, poste ${details.posteCode as string}, ${details.utilisateurNom as string}). Le stock de ce médicament est à -2 unité(s) : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot.`,
    );
    expect(details).not.toHaveProperty('clientNom');
    expect(details).not.toHaveProperty('clientTelephone');

    const vide = await nouvelleFiche();
    const sansLot = await vendre({
      lignes: [{ stockId: vide.stockId, quantite: 1 }],
    });
    expect(sansLot.data.lignes[0].allocations).toMatchObject([
      { lotId: null, quantite: 1, statut: 'PROVISOIRE' },
    ]);
    expect(await soldeProduit(vide.stockId)).toBe(-1);
  });

  it('11. deux ventes simultanées de la dernière unité', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await nouveauLot(stockId, { quantite: 1 });

    const resultats = await Promise.allSettled([
      vendre({ lignes: [{ stockId, quantite: 1 }] }, VENDEUR),
      vendre({ lignes: [{ stockId, quantite: 1 }] }, RESPONSABLE),
    ]);
    expect(resultats.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const ventes = resultats.map(
      (r) => (r as PromiseFulfilledResult<Reponse>).value.data,
    );

    const statuts = await sql(
      `SELECT a."statut", count(*)::int AS n FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."stockMedicamentId" = $1 GROUP BY a."statut" ORDER BY a."statut"`,
      [stockId],
    );
    expect(statuts.rows).toEqual([
      { statut: 'DEFINITIVE', n: 1 },
      { statut: 'PROVISOIRE', n: 1 },
    ]);
    expect(await soldeLot(lotId)).toBe(0);
    expect(await soldeProduit(stockId)).toBe(-1);
    expect(ventes[0].numeroTicket).not.toBe(ventes[1].numeroTicket);
  });

  it('12. caisse ouverte automatiquement, paiements multiples, bilan et fermeture', async () => {
    const { data: poste } = await postes.enregistrerPoste(PHARMACIE, VENDEUR, {
      type: 'WEB',
      appareilId: 'appareil-pb11-caisse',
    });
    const a = await nouvelleFiche({ prixBoite: 10000 });
    await nouveauLot(a.stockId, { quantite: 10 });
    const b = await nouvelleFiche({ prixBoite: 1000 });
    await nouveauLot(b.stockId, { quantite: 10 });

    const premiere = await vendre({
      lignes: [{ stockId: a.stockId, quantite: 1 }],
      paiements: [
        { mode: 'ESPECES', montant: 5000, montantRecu: 10000 },
        { mode: 'ORANGE_MONEY', montant: 5000, reference: 'OM-778899' },
      ],
      posteId: poste.id,
    });
    expect(premiere.data.session.ouverteAutomatiquement).toBe(true);
    const ouvertes = await sql(
      `SELECT "id", to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "SessionCaisse" WHERE "posteId" = $1 AND "utilisateurId" = $2 AND "statut" = 'OUVERTE'`,
      [poste.id, VENDEUR],
    );
    expect(ouvertes.rows).toHaveLength(1);
    const sessionId = String(ouvertes.rows[0].id);
    const venteBase = await sql(
      `SELECT "sessionCaisseId", to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "Vente" WHERE "id" = $1`,
      [premiere.data.id],
    );
    expect(venteBase.rows[0]).toEqual({
      sessionCaisseId: sessionId,
      jour: ouvertes.rows[0].jour,
    });
    expect(premiere.data.session.id).toBe(sessionId);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "Paiement" WHERE "sessionCaisseId" = $1 AND "venteId" = $2',
        [sessionId, premiere.data.id],
      ),
    ).toBe(2);
    expect(premiere.data.paiements).toMatchObject([
      {
        mode: 'ESPECES',
        montant: 5000,
        montantRecu: 10000,
        rendu: 5000,
        reference: null,
      },
      {
        mode: 'ORANGE_MONEY',
        montant: 5000,
        reference: 'OM-778899',
        montantRecu: null,
        rendu: null,
      },
    ]);
    expect(premiere.data.paiements[0]).toHaveProperty('id');
    expect(premiere.data.paiements[0]).toHaveProperty('libelle');

    const seconde = await vendre({
      lignes: [{ stockId: b.stockId, quantite: 2 }],
      posteId: poste.id,
    });
    expect(seconde.data.session.ouverteAutomatiquement).toBe(false);
    expect(seconde.data.session.id).toBe(sessionId);
    expect(seconde.data.paiements).toMatchObject([
      { mode: 'ESPECES', montant: 2000 },
    ]);

    const bilan = await sessions.bilan(PHARMACIE, VENDEUR, sessionId);
    const theorique = (mode: string) =>
      bilan.data.theorique.find((t) => t.mode === mode)?.montant;
    expect(theorique('ESPECES')).toBe(7000);
    expect(theorique('ORANGE_MONEY')).toBe(5000);

    const fermee = await sessions.fermer(PHARMACIE, VENDEUR, sessionId, {
      comptageFermeture: {
        coupures: [
          { valeurFaciale: 5000, nombre: 1 },
          { valeurFaciale: 2000, nombre: 1 },
        ],
        releves: [{ mode: 'ORANGE_MONEY', montant: 4000 }],
      },
    });
    const ecart = (mode: string) =>
      fermee.data.ecarts.find((e) => e.mode === mode)?.ecart;
    expect(ecart('ESPECES')).toBe(0);
    expect(ecart('ORANGE_MONEY')).toBe(-1000);

    const apres = await vendre({
      lignes: [{ stockId: b.stockId, quantite: 1 }],
      posteId: poste.id,
    });
    expect(apres.data.session.ouverteAutomatiquement).toBe(true);
    expect(apres.data.session.id).not.toBe(sessionId);
  });

  it('13. paiements refusés : rien n’est écrit', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    await nouveauLot(stockId, { quantite: 50 });
    const ligne = { lignes: [{ stockId, quantite: 1 }] };
    const numeroAvant = await prochainNumero();

    const somme = await refus(
      vendre({
        ...ligne,
        paiements: [
          { mode: 'ESPECES', montant: 500 },
          { mode: 'ORANGE_MONEY', montant: 400 },
        ],
      }),
    );
    expect(somme.statut).toBe(400);
    expect(somme.corps.code).toBe('PAIEMENTS_INCOHERENTS');
    expect(String(somme.corps.message)).toContain('900 GNF');
    expect(String(somme.corps.message)).toContain('1000 GNF');

    const inconnu = await refus(
      vendre({ ...ligne, paiements: [{ mode: 'CARTE', montant: 1000 }] }),
    );
    expect(inconnu.statut).toBe(400);
    expect(inconnu.corps.code).toBe('MODE_PAIEMENT_INCONNU');

    await sql(
      `UPDATE "ModePaiement" SET "actif" = false WHERE "code" = 'MTN_MOMO'`,
    );
    try {
      const desactive = await refus(
        vendre({ ...ligne, paiements: [{ mode: 'MTN_MOMO', montant: 1000 }] }),
      );
      expect(desactive.statut).toBe(400);
      expect(desactive.corps.code).toBe('MODE_PAIEMENT_INCONNU');
    } finally {
      await sql(
        `UPDATE "ModePaiement" SET "actif" = true WHERE "code" = 'MTN_MOMO'`,
      );
    }

    const double = await refus(
      vendre({
        ...ligne,
        paiements: [
          { mode: 'ESPECES', montant: 500 },
          { mode: 'ESPECES', montant: 500 },
        ],
      }),
    );
    expect(double.statut).toBe(400);
    expect(double.corps.code).toBe('VALIDATION');
    expect(double.corps.champs).toEqual([
      { champ: 'paiements', contraintes: ['modeUnique'] },
    ]);

    const recu = await refus(
      vendre({
        ...ligne,
        paiements: [{ mode: 'ESPECES', montant: 1000, montantRecu: 500 }],
      }),
    );
    expect(recu.statut).toBe(400);
    expect(recu.corps.code).toBe('VALIDATION');
    expect(recu.corps.champs).toEqual([
      { champ: 'paiements', contraintes: ['montantRecuInsuffisant'] },
    ]);

    expect(await prochainNumero()).toBe(numeroAvant);

    const avecReference = await vendre({
      ...ligne,
      paiements: [{ mode: 'ESPECES', montant: 1000, reference: 'IGNOREE' }],
    });
    expect(avecReference.data.paiements[0].reference).toBeNull();
  });

  it('14. poste et session : refus et poste web par défaut', async () => {
    const { stockId } = await nouvelleFiche();
    await nouveauLot(stockId, { quantite: 100 });
    const ligne = { lignes: [{ stockId, quantite: 1 }] };

    const inconnu = await refus(vendre({ ...ligne, posteId: 'poste-inconnu' }));
    expect(inconnu.statut).toBe(409);
    expect(inconnu.corps.code).toBe('POSTE_INCONNU');

    const { data: posteAutre } = await postes.enregistrerPoste(
      'str-pharma-2',
      'usr-pharm-p2',
      { type: 'WEB', appareilId: 'appareil-pb11-autre-pharmacie' },
    );
    const autrePharmacie = await refus(
      vendre({ ...ligne, posteId: posteAutre.id }),
    );
    expect(autrePharmacie.statut).toBe(409);
    expect(autrePharmacie.corps.code).toBe('POSTE_INCONNU');

    const { data: posteResponsable } = await postes.enregistrerPoste(
      PHARMACIE,
      RESPONSABLE,
      { type: 'WEB', appareilId: 'appareil-pb11-responsable' },
    );
    await sessions.ouvrir(PHARMACIE, RESPONSABLE, {
      posteId: posteResponsable.id,
    });
    const collegue = await refus(
      vendre({ ...ligne, posteId: posteResponsable.id }),
    );
    expect(collegue.statut).toBe(409);
    expect(collegue.corps.code).toBe('SESSION_AUTRE_UTILISATEUR');

    const defauts = await sql(
      `SELECT "id", "type"::text AS "type", "code", "libelle" FROM "Poste" WHERE "appareilId" = $1`,
      ['web-defaut:usr-pharm-p1'],
    );
    expect(defauts.rows).toHaveLength(1);
    const defaut = defauts.rows[0];
    expect(defaut.type).toBe('WEB');
    expect(String(defaut.code).startsWith('W')).toBe(true);
    expect(defaut.libelle).toBe('Navigateur de Mamadou');
    expect(
      await compter(
        `SELECT count(*) AS n FROM "AuditLog" WHERE "action" = 'create' AND "entityType" = 'Poste' AND "entityId" = $1`,
        [String(defaut.id)],
      ),
    ).toBe(1);

    const vente = await vendre(ligne);
    expect(vente.data.poste.id).toBe(String(defaut.id));
  });

  it('15. numérotation et idempotence permanente', async () => {
    const { stockId } = await nouvelleFiche();
    await nouveauLot(stockId, { quantite: 100 });
    const ordonnance = await nouvelleFiche({ ordonnance: true });
    await nouveauLot(ordonnance.stockId, { quantite: 10 });

    const un = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    await refus(
      vendre({ lignes: [{ stockId: ordonnance.stockId, quantite: 1 }] }),
    );
    const deux = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(deux.data.numeroTicket).toBe(un.data.numeroTicket + 1);
    expect(deux.data.numero).toBe(
      `T1-${String(deux.data.numeroTicket).padStart(7, '0')}`,
    );

    const premiere = await vendre(
      { lignes: [{ stockId, quantite: 2 }] },
      VENDEUR,
      'cle-pb11-0001',
    );
    const soldeApres = await soldeProduit(stockId);
    const rejeu = await vendre(
      { lignes: [{ stockId, quantite: 2 }] },
      VENDEUR,
      'cle-pb11-0001',
    );
    expect(rejeu.data.rejeu).toBe(true);
    expect(rejeu.data.id).toBe(premiere.data.id);
    expect(rejeu.message).toBe('Cette vente était déjà enregistrée.');
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineId" = $1`,
        [premiere.data.id],
      ),
    ).toBe(1);
    expect(await soldeProduit(stockId)).toBe(soldeApres);

    const simultanees = await Promise.all([
      vendre({ lignes: [{ stockId, quantite: 1 }] }, VENDEUR, 'cle-pb11-0002'),
      vendre({ lignes: [{ stockId, quantite: 1 }] }, VENDEUR, 'cle-pb11-0002'),
    ]);
    expect(simultanees[0].data.id).toBe(simultanees[1].data.id);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1 AND "cleIdempotence" = 'cle-pb11-0002'`,
        [PHARMACIE],
      ),
    ).toBe(1);
    expect(JSON.stringify(premiere.data)).not.toContain('cleIdempotence');
    expect(JSON.stringify(rejeu.data)).not.toContain('cleIdempotence');
  });

  it('16. ordonnance toujours exigée', async () => {
    const { stockId, nom } = await nouvelleFiche({ ordonnance: true });
    await nouveauLot(stockId, { quantite: 10 });

    const sans = await refus(vendre({ lignes: [{ stockId, quantite: 1 }] }));
    expect(sans.statut).toBe(400);
    expect(sans.corps.code).toBe('ORDONNANCE_NON_CONFIRMEE');
    expect(sans.corps.details).toEqual([{ stockId, nom }]);

    const avec = await vendre({
      lignes: [{ stockId, quantite: 1 }],
      ordonnanceVerifiee: true,
    });
    expect(avec.data.ordonnanceVerifiee).toBe(true);
  });

  it('17. lignes : doublons, boîte et unité ensemble, fiches archivées ou étrangères', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const doublon = await refus(
      vendre({
        lignes: [
          { stockId, quantite: 1 },
          { stockId, quantite: 2 },
        ],
      }),
    );
    expect(doublon.statut).toBe(400);
    expect(doublon.corps.code).toBe('VALIDATION');
    expect(doublon.corps.champs).toEqual([
      { champ: 'lignes', contraintes: ['stockUnique'] },
    ]);

    const mixte = await nouvelleFiche({
      coef: 10,
      prixBoite: 1000,
      prixUnite: 120,
      decond: true,
    });
    await nouveauLot(mixte.stockId, { quantite: 30, coef: 10 });
    const { data } = await vendre({
      lignes: [
        { stockId: mixte.stockId, quantite: 1 },
        { stockId: mixte.stockId, quantite: 3, unite: 'UNITE' },
      ],
    });
    expect(data.lignes.map((l) => l.quantite)).toEqual([10, 3]);
    expect(data.total).toBe(1360);
    expect(await soldeProduit(mixte.stockId)).toBe(17);
    for (const l of data.lignes) {
      expect(l.allocations.reduce((s, a) => s + a.quantite, 0)).toBe(
        l.quantite,
      );
    }

    const archivee = await nouvelleFiche();
    await nouveauLot(archivee.stockId, { quantite: 5 });
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1`,
      [archivee.stockId],
    );
    const a = await refus(
      vendre({ lignes: [{ stockId: archivee.stockId, quantite: 1 }] }),
    );
    expect(a.statut).toBe(404);
    expect(a.corps.code).toBe('STOCK_INTROUVABLE');
    expect(a.corps.details).toEqual([{ stockId: archivee.stockId }]);

    const b = await refus(
      vendre({ lignes: [{ stockId: 'stk-21', quantite: 1 }] }),
    );
    expect(b.statut).toBe(404);
    expect(b.corps.code).toBe('STOCK_INTROUVABLE');
  });

  it('18. alerte de stock bas au passage du seuil, sans faire échouer la vente', async () => {
    alertes.mockClear();
    const { stockId, nom } = await nouvelleFiche({ coef: 10 });
    await nouveauLot(stockId, { quantite: 105, coef: 10 });

    await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(alertes).toHaveBeenCalledTimes(1);
    const arguments1 = alertes.mock.calls[0] as [unknown, { message: string }];
    expect(arguments1[1].message).toBe(
      `Le stock de "${nom}" est descendu à 95 unités.`,
    );

    await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(alertes).toHaveBeenCalledTimes(1);

    const autre = await nouvelleFiche({ coef: 10 });
    await nouveauLot(autre.stockId, { quantite: 105, coef: 10 });
    alertes.mockRejectedValueOnce(new Error('notification indisponible'));
    const { data } = await vendre({
      lignes: [{ stockId: autre.stockId, quantite: 1 }],
    });
    expect(data.statut).toBe('VALIDEE');
  });

  it('19. ventes historiques : lecture enrichie sans allocation', async () => {
    const brute = await sql(
      `SELECT "statut"::text AS "statut", "numero" FROM "Vente" WHERE "id" = 'vte-p1-1'`,
    );
    const nbLignes = await compter(
      `SELECT count(*) AS n FROM "LigneVente" WHERE "venteId" = 'vte-p1-1'`,
    );
    const { data } = await service.detailVente(PHARMACIE, 'vte-p1-1', VENDEUR);
    const vente = data as unknown as VenteRep;
    expect(vente.statut).toBe(brute.rows[0].statut);
    expect(vente.numero).toBe(brute.rows[0].numero);
    expect(vente.lignes).toHaveLength(nbLignes);
    expect(vente.poste.code).toBe('REPRISE');
    expect(vente.paiements).toEqual([]);
    for (const l of vente.lignes) expect(l.allocations).toEqual([]);
    expect(vente.session.ouverteAutomatiquement).toBe(false);
    expect(vente.provisoire).toBe(false);
  });

  it('20. invariants du journal et des allocations', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);

    const ecarts = await compter(
      `SELECT count(*) AS n FROM (
         SELECT l."id", l."quantite", sum(a."quantite") FILTER (WHERE a."statut" = 'DEFINITIVE') AS "definitif",
                count(*) FILTER (WHERE a."statut" = 'PROVISOIRE') AS "provisoires"
         FROM "LigneVente" l JOIN "AllocationLot" a ON a."ligneVenteId" = l."id"
         JOIN "Vente" v ON v."id" = l."venteId"
         WHERE v."structureId" = $1
         GROUP BY l."id", l."quantite"
       ) t WHERE t."provisoires" = 0 AND t."definitif" <> t."quantite"`,
      [PHARMACIE],
    );
    expect(ecarts).toBe(0);

    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" v JOIN "SessionCaisse" s ON s."id" = v."sessionCaisseId" WHERE v."structureId" = $1 AND v."numero" LIKE 'T1-%' AND s."technique"`,
        [PHARMACIE],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1 AND "numero" LIKE 'T1-%' AND ("pointDeVenteId" <> $2 OR "typePiece"::text <> 'VENTE')`,
        [PHARMACIE, pv1],
      ),
    ).toBe(0);
  });
});
