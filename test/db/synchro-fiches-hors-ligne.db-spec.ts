import { randomUUID } from 'node:crypto';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { AnomaliesService } from 'src/pharmacie/anomalies/anomalies.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import type { StorageService } from 'src/storage/storage.service';
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

describe('Synchro desktop : fiches modifiées ou créées hors ligne, sur base de test', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let catalogue: CatalogueSynchroService;
  let D: string;
  let sequence = 0;

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
        { type: 'DESKTOP', appareilId: 'desktop-fiches-hors-ligne' },
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

  let compteur = 0;

  /** Fiche existante (déconditionnable ou non) avec prix 1000 et notes « n0 ». */
  async function fiche(
    o: {
      deconditionnable?: boolean;
      archivee?: boolean;
      prix?: number | null;
    } = {},
  ) {
    compteur += 1;
    const n = compteur;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test fiche hors ligne', false, now())`,
      [`med-fh-${n}`, `Produit fiche ${n}`],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "deconditionnable", "qualifie", "notes", "archiveLe", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, 10, $5, true, 'n0', $6, now())`,
      [
        `stk-fh-${n}`,
        `med-fh-${n}`,
        PHARMACIE,
        o.prix === undefined ? 1000 : o.prix,
        o.deconditionnable ?? false,
        o.archivee ? new Date() : null,
      ],
    );
    return { stockId: `stk-fh-${n}`, medicamentId: `med-fh-${n}` };
  }

  async function medicament() {
    compteur += 1;
    const id = `med-fh-${compteur}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test fiche hors ligne', false, now())`,
      [id, `Produit fiche ${compteur}`],
    );
    return id;
  }

  async function envoyer(
    type: string,
    corps: Record<string, unknown>,
    o: { utilisateurId?: string; evenementId?: string } = {},
  ): Promise<ResultatEvenement> {
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D,
        etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
        evenements: [
          {
            evenementId: o.evenementId ?? randomUUID(),
            sequence: ++sequence,
            type,
            horodatageLocal: new Date().toISOString(),
            utilisateurId: o.utilisateurId ?? RESPONSABLE,
            corps,
          },
        ],
      },
      '127.0.0.1',
    );
    return r.data.resultats[0];
  }

  async function ligneFiche(stockId: string) {
    const r = await sql(
      `SELECT "prixUnitaire", "prixUnite", "toleranceInventaire", "notes", "archiveLe", "medicamentId" FROM "StockMedicament" WHERE "id" = $1`,
      [stockId],
    );
    return r.rows[0];
  }

  describe('FICHE_MODIFIEE', () => {
    it('applique les champs sûrs quand le serveur est resté comme le poste le voyait, avec audit', async () => {
      const { stockId } = await fiche({ deconditionnable: true });
      const r = await envoyer('FICHE_MODIFIEE', {
        stockId,
        avant: {
          prixUnitaire: 1000,
          prixUnite: null,
          toleranceInventaire: null,
          notes: 'n0',
        },
        apres: {
          prixUnitaire: 1200,
          prixUnite: 150,
          toleranceInventaire: 2,
          notes: 'n1',
        },
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.anomalies).toBeUndefined();
      expect(await ligneFiche(stockId)).toMatchObject({
        prixUnitaire: 1200,
        prixUnite: 150,
        toleranceInventaire: 2,
        notes: 'n1',
      });
      const audit = await sql(
        `SELECT "metadata" FROM "AuditLog" WHERE "entityType" = 'StockMedicament' AND "entityId" = $1 AND "userId" = $2`,
        [stockId, RESPONSABLE],
      );
      expect(audit.rows).toHaveLength(1);
      const meta = audit.rows[0].metadata as Record<string, unknown>;
      expect(meta.apres).toMatchObject({ prixUnitaire: 1200, prixUnite: 150 });
      expect(JSON.stringify(meta)).not.toContain('n1');
    });

    it('un champ modifié ailleurs entre-temps n est pas appliqué et crée une anomalie ; les autres champs passent', async () => {
      const { stockId } = await fiche();
      await sql(
        `UPDATE "StockMedicament" SET "prixUnitaire" = 1100 WHERE "id" = $1`,
        [stockId],
      );
      const r = await envoyer('FICHE_MODIFIEE', {
        stockId,
        avant: { prixUnitaire: 1000, toleranceInventaire: null },
        apres: { prixUnitaire: 1300, toleranceInventaire: 3 },
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.anomalies).toHaveLength(1);
      expect(r.anomalies?.[0].type).toBe('FICHE_MODIFIEE_ENTRETEMPS');
      expect(await ligneFiche(stockId)).toMatchObject({
        prixUnitaire: 1100,
        toleranceInventaire: 3,
      });
      const a = await sql(
        `SELECT "pieceType", "pieceId", "details" FROM "Anomalie" WHERE "id" = $1`,
        [r.anomalies?.[0].id],
      );
      expect(a.rows[0].pieceType).toBe('FICHE');
      const d = a.rows[0].details as Record<string, any>;
      expect(d.champs).toEqual([
        {
          champ: 'prixUnitaire',
          avantPoste: 1000,
          valeurServeur: 1100,
          valeurVoulue: 1300,
        },
      ]);
      expect(d.message).toContain('le prix de la boîte');
    });

    it('est idempotente par evenementId', async () => {
      const { stockId } = await fiche();
      const evenementId = randomUUID();
      const corps = {
        stockId,
        avant: { prixUnitaire: 1000 },
        apres: { prixUnitaire: 1400 },
      };
      const un = await envoyer('FICHE_MODIFIEE', corps, { evenementId });
      expect(un.statut).toBe('APPLIQUE');
      const horodatageLocal = new Date().toISOString();
      const rejeu = async () =>
        (
          await synchro.recevoir(
            PHARMACIE,
            VENDEUR,
            {
              posteId: D,
              etat: {
                fileVide: true,
                sessionOuverte: false,
                versionApp: '0.1.0',
              },
              evenements: [
                {
                  evenementId,
                  sequence: un.sequence,
                  type: 'FICHE_MODIFIEE',
                  horodatageLocal,
                  utilisateurId: RESPONSABLE,
                  corps,
                },
              ],
            },
            '127.0.0.1',
          )
        ).data.resultats[0];
      // L'horodatage diffère du premier envoi : rejet de contenu ou résultat connu, jamais une seconde application.
      expect(['DEJA_APPLIQUE', 'REJETE']).toContain((await rejeu()).statut);
      expect((await ligneFiche(stockId)).prixUnitaire).toBe(1400);
      const audit = await sql(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityType" = 'StockMedicament' AND "entityId" = $1`,
        [stockId],
      );
      expect(Number(audit.rows[0].n)).toBe(1);
    });

    it('rejette un prix à l unité sur une fiche non déconditionnable, sans rien écrire', async () => {
      const { stockId } = await fiche({ deconditionnable: false });
      const r = await envoyer('FICHE_MODIFIEE', {
        stockId,
        avant: { prixUnitaire: 1000, prixUnite: null },
        apres: { prixUnitaire: 1500, prixUnite: 100 },
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('PRIX_UNITE_SANS_DECONDITIONNEMENT');
      expect(await ligneFiche(stockId)).toMatchObject({
        prixUnitaire: 1000,
        prixUnite: null,
      });
    });

    it('rejette une fiche archivée, un utilisateur sans stock:write et un champ interdit', async () => {
      const archivee = await fiche({ archivee: true });
      const a = await envoyer('FICHE_MODIFIEE', {
        stockId: archivee.stockId,
        avant: { prixUnitaire: 1000 },
        apres: { prixUnitaire: 1 },
      });
      expect(a.statut).toBe('REJETE');
      expect(a.code).toBe('STOCK_INTROUVABLE');
      const { stockId } = await fiche();
      const sansDroit = await envoyer(
        'FICHE_MODIFIEE',
        { stockId, avant: { prixUnitaire: 1000 }, apres: { prixUnitaire: 5 } },
        { utilisateurId: VENDEUR },
      );
      expect(sansDroit.code).toBe('PERMISSION_INSUFFISANTE');
      const interdit = await envoyer('FICHE_MODIFIEE', {
        stockId,
        avant: { coefficientBoite: 10 },
        apres: { coefficientBoite: 20 },
      });
      expect(interdit.statut).toBe('REJETE');
      expect(interdit.code).toBe('EVENEMENT_INVALIDE');
      expect((await ligneFiche(stockId)).prixUnitaire).toBe(1000);
    });
  });

  describe('FICHE_CREEE', () => {
    it('crée une nouvelle fiche à l identifiant du poste, sans quantité', async () => {
      const medicamentId = await medicament();
      const id = randomUUID();
      const r = await envoyer('FICHE_CREEE', {
        id,
        medicamentId,
        prixUnitaire: 2500,
        notes: 'à vérifier',
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'FICHE', id });
      expect(await ligneFiche(id)).toMatchObject({
        prixUnitaire: 2500,
        notes: 'à vérifier',
        archiveLe: null,
      });
      const lots = await sql(
        `SELECT count(*)::int AS n FROM "LotStock" WHERE "stockMedicamentId" = $1`,
        [id],
      );
      expect(Number(lots.rows[0].n)).toBe(0);
    });

    it('réutilise la fiche existante : prix appliqué seulement si vide, alias retrouvé par les événements suivants', async () => {
      const { stockId, medicamentId } = await fiche({
        prix: null,
        archivee: true,
      });
      const idPoste = randomUUID();
      const r = await envoyer('FICHE_CREEE', {
        id: idPoste,
        medicamentId,
        prixUnitaire: 3000,
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'FICHE', id: stockId });
      expect(r.code).toBe('FICHE_EXISTANTE_REUTILISEE');
      expect(await ligneFiche(stockId)).toMatchObject({
        prixUnitaire: 3000,
        archiveLe: null,
      });
      expect(await ligneFiche(idPoste)).toBeUndefined();

      // Une fiche qui avait déjà un prix le garde
      const autre = await fiche({ prix: 800 });
      await envoyer('FICHE_CREEE', {
        id: randomUUID(),
        medicamentId: autre.medicamentId,
        prixUnitaire: 9999,
      });
      expect((await ligneFiche(autre.stockId)).prixUnitaire).toBe(800);

      // L'événement suivant cite encore l'identifiant du poste : il est résolu vers la fiche du serveur
      const m = await envoyer('FICHE_MODIFIEE', {
        stockId: idPoste,
        avant: { prixUnitaire: 3000 },
        apres: { prixUnitaire: 3100 },
      });
      expect(m.statut).toBe('APPLIQUE');
      expect((await ligneFiche(stockId)).prixUnitaire).toBe(3100);
    });

    it('rejette un médicament inconnu', async () => {
      const r = await envoyer('FICHE_CREEE', {
        id: randomUUID(),
        medicamentId: 'inconnu-xyz',
        prixUnitaire: 1,
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('MEDICAMENT_INCONNU');
    });
  });

  describe('photographie', () => {
    it('porte le catalogue allégé sans coût, trié par identifiant, et reste identique quand le temps passe', async () => {
      await medicament();
      await fiche();
      const photo = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      expect(photo.medicaments.length).toBeGreaterThan(0);
      const ids = photo.medicaments.map((m) => m.id);
      expect([...ids].sort()).toEqual(ids);
      for (const m of photo.medicaments) {
        expect(Object.keys(m).sort()).toEqual(
          [
            'categorie',
            'formes',
            'id',
            'nom',
            'nomGenerique',
            'ordonnanceRequise',
          ].sort(),
        );
      }
      expect(cheminsCout(photo.medicaments)).toEqual([]);
      expect(JSON.stringify(photo.medicaments)).not.toMatch(/cout|marge|prix/i);
      expect(photo.fiches[0]).toHaveProperty('toleranceInventaire');

      jest.useFakeTimers({
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'clearTimeout',
          'clearInterval',
          'queueMicrotask',
        ],
      });
      jest.setSystemTime(new Date(Date.now() + 45 * 86_400_000));
      try {
        const plusTard = await catalogue.photographier(
          PHARMACIE,
          RESPONSABLE,
          D,
        );
        expect(JSON.stringify(plusTard)).toBe(JSON.stringify(photo));
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
