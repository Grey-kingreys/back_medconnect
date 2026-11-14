import { randomUUID } from 'node:crypto';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { MESSAGES_REJET } from 'src/pharmacie/synchro/rejeu-regles';
import {
  SynchroService,
  type ResultatEvenement,
} from 'src/pharmacie/synchro/synchro.service';
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

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

describe('Synchro desktop : sortie de stock et correction de quantité hors ligne, sur base de test', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let receptions: ReceptionsService;
  let D: string;
  let sequence = 0;
  let compteurFiche = 0;

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
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: (id: string) =>
        Promise.resolve(
          id === RESPONSABLE
            ? [
                'caisse:utiliser',
                'caisse:superviser',
                'stock:write',
                'reception:write',
              ]
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    synchro = new SynchroService(
      prisma,
      acces,
      mouvements,
      sessions,
      permissions,
    );
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    D = (
      await new PointsDeVenteService(prisma, acces).enregistrerPoste(
        PHARMACIE,
        RESPONSABLE,
        { type: 'DESKTOP', appareilId: 'desktop-stock-hors-ligne' },
      )
    ).data.id;
  });

  afterAll(async () => {
    try {
      if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  /** Fiche reçue avec un lot de `boites` boîtes (coefficient 1 : une boîte = une unité). */
  async function ficheAvecLot(boites: number) {
    compteurFiche += 1;
    const n = compteurFiche;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test stock hors ligne', false, now())`,
      [`med-hl-${n}`, `Produit hors ligne ${n}`],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, 1, true, now())`,
      [`stk-hl-${n}`, `med-hl-${n}`, PHARMACIE],
    );
    const stockId = `stk-hl-${n}`;
    const r = (await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        lignes: [
          {
            stockId,
            nombreBoites: boites,
            dateExpiration: new Date(Date.now() + 300 * 86_400_000)
              .toISOString()
              .slice(0, 10),
          },
        ],
      },
      '127.0.0.1',
    )) as unknown as { data: { lots: { id: string }[] } };
    return { stockId, lotId: r.data.lots[0].id };
  }

  async function envoyer(
    type: string,
    corps: Record<string, unknown>,
    o: {
      utilisateurId?: string;
      evenementId?: string;
      sequence?: number;
      horodatage?: string;
    } = {},
  ): Promise<ResultatEvenement> {
    const numero = o.sequence ?? ++sequence;
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D,
        etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
        evenements: [
          {
            evenementId: o.evenementId ?? randomUUID(),
            sequence: numero,
            type,
            horodatageLocal: o.horodatage ?? new Date().toISOString(),
            utilisateurId: o.utilisateurId ?? RESPONSABLE,
            corps,
          },
        ],
      },
      '127.0.0.1',
    );
    return r.data.resultats[0];
  }

  async function soldeLot(lotId: string): Promise<number> {
    const r = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return r.rows.length === 0 ? 0 : Number(r.rows[0].quantite);
  }
  async function soldeProduit(stockId: string): Promise<number> {
    const r = await sql(
      'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1',
      [stockId],
    );
    return r.rows.length === 0 ? 0 : Number(r.rows[0].quantite);
  }
  async function anomalies(type: string, pieceId: string): Promise<number> {
    const r = await sql(
      `SELECT count(*)::int AS n FROM "Anomalie" WHERE "type"::text = $1 AND "pieceId" = $2`,
      [type, pieceId],
    );
    return Number(r.rows[0].n);
  }

  const sortie = (
    f: { stockId: string; lotId: string },
    quantite: number,
    plus: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    stockId: f.stockId,
    lotId: f.lotId,
    unite: 'UNITE',
    quantite,
    raison: 'CASSE',
    commentaire: '',
    ...plus,
  });

  describe('SORTIE_STOCK', () => {
    it('est appliquée sur le lot, idempotente, sans anomalie', async () => {
      const f = await ficheAvecLot(10);
      const corps = sortie(f, 4);
      const r = await envoyer('SORTIE_STOCK', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'SORTIE_STOCK', id: corps.id });
      expect(await soldeLot(f.lotId)).toBe(6);
      expect(await anomalies('STOCK_NEGATIF', corps.id)).toBe(0);

      // Même sortie sous un autre événement : une seule écriture
      const rejeu = await envoyer('SORTIE_STOCK', corps);
      expect(rejeu.statut).toBe('APPLIQUE');
      expect(rejeu.code).toBe('SORTIE_DEJA_ENREGISTREE');
      expect(await soldeLot(f.lotId)).toBe(6);

      // Même événement renvoyé : DEJA_APPLIQUE
      const evenementId = randomUUID();
      const seq = ++sequence;
      const autre = sortie(f, 1);
      const horodatage = new Date().toISOString();
      const options = { evenementId, sequence: seq, horodatage };
      await envoyer('SORTIE_STOCK', autre, options);
      const encore = await envoyer('SORTIE_STOCK', autre, options);
      expect(encore.statut).toBe('DEJA_APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(5);
    });

    it('stock insuffisant : la part couverte sort du lot, le reste est provisoire avec anomalie STOCK_NEGATIF', async () => {
      const f = await ficheAvecLot(3);
      const corps = sortie(f, 5);
      const r = await envoyer('SORTIE_STOCK', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.anomalies?.[0].type).toBe('STOCK_NEGATIF');
      expect(await soldeLot(f.lotId)).toBe(0);
      expect(await soldeProduit(f.stockId)).toBe(-2);
      expect(await anomalies('STOCK_NEGATIF', corps.id)).toBe(1);
      const detail = await sql(
        `SELECT "pieceType", "details"->>'message' AS message FROM "Anomalie" WHERE "pieceId" = $1`,
        [corps.id],
      );
      expect(detail.rows[0].pieceType).toBe('SORTIE_MANUELLE');
      expect(detail.rows[0].message).toContain(
        'Cette sortie faite hors ligne dépasse le stock restant du lot',
      );
      expect(detail.rows[0].message).toContain(
        '2 unité(s) sont sorties sans lot',
      );
      expect(detail.rows[0].message).toContain('Faites un inventaire');
      expect(detail.rows[0].message).not.toContain('réception');
      const mouvements = await sql(
        `SELECT "lotId", "quantite" FROM "MouvementStock" WHERE "pieceOrigineId" = $1 ORDER BY "quantite"`,
        [corps.id],
      );
      expect(mouvements.rows).toEqual([
        { lotId: f.lotId, quantite: -3 },
        { lotId: null, quantite: -2 },
      ]);
    });

    it('lot disparu : sortie entièrement provisoire sans lot, anomalie', async () => {
      const f = await ficheAvecLot(2);
      const corps = sortie(f, 3, { lotId: randomUUID() });
      const r = await envoyer('SORTIE_STOCK', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(2);
      expect(await soldeProduit(f.stockId)).toBe(-1);
      expect(await anomalies('STOCK_NEGATIF', corps.id)).toBe(1);
    });

    it('fiche inconnue : rejet STOCK_INTROUVABLE', async () => {
      const r = await envoyer('SORTIE_STOCK', {
        ...sortie({ stockId: 'inconnu', lotId: 'x' }, 1),
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('STOCK_INTROUVABLE');
    });

    it('raison absente : rejet MOTIF_REQUIS, rien d écrit', async () => {
      const f = await ficheAvecLot(4);
      const corps = sortie(f, 1);
      delete (corps as { raison?: string }).raison;
      const r = await envoyer('SORTIE_STOCK', corps);
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('MOTIF_REQUIS');
      expect(await soldeLot(f.lotId)).toBe(4);
    });

    it('utilisateur sans stock:write : rejet PERMISSION_INSUFFISANTE', async () => {
      const f = await ficheAvecLot(4);
      const r = await envoyer('SORTIE_STOCK', sortie(f, 1), {
        utilisateurId: VENDEUR,
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('PERMISSION_INSUFFISANTE');
      expect(r.message).toBe(MESSAGES_REJET.PERMISSION_INSUFFISANTE);
      expect(await soldeLot(f.lotId)).toBe(4);
    });
  });

  describe('CORRECTION_QUANTITE', () => {
    const correction = (
      f: { stockId: string; lotId: string },
      variation: number,
      plus: Record<string, unknown> = {},
    ) => ({
      id: randomUUID(),
      stockId: f.stockId,
      lotId: f.lotId,
      variation,
      motif: 'Comptage au rangement',
      notes: '',
      ...plus,
    });

    it('positive et négative appliquées, idempotentes', async () => {
      const f = await ficheAvecLot(10);
      const plus = correction(f, 5);
      expect((await envoyer('CORRECTION_QUANTITE', plus)).statut).toBe(
        'APPLIQUE',
      );
      expect(await soldeLot(f.lotId)).toBe(15);
      const moins = correction(f, -3);
      await envoyer('CORRECTION_QUANTITE', moins);
      expect(await soldeLot(f.lotId)).toBe(12);
      const rejeu = await envoyer('CORRECTION_QUANTITE', moins);
      expect(rejeu.code).toBe('CORRECTION_DEJA_ENREGISTREE');
      expect(await soldeLot(f.lotId)).toBe(12);
    });

    it('variation négative au-delà du lot : provisoire et anomalie STOCK_NEGATIF', async () => {
      const f = await ficheAvecLot(2);
      const corps = correction(f, -5);
      const r = await envoyer('CORRECTION_QUANTITE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(0);
      expect(await soldeProduit(f.stockId)).toBe(-3);
      expect(await anomalies('STOCK_NEGATIF', corps.id)).toBe(1);
      const detail = await sql(
        `SELECT "pieceType", "details"->>'message' AS message FROM "Anomalie" WHERE "pieceId" = $1`,
        [corps.id],
      );
      expect(detail.rows[0].pieceType).toBe('CORRECTION');
      expect(detail.rows[0].message).toContain(
        'Cette correction faite hors ligne dépasse le stock restant du lot',
      );
      expect(detail.rows[0].message).toContain(
        '3 unité(s) sont retirées sans lot',
      );
    });

    it('motif absent : rejet MOTIF_REQUIS ; permission retirée : PERMISSION_INSUFFISANTE ; fiche inconnue : STOCK_INTROUVABLE', async () => {
      const f = await ficheAvecLot(2);
      const sansMotif = await envoyer(
        'CORRECTION_QUANTITE',
        correction(f, 1, { motif: 'a' }),
      );
      expect(sansMotif.code).toBe('MOTIF_REQUIS');
      const interdit = await envoyer('CORRECTION_QUANTITE', correction(f, 1), {
        utilisateurId: VENDEUR,
      });
      expect(interdit.code).toBe('PERMISSION_INSUFFISANTE');
      const inconnue = await envoyer(
        'CORRECTION_QUANTITE',
        correction({ stockId: 'inconnu', lotId: 'x' }, 1),
      );
      expect(inconnue.code).toBe('STOCK_INTROUVABLE');
      expect(await soldeLot(f.lotId)).toBe(2);
    });

    it('positive sur un lot disparu : rejet LOT_INTROUVABLE', async () => {
      const f = await ficheAvecLot(2);
      const r = await envoyer(
        'CORRECTION_QUANTITE',
        correction(f, 2, { lotId: randomUUID() }),
      );
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('LOT_INTROUVABLE');
    });
  });
});
