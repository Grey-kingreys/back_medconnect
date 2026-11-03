import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { DemoSeeder } from 'src/demo/demo.seeder';
import { COMPTES_DEMO, STRUCTURES_DEMO } from 'src/demo/demo.donnees';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import type { RolesService } from 'src/common/rbac/roles.service';
import { EncryptionService } from 'src/common/services/encryption.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { NotificationsService } from 'src/notifications/notifications.service';
import type { StorageService } from 'src/storage/storage.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { AnomaliesService } from 'src/pharmacie/anomalies/anomalies.service';
import { ClotureService } from 'src/pharmacie/caisse/clotures.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { ScenarioDemoPharmacieService } from 'src/pharmacie/demo/scenario-demo-pharmacie.service';
import { InventairesService } from 'src/pharmacie/inventaires/inventaires.service';
import { jourConakry, joursAvant } from 'src/pharmacie/jour-metier';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { RapportsService } from 'src/pharmacie/rapports/rapports.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import { VenteService } from 'src/pharmacie/vente.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  fermerPrismaDeTest,
  RACINE_DEPOT,
  supprimerBaseDeTest,
} from './harnais';

/** Les 28 modèles reliés à `Structure` par des clés `Restrict` (D676). */
const MODELES_DE_LA_TRANCHE = [
  'AgregatStockLot',
  'AgregatStockProduit',
  'AllocationLot',
  'Anomalie',
  'ClotureJournaliere',
  'ComptageCaisse',
  'CompteurTicket',
  'ConditionnementOuvert',
  'EvenementSynchro',
  'Fournisseur',
  'Inventaire',
  'LigneComptage',
  'LigneInventaire',
  'LigneVente',
  'LotStock',
  'MouvementCaisse',
  'MouvementStock',
  'Paiement',
  'ParametresPharmacie',
  'PlageTicket',
  'PointDeVente',
  'Poste',
  'Reception',
  'ReleveModePaiement',
  'ResultatSessionMode',
  'SessionCaisse',
  'TotalClotureMode',
  'Vente',
];

const PERMISSIONS_PHARMACIE = [
  'stock:read',
  'stock:write',
  'catalogue:write',
  'catalogue:manage',
  'vente:read',
  'vente:write',
  'vente:annuler',
  'caisse:utiliser',
  'caisse:superviser',
  'cloture:gerer',
  'inventaire:write',
  'reception:write',
  'marge:read',
  'anomalie:gerer',
];

const BILAN_ATTENDU = {
  receptions: 3,
  lotsRepris: 1,
  inventaires: 1,
  evenementsAppliques: 19,
  clotures: 2,
  ventesWeb: 2,
  annulations: 1,
  anomaliesTraitees: 1,
};

const STOCK_FINAL_KALOUM: Record<string, number> = {
  'Doliprane 1000mg': 326,
  'Augmentin 1g/125mg': 104,
  'Coartem 20/120': 384,
  'Ventoline 100 µg': -1,
  'Amlor 5mg': 150,
  'Glucophage 850mg': 355,
  SRO: 144,
  'Flagyl 500mg': 270,
  'Amoxicilline 500mg': 168,
  'Ibuprofène 400mg': 260,
};

const STOCK_FINAL_NIGER: Record<string, number> = {
  'Doliprane 1000mg': 160,
  'Coartem 20/120': 48,
  'Amoxicilline 500mg': 144,
  'Ibuprofène 400mg': 240,
  Spasfon: 60,
};

const SENTINELLE = 'Annulation voulue de la transaction de purge';

/**
 * Modèles atteints depuis `Structure` par des relations `onDelete: Restrict` : point
 * fixe lu dans `prisma/schema.prisma` (un modèle entre dès qu'il a une relation Restrict
 * vers un modèle déjà dans l'ensemble).
 */
function modelesRestrictDepuisStructure(): string[] {
  const schema = readFileSync(
    path.join(RACINE_DEPOT, 'prisma', 'schema.prisma'),
    'utf8',
  );
  const aretes: { modele: string; cible: string }[] = [];
  for (const bloc of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    for (const ligne of bloc[2].split('\n')) {
      const relation =
        /^\s*\w+\s+(\w+)\??\s+@relation\(.*fields:.*onDelete: Restrict/.exec(
          ligne,
        );
      if (relation) aretes.push({ modele: bloc[1], cible: relation[1] });
    }
  }
  const atteints = new Set(['Structure']);
  let change = true;
  while (change) {
    change = false;
    for (const a of aretes) {
      if (atteints.has(a.cible) && !atteints.has(a.modele)) {
        atteints.add(a.modele);
        change = true;
      }
    }
  }
  atteints.delete('Structure');
  return [...atteints].sort();
}

describe('Jeu démo de pharmacie : création, scénario et purge, sur base de test (PB19a)', () => {
  const modeDemoInitial = process.env.DEMO_MODE;
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let seeder: DemoSeeder;
  let clotures: ClotureService;
  let rapports: RapportsService;
  let anomalies: AnomaliesService;
  let pharmacie: PharmacieService;

  let kaloum: string;
  let niger: string;
  let titulaire: string;
  let vendeur: string;
  let comptesAvantPurge: Record<string, number>;
  let idsStructuresAvant: string[];

  const aujourdhui = jourConakry(new Date());
  const jour = (n: number) => joursAvant(aujourdhui, -n);

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    base = await creerBaseVide();
    await appliquerMigrations(base.client);
    prisma = creerPrismaDeTest(base);

    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: () => Promise.resolve(PERMISSIONS_PHARMACIE),
      invalidateUser: () => Promise.resolve(undefined),
    } as unknown as PermissionsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const notifications = {
      createManyNotifications: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const roles = {
      resolveAssignableRoleId: () => Promise.resolve(null),
      seedStructureDefaultRoles: () => Promise.resolve(undefined),
    } as unknown as RolesService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    clotures = new ClotureService(prisma, acces);
    rapports = new RapportsService(prisma, acces, permissions);
    const receptions = new ReceptionsService(
      prisma,
      acces,
      mouvements,
      permissions,
    );
    const inventaires = new InventairesService(prisma, acces, mouvements);
    anomalies = new AnomaliesService(prisma, acces);
    const scenario = new ScenarioDemoPharmacieService(
      prisma,
      receptions,
      inventaires,
      new PointsDeVenteService(prisma, acces),
      new SynchroService(prisma, acces, mouvements, sessions),
      clotures,
      new VenteService(
        prisma,
        notifications,
        stockage,
        acces,
        permissions,
        mouvements,
        sessions,
      ),
      anomalies,
      mouvements,
    );
    pharmacie = new PharmacieService(
      prisma,
      notifications,
      acces,
      mouvements,
      permissions,
      receptions,
      inventaires,
    );
    seeder = new DemoSeeder(
      prisma,
      new EncryptionService({
        get: (k: string) => process.env[k],
      } as unknown as ConfigService),
      roles,
      permissions,
      scenario,
    );
  });

  afterAll(async () => {
    if (modeDemoInitial === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = modeDemoInitial;
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

  // ------------------------------------------------------------ aides base

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function comptesParModele(): Promise<Record<string, number>> {
    const comptes: Record<string, number> = {};
    for (const modele of MODELES_DE_LA_TRANCHE) {
      comptes[modele] = await compter(
        `SELECT count(*)::int AS n FROM "${modele}"`,
      );
    }
    return comptes;
  }

  async function idPharmacie(cle: string): Promise<string> {
    const def = STRUCTURES_DEMO.find((s) => s.cle === cle);
    const res = await sql('SELECT "id" FROM "Structure" WHERE "email" = $1', [
      def?.email,
    ]);
    return String(res.rows[0].id);
  }

  async function idCompte(cle: string): Promise<string> {
    const def = COMPTES_DEMO.find((c) => c.cle === cle);
    const res = await sql('SELECT "id" FROM "User" WHERE "email" = $1', [
      def?.email,
    ]);
    return String(res.rows[0].id);
  }

  async function stockFinal(
    structureId: string,
  ): Promise<Record<string, number>> {
    const res = await sql(
      `SELECT m."nom" AS "nom", a."quantite" AS "quantite"
       FROM "AgregatStockProduit" a
       JOIN "StockMedicament" s ON s."id" = a."stockMedicamentId"
       JOIN "Medicament" m ON m."id" = s."medicamentId"
       WHERE s."structureId" = $1`,
      [structureId],
    );
    return Object.fromEntries(
      res.rows.map((r) => [String(r.nom), Number(r.quantite)]),
    );
  }

  async function soldeLot(numeroLot: string): Promise<number> {
    const res = await sql(
      `SELECT a."quantite" FROM "AgregatStockLot" a JOIN "LotStock" l ON l."id" = a."lotId" WHERE l."numeroLot" = $1`,
      [numeroLot],
    );
    return Number(res.rows[0].quantite);
  }

  async function posteDesktop() {
    const res = await sql(
      `SELECT p.*, p."type"::text AS "typeTexte" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = $1 AND p."type" = 'DESKTOP'`,
      [kaloum],
    );
    return res.rows[0];
  }

  async function sessionDuJour(posteId: string, j: string) {
    const res = await sql(
      `SELECT "id", "statut"::text AS "statut", "clotureJournaliereId" FROM "SessionCaisse" WHERE "posteId" = $1 AND "jourMetier" = $2::date`,
      [posteId, j],
    );
    return res.rows[0];
  }

  async function cloture(j: string) {
    const res = await sql(
      `SELECT c."id", c."forcee", c."motifForcage", c."postesManquants" FROM "ClotureJournaliere" c JOIN "PointDeVente" pv ON pv."id" = c."pointDeVenteId" WHERE pv."structureId" = $1 AND c."jourMetier" = $2::date`,
      [kaloum, j],
    );
    return res.rows[0];
  }

  async function anomaliesDe(type: string, raison?: string) {
    const res = await sql(
      `SELECT "id", "statut"::text AS "statut", "attribueeAId", "commentaireTraitement", "details"
       FROM "Anomalie" WHERE "type"::text = $1 ${raison ? `AND "details"->>'raison' = $2` : ''} ORDER BY "creeLe", "id"`,
      raison ? [type, raison] : [type],
    );
    return res.rows as {
      id: string;
      statut: string;
      attribueeAId: string | null;
      commentaireTraitement: string | null;
      details: Record<string, unknown>;
    }[];
  }

  // ---------------------------------------------------------------- tests

  it('1. base vide : le jeu démo se crée et le scénario pharmacie se joue', async () => {
    expect(await seeder.creerJeuDeDonnees()).toBe(true);
    await seeder.rattacherRoles();
    const bilan = await seeder.jouerScenarioPharmacie();
    expect(bilan).toEqual(BILAN_ATTENDU);

    kaloum = await idPharmacie('pharmaKaloum');
    niger = await idPharmacie('pharmaNiger');
    titulaire = await idCompte('adminKaloum');
    vendeur = await idCompte('pharmaKeita');
    expect(
      String(
        (
          await sql('SELECT "adminId" FROM "Structure" WHERE "id" = $1', [
            kaloum,
          ])
        ).rows[0].adminId,
      ),
    ).toBe(titulaire);
  });

  it('2. stock calculé non nul et cohérent', async () => {
    expect((await verifierStock(base?.client as never)).totalAnomalies).toBe(0);
    expect(await stockFinal(kaloum)).toEqual(STOCK_FINAL_KALOUM);
    expect(await stockFinal(niger)).toEqual(STOCK_FINAL_NIGER);
    expect(await soldeLot('DL23K052')).toBe(6);
    expect(await soldeLot('CT23H990')).toBe(24);

    const ouverts = await sql(
      `SELECT m."nom" AS "nom" FROM "ConditionnementOuvert" c
       JOIN "StockMedicament" s ON s."id" = c."stockMedicamentId"
       JOIN "Medicament" m ON m."id" = s."medicamentId"
       WHERE c."fermeLe" IS NULL ORDER BY m."nom"`,
    );
    // Doliprane (boîte entamée à l'unité), Flagyl (idem) et Glucophage : l'inventaire
    // compte 11 boîtes et 25 unités, donc une boîte entamée à 25 unités.
    expect(ouverts.rows.map((r) => r.nom)).toEqual([
      'Doliprane 1000mg',
      'Flagyl 500mg',
      'Glucophage 850mg',
    ]);
  });

  it('3. journée J-2 clôturée normalement et exportable', async () => {
    const d = await posteDesktop();
    const c = await cloture(jour(-2));
    expect(c.forcee).toBe(false);
    expect(c.postesManquants).toEqual([]);
    const s2 = await sessionDuJour(String(d.id), jour(-2));
    expect(s2.statut).toBe('INCLUSE_DANS_CLOTURE');

    const totaux = await sql(
      `SELECT m."code" AS "mode", t."theorique", t."compte" FROM "TotalClotureMode" t JOIN "ModePaiement" m ON m."id" = t."modePaiementId" WHERE t."clotureId" = $1 ORDER BY m."code"`,
      [c.id],
    );
    expect(totaux.rows).toEqual([
      { mode: 'ESPECES', theorique: 213000, compte: 211000 },
      { mode: 'MTN_MOMO', theorique: 47000, compte: 47000 },
      { mode: 'ORANGE_MONEY', theorique: 87000, compte: 87000 },
    ]);

    const { contenu } = await clotures.exporter(kaloum, titulaire, jour(-2));
    const lignes = contenu
      .toString('utf8')
      .split('\r\n')
      .filter((l) => l !== '')
      .map((l) => l.split(';'))
      .slice(1);
    expect(lignes.filter((l) => l[1] === 'Pièce')).toHaveLength(6);
    expect(lignes.filter((l) => l[1] === 'Paiement')).toHaveLength(7);
    const mouvements = lignes.filter((l) => l[1] === 'Mouvement de caisse');
    expect(mouvements).toHaveLength(1);
    expect(mouvements[0][10]).toBe('-100000');
    expect(lignes.every((l) => l[12] === 'Oui')).toBe(true);
  });

  it('4. journée J-1 clôturée de force, la vente remontée est régularisée', async () => {
    const d = await posteDesktop();
    const c = await cloture(jour(-1));
    expect(c.forcee).toBe(true);
    const s1 = await sessionDuJour(String(d.id), jour(-1));
    const manquants = c.postesManquants as Record<string, unknown>[];
    expect(manquants[0]).toMatchObject({
      posteId: String(d.id),
      posteCode: 'D1',
      sessionId: s1.id,
    });
    expect(s1.statut).toBe('FERMEE');
    expect(s1.clotureJournaliereId).toBeNull();

    const debut = Number(
      (
        await sql('SELECT "debut" FROM "PlageTicket" WHERE "posteId" = $1', [
          d.id,
        ])
      ).rows[0].debut,
    );
    const t9 = (
      await sql(
        `SELECT "typePiece"::text AS "typePiece", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "origine", "sessionCaisseId" FROM "Vente" WHERE "posteId" = $1 AND "numeroTicket" = $2`,
        [d.id, debut + 8],
      )
    ).rows[0];
    expect(t9).toEqual({
      typePiece: 'REGULARISATION',
      jour: jour(0),
      origine: jour(-1),
      sessionCaisseId: s1.id,
    });

    const duJour = await anomaliesDe(
      'REMONTEE_APRES_CLOTURE',
      'JOURNEE_CLOTUREE',
    );
    expect(duJour).toHaveLength(1);
    expect(duJour[0]).toMatchObject({
      attribueeAId: vendeur,
      statut: 'OUVERTE',
    });
    const fermee = await anomaliesDe(
      'REMONTEE_APRES_CLOTURE',
      'CAISSE_FERMEE_APRES_CLOTURE',
    );
    expect(fermee).toHaveLength(1);
    expect(fermee[0]).toMatchObject({
      attribueeAId: titulaire,
      statut: 'TRAITEE',
      commentaireTraitement:
        'Tiroir du comptoir recompté avec Ousmane Keita : 224 000 GNF en espèces, conforme.',
    });
  });

  it('5. aujourd’hui : plaquette ouverte, vente sans stock et annulation', async () => {
    const ventes = (
      await sql(
        `SELECT v."id", v."numero", s."statut"::text AS "statut", s."utilisateurId", to_char(s."jourMetier", 'YYYY-MM-DD') AS "jour"
         FROM "Vente" v JOIN "SessionCaisse" s ON s."id" = v."sessionCaisseId" JOIN "Poste" p ON p."id" = v."posteId"
         WHERE v."structureId" = $1 AND p."type" = 'WEB' AND v."typePiece" = 'VENTE' ORDER BY v."createdAt"`,
        [kaloum],
      )
    ).rows;
    // Deux ventes web seulement : la vente sans stock passe par le poste (D721)
    expect(ventes).toHaveLength(2);
    const [w1, w3] = ventes;
    for (const w of [w1, w3]) {
      expect(w).toMatchObject({
        statut: 'OUVERTE',
        utilisateurId: vendeur,
        jour: jour(0),
      });
    }

    // Vente de Ventoline : rejouée par le poste, ticket 10, sur la caisse S3 du jour
    const d = await posteDesktop();
    const debut = Number(
      (
        await sql('SELECT "debut" FROM "PlageTicket" WHERE "posteId" = $1', [
          d.id,
        ])
      ).rows[0].debut,
    );
    const w2 = (
      await sql(
        `SELECT v."id", v."numero", v."typePiece"::text AS "typePiece", v."total", to_char(v."jourMetier", 'YYYY-MM-DD') AS "jour", s."id" AS "sessionId", s."statut"::text AS "statut", to_char(s."jourMetier", 'YYYY-MM-DD') AS "jourSession", s."utilisateurId"
         FROM "Vente" v JOIN "SessionCaisse" s ON s."id" = v."sessionCaisseId"
         WHERE v."posteId" = $1 AND v."numeroTicket" = $2`,
        [d.id, debut + 9],
      )
    ).rows[0];
    expect(w2).toMatchObject({
      typePiece: 'VENTE',
      total: 60000,
      jour: jour(0),
      statut: 'OUVERTE',
      jourSession: jour(0),
      utilisateurId: vendeur,
    });
    expect((await sessionDuJour(String(d.id), jour(0))).id).toBe(w2.sessionId);
    // Le paiement Orange Money est dans la caisse du poste, plus dans la caisse web
    const paiementsW2 = (
      await sql(
        `SELECT m."code" AS "mode", p."montant", p."referenceExterne" FROM "Paiement" p JOIN "ModePaiement" m ON m."id" = p."modePaiementId" WHERE p."venteId" = $1`,
        [w2.id],
      )
    ).rows;
    expect(paiementsW2).toEqual([
      { mode: 'ORANGE_MONEY', montant: 60000, referenceExterne: 'OM-7815530' },
    ]);
    const orangeWeb = await compter(
      `SELECT count(*)::int AS n FROM "Paiement" p JOIN "Vente" v ON v."id" = p."venteId" JOIN "Poste" po ON po."id" = v."posteId" JOIN "ModePaiement" m ON m."id" = p."modePaiementId" WHERE v."structureId" = $1 AND po."type" = 'WEB' AND m."code" = 'ORANGE_MONEY'`,
      [kaloum],
    );
    expect(orangeWeb).toBe(0);

    const allocations = await sql(
      `SELECT a."statut"::text AS "statut" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1`,
      [w2.id],
    );
    expect(allocations.rows).toEqual([{ statut: 'PROVISOIRE' }]);
    const anomalieW2 = (
      await sql(
        `SELECT "attribueeAId", "details" FROM "Anomalie" WHERE "type" = 'STOCK_NEGATIF' AND "pieceId" = $1`,
        [w2.id],
      )
    ).rows;
    expect(anomalieW2).toHaveLength(1);
    expect(anomalieW2[0].attribueeAId).toBe(titulaire);
    const details = anomalieW2[0].details as Record<string, unknown>;
    expect(details.message).toBe(
      `Ventoline 100 µg : 1 unité(s) vendue(s) sans stock disponible (vente ${String(w2.numero)}, poste ${details.posteCode as string}, Ousmane Keita). Le stock de ce médicament affiche 0 unité(s) et cette vente reste à régulariser : enregistrez la réception ou l'inventaire qui rattachera ces unités à un lot.`,
    );
    // Le stockage garde la vérité, la lecture écrête (D720)
    expect(details.soldeProduit).toBe(-1);
    const lues = (
      await anomalies.lister(kaloum, titulaire, { type: 'STOCK_NEGATIF' })
    ).data.anomalies.filter((a) => a.pieceId === w2.id);
    expect(lues).toHaveLength(1);
    expect((lues[0].details as Record<string, unknown>).soldeProduit).toBe(0);

    // Lecture du stock : jamais négatif, une boîte à régulariser (D713, D717)
    const lecture = (await pharmacie.getStockPharmacie(kaloum, titulaire))
      .data as unknown as {
      stocks: {
        quantite: number;
        quantiteARegulariser: number;
        medicament: { nom: string };
      }[];
      alertes: { rupture: { nom: string; quantiteARegulariser: number }[] };
    };
    const ventoline = lecture.stocks.find(
      (s) => s.medicament.nom === 'Ventoline 100 µg',
    );
    expect(ventoline).toMatchObject({ quantite: 0, quantiteARegulariser: 1 });
    expect(
      lecture.alertes.rupture.find((r) => r.nom === 'Ventoline 100 µg'),
    ).toMatchObject({ quantiteARegulariser: 1 });
    expect(lecture.stocks.every((s) => s.quantite >= 0)).toBe(true);

    const annulation = (
      await sql(
        `SELECT v."numero", v."typePiece"::text AS "typePiece", s."statut"::text AS "statut", s."utilisateurId"
         FROM "Vente" v JOIN "SessionCaisse" s ON s."id" = v."sessionCaisseId"
         WHERE v."venteOrigineId" = $1`,
        [w3.id],
      )
    ).rows[0];
    expect(annulation).toEqual({
      numero: `A-${String(w3.numero)}`,
      typePiece: 'ANNULATION',
      statut: 'OUVERTE',
      utilisateurId: titulaire,
    });
  });

  it('6. inventaire, alertes de péremption et marge', async () => {
    const ecarts = await anomaliesDe('ECART_INVENTAIRE');
    expect(ecarts).toHaveLength(2);
    const parNom = new Map(ecarts.map((a) => [String(a.details.nom), a]));
    const glucophage = parNom.get('Glucophage 850mg');
    const augmentin = parNom.get('Augmentin 1g/125mg');
    expect(glucophage?.attribueeAId).toBe(titulaire);
    expect(augmentin?.attribueeAId).toBe(titulaire);
    expect(glucophage?.details.ecart).toBe(-5);
    expect(augmentin?.details.ecart).toBe(16);
    expect(glucophage?.details.message).toBe(
      `Inventaire de Glucophage 850mg par ${String(glucophage?.details.utilisateurNom)} : écart de -5 unité(s), au-delà de la tolérance de 3 unité(s). Vérifiez le comptage avant de traiter cette anomalie.`,
    );
    expect(augmentin?.details.message).toBe(
      `Inventaire de Augmentin 1g/125mg par ${String(augmentin?.details.utilisateurNom)} : écart de +16 unité(s), au-delà de la tolérance de 0 unité(s). Vérifiez le comptage avant de traiter cette anomalie.`,
    );

    const alertes = (await rapports.alertesPeremption(kaloum, titulaire)).data;
    const lotsDe = (jours: number) =>
      alertes.horizons
        .find((h) => h.jours === jours)
        ?.lots.map((l) => l.numeroLot);
    expect(lotsDe(7)).toEqual(['CT23H990']);
    expect(lotsDe(30)).toEqual(['DL23K052']);
    expect(lotsDe(90)).toEqual(['FG24E118']);
    expect(alertes.perimes.lots.map((l) => l.numeroLot)).toEqual(['AG23C777']);

    const marge = (
      await rapports.rapportMarge(kaloum, titulaire, {
        du: jour(-2),
        au: jour(0),
      })
    ).data;
    // La vente T5 touche le lot d'ibuprofène reçu sans coût : non valorisable.
    expect(marge.nonValorisable.nombreVentes).toBe(1);
    expect(marge.nonValorisable.chiffreAffaires).toBe(12000);
    // La vente de Ventoline, rejouée par le poste, n'a aucun lot : comptée à part, provisoire.
    expect(marge.provisoires.nombreLignes).toBe(1);
    expect(marge.provisoires.chiffreAffaires).toBe(60000);
    expect(marge.chiffreAffairesValorise).toBeGreaterThan(0);
  });

  it('7. Niger : réception et fiche reprise à qualifier', async () => {
    const spasfon = (
      await sql(
        `SELECT s."id", s."qualifie", s."coefficientBoite" FROM "StockMedicament" s JOIN "Medicament" m ON m."id" = s."medicamentId" WHERE s."structureId" = $1 AND m."nom" = 'Spasfon'`,
        [niger],
      )
    ).rows[0];
    expect(spasfon).toMatchObject({ qualifie: false, coefficientBoite: 1 });
    const lots = (
      await sql(
        `SELECT "quantiteRecue", "coutUnitaire", "lotTechnique" FROM "LotStock" WHERE "stockMedicamentId" = $1`,
        [spasfon.id],
      )
    ).rows;
    expect(lots).toEqual([
      { quantiteRecue: 60, coutUnitaire: 0, lotTechnique: true },
    ]);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "StockMedicament" WHERE "structureId" = $1 AND "qualifie"`,
        [niger],
      ),
    ).toBe(5);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "StockMedicament" WHERE "structureId" = $1`,
        [niger],
      ),
    ).toBe(6);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Vente" WHERE "structureId" = $1`,
        [niger],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "SessionCaisse" s JOIN "PointDeVente" pv ON pv."id" = s."pointDeVenteId" WHERE pv."structureId" = $1 AND NOT s."technique"`,
        [niger],
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Paiement" p JOIN "Vente" v ON v."id" = p."venteId" WHERE v."structureId" = $1`,
        [niger],
      ),
    ).toBe(0);
  });

  it('8. poste desktop : plage et état', async () => {
    const d = await posteDesktop();
    expect(d).toMatchObject({
      typeTexte: 'DESKTOP',
      actif: true,
      code: 'D1',
      libelle: 'Comptoir principal',
      derniereSequenceAppliquee: 19,
    });
    expect((d.dernierEtat as Record<string, unknown>).fileVide).toBe(true);
    const plages = (
      await sql(
        'SELECT "debut", "fin" FROM "PlageTicket" WHERE "posteId" = $1',
        [d.id],
      )
    ).rows;
    expect(plages).toHaveLength(1);
    expect(Number(plages[0].fin) - Number(plages[0].debut) + 1).toBe(1000);
    const evenements = (
      await sql(
        `SELECT "statut"::text AS "statut" FROM "EvenementSynchro" WHERE "posteId" = $1`,
        [d.id],
      )
    ).rows;
    expect(evenements).toHaveLength(19);
    expect(evenements.every((e) => e.statut === 'APPLIQUE')).toBe(true);
  });

  it('9. purge complète : toutes les tables de la tranche', async () => {
    // Les modèles reliés à Structure par un Restrict sont exactement les 28 de la tranche.
    expect(modelesRestrictDepuisStructure()).toEqual(MODELES_DE_LA_TRANCHE);

    const avant = await comptesParModele();
    for (const modele of MODELES_DE_LA_TRANCHE) {
      expect({ modele, lignes: avant[modele] > 0 }).toEqual({
        modele,
        lignes: true,
      });
    }
    const filtre = `%@demo.medconnecte.gn`;
    const idsComptes = (
      await sql(`SELECT "id" FROM "User" WHERE "email" LIKE $1`, [filtre])
    ).rows.map((r) => String(r.id));
    const demoAvant = {
      comptes: idsComptes.length,
      structures: await compter(
        `SELECT count(*)::int AS n FROM "Structure" WHERE "email" LIKE $1`,
        [filtre],
      ),
      audits: await compter(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "userId" = ANY($1::text[])`,
        [idsComptes],
      ),
      medicaments: await compter(`SELECT count(*)::int AS n FROM "Medicament"`),
      stocks: await compter(`SELECT count(*)::int AS n FROM "StockMedicament"`),
    };
    expect(demoAvant.comptes).toBe(20);
    expect(demoAvant.structures).toBe(5);
    expect(demoAvant.audits).toBeGreaterThan(0);
    expect(demoAvant.stocks).toBeGreaterThan(0);

    const apres: Record<string, number> = {};
    await expect(
      prisma.$transaction(
        async (tx) => {
          await seeder.purger(tx);
          const lire = async (requete: string, ...valeurs: unknown[]) => {
            const lignes = await tx.$queryRawUnsafe<{ n: number }[]>(
              requete,
              ...valeurs,
            );
            return Number(lignes[0].n);
          };
          for (const modele of MODELES_DE_LA_TRANCHE) {
            apres[modele] = await lire(
              `SELECT count(*)::int AS n FROM "${modele}"`,
            );
          }
          apres.StockMedicament = await lire(
            `SELECT count(*)::int AS n FROM "StockMedicament"`,
          );
          apres.comptes = await lire(
            `SELECT count(*)::int AS n FROM "User" WHERE "email" LIKE $1`,
            filtre,
          );
          apres.structures = await lire(
            `SELECT count(*)::int AS n FROM "Structure" WHERE "email" LIKE $1`,
            filtre,
          );
          apres.audits = await lire(
            `SELECT count(*)::int AS n FROM "AuditLog" WHERE "userId" = ANY($1::text[])`,
            idsComptes,
          );
          apres.medicaments = await lire(
            `SELECT count(*)::int AS n FROM "Medicament"`,
          );
          throw new Error(SENTINELLE);
        },
        { maxWait: 10_000, timeout: 120_000 },
      ),
    ).rejects.toThrow(SENTINELLE);

    for (const modele of MODELES_DE_LA_TRANCHE) {
      expect({ modele, lignes: apres[modele] }).toEqual({ modele, lignes: 0 });
    }
    expect(apres.StockMedicament).toBe(0);
    expect(apres.comptes).toBe(0);
    expect(apres.structures).toBe(0);
    expect(apres.audits).toBe(0);
    expect(apres.medicaments).toBe(demoAvant.medicaments);

    // La transaction annulée n'a rien laissé : tout est comme avant.
    expect(await comptesParModele()).toEqual(avant);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "User" WHERE "email" LIKE $1`,
        [filtre],
      ),
    ).toBe(demoAvant.comptes);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "userId" = ANY($1::text[])`,
        [idsComptes],
      ),
    ).toBe(demoAvant.audits);
    comptesAvantPurge = avant;
  });

  it('10. purge puis recréation', async () => {
    idsStructuresAvant = (
      await sql(`SELECT "id" FROM "Structure" WHERE "email" LIKE $1`, [
        '%@demo.medconnecte.gn',
      ])
    ).rows.map((r) => String(r.id));
    expect(idsStructuresAvant).toHaveLength(5);

    expect(await seeder.reinitialiserJeuDeDonnees()).toEqual({
      comptes: 20,
      structures: 5,
    });
    const anciens = await compter(
      `SELECT count(*)::int AS n FROM "Structure" WHERE "id" = ANY($1::text[])`,
      [idsStructuresAvant],
    );
    expect(anciens).toBe(0);

    const bilan = await seeder.jouerScenarioPharmacie();
    expect(bilan).toEqual(BILAN_ATTENDU);
    expect((await verifierStock(base?.client as never)).totalAnomalies).toBe(0);
    expect(await comptesParModele()).toEqual(comptesAvantPurge);

    const nouveauKaloum = await idPharmacie('pharmaKaloum');
    const nouveauNiger = await idPharmacie('pharmaNiger');
    expect(await stockFinal(nouveauKaloum)).toEqual(STOCK_FINAL_KALOUM);
    expect(await stockFinal(nouveauNiger)).toEqual(STOCK_FINAL_NIGER);
  });
});
