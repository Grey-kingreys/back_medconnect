import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  AnomaliesService,
  MESSAGE_ANOMALIE_INTROUVABLE,
  type ElementAnomalie,
} from 'src/pharmacie/anomalies/anomalies.service';
import {
  MESSAGE_COMMENTAIRE_SORTIE_REQUIS,
  MESSAGE_LOT_INTROUVABLE_SORTIE,
  MESSAGE_RAISON_SORTIE_REQUISE,
  MESSAGE_SORTIE_REJOUEE,
  messageSortieLotInsuffisante,
  SortiesStockService,
} from 'src/pharmacie/inventaires/sorties.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { CreerSortieStockDto } from 'src/pharmacie/dto/inventaires.dto';
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

interface LotRep {
  id: string;
  stockId: string;
  dateExpiration: string | null;
}
interface ReceptionRep {
  data: { id: string; lots: LotRep[] };
  message: string;
}
interface VenteRep {
  data: { id: string };
}
interface SortieRep {
  data: {
    id: string;
    mouvementId: string;
    type: string;
    motif: string;
    quantite: number;
    soldeLot: number;
    perime: boolean;
    auteurId: string;
    cree: boolean;
  };
  message: string;
}
interface TraitementRep {
  data: ElementAnomalie;
  message: string;
}
interface ListeRep {
  data: {
    anomalies: ElementAnomalie[];
    page: number;
    parPage: number;
    total: number;
    ouvertes: number;
  };
}

const PHARMACIE = 'str-pharma-1';
const AUTRE_PHARMACIE = 'str-pharma-2';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const RESPONSABLE_AUTRE = 'usr-admin-p2';

describe("Sorties manuelles et file d'anomalies, sur base de test (PB15a)", () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let receptions: ReceptionsService;
  let mouvements: MouvementsStockService;
  let sorties: SortiesStockService;
  let anomalies: AnomaliesService;
  let pv1: string;
  let pv2: string;
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
                'stock:write',
                'reception:write',
                'marge:read',
                'anomalie:gerer',
              ]
            : ['vente:write', 'caisse:utiliser', 'stock:write'],
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
    sorties = new SortiesStockService(prisma, acces, mouvements);
    anomalies = new AnomaliesService(prisma, acces);
    pv1 = await pointDeVente(PHARMACIE);
    pv2 = await pointDeVente(AUTRE_PHARMACIE);
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

  async function nouvelleFiche(
    o: { coef?: number; structureId?: string } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit sortie ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB15a', false, now())`,
      [`med-sortie-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, true, now())`,
      [
        `stk-sortie-${n}`,
        `med-sortie-${n}`,
        o.structureId ?? PHARMACIE,
        o.coef ?? 1,
      ],
    );
    return { stockId: `stk-sortie-${n}`, nom };
  }

  async function recevoir(
    dto: CreerReceptionDto,
    structureId = PHARMACIE,
    utilisateur = RESPONSABLE,
  ): Promise<ReceptionRep> {
    return (await receptions.enregistrer(
      structureId,
      utilisateur,
      dto,
      '127.0.0.1',
    )) as unknown as ReceptionRep;
  }

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

  const sortir = (
    dto: CreerSortieStockDto,
    utilisateur = VENDEUR,
    structureId = PHARMACIE,
  ) =>
    sorties.enregistrer(
      structureId,
      utilisateur,
      dto,
      '127.0.0.1',
    ) as unknown as Promise<SortieRep>;

  const lotDe = (r: ReceptionRep) => r.data.lots[0].id;

  const lister = (o: Parameters<AnomaliesService['lister']>[2] = {}) =>
    anomalies.lister(PHARMACIE, RESPONSABLE, o) as unknown as Promise<ListeRep>;

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

  /** Crée une vente sans stock et renvoie son anomalie STOCK_NEGATIF. */
  async function venteSansStock(quantite: number) {
    const { stockId } = await nouvelleFiche();
    const v = await vendre(stockId, quantite);
    const liste = await lister({ type: 'STOCK_NEGATIF' });
    const anomalie = liste.data.anomalies.find((a) => a.pieceId === v.data.id);
    if (!anomalie) throw new Error('Anomalie attendue.');
    return { stockId, vente: v, anomalie };
  }

  it("CA13 manuel : la sortie d'un lot périmé exige une raison, puis mouvement PEREMPTION attribué", async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    const r = await recevoirBoites(stockId, 3);
    const lotId = lotDe(r);
    await receptions.corrigerDateLot(
      PHARMACIE,
      RESPONSABLE,
      lotId,
      { dateExpiration: jour(-5), motif: 'Date relue sur la boîte' },
      '127.0.0.1',
    );
    const avant = await compter(
      'SELECT count(*) AS n FROM "MouvementStock" WHERE "lotId" = $1',
      [lotId],
    );

    const sansRaison = await refus(
      sortir({ stockId, lotId, unite: 'BOITE', quantite: 1 }),
    );
    expect(sansRaison.statut).toBe(400);
    expect(sansRaison.corps.code).toBe('MOTIF_REQUIS');
    expect(sansRaison.corps.message).toBe(MESSAGE_RAISON_SORTIE_REQUISE);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementStock" WHERE "lotId" = $1',
        [lotId],
      ),
    ).toBe(avant);

    const s = await sortir({
      stockId,
      lotId,
      unite: 'BOITE',
      quantite: 1,
      raison: 'PERIME',
    });
    expect(s.data).toMatchObject({
      type: 'PEREMPTION',
      motif: 'Périmé',
      quantite: 10,
      soldeLot: 20,
      perime: true,
      auteurId: VENDEUR,
      cree: true,
    });
    const m = (
      await sql(
        `SELECT "type"::text AS "type", "quantite", "pieceOrigineType"::text AS "pieceOrigineType", "pieceOrigineId", "evenementId" FROM "MouvementStock" WHERE "id" = $1`,
        [s.data.mouvementId],
      )
    ).rows[0];
    expect(m).toEqual({
      type: 'PEREMPTION',
      quantite: -10,
      pieceOrigineType: 'SORTIE_MANUELLE',
      pieceOrigineId: s.data.id,
      evenementId: 'sortie:' + s.data.id,
    });
  });

  it('raisons : cassé, perdu, retour fournisseur et autre', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 20));
    const base1 = { stockId, lotId, unite: 'UNITE' as const, quantite: 1 };
    const casse = await sortir({
      ...base1,
      raison: 'CASSE',
      commentaire: 'flacon tombé',
    });
    const perdu = await sortir({ ...base1, raison: 'PERDU' });
    const retour = await sortir({ ...base1, raison: 'RETOUR_FOURNISSEUR' });
    const autre = await sortir({
      ...base1,
      raison: 'AUTRE',
      commentaire: 'Don au dispensaire',
    });
    expect(
      [casse, perdu, retour, autre].map((s) => [s.data.type, s.data.motif]),
    ).toEqual([
      ['PERTE', 'Cassé ou abîmé : flacon tombé'],
      ['PERTE', 'Perdu ou volé'],
      ['RETOUR', 'Retour au fournisseur'],
      ['PERTE', 'Don au dispensaire'],
    ]);

    const sans = await refus(sortir({ ...base1, raison: 'AUTRE' }));
    expect(sans.statut).toBe(400);
    expect(sans.corps.code).toBe('MOTIF_REQUIS');
    expect(sans.corps.message).toBe(MESSAGE_COMMENTAIRE_SORTIE_REQUIS);
  });

  it('sortie au-delà du stock du lot refusée sans écriture', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 5));
    const e = await refus(
      sortir({ stockId, lotId, unite: 'UNITE', quantite: 6, raison: 'PERDU' }),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('STOCK_LOT_NEGATIF');
    expect(e.corps.message).toBe(messageSortieLotInsuffisante(5));
    expect(await soldeLot(lotId)).toBe(5);
  });

  it('sortie en boîtes au-delà de l entier maximal : 400 sans écriture (contrôle du chef)', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    const lotId = lotDe(await recevoirBoites(stockId, 2));
    const e = await refus(
      sortir({
        stockId,
        lotId,
        unite: 'BOITE',
        quantite: 1_000_000_000,
        raison: 'PERDU',
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('VALIDATION');
    expect(await soldeLot(lotId)).toBe(20);
  });

  it("lot d'une autre fiche ou d'une autre pharmacie : 404", async () => {
    const a = await nouvelleFiche();
    const b = await nouvelleFiche();
    const lotA = lotDe(await recevoirBoites(a.stockId, 2));
    const e = await refus(
      sortir({
        stockId: b.stockId,
        lotId: lotA,
        unite: 'UNITE',
        quantite: 1,
        raison: 'PERDU',
      }),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_LOT_INTROUVABLE_SORTIE);

    const autre = await refus(
      sortir(
        {
          stockId: a.stockId,
          lotId: lotA,
          unite: 'UNITE',
          quantite: 1,
          raison: 'PERDU',
        },
        RESPONSABLE_AUTRE,
        AUTRE_PHARMACIE,
      ),
    );
    expect(autre.statut).toBe(404);
    expect(await soldeLot(lotA)).toBe(2);
  });

  it('idempotence de la sortie', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 10));
    const id = randomUUID();
    const dto: CreerSortieStockDto = {
      id,
      stockId,
      lotId,
      unite: 'UNITE',
      quantite: 3,
      raison: 'CASSE',
    };
    const premiere = await sortir(dto);
    const seconde = await sortir(dto);
    expect(premiere.data.cree).toBe(true);
    expect(seconde.data.cree).toBe(false);
    expect(seconde.message).toBe(MESSAGE_SORTIE_REJOUEE);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementStock" WHERE "evenementId" = $1',
        ['sortie:' + id],
      ),
    ).toBe(1);
    expect(await soldeLot(lotId)).toBe(7);

    const idCourse = randomUUID();
    const course: CreerSortieStockDto = { ...dto, id: idCourse, quantite: 1 };
    const [x, y] = await Promise.all([sortir(course), sortir(course)]);
    expect([x.data.cree, y.data.cree].sort()).toEqual([false, true]);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementStock" WHERE "evenementId" = $1',
        ['sortie:' + idCourse],
      ),
    ).toBe(1);
    expect(await soldeLot(lotId)).toBe(6);
  });

  it('fiche archivée : sortie acceptée', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 4));
    await sql(
      'UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1',
      [stockId],
    );
    const s = await sortir({
      stockId,
      lotId,
      unite: 'UNITE',
      quantite: 1,
      raison: 'PERIME',
    });
    expect(s.data.cree).toBe(true);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "StockMedicament" WHERE "id" = $1 AND "archiveLe" IS NOT NULL',
        [stockId],
      ),
    ).toBe(1);
  });

  it('vente sans stock : rattachement EN_ATTENTE, PARTIELLE puis RATTACHEE, statut inchangé', async () => {
    const { stockId, vente } = await venteSansStock(2);
    const trouver = async () => {
      const liste = await lister({ type: 'STOCK_NEGATIF' });
      const a = liste.data.anomalies.find((x) => x.pieceId === vente.data.id);
      if (!a) throw new Error('Anomalie attendue.');
      return a;
    };

    let a = await trouver();
    expect(a).toMatchObject({
      type: 'STOCK_NEGATIF',
      libelle: 'Vente sans stock',
      statut: 'OUVERTE',
      attribueeA: { id: RESPONSABLE, nom: 'Fatoumata Camara' },
    });
    expect(a.rattachement).toMatchObject({
      etat: 'EN_ATTENTE',
      quantiteInitiale: 2,
      quantiteEnAttente: 2,
    });

    await recevoir({
      lignes: [
        {
          stockId,
          quantiteUnites: 1,
          dateExpiration: jour(300),
        },
      ],
    });
    a = await trouver();
    expect(a.rattachement).toMatchObject({
      etat: 'PARTIELLE',
      quantiteEnAttente: 1,
    });

    await recevoirBoites(stockId, 5);
    a = await trouver();
    expect(a.rattachement).toMatchObject({
      etat: 'RATTACHEE',
      quantiteEnAttente: 0,
    });
    expect(a.statut).toBe('OUVERTE');
  });

  it('vente sans stock annulée : VENTE_ANNULEE', async () => {
    const { vente } = await venteSansStock(2);
    await annuler(vente.data.id);
    const liste = await lister({ type: 'STOCK_NEGATIF' });
    const a = liste.data.anomalies.find((x) => x.pieceId === vente.data.id);
    expect(a?.rattachement?.etat).toBe('VENTE_ANNULEE');
  });

  it('vente sans stock en boîte et en unité sur la même fiche : quantités additionnées (contrôle du chef)', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    await sql(
      'UPDATE "StockMedicament" SET "deconditionnable" = true, "prixUnite" = 150 WHERE "id" = $1',
      [stockId],
    );
    const v = (await service.creerVente(
      PHARMACIE,
      VENDEUR,
      {
        lignes: [
          { stockId, quantite: 1 },
          { stockId, quantite: 3, unite: 'UNITE' },
        ],
      },
      undefined,
      '127.0.0.1',
    )) as unknown as VenteRep;
    const deLaVente = async () =>
      (await lister({ type: 'STOCK_NEGATIF' })).data.anomalies.filter(
        (x) => x.pieceId === v.data.id,
      );

    let liste = await deLaVente();
    expect(liste).toHaveLength(2);
    for (const a of liste) {
      expect(a.rattachement).toMatchObject({
        etat: 'EN_ATTENTE',
        quantiteInitiale: 13,
        quantiteEnAttente: 13,
      });
    }

    await recevoir({
      lignes: [{ stockId, quantiteUnites: 5, dateExpiration: jour(300) }],
    });
    liste = await deLaVente();
    for (const a of liste) {
      expect(a.rattachement).toMatchObject({
        etat: 'PARTIELLE',
        quantiteInitiale: 13,
        quantiteEnAttente: 8,
      });
    }

    await recevoirBoites(stockId, 1);
    liste = await deLaVente();
    for (const a of liste) {
      expect(a.rattachement).toMatchObject({
        etat: 'RATTACHEE',
        quantiteEnAttente: 0,
      });
    }
  });

  it('traitement une seule fois', async () => {
    const { anomalie } = await venteSansStock(1);
    const traiter = (commentaire: string) =>
      anomalies.traiter(
        PHARMACIE,
        RESPONSABLE,
        anomalie.id,
        { commentaire },
        '127.0.0.1',
      ) as unknown as Promise<TraitementRep>;

    const court = await refus(traiter('ab'));
    expect(court.statut).toBe(400);
    expect(court.corps.code).toBe('MOTIF_REQUIS');

    const t = await traiter(' Stock recompté ');
    expect(t.data).toMatchObject({
      statut: 'TRAITEE',
      traiteePar: { id: RESPONSABLE, nom: 'Fatoumata Camara' },
      commentaireTraitement: 'Stock recompté',
    });
    expect(t.data.traiteeLe).not.toBeNull();

    const encore = await refus(traiter('Stock recompté'));
    expect(encore.statut).toBe(409);
    expect(encore.corps.code).toBe('ANOMALIE_DEJA_TRAITEE');

    const ouvertes = await lister({ type: 'STOCK_NEGATIF' });
    expect(ouvertes.data.anomalies.some((a) => a.id === anomalie.id)).toBe(
      false,
    );
    const traitees = await lister({ statut: 'TRAITEE' });
    expect(traitees.data.anomalies.some((a) => a.id === anomalie.id)).toBe(
      true,
    );

    const audits = (
      await sql(
        `SELECT "metadata" FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'Anomalie' AND "entityId" = $1`,
        [anomalie.id],
      )
    ).rows;
    expect(audits).toHaveLength(1);
    expect(Object.keys(audits[0].metadata as object)).not.toContain(
      'commentaire',
    );
  });

  it('traitement simultané : une réussite et un refus', async () => {
    const { anomalie } = await venteSansStock(1);
    const traiter = () =>
      anomalies.traiter(
        PHARMACIE,
        RESPONSABLE,
        anomalie.id,
        { commentaire: 'Vérifié au comptoir' },
        '127.0.0.1',
      );
    const resultats = await Promise.allSettled([traiter(), traiter()]);
    const ok = resultats.filter((r) => r.status === 'fulfilled');
    const ko = resultats.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    const erreur = ko[0].reason as HttpException;
    expect(erreur.getStatus()).toBe(409);
    expect((erreur.getResponse() as Record<string, unknown>).code).toBe(
      'ANOMALIE_DEJA_TRAITEE',
    );
  });

  it("anomalie d'une autre pharmacie", async () => {
    const id = randomUUID();
    await sql(
      `INSERT INTO "Anomalie" ("id", "pointDeVenteId", "type", "pieceType", "details") VALUES ($1, $2, 'ECART_CAISSE', 'SESSION', '{}')`,
      [id, pv2],
    );
    const e = await refus(
      anomalies.traiter(
        PHARMACIE,
        RESPONSABLE,
        id,
        { commentaire: 'Vérifié' },
        '127.0.0.1',
      ),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_ANOMALIE_INTROUVABLE);
    const liste = await lister({ type: 'ECART_CAISSE' });
    expect(liste.data.anomalies.some((a) => a.id === id)).toBe(false);
  });

  it('filtres et pagination', async () => {
    for (let i = 0; i < 22; i += 1) {
      await sql(
        `INSERT INTO "Anomalie" ("id", "pointDeVenteId", "type", "pieceType", "details", "creeLe") VALUES ($1, $2, 'ECART_CAISSE', 'SESSION', '{}', now() - ($3 * interval '1 minute'))`,
        [randomUUID(), pv1, i],
      );
    }
    const p1 = await lister({ type: 'ECART_CAISSE', page: 1 });
    const p2 = await lister({ type: 'ECART_CAISSE', page: 2 });
    expect(p1.data.anomalies).toHaveLength(20);
    expect(p1.data).toMatchObject({ total: 22, parPage: 20 });
    expect(p2.data.anomalies).toHaveLength(2);
    expect(p1.data.ouvertes).toBe(
      await compter(
        `SELECT count(*) AS n FROM "Anomalie" WHERE "pointDeVenteId" = $1 AND "statut" = 'OUVERTE'`,
        [pv1],
      ),
    );
    const dates = [...p1.data.anomalies, ...p2.data.anomalies].map((a) =>
      new Date(a.creeLe).getTime(),
    );
    expect(dates).toEqual([...dates].sort((x, y) => y - x));
  });

  it("correction de date simultanée : l'audit « avant » est relu sous le verrou (réserve PB14a)", async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 2, { dans: 300 }));
    const corriger = (dateExpiration: string) =>
      receptions.corrigerDateLot(
        PHARMACIE,
        RESPONSABLE,
        lotId,
        { dateExpiration, motif: 'Date relue sur la boîte' },
        '127.0.0.1',
      );
    const { tenu, liberer, fin } = tenirFiche(stockId);
    let c1: Promise<unknown> | undefined;
    let c2: Promise<unknown> | undefined;
    try {
      await tenu;
      c1 = corriger(jour(200));
      await attendreAttentes(1);
      c2 = corriger(jour(100));
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    await Promise.all([c1, c2]);

    const audits = (
      await sql(
        `SELECT "metadata" FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'LotStock' AND "entityId" = $1 ORDER BY "createdAt", "id"`,
        [lotId],
      )
    ).rows.map(
      (r) =>
        r.metadata as {
          avant: { dateExpiration: string | null };
          apres: { dateExpiration: string | null };
        },
    );
    expect(audits).toHaveLength(2);
    expect(audits[0].avant.dateExpiration).toBe(jour(300));
    expect(audits[1].avant.dateExpiration).toBe(audits[0].apres.dateExpiration);
  });

  it('aucune donnée de coût', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 3, { cout: 5000 }));
    const s = await sortir({
      stockId,
      lotId,
      unite: 'UNITE',
      quantite: 1,
      raison: 'PERDU',
    });
    expect(cheminsCout(s.data)).toEqual([]);
    const liste = await lister();
    expect(cheminsCout(liste.data)).toEqual([]);
    expect(await soldeProduit(stockId)).toBeGreaterThan(0);
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
