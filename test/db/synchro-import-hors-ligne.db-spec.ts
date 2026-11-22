import { randomUUID } from 'node:crypto';
import { Workbook } from 'exceljs';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
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

describe('Synchro desktop : imports Excel mis de côté hors ligne, sur base de test', () => {
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
            : id === VENDEUR
              ? ['caisse:utiliser', 'stock:write', 'reception:write']
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
    const inventaires = new InventairesService(prisma, acces, mouvements);
    const pharmacie = new PharmacieService(
      prisma,
      {
        createManyNotifications: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationsService,
      acces,
      mouvements,
      permissions,
      receptions,
      inventaires,
    );
    synchro = new SynchroService(
      prisma,
      acces,
      mouvements,
      sessions,
      permissions,
      receptions,
      inventaires,
      pharmacie,
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
        { type: 'DESKTOP', appareilId: 'desktop-import-hors-ligne' },
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

  const jourDans = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: D,
        etat: { fileVide: true, sessionOuverte: false, versionApp: '0.1.0' },
        evenements: [
          {
            evenementId: o.evenementId ?? randomUUID(),
            sequence: o.sequence ?? ++sequence,
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

  /** Médicament du catalogue avec une fiche de stock qualifiée. */
  async function fiche(): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit import hors ligne ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test import hors ligne', false, now())`,
      [`med-iho-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, 1000, 1, true, now())`,
      [`stk-iho-${n}`, `med-iho-${n}`, PHARMACIE],
    );
    return { stockId: `stk-iho-${n}`, nom };
  }

  async function classeur(
    entetes: string[],
    lignes: unknown[][],
  ): Promise<Buffer> {
    const workbook = new Workbook();
    const feuille = workbook.addWorksheet('Stock');
    feuille.addRow(entetes);
    lignes.forEach((l) => feuille.addRow(l));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const ENTETES_LIVRAISON = [
    'Médicament',
    'Quantité (boîtes)',
    'Prix de la boîte (GNF)',
    "Date d'expiration (AAAA-MM-JJ)",
  ];
  const ENTETES_INVENTAIRE = [
    'Médicament',
    'Quantité comptée (boîtes)',
    'Unités en plus (boîte entamée)',
    'Lot',
    "Date d'expiration (AAAA-MM-JJ)",
  ];

  const corpsImport = (
    mode: 'livraison' | 'inventaire',
    buffer: Buffer,
    nomFichier = 'stock.xlsx',
  ) => ({
    id: randomUUID(),
    mode,
    nomFichier,
    contenuBase64: buffer.toString('base64'),
  });

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
  async function anomalies(type: string, pieceId: string): Promise<number> {
    const r = await sql(
      `SELECT count(*)::int AS n FROM "Anomalie" WHERE "type"::text = $1 AND "pieceId" = $2`,
      [type, pieceId],
    );
    return Number(r.rows[0].n);
  }

  describe('IMPORT_STOCK_FICHIER, mode livraison', () => {
    it('est importé comme en ligne : réception, lots, lignes refusées signalées au responsable ; idempotent', async () => {
      const a = await fiche();
      const buffer = await classeur(ENTETES_LIVRAISON, [
        [a.nom, 4, 2500, jourDans(200)],
        ['Médicament qui n existe pas', 1, 100, jourDans(200)],
      ]);
      const corps = corpsImport('livraison', buffer, 'livraison-mardi.xlsx');
      const evenementId = randomUUID();
      const horodatage = new Date().toISOString();
      const r = await envoyer('IMPORT_STOCK_FICHIER', corps, {
        evenementId,
        horodatage,
      });
      expect(r.statut).toBe('APPLIQUE');
      const sequenceEnvoyee = r.sequence;
      expect(r.piece).toEqual({ type: 'IMPORT_STOCK', id: corps.id });
      expect(r.importe).toMatchObject({
        mode: 'livraison',
        nomFichier: 'livraison-mardi.xlsx',
        totalLignes: 2,
        importees: 1,
        rejetees: 1,
        receptionId: corps.id,
        inventaireId: null,
      });
      expect(r.importe?.lignesRejetees).toEqual([
        expect.objectContaining({
          ligne: 3,
          nom: 'Médicament qui n existe pas',
          raison: expect.stringContaining('absent du catalogue') as string,
        }),
      ]);
      expect(await compter('Reception', corps.id)).toBe(1);
      expect(await soldeProduit(a.stockId)).toBe(4);
      expect(r.anomalies).toHaveLength(1);
      expect(await anomalies('IMPORT_DIFFERE_PARTIEL', corps.id)).toBe(1);
      const details = (
        await sql(
          `SELECT "details" FROM "Anomalie" WHERE "type"::text = 'IMPORT_DIFFERE_PARTIEL' AND "pieceId" = $1`,
          [corps.id],
        )
      ).rows[0].details as { message: string; importees: number };
      expect(details.importees).toBe(1);
      expect(details.message).toContain('livraison-mardi.xlsx');

      // Même événement renvoyé : rien de plus
      const encore = await envoyer('IMPORT_STOCK_FICHIER', corps, {
        evenementId,
        sequence: sequenceEnvoyee,
        horodatage,
      });
      expect(encore.statut).toBe('DEJA_APPLIQUE');
      // Même identifiant d'import dans un autre événement : reconnu, rien d'écrit
      const autre = await envoyer('IMPORT_STOCK_FICHIER', corps);
      expect(autre.statut).toBe('APPLIQUE');
      expect(autre.code).toBe('IMPORT_DEJA_ENREGISTRE');
      expect(await soldeProduit(a.stockId)).toBe(4);
      expect(await anomalies('IMPORT_DIFFERE_PARTIEL', corps.id)).toBe(1);
    });

    it('un fichier sans aucune ligne refusée ne crée aucune anomalie', async () => {
      const a = await fiche();
      const corps = corpsImport(
        'livraison',
        await classeur(ENTETES_LIVRAISON, [[a.nom, 2, 1000, jourDans(90)]]),
      );
      const r = await envoyer('IMPORT_STOCK_FICHIER', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.importe).toMatchObject({ importees: 1, rejetees: 0 });
      expect(r.anomalies).toBeUndefined();
      expect(await anomalies('IMPORT_DIFFERE_PARTIEL', corps.id)).toBe(0);
    });

    it('toutes les lignes refusées : rien d écrit, anomalie au responsable', async () => {
      const corps = corpsImport(
        'livraison',
        await classeur(ENTETES_LIVRAISON, [['Inconnu total', 1, 100, '']]),
      );
      const r = await envoyer('IMPORT_STOCK_FICHIER', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.importe).toMatchObject({
        importees: 0,
        rejetees: 1,
        receptionId: null,
      });
      expect(await compter('Reception', corps.id)).toBe(0);
      expect(await anomalies('IMPORT_DIFFERE_PARTIEL', corps.id)).toBe(1);
    });
  });

  describe('IMPORT_STOCK_FICHIER, mode inventaire', () => {
    it('est importé comme en ligne : le lot compté devient le stock, inventaire créé sous l identifiant', async () => {
      const a = await fiche();
      // Un premier lot par une livraison importée
      const livraison = corpsImport(
        'livraison',
        await classeur(ENTETES_LIVRAISON, [[a.nom, 10, 1000, jourDans(300)]]),
      );
      expect((await envoyer('IMPORT_STOCK_FICHIER', livraison)).statut).toBe(
        'APPLIQUE',
      );
      const corps = corpsImport(
        'inventaire',
        await classeur(ENTETES_INVENTAIRE, [[a.nom, 7, null, null, null]]),
      );
      const r = await envoyer('IMPORT_STOCK_FICHIER', corps);
      expect(r.statut).toBe('APPLIQUE');
      expect(r.importe).toMatchObject({
        mode: 'inventaire',
        importees: 1,
        rejetees: 0,
        inventaireId: corps.id,
        receptionId: null,
      });
      expect(await compter('Inventaire', corps.id)).toBe(1);
      expect(await soldeProduit(a.stockId)).toBe(7);
      const encore = await envoyer('IMPORT_STOCK_FICHIER', corps);
      expect(encore.code).toBe('IMPORT_DEJA_ENREGISTRE');
      expect(await soldeProduit(a.stockId)).toBe(7);
    });
  });

  describe('droits, fichiers invalides, taille', () => {
    it('le droit dépend du mode : reception:write pour une livraison, inventaire:write pour un inventaire', async () => {
      const a = await fiche();
      const livraison = corpsImport(
        'livraison',
        await classeur(ENTETES_LIVRAISON, [[a.nom, 1, 1000, jourDans(90)]]),
      );
      expect(
        (
          await envoyer('IMPORT_STOCK_FICHIER', livraison, {
            utilisateurId: VENDEUR,
          })
        ).statut,
      ).toBe('APPLIQUE');
      const inventaire = corpsImport(
        'inventaire',
        await classeur(ENTETES_INVENTAIRE, [[a.nom, 0, null, null, null]]),
      );
      const refuse = await envoyer('IMPORT_STOCK_FICHIER', inventaire, {
        utilisateurId: VENDEUR,
      });
      expect(refuse.statut).toBe('REJETE');
      expect(refuse.code).toBe('PERMISSION_INSUFFISANTE');
      expect(await compter('Inventaire', inventaire.id)).toBe(0);
      expect(await soldeProduit(a.stockId)).toBe(1);
    });

    it('un fichier qui n est pas un classeur, un base64 faux, des colonnes inconnues ou un fichier trop gros : FICHIER_INVALIDE, rien d écrit', async () => {
      const illisible = corpsImport(
        'livraison',
        Buffer.from('pas un classeur'),
      );
      const r1 = await envoyer('IMPORT_STOCK_FICHIER', illisible);
      expect(r1.statut).toBe('REJETE');
      expect(r1.code).toBe('FICHIER_INVALIDE');
      expect(r1.message).toBe(MESSAGES_REJET.FICHIER_INVALIDE);
      expect(r1.anomalies?.[0].type).toBe('EVENEMENT_REJETE');

      const faux = {
        ...corpsImport('livraison', Buffer.from('x')),
        contenuBase64: 'ceci !! n est pas du base64',
      };
      expect((await envoyer('IMPORT_STOCK_FICHIER', faux)).code).toBe(
        'FICHIER_INVALIDE',
      );

      const colonnes = corpsImport(
        'livraison',
        await classeur(['Foo', 'Bar'], [['a', 'b']]),
      );
      expect((await envoyer('IMPORT_STOCK_FICHIER', colonnes)).code).toBe(
        'FICHIER_INVALIDE',
      );

      const gros = corpsImport('livraison', Buffer.alloc(1_400_001, 1));
      expect((await envoyer('IMPORT_STOCK_FICHIER', gros)).code).toBe(
        'FICHIER_INVALIDE',
      );
      expect(await compter('Reception', illisible.id)).toBe(0);
    });
  });

  describe('photographie', () => {
    it('liste les imports différés du poste avec leur résultat, sans coût, identique dans le temps', async () => {
      const a = await fiche();
      const corps = corpsImport(
        'livraison',
        await classeur(ENTETES_LIVRAISON, [[a.nom, 3, 1000, jourDans(90)]]),
        'photo.xlsx',
      );
      await envoyer('IMPORT_STOCK_FICHIER', corps);
      const rejete = corpsImport(
        'livraison',
        Buffer.from('illisible'),
        'mauvais.xlsx',
      );
      await envoyer('IMPORT_STOCK_FICHIER', rejete);
      const photo = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      expect(photo.importsDifferes.length).toBeLessThanOrEqual(20);
      const lu = photo.importsDifferes.find((x) => x.id === corps.id);
      expect(lu).toMatchObject({
        mode: 'livraison',
        nomFichier: 'photo.xlsx',
        statut: 'APPLIQUE',
        importe: { importees: 1, rejetees: 0, receptionId: corps.id },
      });
      const lu2 = photo.importsDifferes.find((x) => x.id === rejete.id);
      expect(lu2).toMatchObject({
        statut: 'REJETE',
        code: 'FICHIER_INVALIDE',
        importe: null,
      });
      // Jamais le contenu du fichier
      expect(JSON.stringify(photo.importsDifferes)).not.toContain(
        corps.contenuBase64.slice(0, 40),
      );
      expect(cheminsCout(photo.importsDifferes)).toEqual([]);
      const encore = await catalogue.photographier(PHARMACIE, RESPONSABLE, D);
      expect(JSON.stringify(encore.importsDifferes)).toBe(
        JSON.stringify(photo.importsDifferes),
      );
    });
  });
});
