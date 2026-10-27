import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { FicheProduitService } from 'src/pharmacie/fiche-produit.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import {
  MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION,
  MESSAGE_FICHE_INTROUVABLE,
  MESSAGE_FICHE_NON_QUALIFIEE,
  MESSAGE_FOURNISSEUR_EXISTANT,
  MESSAGE_FOURNISSEUR_INTROUVABLE,
  MESSAGE_IDENTIFIANT_RECEPTION,
  MESSAGE_LOT_INTROUVABLE,
  MESSAGE_QUANTITE_RECUE_REQUISE,
  MESSAGE_QUANTITE_RECUE_TROP_GRANDE,
  MESSAGE_RECEPTION_INTROUVABLE,
  MESSAGE_RECEPTION_REJOUEE,
  MESSAGE_STOCK_INTROUVABLE_RECEPTION,
  messageReceptionEnregistree,
  ReceptionsService,
  type ElementLot,
} from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
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
  nom: string;
  numeroLot: string | null;
  dateExpiration: string | null;
  quantiteRecue: number;
  coefficientReception: number;
  solde: number;
  coutAchatBoite: number | null;
  coutUnitaire: number;
}
interface ReceptionRep {
  data: {
    id: string;
    cree: boolean;
    fournisseur: { id: string; nom: string } | null;
    lots: LotRep[];
    avertissements: unknown[];
  };
  message: string;
  success: boolean;
}
interface ListeRep {
  data: {
    receptions: { id: string }[];
    page: number;
    parPage: number;
    total: number;
  };
}
interface LigneVenteRep {
  quantite: number;
}
interface VenteRep {
  data: { id: string; lignes: LigneVenteRep[] };
}
interface FournisseurRep {
  data: { id: string; nom: string; cree: boolean };
}
interface LotsRep {
  data: ElementLot[];
  message: string;
}
interface LotCorrigeRep {
  data: ElementLot;
  message: string;
}

const PHARMACIE = 'str-pharma-1';
const AUTRE_PHARMACIE = 'str-pharma-2';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const RESPONSABLE_AUTRE = 'usr-admin-p2';

describe('Réceptions, fournisseurs et lots, sur base de test (PB14a)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let fiches: FicheProduitService;
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
    fiches = new FicheProduitService(prisma, acces, mouvements);
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

  async function nouvelleFiche(
    o: {
      coef?: number;
      qualifie?: boolean;
      prixBoite?: number | null;
      structureId?: string;
    } = {},
  ): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit réception ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB14', false, now())`,
      [`med-recep-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, now())`,
      [
        `stk-recep-${n}`,
        `med-recep-${n}`,
        o.structureId ?? PHARMACIE,
        o.prixBoite === undefined ? 1000 : o.prixBoite,
        o.coef ?? 1,
        o.qualifie ?? true,
      ],
    );
    return { stockId: `stk-recep-${n}`, nom };
  }

  async function recevoir(
    dto: CreerReceptionDto,
    utilisateur = RESPONSABLE,
  ): Promise<ReceptionRep> {
    return (await receptions.enregistrer(
      PHARMACIE,
      utilisateur,
      dto,
      '127.0.0.1',
    )) as unknown as ReceptionRep;
  }

  async function vendre(dto: CreerVenteDto, utilisateur = VENDEUR) {
    return (await service.creerVente(
      PHARMACIE,
      utilisateur,
      dto,
      undefined,
      '127.0.0.1',
    )) as unknown as VenteRep;
  }

  /** Réception de N boîtes d'une fiche, date de péremption dans 300 jours. */
  const recevoirBoites = (stockId: string, nombreBoites: number) =>
    recevoir({
      lignes: [{ stockId, nombreBoites, dateExpiration: jour(300) }],
    });

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

  const nombreReceptions = () =>
    compter(
      'SELECT count(*) AS n FROM "Reception" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
  const nombreLots = () =>
    compter(
      'SELECT count(*) AS n FROM "LotStock" WHERE "pointDeVenteId" = $1',
      [pv1],
    );

  const audits = async (entityType: string, entityId: string) =>
    (
      await sql(
        `SELECT "action", "metadata" FROM "AuditLog" WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "createdAt", "id"`,
        [entityType, entityId],
      )
    ).rows;

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

  it('réception par boîtes : lot au coefficient de la fiche, coût par unité arrondi, mouvement RECEPTION', async () => {
    const { stockId } = await nouvelleFiche({ coef: 3 });
    const r = await recevoir({
      lignes: [
        {
          stockId,
          numeroLot: ' A123 ',
          nombreBoites: 2,
          coutAchatBoite: 1000,
          dateExpiration: jour(200),
        },
      ],
    });

    expect(r.data.cree).toBe(true);
    expect(r.message).toBe(messageReceptionEnregistree(1));
    expect(r.data.lots).toEqual([
      expect.objectContaining({
        stockId,
        numeroLot: 'A123',
        dateExpiration: jour(200),
        quantiteRecue: 6,
        coefficientReception: 3,
        solde: 6,
        coutAchatBoite: 1000,
        coutUnitaire: 333,
      }),
    ]);
    expect(r.data.avertissements).toEqual([]);

    const receptionId = r.data.id;
    const recep = await sql(
      'SELECT "auteurId", "recueLe" FROM "Reception" WHERE "id" = $1',
      [receptionId],
    );
    expect(recep.rows).toHaveLength(1);
    expect(recep.rows[0].auteurId).toBe(RESPONSABLE);

    const lots = await sql(
      'SELECT "receptionId", "lotTechnique", "dateReception" FROM "LotStock" WHERE "stockMedicamentId" = $1',
      [stockId],
    );
    expect(lots.rows).toHaveLength(1);
    expect(lots.rows[0].receptionId).toBe(receptionId);
    expect(lots.rows[0].lotTechnique).toBe(false);
    expect(lots.rows[0].dateReception).toEqual(recep.rows[0].recueLe);

    const mvts = await sql(
      `SELECT "type"::text AS "type", "quantite", "pieceOrigineType"::text AS "pieceOrigineType", "pieceOrigineId", "evenementId" FROM "MouvementStock" WHERE "stockMedicamentId" = $1`,
      [stockId],
    );
    expect(mvts.rows).toEqual([
      {
        type: 'RECEPTION',
        quantite: 6,
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: receptionId,
        evenementId: `reception:${receptionId}:0`,
      },
    ]);
    expect(await soldeProduit(stockId)).toBe(6);
    const colonne = await sql(
      'SELECT "quantite" FROM "StockMedicament" WHERE "id" = $1',
      [stockId],
    );
    expect(Number(colonne.rows[0].quantite)).toBe(0);

    const audit = await audits('Reception', receptionId);
    expect(audit).toEqual([
      {
        action: 'create',
        metadata: { nombreLignes: 1, fournisseurId: null, quantiteTotale: 6 },
      },
    ]);
  });

  it("réception en unités : quantité telle quelle, boîte entamée si elle n'est pas un multiple", async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    const r = await recevoir({
      lignes: [
        {
          stockId,
          quantiteUnites: 15,
          coutAchatBoite: 500,
          dateExpiration: jour(100),
        },
      ],
    });
    expect(r.data.lots[0]).toEqual(
      expect.objectContaining({ quantiteRecue: 15, coutUnitaire: 50 }),
    );
    const ouverts = await sql(
      'SELECT "unitesParConditionnement" FROM "ConditionnementOuvert" WHERE "lotId" = $1 AND "fermeLe" IS NULL',
      [r.data.lots[0].id],
    );
    expect(ouverts.rows).toEqual([{ unitesParConditionnement: 10 }]);
  });

  it('coût figé : changer la fiche ne change ni le lot ni le coût des ventes', async () => {
    const { stockId } = await nouvelleFiche({ coef: 3, prixBoite: 1500 });
    const r = await recevoir({
      lignes: [
        {
          stockId,
          nombreBoites: 2,
          coutAchatBoite: 1000,
          dateExpiration: jour(200),
        },
      ],
    });
    const lotId = r.data.lots[0].id;

    await fiches.modifierFiche(
      PHARMACIE,
      RESPONSABLE,
      stockId,
      { coefficientBoite: 4, prixUnitaire: 2000 },
      '127.0.0.1',
    );
    const lot = await sql(
      'SELECT "coefficientReception", "coutUnitaire" FROM "LotStock" WHERE "id" = $1',
      [lotId],
    );
    expect(lot.rows[0]).toEqual({ coefficientReception: 3, coutUnitaire: 333 });

    await vendre({ lignes: [{ stockId, quantite: 1 }] });
    const allocations = await sql(
      `SELECT a."statut"::text AS "statut", a."quantite", a."coutUnitaire" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."stockMedicamentId" = $1`,
      [stockId],
    );
    expect(allocations.rows).toEqual([
      { statut: 'DEFINITIVE', quantite: 4, coutUnitaire: 333 },
    ]);

    await expect(
      sql('UPDATE "LotStock" SET "coutUnitaire" = 1 WHERE "id" = $1', [lotId]),
    ).rejects.toThrow();
  });

  it('date de péremption obligatoire sauf sans péremption (A3), date passée refusée, rien n’est écrit', async () => {
    const a = await nouvelleFiche();
    const b = await nouvelleFiche();
    const receptionsAvant = await nombreReceptions();
    const lotsAvant = await nombreLots();

    const sansDate = await refus(
      recevoir({
        lignes: [
          { stockId: a.stockId, nombreBoites: 1, dateExpiration: jour(100) },
          { stockId: b.stockId, nombreBoites: 1 },
        ],
      }),
    );
    expect(sansDate.statut).toBe(400);
    expect(sansDate.corps.code).toBe('DATE_PEREMPTION_REQUISE');
    expect(sansDate.corps.message).toBe(
      MESSAGE_DATE_PEREMPTION_REQUISE_RECEPTION,
    );
    expect(sansDate.corps.details).toEqual([
      { stockId: b.stockId, nom: b.nom },
    ]);

    const passee = await refus(
      recevoir({
        lignes: [
          { stockId: a.stockId, nombreBoites: 1, dateExpiration: jour(-1) },
        ],
      }),
    );
    expect(passee.statut).toBe(400);
    expect(passee.corps.code).toBe('DATE_PEREMPTION_PASSEE');
    expect(passee.corps.details).toEqual([{ stockId: a.stockId, nom: a.nom }]);

    const invalide = await refus(
      recevoir({
        lignes: [
          { stockId: a.stockId, nombreBoites: 1, dateExpiration: '2027-02-30' },
        ],
      }),
    );
    expect(invalide.statut).toBe(400);
    expect(invalide.corps.code).toBe('VALIDATION');
    expect(invalide.corps.champs).toEqual([
      { champ: 'lignes.0.dateExpiration', contraintes: ['dateValide'] },
    ]);

    const quantites = await refus(
      recevoir({
        lignes: [
          { stockId: a.stockId, dateExpiration: jour(100) },
          {
            stockId: a.stockId,
            quantiteUnites: 1,
            nombreBoites: 1,
            dateExpiration: jour(100),
          },
        ],
      }),
    );
    expect(quantites.statut).toBe(400);
    expect(quantites.corps.code).toBe('VALIDATION');
    expect(quantites.corps.message).toBe(MESSAGE_QUANTITE_RECUE_REQUISE);
    expect(quantites.corps.champs).toEqual([
      { champ: 'lignes.0.nombreBoites', contraintes: ['quantiteRequise'] },
      { champ: 'lignes.1.nombreBoites', contraintes: ['quantiteUnique'] },
    ]);

    expect(await nombreReceptions()).toBe(receptionsAvant);
    expect(await nombreLots()).toBe(lotsAvant);

    const sansPeremption = await recevoir({
      lignes: [{ stockId: a.stockId, nombreBoites: 1, sansPeremption: true }],
    });
    expect(sansPeremption.data.lots[0].dateExpiration).toBeNull();
    const memeJour = await recevoir({
      lignes: [
        { stockId: b.stockId, nombreBoites: 1, dateExpiration: jour(0) },
      ],
    });
    expect(memeJour.data.lots[0].dateExpiration).toBe(jour(0));
  });

  it('fiche archivée désarchivée, fiche d’une autre pharmacie refusée', async () => {
    const { stockId } = await nouvelleFiche();
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = date_trunc('milliseconds', now()) WHERE "id" = $1`,
      [stockId],
    );
    const avant = (
      await sql('SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1', [
        stockId,
      ])
    ).rows[0].archiveLe as Date;

    await recevoirBoites(stockId, 1);
    const apres = await sql(
      'SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1',
      [stockId],
    );
    expect(apres.rows[0].archiveLe).toBeNull();
    const audit = await audits('StockMedicament', stockId);
    expect(audit).toContainEqual({
      action: 'update',
      metadata: {
        avant: { archiveLe: avant.toISOString() },
        apres: { archiveLe: null },
      },
    });

    const etrangere = await nouvelleFiche({ structureId: AUTRE_PHARMACIE });
    const e = await refus(recevoirBoites(etrangere.stockId, 1));
    expect(e.statut).toBe(404);
    expect(e.corps.code).toBe('STOCK_INTROUVABLE');
    expect(e.corps.message).toBe(MESSAGE_STOCK_INTROUVABLE_RECEPTION);
    expect(e.corps.details).toEqual([{ stockId: etrangere.stockId }]);
  });

  it('idempotence : même identifiant rejoué sans doublon, identifiant d’une autre pharmacie refusé', async () => {
    const { stockId } = await nouvelleFiche();
    const id = randomUUID();
    const dto: CreerReceptionDto = {
      id,
      lignes: [{ stockId, nombreBoites: 5, dateExpiration: jour(300) }],
    };
    const premiere = await recevoir(dto);
    const seconde = await recevoir(dto);
    expect(premiere.data.cree).toBe(true);
    expect(seconde.data.cree).toBe(false);
    expect(seconde.message).toBe(MESSAGE_RECEPTION_REJOUEE);
    expect(seconde.data.lots).toEqual(premiere.data.lots);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "LotStock" WHERE "stockMedicamentId" = $1',
        [stockId],
      ),
    ).toBe(1);
    expect(await soldeProduit(stockId)).toBe(5);

    const idCourse = randomUUID();
    const course: CreerReceptionDto = {
      id: idCourse,
      lignes: [{ stockId, nombreBoites: 3, dateExpiration: jour(300) }],
    };
    const resultats = await Promise.all([recevoir(course), recevoir(course)]);
    expect(resultats.map((x) => x.data.id)).toEqual([idCourse, idCourse]);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "LotStock" WHERE "receptionId" = $1',
        [idCourse],
      ),
    ).toBe(1);
    expect(await soldeProduit(stockId)).toBe(8);

    const etrangere = await nouvelleFiche({ structureId: AUTRE_PHARMACIE });
    const e = await refus(
      receptions.enregistrer(
        AUTRE_PHARMACIE,
        RESPONSABLE_AUTRE,
        {
          id,
          lignes: [
            {
              stockId: etrangere.stockId,
              nombreBoites: 1,
              dateExpiration: jour(300),
            },
          ],
        },
        '127.0.0.1',
      ),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('IDENTIFIANT_DEJA_UTILISE');
    expect(e.corps.message).toBe(MESSAGE_IDENTIFIANT_RECEPTION);
  });

  it('fournisseurs : création, doublon insensible à la casse, fournisseur d’une autre pharmacie refusé', async () => {
    const cree = (await receptions.creerFournisseur(
      PHARMACIE,
      RESPONSABLE,
      { nom: 'Sopharma', telephone: '+224 620 00 00 00' },
      '127.0.0.1',
    )) as unknown as FournisseurRep;
    expect(cree.data.cree).toBe(true);

    const doublon = await refus(
      receptions.creerFournisseur(
        PHARMACIE,
        RESPONSABLE,
        { nom: 'SOPHARMA' },
        '127.0.0.1',
      ),
    );
    expect(doublon.statut).toBe(409);
    expect(doublon.corps.code).toBe('FOURNISSEUR_EXISTANT');
    expect(doublon.corps.message).toBe(MESSAGE_FOURNISSEUR_EXISTANT);

    const liste = (await receptions.listerFournisseurs(
      PHARMACIE,
      RESPONSABLE,
    )) as unknown as { data: unknown[] };
    expect(liste.data).toHaveLength(1);

    const { stockId } = await nouvelleFiche();
    const r = await recevoir({
      fournisseurId: cree.data.id,
      lignes: [{ stockId, nombreBoites: 1, dateExpiration: jour(300) }],
    });
    expect(r.data.fournisseur).toEqual({ id: cree.data.id, nom: 'Sopharma' });
    const lot = await sql(
      'SELECT "fournisseurId" FROM "LotStock" WHERE "id" = $1',
      [r.data.lots[0].id],
    );
    expect(lot.rows[0].fournisseurId).toBe(cree.data.id);

    await sql(
      `INSERT INTO "Fournisseur" ("id", "structureId", "nom") VALUES ('four-autre', $1, 'Autre fournisseur')`,
      [AUTRE_PHARMACIE],
    );
    const e = await refus(
      recevoir({
        fournisseurId: 'four-autre',
        lignes: [{ stockId, nombreBoites: 1, dateExpiration: jour(300) }],
      }),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_FOURNISSEUR_INTROUVABLE);
  });

  it('lectures : liste paginée, détail, coûts masqués sans marge:read, avertissement fiche non qualifiée', async () => {
    const { stockId, nom } = await nouvelleFiche({ qualifie: false });
    const r = await recevoir({
      lignes: [
        {
          stockId,
          nombreBoites: 2,
          coutAchatBoite: 800,
          dateExpiration: jour(300),
        },
      ],
    });
    expect(r.data.avertissements).toEqual([
      {
        code: 'FICHE_NON_QUALIFIEE',
        stockId,
        nom,
        message: MESSAGE_FICHE_NON_QUALIFIEE,
      },
    ]);

    const liste = (await receptions.lister(
      PHARMACIE,
      RESPONSABLE,
      {},
    )) as unknown as ListeRep;
    expect(liste.data.parPage).toBe(20);
    expect(liste.data.total).toBe(await nombreReceptions());
    const plusRecente = await sql(
      'SELECT "id" FROM "Reception" WHERE "pointDeVenteId" = $1 ORDER BY "recueLe" DESC, "createdAt" DESC, "id" DESC LIMIT 1',
      [pv1],
    );
    expect(liste.data.receptions[0].id).toBe(plusRecente.rows[0].id);

    const sansMarge = (await receptions.detail(
      PHARMACIE,
      VENDEUR,
      r.data.id,
    )) as unknown as ReceptionRep;
    expect(cheminsCout(sansMarge.data)).toEqual([]);
    const avecMarge = (await receptions.detail(
      PHARMACIE,
      RESPONSABLE,
      r.data.id,
    )) as unknown as ReceptionRep;
    expect(avecMarge.data.lots[0].coutUnitaire).toBe(800);

    const inconnue = await refus(
      receptions.detail(PHARMACIE, RESPONSABLE, 'inconnue'),
    );
    expect(inconnue.statut).toBe(404);
    expect(inconnue.corps.message).toBe(MESSAGE_RECEPTION_INTROUVABLE);
  });

  it("lots d'une fiche : ordre FEFO, reliquat, périmé, coût masqué", async () => {
    const { stockId } = await nouvelleFiche({ coef: 10 });
    const r = await recevoir({
      lignes: [
        {
          stockId,
          numeroLot: 'B',
          quantiteUnites: 20,
          dateExpiration: jour(300),
        },
        {
          stockId,
          numeroLot: 'A',
          quantiteUnites: 15,
          dateExpiration: jour(100),
        },
        {
          stockId,
          numeroLot: 'C',
          quantiteUnites: 10,
          dateExpiration: jour(50),
        },
      ],
    });
    const lotC = r.data.lots.find((l) => l.numeroLot === 'C');
    await sql('UPDATE "LotStock" SET "dateExpiration" = $1 WHERE "id" = $2', [
      jour(-1),
      lotC?.id,
    ]);

    const lots = (await receptions.listerLots(
      PHARMACIE,
      RESPONSABLE,
      stockId,
    )) as unknown as LotsRep;
    expect(lots.data.map((l) => l.numeroLot)).toEqual(['C', 'A', 'B']);
    expect(lots.data[0].perime).toBe(true);
    expect(lots.data[1].reliquat).toBe(5);
    expect(lots.data[2].reliquat).toBe(0);

    const sansMarge = (await receptions.listerLots(
      PHARMACIE,
      VENDEUR,
      stockId,
    )) as unknown as LotsRep;
    expect(cheminsCout(sansMarge.data)).toEqual([]);

    const archivee = await nouvelleFiche();
    await sql(
      'UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1',
      [archivee.stockId],
    );
    const e = await refus(
      receptions.listerLots(PHARMACIE, RESPONSABLE, archivee.stockId),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_FICHE_INTROUVABLE);
  });

  it("correction de date d'un lot : motif obligatoire, audit, rejeu sans écriture, lot d'une autre pharmacie introuvable", async () => {
    const { stockId } = await nouvelleFiche();
    const r = await recevoir({
      lignes: [{ stockId, nombreBoites: 3, dateExpiration: jour(200) }],
    });
    const lotId = r.data.lots[0].id;
    const corriger = (
      dto: Parameters<ReceptionsService['corrigerDateLot']>[3],
    ) =>
      receptions.corrigerDateLot(
        PHARMACIE,
        RESPONSABLE,
        lotId,
        dto,
        '127.0.0.1',
      ) as unknown as Promise<LotCorrigeRep>;

    const sansMotif = await refus(corriger({ dateExpiration: jour(400) }));
    expect(sansMotif.statut).toBe(400);
    expect(sansMotif.corps.code).toBe('MOTIF_REQUIS');

    const sansDate = await refus(corriger({ motif: 'Erreur de saisie' }));
    expect(sansDate.statut).toBe(400);
    expect(sansDate.corps.code).toBe('DATE_PEREMPTION_REQUISE');

    const ok = await corriger({
      dateExpiration: jour(400),
      motif: 'Erreur de saisie',
    });
    expect(ok.message).toBe('Date de péremption du lot corrigée.');
    expect(ok.data.dateExpiration).toBe(jour(400));
    const apresCorrection = await audits('LotStock', lotId);
    expect(apresCorrection).toEqual([
      {
        action: 'update',
        metadata: {
          avant: { dateExpiration: jour(200) },
          apres: { dateExpiration: jour(400) },
          motif: 'Erreur de saisie',
        },
      },
    ]);

    const rejeu = await corriger({
      dateExpiration: jour(400),
      motif: 'Erreur de saisie',
    });
    expect(rejeu.message).toBe('Aucune modification du lot.');
    expect(await audits('LotStock', lotId)).toHaveLength(1);

    const sans = await corriger({
      sansPeremption: true,
      motif: 'Produit sans date',
    });
    expect(sans.data.dateExpiration).toBeNull();

    const etrangere = await nouvelleFiche({ structureId: AUTRE_PHARMACIE });
    const recueAilleurs = (await receptions.enregistrer(
      AUTRE_PHARMACIE,
      RESPONSABLE_AUTRE,
      {
        lignes: [
          {
            stockId: etrangere.stockId,
            nombreBoites: 1,
            dateExpiration: jour(300),
          },
        ],
      },
      '127.0.0.1',
    )) as unknown as ReceptionRep;
    const e = await refus(
      receptions.corrigerDateLot(
        PHARMACIE,
        RESPONSABLE,
        recueAilleurs.data.lots[0].id,
        { dateExpiration: jour(400), motif: 'Erreur de saisie' },
        '127.0.0.1',
      ),
    );
    expect(e.statut).toBe(404);
    expect(e.corps.message).toBe(MESSAGE_LOT_INTROUVABLE);
  });

  it('concurrence : vente en attente puis réception, aucun interblocage', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const initiale = await recevoirBoites(stockId, 12);
    const l1 = initiale.data.lots[0].id;
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let vente: Promise<VenteRep> | undefined;
    let reception: Promise<ReceptionRep> | undefined;
    try {
      await tenu;
      vente = vendre({ lignes: [{ stockId, quantite: 2 }] });
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
    expect(await soldeLot(l1)).toBe(10);
    expect(await soldeProduit(stockId)).toBe(20);
  });

  it('concurrence : réception en attente puis vente, la vente prend le stock reçu', async () => {
    const { stockId } = await nouvelleFiche({ prixBoite: 1000 });
    const { tenu, liberer, fin } = tenirFiche(stockId);

    let reception: Promise<ReceptionRep> | undefined;
    let vente: Promise<VenteRep> | undefined;
    try {
      await tenu;
      reception = recevoirBoites(stockId, 10);
      await attendreAttentes(1);
      vente = vendre({ lignes: [{ stockId, quantite: 2 }] });
      await attendreAttentes(2);
    } finally {
      liberer();
      await fin;
    }
    const [r, v] = await Promise.allSettled([reception, vente]);

    expect(r.status).toBe('fulfilled');
    expect(v.status).toBe('fulfilled');
    if (r.status === 'fulfilled' && v.status === 'fulfilled') {
      const allocations = await sql(
        `SELECT a."statut"::text AS "statut", a."quantite", a."lotId" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1`,
        [v.value.data.id],
      );
      expect(allocations.rows.filter((a) => a.statut === 'PROVISOIRE')).toEqual(
        [],
      );
      expect(allocations.rows).toEqual([
        { statut: 'DEFINITIVE', quantite: 2, lotId: r.value.data.lots[0].id },
      ]);
    }
    expect(await soldeProduit(stockId)).toBe(8);
  });

  it('quantité maximale : la somme reçue ne peut pas dépasser la borne entière', async () => {
    const { stockId } = await nouvelleFiche();
    await recevoir({
      lignes: [{ stockId, quantiteUnites: 2147483000, sansPeremption: true }],
    });
    const lotsAvant = await nombreLots();

    const e = await refus(
      recevoir({
        lignes: [{ stockId, nombreBoites: 1000, sansPeremption: true }],
      }),
    );
    expect(e.statut).toBe(400);
    expect(e.corps.code).toBe('VALIDATION');
    expect(e.corps.message).toBe(MESSAGE_QUANTITE_RECUE_TROP_GRANDE);
    expect(e.corps.champs).toEqual([
      { champ: 'lignes.0.nombreBoites', contraintes: ['quantiteMaximale'] },
    ]);
    expect(await nombreLots()).toBe(lotsAvant);
  });

  it('invariants', async () => {
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });
});
