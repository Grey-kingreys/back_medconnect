import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  FicheProduitService,
  MESSAGE_AUCUNE_MODIFICATION,
  MESSAGE_CONVERSION_IMPOSSIBLE,
  MESSAGE_CONVERSION_REQUISE,
  MESSAGE_CONVERSION_TROP_GRANDE,
  MESSAGE_FICHE_DEJA_QUALIFIEE,
  MESSAGE_FICHE_ENREGISTREE,
  MESSAGE_STOCK_CONSERVE,
  messageStockMultiplie,
} from 'src/pharmacie/fiche-produit.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import {
  MESSAGE_FICHE_MODIFIEE,
  MESSAGE_VENTE_AVANT_QUALIFICATION,
  VenteService,
} from 'src/pharmacie/vente.service';
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

interface LigneRep {
  quantite: number;
  coefficientApplique: number;
}
interface VenteRep {
  id: string;
  lignes: LigneRep[];
}
interface Reponse {
  data: VenteRep;
  message: string;
  success: boolean;
}
interface EntreeStock {
  id: string;
  quantite: number;
  reliquat: unknown[];
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Qualification d une fiche, sur base de test (PB13)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let fiches: FicheProduitService;
  let pharmacie: PharmacieService;
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
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      mouvements,
      permissions,
      new ReceptionsService(prisma, acces, mouvements, permissions),
      new InventairesService(prisma, acces, mouvements),
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
    } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit qualification ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB13', false, now())`,
      [`med-qualif-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "prixUnite", "coefficientBoite", "deconditionnable", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, $7, now())`,
      [
        `stk-qualif-${n}`,
        `med-qualif-${n}`,
        PHARMACIE,
        o.prixBoite === undefined ? 1000 : o.prixBoite,
        o.prixUnite ?? null,
        o.coef ?? 1,
        o.decond ?? false,
      ],
    );
    return { stockId: `stk-qualif-${n}`, nom };
  }

  async function lotTechnique(
    stockId: string,
    quantite: number,
    cout = 0,
  ): Promise<string> {
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(200)),
        quantite,
        coutUnitaire: cout,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: true,
        auteurId: null,
        pieceOrigineType: 'MIGRATION',
        pieceOrigineId: 'test-pb13',
        motif: 'Reprise du stock existant',
      }),
    );
    return lot.id;
  }

  async function nouveauLot(
    stockId: string,
    o: { quantite: number; coef?: number; cout?: number },
  ): Promise<string> {
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(200)),
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

  const modifier = (
    stockId: string,
    dto: Parameters<FicheProduitService['modifierFiche']>[3],
  ) => fiches.modifierFiche(PHARMACIE, RESPONSABLE, stockId, dto, '127.0.0.1');

  async function vendre(dto: CreerVenteDto, utilisateur = VENDEUR) {
    return (await service.creerVente(
      PHARMACIE,
      utilisateur,
      dto,
      undefined,
      '127.0.0.1',
    )) as unknown as Reponse;
  }

  async function annuler(venteId: string) {
    return (await service.annulerVente(
      PHARMACIE,
      venteId,
      VENDEUR,
      { motif: 'Erreur de quantité' },
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
      'SELECT COALESCE(max("prochainNumero"), 0) AS n FROM "CompteurTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    return Number(res.rows[0].n);
  }

  const nombreVentes = () =>
    compter('SELECT count(*) AS n FROM "Vente" WHERE "structureId" = $1', [
      PHARMACIE,
    ]);

  const nombreMouvements = (stockId: string) =>
    compter(
      'SELECT count(*) AS n FROM "MouvementStock" WHERE "stockMedicamentId" = $1',
      [stockId],
    );

  const mouvementsQualification = async (stockId: string) =>
    (
      await sql(
        `SELECT "type"::text AS "type", "quantite", "lotId", "evenementId", "pieceOrigineId", "motif", "auteurId" FROM "MouvementStock" WHERE "pieceOrigineType" = 'QUALIFICATION' AND "stockMedicamentId" = $1`,
        [stockId],
      )
    ).rows;

  const lot = async (lotId: string) =>
    (
      await sql(
        'SELECT "coefficientReception", "coutUnitaire" FROM "LotStock" WHERE "id" = $1',
        [lotId],
      )
    ).rows[0];

  const fiche = async (stockId: string) =>
    (
      await sql(
        'SELECT "coefficientBoite", "qualifie" FROM "StockMedicament" WHERE "id" = $1',
        [stockId],
      )
    ).rows[0];

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

  it('MULTIPLIER : 12 boîtes de coefficient 1 qualifiées à 20 donnent 240 unités et un reliquat nul', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const lotId = await lotTechnique(stockId, 12);

    const r = await modifier(stockId, {
      coefficientBoite: 20,
      uniteMinimale: 'COMPRIME',
      conversionStock: 'MULTIPLIER',
    });

    expect(r.data.coefficientBoite).toBe(20);
    expect(r.data.qualifie).toBe(true);
    expect(r.data.conversion).toEqual({
      mode: 'MULTIPLIER',
      coefficientAvant: 1,
      coefficientApres: 20,
      quantiteAvant: 12,
      quantiteApres: 240,
      lots: [{ lotId, quantiteAvant: 12, quantiteApres: 240 }],
    });
    expect(r.message).toBe(messageStockMultiplie(240));
    expect(cheminsCout(r.data)).toEqual([]);

    expect(await soldeLot(lotId)).toBe(240);
    expect(await soldeProduit(stockId)).toBe(240);
    expect(await lot(lotId)).toEqual({
      coefficientReception: 20,
      coutUnitaire: 0,
    });
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ConditionnementOuvert" WHERE "stockMedicamentId" = $1 AND "fermeLe" IS NULL',
        [stockId],
      ),
    ).toBe(0);
    expect(await mouvementsQualification(stockId)).toEqual([
      {
        type: 'CORRECTION',
        quantite: 228,
        lotId,
        evenementId: `qualification:${lotId}`,
        pieceOrigineId: stockId,
        motif: 'Qualification de la fiche : 20 unités par boîte',
        auteurId: RESPONSABLE,
      },
    ]);

    const audit = await sql(
      `SELECT "metadata" FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'StockMedicament' AND "entityId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      [stockId],
    );
    const metadata = audit.rows[0].metadata as {
      conversion: unknown;
      apres: Record<string, unknown>;
    };
    expect(metadata.conversion).toEqual(r.data.conversion);
    expect(metadata.apres).toMatchObject({
      coefficientBoite: 20,
      qualifie: true,
    });

    const lecture = (await pharmacie.getStockPharmacie(
      PHARMACIE,
      RESPONSABLE,
    )) as unknown as { data: { stocks: EntreeStock[] } };
    const entree = lecture.data.stocks.find((s) => s.id === stockId);
    expect(entree?.quantite).toBe(240);
    expect(entree?.reliquat).toEqual([]);

    const vente = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(vente.data.lignes[0].quantite).toBe(20);
    expect(vente.data.lignes[0].coefficientApplique).toBe(20);
    expect(await soldeLot(lotId)).toBe(220);
  });

  it('CONSERVER ne change rien au stock', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await lotTechnique(stockId, 12);

    const r = await modifier(stockId, {
      coefficientBoite: 20,
      conversionStock: 'CONSERVER',
    });

    expect(r.data.qualifie).toBe(true);
    expect(r.data.coefficientBoite).toBe(20);
    expect(r.data.conversion).toEqual({
      mode: 'CONSERVER',
      coefficientAvant: 1,
      coefficientApres: 20,
      quantiteAvant: 12,
      quantiteApres: 12,
      lots: [],
    });
    expect(r.message).toBe(MESSAGE_STOCK_CONSERVE);
    expect(await soldeLot(lotId)).toBe(12);
    expect(await soldeProduit(stockId)).toBe(12);
    expect((await lot(lotId)).coefficientReception).toBe(1);
    expect(await mouvementsQualification(stockId)).toEqual([]);
    expect(await nombreMouvements(stockId)).toBe(1);
  });

  it('CONVERSION_REQUISE lit le stock calculé, pas la colonne gelée', async () => {
    const { stockId } = await nouvelleFiche();
    await lotTechnique(stockId, 12);

    const e = await refus(modifier(stockId, { coefficientBoite: 20 }));
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('CONVERSION_REQUISE');
    expect(e.corps.message).toBe(MESSAGE_CONVERSION_REQUISE);
    expect(await fiche(stockId)).toEqual({
      coefficientBoite: 1,
      qualifie: false,
    });
    expect(await nombreMouvements(stockId)).toBe(1);

    const vide = await nouvelleFiche();
    const r1 = await modifier(vide.stockId, { coefficientBoite: 10 });
    expect(r1.data.qualifie).toBe(false);
    expect(r1.data.conversion).toBeNull();
    expect(r1.message).toBe(MESSAGE_FICHE_ENREGISTREE);

    const autre = await nouvelleFiche();
    const r2 = await modifier(autre.stockId, {
      coefficientBoite: 10,
      conversionStock: 'MULTIPLIER',
    });
    expect(r2.data.qualifie).toBe(true);
    expect(r2.data.conversion).toEqual({
      mode: 'MULTIPLIER',
      coefficientAvant: 1,
      coefficientApres: 10,
      quantiteAvant: 0,
      quantiteApres: 0,
      lots: [],
    });
    expect(await nombreMouvements(autre.stockId)).toBe(0);
  });

  it('conversion refusée après qualification', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await lotTechnique(stockId, 12);
    await modifier(stockId, {
      coefficientBoite: 20,
      uniteMinimale: 'COMPRIME',
      conversionStock: 'MULTIPLIER',
    });

    for (const conversionStock of ['MULTIPLIER', 'CONSERVER'] as const) {
      const e = await refus(
        modifier(stockId, { coefficientBoite: 10, conversionStock }),
      );
      expect(e.statut).toBe(409);
      expect(e.corps.code).toBe('FICHE_DEJA_QUALIFIEE');
      expect(e.corps.message).toBe(MESSAGE_FICHE_DEJA_QUALIFIEE);
      expect((await fiche(stockId)).coefficientBoite).toBe(20);
      expect(await soldeLot(lotId)).toBe(240);
      expect(await mouvementsQualification(stockId)).toHaveLength(1);
    }

    const rejeu = await modifier(stockId, {
      coefficientBoite: 20,
      conversionStock: 'MULTIPLIER',
    });
    expect(rejeu.message).toBe(MESSAGE_AUCUNE_MODIFICATION);
    expect(rejeu.data.conversion).toBeNull();
    expect(await mouvementsQualification(stockId)).toHaveLength(1);

    const sans = await modifier(stockId, { coefficientBoite: 10 });
    expect(sans.data.coefficientBoite).toBe(10);
    expect(await soldeLot(lotId)).toBe(240);
    expect((await lot(lotId)).coefficientReception).toBe(20);
  });

  it('MULTIPLIER refusé si du stock est hors du lot technique', async () => {
    const a = await nouvelleFiche();
    const technique = await lotTechnique(a.stockId, 12);
    await nouveauLot(a.stockId, { quantite: 5 });

    const e = await refus(
      modifier(a.stockId, {
        coefficientBoite: 20,
        conversionStock: 'MULTIPLIER',
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('CONVERSION_IMPOSSIBLE');
    expect(e.corps.message).toBe(MESSAGE_CONVERSION_IMPOSSIBLE);
    expect(await soldeProduit(a.stockId)).toBe(17);
    expect((await lot(technique)).coefficientReception).toBe(1);
    expect((await fiche(a.stockId)).qualifie).toBe(false);
    expect(await mouvementsQualification(a.stockId)).toEqual([]);

    const ok = await modifier(a.stockId, {
      coefficientBoite: 20,
      conversionStock: 'CONSERVER',
    });
    expect(ok.data.qualifie).toBe(true);
    expect(await soldeProduit(a.stockId)).toBe(17);

    const b = await nouvelleFiche({ prixBoite: 1000 });
    await lotTechnique(b.stockId, 2);
    await vendre({ lignes: [{ stockId: b.stockId, quantite: 3 }] });
    expect(await soldeProduit(b.stockId)).toBe(-1);

    const requise = await refus(modifier(b.stockId, { coefficientBoite: 20 }));
    expect(requise.statut).toBe(400);
    expect(requise.corps.code).toBe('CONVERSION_REQUISE');
    const impossible = await refus(
      modifier(b.stockId, {
        coefficientBoite: 20,
        conversionStock: 'MULTIPLIER',
      }),
    );
    expect(impossible.statut).toBe(409);
    expect(impossible.corps.code).toBe('CONVERSION_IMPOSSIBLE');
  });

  it('quantité trop grande', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await lotTechnique(stockId, 300000);

    const e = await refus(
      modifier(stockId, {
        coefficientBoite: 10000,
        conversionStock: 'MULTIPLIER',
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('CONVERSION_IMPOSSIBLE');
    expect(e.corps.message).toBe(MESSAGE_CONVERSION_TROP_GRANDE);
    expect(await soldeLot(lotId)).toBe(300000);
  });

  it('coût du lot technique divisé par le coefficient, jamais exposé', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = await lotTechnique(stockId, 12, 1000);

    const r = await modifier(stockId, {
      coefficientBoite: 3,
      conversionStock: 'MULTIPLIER',
    });

    expect(await lot(lotId)).toEqual({
      coefficientReception: 3,
      coutUnitaire: 333,
    });
    expect(await soldeLot(lotId)).toBe(36);
    expect(cheminsCout(r.data)).toEqual([]);
  });

  it('MULTIPLIER refusé si la fiche ne comptait pas 1 unité par boîte', async () => {
    // Fiche passée à 5 sans stock, puis lot technique réalimenté en unités (D565)
    const { stockId } = await nouvelleFiche({ coef: 5 });
    const lotId = await lotTechnique(stockId, 10);

    const e = await refus(
      modifier(stockId, {
        coefficientBoite: 10,
        conversionStock: 'MULTIPLIER',
      }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('CONVERSION_IMPOSSIBLE');
    expect(e.corps.message).toBe(MESSAGE_CONVERSION_IMPOSSIBLE);
    expect(await soldeLot(lotId)).toBe(10);
    expect((await lot(lotId)).coefficientReception).toBe(1);
    expect((await fiche(stockId)).qualifie).toBe(false);
    expect(await mouvementsQualification(stockId)).toEqual([]);

    const ok = await modifier(stockId, {
      coefficientBoite: 10,
      conversionStock: 'CONSERVER',
    });
    expect(ok.data.qualifie).toBe(true);
    expect(await soldeLot(lotId)).toBe(10);
  });

  it('concurrence : vente en attente avant la qualification, aucun interblocage', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const lotId = await lotTechnique(stockId, 12);
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let vente: Promise<Reponse> | undefined;
    let qualification: ReturnType<typeof modifier> | undefined;
    try {
      await tenu;
      vente = vendre({ lignes: [{ stockId, quantite: 2 }] });
      await attendreAttentes(1);
      qualification = modifier(stockId, {
        coefficientBoite: 20,
        conversionStock: 'MULTIPLIER',
      });
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [v, q] = await Promise.allSettled([vente, qualification]);

    expect(v.status).toBe('fulfilled');
    expect(q.status).toBe('fulfilled');
    if (v.status === 'fulfilled' && q.status === 'fulfilled') {
      expect(v.value.data.lignes[0].quantite).toBe(2);
      expect(v.value.data.lignes[0].coefficientApplique).toBe(1);
      expect(q.value.data.conversion?.quantiteAvant).toBe(10);
      expect(q.value.data.conversion?.quantiteApres).toBe(200);
    }
    expect(await soldeLot(lotId)).toBe(200);
  });

  it('concurrence : qualification avant une vente en attente, vente refusée FICHE_MODIFIEE', async () => {
    const { stockId, nom } = await nouvelleFiche({ prixBoite: 1000 });
    const lotId = await lotTechnique(stockId, 12);
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let qualification: ReturnType<typeof modifier> | undefined;
    let vente: Promise<Reponse> | undefined;
    let ventesAvant = 0;
    let numeroAvant = 0;
    try {
      await tenu;
      qualification = modifier(stockId, {
        coefficientBoite: 20,
        conversionStock: 'MULTIPLIER',
      });
      await attendreAttentes(1);
      ventesAvant = await nombreVentes();
      numeroAvant = await prochainNumero();
      vente = vendre({ lignes: [{ stockId, quantite: 2 }] });
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [q, v] = await Promise.allSettled([qualification, vente]);

    expect(q.status).toBe('fulfilled');
    expect(await soldeLot(lotId)).toBe(240);
    expect(v.status).toBe('rejected');
    const e = await refus(vente);
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('FICHE_MODIFIEE');
    expect(e.corps.message).toBe(MESSAGE_FICHE_MODIFIEE);
    expect(e.corps.details).toEqual([{ stockId, nom }]);
    expect(await nombreVentes()).toBe(ventesAvant);
    expect(await prochainNumero()).toBe(numeroAvant);
  });

  it('PATCH quantité pendant une vente, aucun interblocage', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const lotId = await lotTechnique(stockId, 12);
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let vente: Promise<Reponse> | undefined;
    let ajustement:
      | ReturnType<PharmacieService['updateStockQuantite']>
      | undefined;
    try {
      await tenu;
      vente = vendre({ lignes: [{ stockId, quantite: 2 }] });
      await attendreAttentes(1);
      ajustement = pharmacie.updateStockQuantite(
        PHARMACIE,
        stockId,
        RESPONSABLE,
        { variation: 5, motif: 'Retour fournisseur' },
      );
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [v, a] = await Promise.allSettled([vente, ajustement]);

    expect(v.status).toBe('fulfilled');
    expect(a.status).toBe('fulfilled');
    expect(await soldeLot(lotId)).toBe(15);
  });

  it('annulation : vente antérieure à la multiplication refusée, vente postérieure annulable', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const lotId = await lotTechnique(stockId, 12);
    const venteA = await vendre({ lignes: [{ stockId, quantite: 2 }] });
    await modifier(stockId, {
      coefficientBoite: 20,
      conversionStock: 'MULTIPLIER',
    });
    expect(await soldeLot(lotId)).toBe(200);

    const e = await refus(annuler(venteA.data.id));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('PIECE_NON_ANNULABLE');
    expect(e.corps.message).toBe(MESSAGE_VENTE_AVANT_QUALIFICATION);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "Vente" WHERE "venteOrigineId" = $1',
        [venteA.data.id],
      ),
    ).toBe(0);
    expect(await soldeLot(lotId)).toBe(200);

    const venteB = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    expect(venteB.data.lignes[0].quantite).toBe(20);
    expect(await soldeLot(lotId)).toBe(180);
    await annuler(venteB.data.id);
    expect(await soldeLot(lotId)).toBe(200);

    const autre = await nouvelleFiche({ prixBoite: 1000 });
    const lotC = await lotTechnique(autre.stockId, 12);
    const venteC = await vendre({
      lignes: [{ stockId: autre.stockId, quantite: 2 }],
    });
    await modifier(autre.stockId, {
      coefficientBoite: 20,
      conversionStock: 'CONSERVER',
    });
    await annuler(venteC.data.id);
    expect(await soldeLot(lotC)).toBe(12);
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
