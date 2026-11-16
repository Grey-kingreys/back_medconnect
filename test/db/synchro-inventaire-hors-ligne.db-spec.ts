import { randomUUID } from 'node:crypto';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { AnomaliesService } from 'src/pharmacie/anomalies/anomalies.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import type { StorageService } from 'src/storage/storage.service';
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

describe('Synchro desktop : inventaires faits hors ligne, sur base de test', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let catalogue: CatalogueSynchroService;
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
                'inventaire:write',
                'anomalie:gerer',
              ]
            : ['caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    const receptions = new ReceptionsService(
      prisma,
      acces,
      mouvements,
      permissions,
    );
    synchro = new SynchroService(
      prisma,
      acces,
      mouvements,
      sessions,
      permissions,
      receptions,
      new InventairesService(prisma, acces, mouvements),
    );
    catalogue = new CatalogueSynchroService(
      prisma,
      acces,
      {
        getPublicUrl: (cle: string) => `logo/${cle}`,
      } as unknown as StorageService,
      new AnomaliesService(prisma, acces),
    );
    D = (
      await new PointsDeVenteService(prisma, acces).enregistrerPoste(
        PHARMACIE,
        RESPONSABLE,
        { type: 'DESKTOP', appareilId: 'desktop-inventaire-hors-ligne' },
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

  const joursAvant = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString();
  const jourAvant = (n: number) => joursAvant(n).slice(0, 10);

  /** Fiche sans lot avec le coefficient donné, archivée ou non. */
  async function fiche(coefficient: number, archivee = false) {
    compteurFiche += 1;
    const n = compteurFiche;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test inventaire hors ligne', false, now())`,
      [`med-ih-${n}`, `Produit inventaire ${n}`],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "archiveLe", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, true, $5, now())`,
      [
        `stk-ih-${n}`,
        `med-ih-${n}`,
        PHARMACIE,
        coefficient,
        archivee ? new Date() : null,
      ],
    );
    return `stk-ih-${n}`;
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
  async function compter(table: string, id: string): Promise<number> {
    const r = await sql(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "id" = $1`,
      [id],
    );
    return Number(r.rows[0].n);
  }

  /** Fiche avec un lot de `quantite` unités (réception rejouée), tolérance donnée. */
  async function ficheAvecLot(
    quantite: number,
    tolerance: number | null = null,
  ) {
    const stockId = await fiche(10);
    if (tolerance !== null) {
      await sql(
        `UPDATE "StockMedicament" SET "toleranceInventaire" = $1 WHERE "id" = $2`,
        [tolerance, stockId],
      );
    }
    const lotId = randomUUID();
    const r = await envoyer('RECEPTION_ENREGISTREE', {
      id: randomUUID(),
      recueLe: new Date().toISOString(),
      lignes: [
        {
          stockId,
          lotId,
          coefficientLocal: 10,
          quantiteUnites: quantite,
          dateExpiration: jourAvant(-300),
          numeroLot: 'L1',
        },
      ],
    });
    expect(r.statut).toBe('APPLIQUE');
    return { stockId, lotId };
  }

  const inventaire = (
    lignes: Record<string, unknown>[],
    plus: Record<string, unknown> = {},
  ) => ({ id: randomUUID(), commentaire: 'Comptage du soir', lignes, ...plus });

  const compte = (
    f: { stockId: string; lotId: string },
    quantiteComptee: number,
    theoriqueLocal: number,
  ) => ({
    stockId: f.stockId,
    lotId: f.lotId,
    quantiteComptee,
    theoriqueLocal,
  });

  async function anomalies(type: string, pieceId: string): Promise<number> {
    const r = await sql(
      `SELECT count(*)::int AS n FROM "Anomalie" WHERE "type"::text = $1 AND "pieceId" = $2`,
      [type, pieceId],
    );
    return Number(r.rows[0].n);
  }

  describe('INVENTAIRE_ENREGISTRE', () => {
    it('est appliqué : le stock du lot devient le compté, écart au-delà de la tolérance signalé ; idempotent', async () => {
      const f = await ficheAvecLot(30);
      const corps = inventaire([compte(f, 25, 30)]);
      const r = await envoyer('INVENTAIRE_ENREGISTRE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'INVENTAIRE', id: corps.id });
      expect(await soldeLot(f.lotId)).toBe(25);
      expect(await soldeProduit(f.stockId)).toBe(25);
      expect(await anomalies('ECART_INVENTAIRE', corps.id)).toBe(1);
      expect(await anomalies('THEORIQUE_DIVERGENT', corps.id)).toBe(0);
      const ligne = await sql(
        `SELECT "quantiteTheorique", "quantiteComptee", "ecart" FROM "LigneInventaire" WHERE "inventaireId" = $1`,
        [corps.id],
      );
      expect(ligne.rows).toEqual([
        { quantiteTheorique: 30, quantiteComptee: 25, ecart: -5 },
      ]);

      // Même inventaire sous un autre événement : rien de plus
      const rejeu = await envoyer('INVENTAIRE_ENREGISTRE', corps);
      expect(rejeu.statut).toBe('APPLIQUE');
      expect(rejeu.code).toBe('INVENTAIRE_DEJA_ENREGISTRE');
      expect(await soldeLot(f.lotId)).toBe(25);
      expect(await anomalies('ECART_INVENTAIRE', corps.id)).toBe(1);

      // Même événement renvoyé : DEJA_APPLIQUE
      const options = {
        evenementId: randomUUID(),
        sequence: ++sequence,
        horodatage: new Date().toISOString(),
      };
      const autre = inventaire([compte(f, 20, 25)]);
      await envoyer('INVENTAIRE_ENREGISTRE', autre, options);
      const encore = await envoyer('INVENTAIRE_ENREGISTRE', autre, options);
      expect(encore.statut).toBe('DEJA_APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(20);
    });

    it('écart dans la tolérance de la fiche (lue au serveur) : aucune anomalie', async () => {
      const f = await ficheAvecLot(30, 10);
      const corps = inventaire([compte(f, 27, 30)]);
      expect((await envoyer('INVENTAIRE_ENREGISTRE', corps)).statut).toBe(
        'APPLIQUE',
      );
      expect(await soldeLot(f.lotId)).toBe(27);
      expect(await anomalies('ECART_INVENTAIRE', corps.id)).toBe(0);
    });

    it("nouveau lot : créé avec l'identifiant du poste, une seule fois", async () => {
      const f = await ficheAvecLot(30);
      const nouveau = randomUUID();
      const corps = inventaire([
        compte(f, 30, 30),
        {
          stockId: f.stockId,
          nouveauLot: {
            id: nouveau,
            numeroLot: 'N1',
            dateExpiration: jourAvant(-200),
          },
          quantiteComptee: 12,
          theoriqueLocal: 0,
        },
      ]);
      const r = await envoyer('INVENTAIRE_ENREGISTRE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(await soldeLot(nouveau)).toBe(12);
      expect(await soldeLot(f.lotId)).toBe(30);
      expect(await soldeProduit(f.stockId)).toBe(42);
      expect(await compter('LotStock', nouveau)).toBe(1);
      expect((await envoyer('INVENTAIRE_ENREGISTRE', corps)).code).toBe(
        'INVENTAIRE_DEJA_ENREGISTRE',
      );
      expect(await compter('LotStock', nouveau)).toBe(1);
      expect(await soldeProduit(f.stockId)).toBe(42);
    });

    it('un autre mouvement a eu lieu entre-temps : le stock est exactement le compté, anomalie THEORIQUE_DIVERGENT', async () => {
      const f = await ficheAvecLot(30);
      // Un autre poste a retiré 4 unités depuis le comptage (ici une correction)
      const c = await envoyer('CORRECTION_QUANTITE', {
        id: randomUUID(),
        stockId: f.stockId,
        lotId: f.lotId,
        variation: -4,
        motif: 'Casse constatée',
      });
      expect(c.statut).toBe('APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(26);
      const corps = inventaire([compte(f, 30, 30)]);
      const r = await envoyer('INVENTAIRE_ENREGISTRE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(await soldeLot(f.lotId)).toBe(30);
      expect(await soldeProduit(f.stockId)).toBe(30);
      expect(await anomalies('THEORIQUE_DIVERGENT', corps.id)).toBe(1);
      // Écart calculé contre le théorique du serveur (26) : +4, au-delà de la tolérance 0
      expect(await anomalies('ECART_INVENTAIRE', corps.id)).toBe(1);
      expect(r.anomalies?.map((a) => a.type).sort()).toEqual([
        'ECART_INVENTAIRE',
        'THEORIQUE_DIVERGENT',
      ]);
      const d = await sql(
        `SELECT "details" FROM "Anomalie" WHERE "type"::text = 'THEORIQUE_DIVERGENT' AND "pieceId" = $1`,
        [corps.id],
      );
      const details = d.rows[0].details as Record<string, unknown>;
      expect(details.lignes).toEqual([
        {
          lotId: f.lotId,
          theoriquePoste: 30,
          theoriqueServeur: 26,
          quantiteComptee: 30,
        },
      ]);
      expect(String(details.message)).toContain(
        'exactement la quantité comptée',
      );
    });

    it('lot inconnu, lot compté deux fois, fiche inconnue : rejets typés, rien écrit', async () => {
      const f = await ficheAvecLot(30);
      const inconnu = inventaire([
        {
          stockId: f.stockId,
          lotId: randomUUID(),
          quantiteComptee: 5,
          theoriqueLocal: 0,
        },
      ]);
      expect((await envoyer('INVENTAIRE_ENREGISTRE', inconnu)).code).toBe(
        'LOT_INTROUVABLE',
      );
      const double = inventaire([compte(f, 5, 30), compte(f, 6, 30)]);
      expect((await envoyer('INVENTAIRE_ENREGISTRE', double)).code).toBe(
        'LOT_EN_DOUBLE',
      );
      const sansFiche = inventaire([
        {
          stockId: 'stk-inconnu',
          lotId: f.lotId,
          quantiteComptee: 5,
          theoriqueLocal: 30,
        },
      ]);
      expect((await envoyer('INVENTAIRE_ENREGISTRE', sansFiche)).code).toBe(
        'STOCK_INTROUVABLE',
      );
      expect(await soldeLot(f.lotId)).toBe(30);
      expect(await compter('Inventaire', double.id)).toBe(0);
    });

    it('utilisateur sans inventaire:write : rejet PERMISSION_INSUFFISANTE', async () => {
      const f = await ficheAvecLot(30);
      const corps = inventaire([compte(f, 5, 30)]);
      const r = await envoyer('INVENTAIRE_ENREGISTRE', corps, {
        utilisateurId: VENDEUR,
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('PERMISSION_INSUFFISANTE');
      expect(r.message).toBe(MESSAGES_REJET.PERMISSION_INSUFFISANTE);
      expect(await soldeLot(f.lotId)).toBe(30);
    });
  });

  describe('photographie', () => {
    it('contient les inventaires récents sans coût, identique dans le temps', async () => {
      const f = await ficheAvecLot(30);
      const corps = inventaire([compte(f, 28, 30)]);
      await envoyer('INVENTAIRE_ENREGISTRE', corps);
      const photo = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      const lu = photo.inventaires.find((x) => x.id === corps.id);
      expect(lu).toBeDefined();
      expect(lu?.lignes).toHaveLength(1);
      expect(lu?.lignes[0]).toMatchObject({
        stockId: f.stockId,
        lotId: f.lotId,
        quantiteTheorique: 30,
        quantiteComptee: 28,
        ecart: -2,
      });
      expect(cheminsCout(photo.inventaires)).toEqual([]);
      const encore = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      expect(JSON.stringify(encore.inventaires)).toBe(
        JSON.stringify(photo.inventaires),
      );
    });
  });
});
