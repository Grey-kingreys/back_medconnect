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

describe('Synchro desktop : fournisseurs et réceptions faits hors ligne, sur base de test', () => {
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
        { type: 'DESKTOP', appareilId: 'desktop-reception-hors-ligne' },
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
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test réception hors ligne', false, now())`,
      [`med-rh-${n}`, `Produit réception ${n}`],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "archiveLe", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, $4, true, $5, now())`,
      [
        `stk-rh-${n}`,
        `med-rh-${n}`,
        PHARMACIE,
        coefficient,
        archivee ? new Date() : null,
      ],
    );
    return `stk-rh-${n}`;
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

  /** Réception de 3 boîtes de 10 unités, avec facture et coûts, au coefficient local 10. */
  const reception = (
    stockId: string,
    plus: Record<string, unknown> = {},
    ligne: Record<string, unknown> = {},
  ) => ({
    id: randomUUID(),
    recueLe: new Date().toISOString(),
    numeroFacture: 'FAC-1',
    montantHT: 5000,
    montantTTC: 5900,
    netAPayer: 5900,
    lignes: [
      {
        stockId,
        lotId: randomUUID(),
        coefficientLocal: 10,
        nombreBoites: 3,
        dateExpiration: jourAvant(-300),
        numeroLot: 'L1',
        coutAchatBoite: 500,
        montantHTLigne: 1500,
        prixPublicBoite: 900,
        codeArticleFournisseur: 'ART-1',
        ...ligne,
      },
    ],
    ...plus,
  });

  describe('RECEPTION_ENREGISTREE', () => {
    it('est appliquée avec le lot stable, idempotente ; les coûts saisis sont enregistrés', async () => {
      const stockId = await fiche(10);
      const corps = reception(stockId);
      const lotId = corps.lignes[0].lotId;
      const r = await envoyer('RECEPTION_ENREGISTREE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'RECEPTION', id: corps.id });
      expect(r.anomalies).toBeUndefined();
      expect(await soldeLot(lotId)).toBe(30);
      expect(await soldeProduit(stockId)).toBe(30);
      const lot = await sql(
        `SELECT "coutAchatBoite", "coefficientReception", "montantHTLigne", "receptionId" FROM "LotStock" WHERE "id" = $1`,
        [lotId],
      );
      expect(lot.rows[0]).toEqual({
        coutAchatBoite: 500,
        coefficientReception: 10,
        montantHTLigne: 1500,
        receptionId: corps.id,
      });
      const rec = await sql(
        `SELECT "montantHT", "netAPayer", "numeroFacture" FROM "Reception" WHERE "id" = $1`,
        [corps.id],
      );
      expect(rec.rows[0]).toEqual({
        montantHT: 5000,
        netAPayer: 5900,
        numeroFacture: 'FAC-1',
      });

      // Même réception sous un autre événement : rien de plus
      const rejeu = await envoyer('RECEPTION_ENREGISTREE', corps);
      expect(rejeu.statut).toBe('APPLIQUE');
      expect(rejeu.code).toBe('RECEPTION_DEJA_ENREGISTREE');
      expect(await soldeLot(lotId)).toBe(30);
      expect(await compter('LotStock', lotId)).toBe(1);

      // Même événement renvoyé : DEJA_APPLIQUE
      const options = {
        evenementId: randomUUID(),
        sequence: ++sequence,
        horodatage: new Date().toISOString(),
      };
      const autre = reception(stockId);
      await envoyer('RECEPTION_ENREGISTREE', autre, options);
      const encore = await envoyer('RECEPTION_ENREGISTREE', autre, options);
      expect(encore.statut).toBe('DEJA_APPLIQUE');
      expect(await soldeProduit(stockId)).toBe(60);
    });

    it('coefficient serveur différent : quantité du poste appliquée et anomalie RECEPTION_COEFFICIENT_DIFFERENT', async () => {
      const stockId = await fiche(20);
      const corps = reception(stockId); // le poste comptait 10 par boîte, 3 boîtes
      const lotId = corps.lignes[0].lotId;
      const r = await envoyer('RECEPTION_ENREGISTREE', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.anomalies?.[0].type).toBe('RECEPTION_COEFFICIENT_DIFFERENT');
      expect(await soldeLot(lotId)).toBe(30);
      const coef = await sql(
        `SELECT "coefficientReception" FROM "LotStock" WHERE "id" = $1`,
        [lotId],
      );
      expect(coef.rows[0].coefficientReception).toBe(10);
      const a = await sql(
        `SELECT "pieceType", "details" FROM "Anomalie" WHERE "type"::text = 'RECEPTION_COEFFICIENT_DIFFERENT' AND "pieceId" = $1`,
        [corps.id],
      );
      expect(a.rows).toHaveLength(1);
      expect(a.rows[0].pieceType).toBe('RECEPTION');
      const details = a.rows[0].details as Record<string, unknown>;
      expect(details).toMatchObject({
        stockId,
        coefficientLocal: 10,
        coefficientServeur: 20,
        quantiteUm: 30,
      });
      expect(String(details.message)).toContain('10 unité(s) par boîte');
    });

    it("péremption jugée à l'horodatage local : un lot périmé depuis n'est pas refusé", async () => {
      const stockId = await fiche(10);
      // Reçu il y a 5 jours, péremption il y a 2 jours : valable au moment de la réception.
      const corps = reception(
        stockId,
        { recueLe: joursAvant(5) },
        { dateExpiration: jourAvant(2) },
      );
      const r = await envoyer('RECEPTION_ENREGISTREE', corps, {
        horodatage: joursAvant(5),
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(await soldeLot(corps.lignes[0].lotId)).toBe(30);

      // Périmée au jour local : refusée comme en ligne
      const perimee = reception(
        stockId,
        { recueLe: joursAvant(5) },
        { dateExpiration: jourAvant(7) },
      );
      const refus = await envoyer('RECEPTION_ENREGISTREE', perimee, {
        horodatage: joursAvant(5),
      });
      expect(refus.statut).toBe('REJETE');
      expect(refus.code).toBe('DATE_PEREMPTION_PASSEE');
      expect(await soldeLot(perimee.lignes[0].lotId)).toBe(0);
    });

    it('fiche archivée : réception acceptée et fiche désarchivée', async () => {
      const stockId = await fiche(10, true);
      const r = await envoyer('RECEPTION_ENREGISTREE', reception(stockId));
      expect(r.statut).toBe('APPLIQUE');
      const f = await sql(
        'SELECT "archiveLe" FROM "StockMedicament" WHERE "id" = $1',
        [stockId],
      );
      expect(f.rows[0].archiveLe).toBeNull();
    });

    it("fiche inconnue : rejet STOCK_INTROUVABLE, rien d'écrit", async () => {
      const corps = reception('inconnu');
      const r = await envoyer('RECEPTION_ENREGISTREE', corps);
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('STOCK_INTROUVABLE');
      expect(await compter('Reception', corps.id)).toBe(0);
    });

    it('utilisateur sans reception:write : rejet PERMISSION_INSUFFISANTE', async () => {
      const stockId = await fiche(10);
      const r = await envoyer('RECEPTION_ENREGISTREE', reception(stockId), {
        utilisateurId: VENDEUR,
      });
      expect(r.statut).toBe('REJETE');
      expect(r.code).toBe('PERMISSION_INSUFFISANTE');
      expect(r.message).toBe(MESSAGES_REJET.PERMISSION_INSUFFISANTE);
      expect(await soldeProduit(stockId)).toBe(0);
    });

    it('lot cité deux fois : rejet LOT_EN_DOUBLE ; clé inconnue : EVENEMENT_INVALIDE', async () => {
      const stockId = await fiche(10);
      const corps = reception(stockId);
      corps.lignes.push({ ...corps.lignes[0] });
      expect((await envoyer('RECEPTION_ENREGISTREE', corps)).code).toBe(
        'LOT_EN_DOUBLE',
      );
      const invalide = await envoyer('RECEPTION_ENREGISTREE', {
        ...reception(stockId),
        prixAchat: 1,
      });
      expect(invalide.code).toBe('EVENEMENT_INVALIDE');
    });
  });

  describe('FOURNISSEUR_CREE', () => {
    it("crée le fournisseur avec l'identifiant du poste, idempotent", async () => {
      const id = randomUUID();
      const nom = `Sopharma ${id.slice(0, 6)}`;
      const r = await envoyer('FOURNISSEUR_CREE', {
        id,
        nom,
        telephone: '+224 620 00 00 00',
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.piece).toEqual({ type: 'FOURNISSEUR', id });
      const encore = await envoyer('FOURNISSEUR_CREE', { id, nom });
      expect(encore.statut).toBe('DEJA_APPLIQUE');
      expect(await compter('Fournisseur', id)).toBe(1);
    });

    it('nom déjà présent (casse ignorée) : le fournisseur existant est utilisé, la réception du poste le retrouve', async () => {
      const existant = randomUUID();
      await sql(
        `INSERT INTO "Fournisseur" ("id", "structureId", "nom") VALUES ($1, $2, $3)`,
        [existant, PHARMACIE, 'Laborex Guinée'],
      );
      const idPoste = randomUUID();
      const r = await envoyer('FOURNISSEUR_CREE', {
        id: idPoste,
        nom: 'LABOREX guinée',
      });
      expect(r.statut).toBe('APPLIQUE');
      expect(r.code).toBe('FOURNISSEUR_EXISTANT_REUTILISE');
      expect(r.piece).toEqual({ type: 'FOURNISSEUR', id: existant });
      expect(await compter('Fournisseur', idPoste)).toBe(0);

      const stockId = await fiche(10);
      const corps = reception(stockId, { fournisseurId: idPoste });
      expect((await envoyer('RECEPTION_ENREGISTREE', corps)).statut).toBe(
        'APPLIQUE',
      );
      const rec = await sql(
        'SELECT "fournisseurId" FROM "Reception" WHERE "id" = $1',
        [corps.id],
      );
      expect(rec.rows[0].fournisseurId).toBe(existant);
      // L'id du poste n'est plus gardé dans le journal d'audit : il se retrouve par l'événement du poste.
      const alias = await sql(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityType" = 'FournisseurAlias'`,
      );
      expect(alias.rows[0].n).toBe(0);
    });

    it('utilisateur sans reception:write : rejet PERMISSION_INSUFFISANTE', async () => {
      const r = await envoyer(
        'FOURNISSEUR_CREE',
        { id: randomUUID(), nom: 'Pas autorisé' },
        { utilisateurId: VENDEUR },
      );
      expect(r.code).toBe('PERMISSION_INSUFFISANTE');
    });

    it('fournisseur créé puis cité par la réception suivante', async () => {
      const id = randomUUID();
      await envoyer('FOURNISSEUR_CREE', {
        id,
        nom: `Pharmalab ${id.slice(0, 6)}`,
      });
      const stockId = await fiche(10);
      const corps = reception(stockId, { fournisseurId: id });
      await envoyer('RECEPTION_ENREGISTREE', corps);
      const rec = await sql(
        'SELECT "fournisseurId" FROM "Reception" WHERE "id" = $1',
        [corps.id],
      );
      expect(rec.rows[0].fournisseurId).toBe(id);
    });
  });

  describe('photographie', () => {
    it('contient les fournisseurs et les dernières réceptions sans filtre de date, sans aucun coût ni montant, et reste identique quand le temps passe', async () => {
      const stockId = await fiche(10);
      const recente = reception(stockId, { recueLe: joursAvant(2) });
      const r = await envoyer('RECEPTION_ENREGISTREE', recente, {
        horodatage: joursAvant(2),
      });
      expect(r.statut).toBe('APPLIQUE');
      const ancienne = reception(stockId, { recueLe: joursAvant(40) });
      await envoyer('RECEPTION_ENREGISTREE', ancienne, {
        horodatage: joursAvant(40),
      });

      const photo = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      const ids = photo.receptions.map((x) => x.id);
      expect(ids).toContain(recente.id);
      // Pas de filtre de date côté serveur (D662) : le poste applique lui-même ses 30 jours.
      expect(ids).toContain(ancienne.id);
      const lue = photo.receptions.find((x) => x.id === recente.id);
      expect(lue?.numeroFacture).toBe('FAC-1');
      expect(lue?.lots[0]).toMatchObject({
        stockId,
        quantiteRecue: 30,
        coefficientReception: 10,
        codeArticleFournisseur: 'ART-1',
        prixPublicBoite: 900,
      });
      expect(photo.fournisseurs.length).toBeGreaterThan(0);

      // Aucune clé de coût, aucune valeur de coût ni de montant de facture
      const json = JSON.stringify({
        receptions: photo.receptions,
        fournisseurs: photo.fournisseurs,
      });
      expect(cheminsCout(photo.receptions)).toEqual([]);
      expect(json).not.toMatch(
        /cout|marge|montantHT|totalTva|montantTTC|netAPayer/i,
      );
      expect(json).not.toContain('5900');
      expect(json).not.toContain('1500');

      // Aucune dépendance à l'heure : deux photographies sans changement de données sont identiques.
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
