import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  InventairesService,
  MESSAGE_IDENTIFIANT_INVENTAIRE,
  MESSAGE_INVENTAIRE_DATE_REQUISE,
  MESSAGE_INVENTAIRE_INTROUVABLE,
  MESSAGE_INVENTAIRE_LOT_REQUIS,
  MESSAGE_INVENTAIRE_REJOUE,
  MESSAGE_VENTES_RATTACHEES_INVENTAIRE,
  messageInventaireEnregistre,
  type LigneInventaireAEnregistrer,
} from 'src/pharmacie/inventaires/inventaires.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { CreerInventaireDto } from 'src/pharmacie/dto/inventaires.dto';
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
  numeroLot: string | null;
  dateExpiration: string | null;
}
interface ReceptionRep {
  data: { id: string; lots: LotRep[] };
  message: string;
}
interface VenteRep {
  data: { id: string };
}
interface InventaireRep {
  data: {
    id: string;
    cree: boolean;
    auteur: { id: string; nom: string };
    lignes: {
      id: string;
      stockId: string;
      lotId: string | null;
      numeroLot: string | null;
      dateExpiration: string | null;
      quantiteTheorique: number;
      quantiteComptee: number;
      ecart: number;
      sousTolerance: boolean;
      anomalieId: string | null;
    }[];
    anomalies: { id: string; stockId: string; ecart: number; statut: string }[];
    resolutions: {
      quantiteResolue: number;
      resteProvisoire: number;
    }[];
    avertissements: { code: string; stockId: string }[];
  };
  message: string;
}
interface ListeInventairesRep {
  data: {
    inventaires: {
      id: string;
      nombreLignes: number;
      nombreEcarts: number;
      nombreAnomalies: number;
    }[];
    total: number;
  };
}

const PHARMACIE = 'str-pharma-1';
const AUTRE_PHARMACIE = 'str-pharma-2';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const RESPONSABLE_AUTRE = 'usr-admin-p2';

describe('Inventaire par lot, sur base de test (PB15b)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let receptions: ReceptionsService;
  let mouvements: MouvementsStockService;
  let inventaires: InventairesService;
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
                'stock:write',
                'reception:write',
                'marge:read',
                'anomalie:gerer',
                'inventaire:write',
              ]
            : [
                'vente:write',
                'caisse:utiliser',
                'stock:write',
                'inventaire:write',
              ],
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
    inventaires = new InventairesService(prisma, acces, mouvements);
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

  async function nouvelleFiche(
    o: {
      coef?: number;
      tolerance?: number;
      qualifie?: boolean;
      structureId?: string;
    } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit inventaire ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB15b', false, now())`,
      [`med-inv-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "toleranceInventaire", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, $5, $6, now())`,
      [
        `stk-inv-${n}`,
        `med-inv-${n}`,
        o.structureId ?? PHARMACIE,
        o.coef ?? 1,
        o.tolerance ?? null,
        o.qualifie ?? true,
      ],
    );
    return { stockId: `stk-inv-${n}`, nom };
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

  const inventorier = (
    lignes: CreerInventaireDto['lignes'],
    utilisateur = VENDEUR,
    extra: Partial<Omit<CreerInventaireDto, 'lignes'>> = {},
    structureId = PHARMACIE,
  ) =>
    inventaires.enregistrer(
      structureId,
      utilisateur,
      { lignes, ...extra },
      '127.0.0.1',
    ) as unknown as Promise<InventaireRep>;

  const lotDe = (r: ReceptionRep) => r.data.lots[0].id;

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

  /** Attente sur un verrou de ligne (la réception tient la ligne de la fiche avant le verrou consultatif). */
  async function attendreVerrouLigne(): Promise<void> {
    const debut = Date.now();
    while (
      (await compter(
        `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'transactionid' AND NOT granted`,
      )) < 1
    ) {
      if (Date.now() - debut > 4_000) {
        throw new Error('Attente de verrou de ligne non observée.');
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

  async function allocationsDeVente(venteId: string) {
    return (
      await sql(
        `SELECT a."id", a."statut"::text AS "statut", a."quantite", a."lotId", a."remplaceeParPieceId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."createdAt", a."id"`,
        [venteId],
      )
    ).rows;
  }

  const compterInventaires = () =>
    compter('SELECT count(*) AS n FROM "Inventaire"');
  const compterMouvements = () =>
    compter('SELECT count(*) AS n FROM "MouvementStock"');

  async function anomaliesDe(inventaireId: string) {
    return (
      await sql(
        `SELECT "id", "type"::text AS "type", "statut"::text AS "statut", "attribueeAId", "pieceType", "pieceId", "details" FROM "Anomalie" WHERE "pieceId" = $1`,
        [inventaireId],
      )
    ).rows;
  }

  it('CA8 sous la tolérance : mouvement INVENTAIRE écrit, aucune anomalie', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10, tolerance: 5 });
    const lotId = lotDe(await recevoirBoites(stockId, 3));
    const r = await inventorier([{ stockId, quantiteComptee: 27 }]);

    expect(r.data.lignes).toHaveLength(1);
    expect(r.data.lignes[0]).toMatchObject({
      quantiteTheorique: 30,
      quantiteComptee: 27,
      ecart: -3,
      sousTolerance: true,
      anomalieId: null,
    });
    const mouvements = (
      await sql(
        `SELECT "type"::text AS "type", "quantite", "pieceOrigineType"::text AS "pieceOrigineType", "pieceOrigineId", "evenementId", "auteurId" FROM "MouvementStock" WHERE "lotId" = $1 AND "type" = 'INVENTAIRE'`,
        [lotId],
      )
    ).rows;
    expect(mouvements).toEqual([
      {
        type: 'INVENTAIRE',
        quantite: -3,
        pieceOrigineType: 'INVENTAIRE',
        pieceOrigineId: r.data.id,
        evenementId: `inventaire:${r.data.id}:0`,
        auteurId: VENDEUR,
      },
    ]);
    expect(await soldeLot(lotId)).toBe(27);
    expect(await anomaliesDe(r.data.id)).toHaveLength(0);
    expect(r.message).toBe(messageInventaireEnregistre(1, 0));
  });

  it("CA8 au-dessus de la tolérance : mouvement écrit et anomalie attribuée à l'auteur du comptage", async () => {
    const { stockId } = await nouvelleFiche({ coef: 10, tolerance: 5 });
    const lotId = lotDe(await recevoirBoites(stockId, 3));
    const r = await inventorier([{ stockId, quantiteComptee: 20 }]);

    const anomalies = await anomaliesDe(r.data.id);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({
      type: 'ECART_INVENTAIRE',
      statut: 'OUVERTE',
      attribueeAId: VENDEUR,
      pieceType: 'INVENTAIRE',
      pieceId: r.data.id,
    });
    expect(anomalies[0].details).toMatchObject({
      stockId,
      ecart: -10,
      tolerance: 5,
      utilisateurNom: 'Mamadou Diallo',
    });
    expect((anomalies[0].details as Record<string, unknown>).message).toBe(
      'Inventaire de ' +
        String((anomalies[0].details as Record<string, unknown>).nom) +
        ' par Mamadou Diallo : écart de -10 unité(s), au-delà de la tolérance de 5 unité(s). Vérifiez le comptage avant de traiter cette anomalie.',
    );
    expect(r.data.lignes[0].anomalieId).toBe(String(anomalies[0].id));
    expect(await soldeLot(lotId)).toBe(20);
    expect(r.message).toBe(messageInventaireEnregistre(1, 1));
  });

  it('écart nul : mouvement INVENTAIRE de quantité 0', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10, tolerance: 5 });
    const lotId = lotDe(await recevoirBoites(stockId, 3));
    const r = await inventorier([{ stockId, quantiteComptee: 30 }]);

    const mouvements = (
      await sql(
        `SELECT "quantite" FROM "MouvementStock" WHERE "lotId" = $1 AND "type" = 'INVENTAIRE'`,
        [lotId],
      )
    ).rows;
    expect(mouvements).toEqual([{ quantite: 0 }]);
    expect(r.data.lignes[0]).toMatchObject({ ecart: 0, sousTolerance: true });
  });

  it('tolérance nulle par défaut', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    await recevoirBoites(stockId, 3);
    const r = await inventorier([{ stockId, quantiteComptee: 31 }]);
    expect(await anomaliesDe(r.data.id)).toHaveLength(1);
    expect(r.data.lignes[0].sousTolerance).toBe(false);
  });

  it('tolérance par fiche : écarts de deux lots compensés', async () => {
    const { stockId } = await nouvelleFiche({ tolerance: 0 });
    const lotA = lotDe(await recevoirBoites(stockId, 10, { dans: 300 }));
    const lotB = lotDe(await recevoirBoites(stockId, 10, { dans: 200 }));
    const r = await inventorier([
      { stockId, lotId: lotA, quantiteComptee: 12 },
      { stockId, lotId: lotB, quantiteComptee: 8 },
    ]);
    expect(await anomaliesDe(r.data.id)).toHaveLength(0);
    expect(await soldeLot(lotA)).toBe(12);
    expect(await soldeLot(lotB)).toBe(8);
  });

  it('plusieurs lots sans précision : 409 LOT_REQUIS avec la liste, rien écrit', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoirBoites(stockId, 10, { dans: 300 });
    await recevoirBoites(stockId, 10, { dans: 200 });
    const inventairesAvant = await compterInventaires();
    const mouvementsAvant = await compterMouvements();

    const e = await refus(inventorier([{ stockId, quantiteComptee: 5 }]));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('LOT_REQUIS');
    expect(e.corps.message).toBe(MESSAGE_INVENTAIRE_LOT_REQUIS);
    const details = e.corps.details as {
      stockId: string;
      lots: Record<string, unknown>[];
    }[];
    expect(details[0].stockId).toBe(stockId);
    expect(details[0].lots).toHaveLength(2);
    expect(Object.keys(details[0].lots[0]).sort()).toEqual([
      'dateExpiration',
      'lotId',
      'numeroLot',
      'quantite',
    ]);
    expect(await compterInventaires()).toBe(inventairesAvant);
    expect(await compterMouvements()).toBe(mouvementsAvant);
  });

  it('ciblage par numéro de lot et par date', async () => {
    const { stockId } = await nouvelleFiche();
    const r = await recevoir({
      lignes: [
        {
          stockId,
          numeroLot: 'A12',
          nombreBoites: 10,
          dateExpiration: jour(300),
        },
        {
          stockId,
          numeroLot: 'B07',
          nombreBoites: 10,
          dateExpiration: jour(200),
        },
      ],
    });
    const lotA = r.data.lots.find((l) => l.numeroLot === 'A12') as LotRep;
    const lotB = r.data.lots.find((l) => l.numeroLot === 'B07') as LotRep;
    await inventorier([
      { stockId, numeroLot: ' a 12 ', quantiteComptee: 4 },
      { stockId, dateExpiration: jour(200), quantiteComptee: 6 },
    ]);
    expect(await soldeLot(lotA.id)).toBe(4);
    expect(await soldeLot(lotB.id)).toBe(6);
  });

  it("nouveau lot trouvé à l'inventaire", async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    await recevoirBoites(stockId, 2);

    const sansDate = await refus(
      inventorier([{ stockId, numeroLot: 'Z99', quantiteComptee: 4 }]),
    );
    expect(sansDate.statut).toBe(400);
    expect(sansDate.corps.code).toBe('DATE_PEREMPTION_REQUISE');
    expect(sansDate.corps.message).toBe(MESSAGE_INVENTAIRE_DATE_REQUISE);
    expect((sansDate.corps.details as { stockId: string }[])[0].stockId).toBe(
      stockId,
    );

    const r = await inventorier([
      {
        stockId,
        numeroLot: 'Z99',
        dateExpiration: jour(-10),
        quantiteComptee: 4,
      },
    ]);
    const lot = (
      await sql(
        `SELECT "id", "numeroLot", "quantiteRecue", "coutUnitaire", "coutAchatBoite", "receptionId", "lotTechnique", "coefficientReception" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "numeroLot" = 'Z99'`,
        [stockId],
      )
    ).rows[0];
    expect(lot).toMatchObject({
      numeroLot: 'Z99',
      quantiteRecue: 4,
      coutUnitaire: 0,
      coutAchatBoite: null,
      receptionId: null,
      lotTechnique: false,
      coefficientReception: 10,
    });
    const mouvements = (
      await sql(
        `SELECT "type"::text AS "type", "quantite", "pieceOrigineType"::text AS "pieceOrigineType" FROM "MouvementStock" WHERE "lotId" = $1`,
        [lot.id],
      )
    ).rows;
    expect(mouvements).toEqual([
      { type: 'INVENTAIRE', quantite: 4, pieceOrigineType: 'INVENTAIRE' },
    ]);
    expect(r.data.lignes[0]).toMatchObject({
      lotId: String(lot.id),
      quantiteTheorique: 0,
      ecart: 4,
    });
  });

  it('fiche sans lot comptée à 0 : ligne sans lot, aucun mouvement', async () => {
    const { stockId } = await nouvelleFiche();
    const r = await inventorier([{ stockId, quantiteComptee: 0 }]);
    expect(r.data.lignes[0]).toMatchObject({
      lotId: null,
      quantiteTheorique: 0,
      quantiteComptee: 0,
      ecart: 0,
    });
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineId" = $1`,
        [r.data.id],
      ),
    ).toBe(0);
  });

  it('boîtes et unités en plus, avertissement de fiche non qualifiée', async () => {
    const { stockId } = await nouvelleFiche({ coef: 10, qualifie: false });
    await recevoirBoites(stockId, 3);
    const r = await inventorier([
      { stockId, nombreBoites: 2, unitesEnPlus: 3 },
    ]);
    expect(r.data.lignes[0].quantiteComptee).toBe(23);
    expect(r.data.avertissements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'FICHE_NON_QUALIFIEE', stockId }),
      ]),
    );
  });

  it('refus de saisie', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoirBoites(stockId, 10);
    const cas: [CreerInventaireDto['lignes'], string, string][] = [
      [[{ stockId }], 'lignes.0.quantiteComptee', 'quantiteRequise'],
      [
        [{ stockId, quantiteComptee: 1, nombreBoites: 1 }],
        'lignes.0.quantiteComptee',
        'quantiteUnique',
      ],
      [
        [{ stockId, quantiteComptee: 1, unitesEnPlus: 2 }],
        'lignes.0.unitesEnPlus',
        'unitesSansBoites',
      ],
      [
        [{ stockId, quantiteComptee: 1, dateExpiration: '2027-02-30' }],
        'lignes.0.dateExpiration',
        'dateValide',
      ],
      [
        [
          { stockId, quantiteComptee: 1 },
          { stockId, quantiteComptee: 2 },
        ],
        'lignes.1.lotId',
        'lotUnique',
      ],
      [
        [{ stockId, numeroLot: 'INCONNU', quantiteComptee: 0 }],
        'lignes.0.quantiteComptee',
        'lotInconnuVide',
      ],
    ];
    for (const [lignes, champ, contrainte] of cas) {
      const e = await refus(inventorier(lignes));
      expect(e.statut).toBe(400);
      expect(e.corps.code).toBe('VALIDATION');
      expect(e.corps.champs).toEqual(
        expect.arrayContaining([{ champ, contraintes: [contrainte] }]),
      );
    }
  });

  it('ventes faites sans stock rattachées, lot final égal au comptage', async () => {
    const { stockId } = await nouvelleFiche({ tolerance: 10 });
    const lotId = lotDe(await recevoirBoites(stockId, 5));
    await vendre(stockId, 5);
    const v2 = await vendre(stockId, 2);
    expect(await soldeProduit(stockId)).toBe(-2);

    const r = await inventorier([{ stockId, lotId, quantiteComptee: 3 }]);
    expect(r.data.lignes[0]).toMatchObject({
      quantiteTheorique: -2,
      ecart: 5,
      sousTolerance: true,
    });
    const allocations = await allocationsDeVente(v2.data.id);
    expect(allocations).toHaveLength(2);
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          statut: 'REMPLACEE',
          quantite: 2,
          remplaceeParPieceId: r.data.id,
        }),
        expect.objectContaining({
          statut: 'DEFINITIVE',
          quantite: 2,
          lotId,
        }),
      ]),
    );
    expect(await soldeLot(lotId)).toBe(3);
    expect(await soldeProduit(stockId)).toBe(3);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineType" = 'RESOLUTION' AND "pieceOrigineId" = $1`,
        [r.data.id],
      ),
    ).toBe(2);
    expect(r.data.resolutions).toMatchObject([
      { quantiteResolue: 2, resteProvisoire: 0 },
    ]);
    expect(r.message.endsWith(MESSAGE_VENTES_RATTACHEES_INVENTAIRE)).toBe(true);
  });

  it('lot compté périmé : aucune vente rattachée (CA13)', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 2));
    await vendre(stockId, 2);
    const v2 = await vendre(stockId, 2);
    await receptions.corrigerDateLot(
      PHARMACIE,
      RESPONSABLE,
      lotId,
      { dateExpiration: jour(-3), motif: 'Date relue sur la boîte' },
      '127.0.0.1',
    );

    const r = await inventorier([{ stockId, lotId, quantiteComptee: 4 }]);
    const allocations = await allocationsDeVente(v2.data.id);
    expect(allocations.map((a) => a.statut)).toEqual(['PROVISOIRE']);
    expect(await soldeLot(lotId)).toBe(4);
    expect(r.data.resolutions).toEqual([]);
  });

  it('vente annulée jamais rattachée (D548)', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 1));
    await vendre(stockId, 1);
    const v2 = await vendre(stockId, 2);
    await annuler(v2.data.id);
    const lire = async () =>
      (
        await sql(
          `SELECT a."id", a."statut"::text AS "statut", a."remplaceeParPieceId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."stockMedicamentId" = $1 ORDER BY a."id"`,
          [stockId],
        )
      ).rows;
    const avant = await lire();

    const r = await inventorier([{ stockId, lotId, quantiteComptee: 3 }]);
    expect(await lire()).toEqual(avant);
    expect(avant.some((a) => a.statut === 'PROVISOIRE')).toBe(true);
    expect(await soldeLot(lotId)).toBe(3);
    expect(r.data.resolutions).toEqual([]);
  });

  it('fiche archivée désarchivée si une quantité est comptée', async () => {
    const compte = await nouvelleFiche();
    await recevoirBoites(compte.stockId, 5);
    const vide = await nouvelleFiche();
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = ANY($1)`,
      [[compte.stockId, vide.stockId]],
    );

    await inventorier([
      { stockId: compte.stockId, quantiteComptee: 2 },
      { stockId: vide.stockId, quantiteComptee: 0 },
    ]);
    const archives = Object.fromEntries(
      (
        await sql(
          `SELECT "id", "archiveLe" FROM "StockMedicament" WHERE "id" = ANY($1)`,
          [[compte.stockId, vide.stockId]],
        )
      ).rows.map((r) => [String(r.id), r.archiveLe]),
    );
    expect(archives[compte.stockId]).toBeNull();
    expect(archives[vide.stockId]).not.toBeNull();
    expect(
      await compter(
        `SELECT count(*) AS n FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'StockMedicament' AND "entityId" = $1`,
        [compte.stockId],
      ),
    ).toBe(1);
  });

  it('idempotence', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoirBoites(stockId, 5);
    const id = randomUUID();
    const lignes = [{ stockId, quantiteComptee: 4 }];
    const avant = await compterInventaires();
    const premier = await inventorier(lignes, VENDEUR, { id });
    const second = await inventorier(lignes, VENDEUR, { id });
    expect(premier.data.cree).toBe(true);
    expect(second.data.cree).toBe(false);
    expect(second.message).toBe(MESSAGE_INVENTAIRE_REJOUE);
    expect(await compterInventaires()).toBe(avant + 1);

    const autre = await refus(
      inventorier(lignes, RESPONSABLE_AUTRE, { id }, AUTRE_PHARMACIE),
    );
    expect(autre.statut).toBe(409);
    expect(autre.corps.code).toBe('IDENTIFIANT_DEJA_UTILISE');
    expect(autre.corps.message).toBe(MESSAGE_IDENTIFIANT_INVENTAIRE);
  });

  it('mode rejeterLignes : lignes refusées écartées, les autres écrites', async () => {
    const deuxLots = await nouvelleFiche();
    await recevoirBoites(deuxLots.stockId, 10, { dans: 300 });
    await recevoirBoites(deuxLots.stockId, 10, { dans: 200 });
    const unLot = await nouvelleFiche();
    const lot = lotDe(await recevoirBoites(unLot.stockId, 10));
    const acces = await new AccesPharmacieService(prisma).verifier(
      PHARMACIE,
      VENDEUR,
    );
    const ligne = (
      stockId: string,
      quantiteComptee: number,
    ): LigneInventaireAEnregistrer => ({
      stockId,
      lotId: null,
      numeroLot: null,
      dateExpiration: null,
      sansPeremption: false,
      quantiteComptee,
      nombreBoites: null,
      unitesEnPlus: null,
    });

    const ecrit = await prisma.$transaction((tx) =>
      inventaires.enregistrerDansTransaction(
        tx,
        acces,
        {
          commentaire: null,
          lignes: [
            ligne(deuxLots.stockId, 5),
            ligne(unLot.stockId, 7),
            ligne('stk-inconnu', 1),
          ],
        },
        null,
        { rejeterLignes: true },
      ),
    );
    expect(ecrit.refusees).toMatchObject([
      { index: 0, code: 'LOT_REQUIS' },
      { index: 2, code: 'STOCK_INTROUVABLE' },
    ]);
    expect(ecrit.lignes).toHaveLength(1);
    expect(ecrit.lignes[0]).toMatchObject({ index: 1, quantiteComptee: 7 });
    expect(await soldeLot(lot)).toBe(7);

    const avant = await compterInventaires();
    const rien = await prisma.$transaction((tx) =>
      inventaires.enregistrerDansTransaction(
        tx,
        acces,
        { commentaire: null, lignes: [ligne(deuxLots.stockId, 5)] },
        null,
        { rejeterLignes: true },
      ),
    );
    expect(rien.inventaireId).toBeNull();
    expect(await compterInventaires()).toBe(avant);
  });

  it('mode rejeterLignes : une ligne refusée ne désarchive pas sa fiche', async () => {
    const refusee = await nouvelleFiche();
    await recevoirBoites(refusee.stockId, 10, { dans: 300 });
    await recevoirBoites(refusee.stockId, 10, { dans: 200 });
    const retenue = await nouvelleFiche();
    await recevoirBoites(retenue.stockId, 10);
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = ANY($1)`,
      [[refusee.stockId, retenue.stockId]],
    );
    const acces = await new AccesPharmacieService(prisma).verifier(
      PHARMACIE,
      VENDEUR,
    );
    const ligne = (stockId: string): LigneInventaireAEnregistrer => ({
      stockId,
      lotId: null,
      numeroLot: null,
      dateExpiration: null,
      sansPeremption: false,
      quantiteComptee: 5,
      nombreBoites: null,
      unitesEnPlus: null,
    });

    const ecrit = await prisma.$transaction((tx) =>
      inventaires.enregistrerDansTransaction(
        tx,
        acces,
        {
          commentaire: null,
          lignes: [ligne(refusee.stockId), ligne(retenue.stockId)],
        },
        null,
        { rejeterLignes: true },
      ),
    );
    expect(ecrit.refusees).toMatchObject([{ index: 0, code: 'LOT_REQUIS' }]);
    const archives = Object.fromEntries(
      (
        await sql(
          `SELECT "id", "archiveLe" FROM "StockMedicament" WHERE "id" = ANY($1)`,
          [[refusee.stockId, retenue.stockId]],
        )
      ).rows.map((r) => [String(r.id), r.archiveLe]),
    );
    expect(archives[refusee.stockId]).not.toBeNull();
    expect(archives[retenue.stockId]).toBeNull();
    expect(
      await compter(
        `SELECT count(*) AS n FROM "AuditLog" WHERE "action" = 'update' AND "entityType" = 'StockMedicament' AND "entityId" = $1`,
        [refusee.stockId],
      ),
    ).toBe(0);
  });

  it('simulation sans écriture', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoirBoites(stockId, 10);
    const inventairesAvant = await compterInventaires();
    const mouvementsAvant = await compterMouvements();
    const lotsAvant = await compter('SELECT count(*) AS n FROM "LotStock"');

    const s = await inventaires.simuler(
      prisma,
      PHARMACIE,
      [
        {
          stockId,
          lotId: null,
          numeroLot: null,
          dateExpiration: null,
          sansPeremption: false,
          quantiteComptee: 8,
          nombreBoites: null,
          unitesEnPlus: null,
        },
      ],
      jour(0),
    );
    expect(s.refusees).toEqual([]);
    expect(s.lignes[0]).toMatchObject({
      soldeAvant: 10,
      quantiteTheorique: 10,
      ecart: -2,
    });
    expect(await compterInventaires()).toBe(inventairesAvant);
    expect(await compterMouvements()).toBe(mouvementsAvant);
    expect(await compter('SELECT count(*) AS n FROM "LotStock"')).toBe(
      lotsAvant,
    );
  });

  it('lecture : détail et liste, aucune donnée de coût', async () => {
    const { stockId } = await nouvelleFiche({ tolerance: 0 });
    const lotA = lotDe(
      await recevoirBoites(stockId, 10, { dans: 300, cout: 5000 }),
    );
    const lotB = lotDe(
      await recevoirBoites(stockId, 10, { dans: 200, cout: 6000 }),
    );
    const r = await inventorier(
      [
        { stockId, lotId: lotA, quantiteComptee: 9 },
        { stockId, lotId: lotB, quantiteComptee: 10 },
      ],
      VENDEUR,
      { commentaire: 'Comptage du soir' },
    );

    const detail = (await inventaires.detail(
      PHARMACIE,
      VENDEUR,
      r.data.id,
    )) as unknown as InventaireRep;
    expect(detail.data.auteur.nom).toBe('Mamadou Diallo');
    expect(detail.data.lignes.map((l) => l.lotId)).toEqual([lotB, lotA]);
    expect(detail.data.anomalies).toHaveLength(1);
    expect(detail.data.anomalies[0]).toMatchObject({ stockId, ecart: -1 });

    const liste = (await inventaires.lister(
      PHARMACIE,
      VENDEUR,
      {},
    )) as unknown as ListeInventairesRep;
    const ligne = liste.data.inventaires.find((i) => i.id === r.data.id);
    expect(ligne).toMatchObject({
      nombreLignes: 2,
      nombreEcarts: 1,
      nombreAnomalies: 1,
    });
    expect(cheminsCout(detail.data)).toEqual([]);
    expect(cheminsCout(liste.data)).toEqual([]);

    const autre = await refus(
      inventaires.detail(AUTRE_PHARMACIE, RESPONSABLE_AUTRE, r.data.id),
    );
    expect(autre.statut).toBe(404);
    expect(autre.corps.message).toBe(MESSAGE_INVENTAIRE_INTROUVABLE);
  });

  it("concurrence : vente en attente puis inventaire, l'inventaire compte la vente", async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 10));
    const { tenu, liberer, fin } = tenirFiche(stockId);
    let vente: Promise<VenteRep> | undefined;
    let inventaire: Promise<InventaireRep> | undefined;
    try {
      await tenu;
      vente = vendre(stockId, 2);
      await attendreAttentes(1);
      inventaire = inventorier([{ stockId, quantiteComptee: 7 }]);
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [v, i] = await Promise.all([vente, inventaire]);
    expect(v?.data.id).toBeDefined();
    expect(i?.data.lignes[0]).toMatchObject({
      quantiteTheorique: 8,
      ecart: -1,
    });
    expect(await soldeLot(lotId)).toBe(7);
  });

  it('concurrence : inventaire en attente puis vente, la vente part du stock compté', async () => {
    const { stockId } = await nouvelleFiche();
    const lotId = lotDe(await recevoirBoites(stockId, 10));
    const { tenu, liberer, fin } = tenirFiche(stockId);
    let vente: Promise<VenteRep> | undefined;
    let inventaire: Promise<InventaireRep> | undefined;
    try {
      await tenu;
      inventaire = inventorier([{ stockId, quantiteComptee: 7 }]);
      await attendreAttentes(1);
      vente = vendre(stockId, 2);
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [i, v] = await Promise.all([inventaire, vente]);
    expect(v?.data.id).toBeDefined();
    expect(i?.data.lignes[0]).toMatchObject({
      quantiteTheorique: 10,
      ecart: -3,
    });
    expect(await soldeLot(lotId)).toBe(5);
  });

  it('concurrence : réception et inventaire simultanés, sans interblocage', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoirBoites(stockId, 10);
    const { tenu, liberer, fin } = tenirFiche(stockId);
    let reception: Promise<ReceptionRep> | undefined;
    let inventaire: Promise<InventaireRep> | undefined;
    try {
      await tenu;
      reception = recevoirBoites(stockId, 5);
      await attendreAttentes(1);
      inventaire = inventorier([
        {
          stockId,
          numeroLot: 'NOUVEAU1',
          dateExpiration: jour(100),
          quantiteComptee: 3,
        },
      ]);
      await attendreVerrouLigne();
    } finally {
      liberer();
      await fin;
    }
    const resultats = await Promise.allSettled([reception, inventaire]);
    expect(resultats.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
