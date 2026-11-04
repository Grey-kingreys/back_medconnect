import { randomUUID } from 'node:crypto';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import type { NotificationsService } from 'src/notifications/notifications.service';
import { AnomaliesService } from 'src/pharmacie/anomalies/anomalies.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { avecStock, lireEtatsStock } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { CatalogueSynchroService } from 'src/pharmacie/synchro/catalogue-synchro.service';
import {
  SynchroService,
  type ReponseSynchro,
  type ResultatEvenement,
} from 'src/pharmacie/synchro/synchro.service';
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

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const ip = '127.0.0.1';
const CLIENT_NOM = 'Mariama Camara';
const CLIENT_TELEPHONE = '620123456';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

interface PosteTest {
  id: string;
  code: string;
  debut: number;
  fin: number;
  utilises: number;
}

interface EvenementEnvoye {
  evenementId: string;
  sequence: number;
  type: string;
  horodatageLocal: string;
  utilisateurId: string;
  corps: unknown;
}

interface LigneTest {
  stockId: string;
  unite?: 'BOITE' | 'UNITE';
  nombre: number;
  prixUnitaire: number;
  quantiteProvisoireLocale?: number;
  ouvertureConditionnement?: boolean;
  sortieManuelle?: { lotId: string; motif: string };
}

interface OptionsVente {
  numeroTicket?: number;
  numeroSecours?: number;
  deuxNumeros?: boolean;
  ordonnanceVerifiee?: boolean;
  venteId?: string;
  total?: number;
  paiementTotal?: number;
  avecClient?: boolean;
}

interface PrixFiche {
  boite: number;
  unite: number | null;
}

describe('Synchro desktop : rejeu des ventes, sur base de test (PB18c)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let synchro: SynchroService;
  let catalogue: CatalogueSynchroService;
  let service: VenteService;
  let receptions: ReceptionsService;
  let anomaliesService: AnomaliesService;
  let postes: PointsDeVenteService;
  let pv1: string;
  let D1: PosteTest;
  let D2: PosteTest;
  let compteurFiche = 0;
  const prix = new Map<string, PrixFiche>();
  const heure = () => new Date().toISOString();

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
                'vente:write',
                'caisse:utiliser',
                'caisse:superviser',
                'cloture:gerer',
                'stock:write',
                'reception:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const notifications = {
      createManyNotifications: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const mouvements = new MouvementsStockService();
    const sessions = new SessionsCaisseService(prisma, acces, permissions);
    postes = new PointsDeVenteService(prisma, acces);
    catalogue = new CatalogueSynchroService(prisma, acces, stockage);
    synchro = new SynchroService(prisma, acces, mouvements, sessions);
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
    anomaliesService = new AnomaliesService(prisma, acces);
    await sql(
      `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = $1`,
      [PHARMACIE],
    );
    pv1 = String(
      (
        await sql(
          'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
          [PHARMACIE],
        )
      ).rows[0].id,
    );
    D1 = await creerPoste('desktop-pb18c-1');
    D2 = await creerPoste('desktop-pb18c-2');
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

  // ------------------------------------------------------------ aides base

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

  async function compter(requete: string, valeurs: unknown[] = []) {
    const res = await sql(requete, valeurs);
    return Number(res.rows[0].n);
  }

  async function creerPoste(appareilId: string): Promise<PosteTest> {
    const poste = await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'DESKTOP',
      appareilId,
    });
    const plage = await postes.attribuerPlage(
      PHARMACIE,
      RESPONSABLE,
      poste.data.id,
      { id: randomUUID() },
    );
    return {
      id: poste.data.id,
      code: poste.data.code,
      debut: plage.data.debut,
      fin: plage.data.fin,
      utilises: 0,
    };
  }

  const ticket = (p: PosteTest) => p.debut + p.utilises++;
  const sept = (n: number) => String(n).padStart(7, '0');

  async function nouvelleFiche(
    o: {
      nom?: string;
      prixBoite?: number;
      coefficient?: number;
      prixUnite?: number | null;
      deconditionnable?: boolean;
      ordonnance?: boolean;
    } = {},
  ): Promise<string> {
    compteurFiche += 1;
    const n = compteurFiche;
    const stockId = `stk-vsy-${n}`;
    const prixBoite = o.prixBoite ?? 1000;
    const prixUnite = o.prixUnite ?? null;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB18c', $3, now())`,
      [`med-vsy-${n}`, o.nom ?? `Produit synchro ${n}`, o.ordonnance ?? false],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "prixUnite", "coefficientBoite", "deconditionnable", "qualifie", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, $7, true, now())`,
      [
        stockId,
        `med-vsy-${n}`,
        PHARMACIE,
        prixBoite,
        prixUnite,
        o.coefficient ?? 1,
        o.deconditionnable ?? false,
      ],
    );
    prix.set(stockId, { boite: prixBoite, unite: prixUnite });
    return stockId;
  }

  async function recevoir(stockId: string, boites: number): Promise<string> {
    const r = await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        lignes: [{ stockId, nombreBoites: boites, dateExpiration: jour(300) }],
      },
      ip,
    );
    return (r as unknown as { data: { lots: { id: string }[] } }).data.lots[0]
      .id;
  }

  async function ficheStockee(
    boites: number,
    o: Parameters<typeof nouvelleFiche>[0] = {},
  ): Promise<{ stockId: string; lotId: string }> {
    const stockId = await nouvelleFiche(o);
    return { stockId, lotId: await recevoir(stockId, boites) };
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

  // ---------------------------------------------------------- aides envoi

  const ligne = (
    stockId: string,
    nombre: number,
    o: Partial<LigneTest> = {},
  ): LigneTest => {
    const p = prix.get(stockId);
    const unite = o.unite ?? 'BOITE';
    return {
      stockId,
      unite,
      nombre,
      prixUnitaire:
        o.prixUnitaire ??
        (unite === 'UNITE' ? (p?.unite ?? 0) : (p?.boite ?? 0)),
      ...(o.quantiteProvisoireLocale === undefined
        ? {}
        : { quantiteProvisoireLocale: o.quantiteProvisoireLocale }),
      ...(o.ouvertureConditionnement === undefined
        ? {}
        : { ouvertureConditionnement: o.ouvertureConditionnement }),
      ...(o.sortieManuelle ? { sortieManuelle: o.sortieManuelle } : {}),
    };
  };

  function evOuverture(
    sequence: number,
    sessionId: string,
    utilisateur = VENDEUR,
  ): EvenementEnvoye {
    return {
      evenementId: randomUUID(),
      sequence,
      type: 'SESSION_OUVERTE',
      horodatageLocal: heure(),
      utilisateurId: utilisateur,
      corps: { sessionId },
    };
  }

  function evVente(
    poste: PosteTest,
    sequence: number,
    sessionId: string,
    lignes: LigneTest[],
    o: OptionsVente = {},
  ): EvenementEnvoye & { venteId: string } {
    const venteId = o.venteId ?? randomUUID();
    const total =
      o.total ?? lignes.reduce((s, l) => s + l.nombre * l.prixUnitaire, 0);
    const numeros =
      o.numeroSecours !== undefined && !o.deuxNumeros
        ? { numeroSecours: o.numeroSecours }
        : {
            numeroTicket: o.numeroTicket ?? ticket(poste),
            ...(o.deuxNumeros ? { numeroSecours: 1 } : {}),
          };
    return {
      evenementId: randomUUID(),
      sequence,
      type: 'VENTE',
      horodatageLocal: heure(),
      utilisateurId: VENDEUR,
      venteId,
      corps: {
        venteId,
        sessionId,
        ...numeros,
        lignes,
        paiements: [{ mode: 'ESPECES', montant: o.paiementTotal ?? total }],
        total,
        ordonnanceVerifiee: o.ordonnanceVerifiee ?? true,
        ...(o.avecClient
          ? { clientNom: CLIENT_NOM, clientTelephone: CLIENT_TELEPHONE }
          : {}),
      },
    };
  }

  async function envoyer(
    poste: PosteTest,
    evenements: EvenementEnvoye[],
  ): Promise<ReponseSynchro> {
    const sansVenteId = evenements.map((e) => ({
      evenementId: e.evenementId,
      sequence: e.sequence,
      type: e.type,
      horodatageLocal: e.horodatageLocal,
      utilisateurId: e.utilisateurId,
      corps: e.corps,
    }));
    const r = await synchro.recevoir(
      PHARMACIE,
      VENDEUR,
      {
        posteId: poste.id,
        etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' },
        evenements: sansVenteId,
      },
      ip,
    );
    return r.data;
  }

  async function derniere(poste: PosteTest): Promise<number> {
    const res = await sql(
      `SELECT "derniereSequenceAppliquee" AS n FROM "Poste" WHERE "id" = $1`,
      [poste.id],
    );
    return Number(res.rows[0].n);
  }

  /** Envoie une vente seule à la prochaine séquence du poste. */
  async function vendre(
    poste: PosteTest,
    sessionId: string,
    lignes: LigneTest[],
    o: OptionsVente = {},
  ) {
    const e = evVente(poste, (await derniere(poste)) + 1, sessionId, lignes, o);
    const r = await envoyer(poste, [e]);
    expect(r.resultats).toHaveLength(1);
    return { e, venteId: e.venteId, resultat: r.resultats[0] };
  }

  // ------------------------------------------------------- aides lecture

  async function pieceDe(venteId: string) {
    const res = await sql(
      `SELECT "id", "numero", "numeroTicket", "typePiece"::text AS "typePiece", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", "horodatageLocal", "sequencePoste", "vendeurId", "cleIdempotence", "posteId", "sessionCaisseId", "total" FROM "Vente" WHERE "id" = $1`,
      [venteId],
    );
    return res.rows[0];
  }

  async function lignesDe(venteId: string) {
    return (
      await sql(
        `SELECT "id", "quantite", "prixUnitaire", "sousTotal", "coefficientApplique", "uniteAffichee"::text AS "unite", "nombreAffiche" FROM "LigneVente" WHERE "venteId" = $1 ORDER BY "id"`,
        [venteId],
      )
    ).rows;
  }

  async function allocationsDe(venteId: string) {
    return (
      await sql(
        `SELECT a."statut"::text AS "statut", a."quantite", a."lotId", a."sortieManuelle", a."motif" FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."venteId" = $1 ORDER BY a."statut", a."quantite", a."id"`,
        [venteId],
      )
    ).rows;
  }

  async function mouvementsDe(venteId: string) {
    return (
      await sql(
        `SELECT "evenementId", "quantite", "lotId", "posteId", "sequencePoste", "motif" FROM "MouvementStock" WHERE "pieceOrigineType" = 'VENTE' AND "pieceOrigineId" = $1 ORDER BY "evenementId"`,
        [venteId],
      )
    ).rows;
  }

  async function anomalies(type: string, pieceId?: string) {
    const res = await sql(
      `SELECT "id", "pieceType", "pieceId", "attribueeAId", "statut"::text AS "statut", "details" FROM "Anomalie" WHERE "type"::text = $1 ${pieceId ? 'AND "pieceId" = $2' : ''} ORDER BY "creeLe", "id"`,
      pieceId ? [type, pieceId] : [type],
    );
    return res.rows as {
      id: string;
      pieceType: string;
      pieceId: string;
      attribueeAId: string | null;
      statut: string;
      details: Record<string, unknown>;
    }[];
  }

  async function compteursVente(venteId: string) {
    return {
      ventes: await compter('SELECT count(*) AS n FROM "Vente"'),
      lignes: await compter('SELECT count(*) AS n FROM "LigneVente"'),
      allocations: await compter('SELECT count(*) AS n FROM "AllocationLot"'),
      paiements: await compter('SELECT count(*) AS n FROM "Paiement"'),
      mouvements: await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "pieceOrigineId" = $1`,
        [venteId],
      ),
      audits: await compter(
        `SELECT count(*) AS n FROM "AuditLog" WHERE "entityId" = $1`,
        [venteId],
      ),
    };
  }

  async function rattachementDe(anomalieId: string): Promise<string | null> {
    const r = (await anomaliesService.lister(PHARMACIE, RESPONSABLE, {
      type: 'STOCK_NEGATIF',
    })) as unknown as {
      data: {
        anomalies: { id: string; rattachement: { etat: string } | null }[];
      };
    };
    return (
      r.data.anomalies.find((a) => a.id === anomalieId)?.rattachement?.etat ??
      null
    );
  }

  const statuts = (r: ReponseSynchro) => r.resultats.map((x) => x.statut);

  function unique(r: ReponseSynchro): ResultatEvenement {
    expect(r.resultats).toHaveLength(1);
    return r.resultats[0];
  }

  // ---------------------------------------------------------------- état

  const S1 = randomUUID();
  const S2 = randomUUID();
  let F: string;
  let lotF: string;
  let lotsEnvoyes: (EvenementEnvoye & { venteId: string })[] = [];
  let ouvertureS1: EvenementEnvoye;
  let ventePremiere: { venteId: string; numero: string };

  it('1. vente du poste rejouée', async () => {
    ({ stockId: F, lotId: lotF } = await ficheStockee(10));
    ouvertureS1 = evOuverture(1, S1);
    const vente = evVente(D1, 2, S1, [ligne(F, 2)]);
    lotsEnvoyes = [vente];
    const r = await envoyer(D1, [ouvertureS1, vente]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE']);
    const resultat = r.resultats[1];
    expect(resultat.anomalies ?? []).toEqual([]);
    const numero = `T1-${sept(D1.debut)}`;
    expect(resultat.piece).toEqual({
      type: 'VENTE',
      id: vente.venteId,
      numero,
    });
    ventePremiere = { venteId: vente.venteId, numero };

    const piece = await pieceDe(vente.venteId);
    const session = await sql(
      `SELECT to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "SessionCaisse" WHERE "id" = $1`,
      [S1],
    );
    expect(piece).toMatchObject({
      id: vente.venteId,
      numero,
      numeroTicket: D1.debut,
      typePiece: 'VENTE',
      jour: session.rows[0].jour,
      sequencePoste: 2,
      vendeurId: VENDEUR,
      cleIdempotence: null,
      posteId: D1.id,
      sessionCaisseId: S1,
    });
    expect((piece.horodatageLocal as Date).toISOString()).toBe(
      vente.horodatageLocal,
    );
    const lignes = await lignesDe(vente.venteId);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ quantite: 2, sousTotal: 2000 });
    expect(await allocationsDe(vente.venteId)).toEqual([
      expect.objectContaining({
        statut: 'DEFINITIVE',
        quantite: 2,
        lotId: lotF,
      }),
    ]);
    const paiements = await sql(
      `SELECT "montant", "sessionCaisseId" FROM "Paiement" WHERE "venteId" = $1`,
      [vente.venteId],
    );
    expect(paiements.rows).toEqual([{ montant: 2000, sessionCaisseId: S1 }]);
    expect(await mouvementsDe(vente.venteId)).toEqual([
      expect.objectContaining({
        evenementId: `synchro:${vente.evenementId}:0:${lotF}`,
        quantite: -2,
        posteId: D1.id,
        sequencePoste: 2,
      }),
    ]);
    expect(await soldeLot(lotF)).toBe(8);
    const audit = await sql(
      `SELECT "metadata", "userId" FROM "AuditLog" WHERE "entityType" = 'Vente' AND "entityId" = $1`,
      [vente.venteId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].userId).toBe(VENDEUR);
    expect(audit.rows[0].metadata).toMatchObject({
      origine: 'synchro',
      numero,
      total: 2000,
      nombreLignes: 1,
      provisoire: false,
      sequence: 2,
    });
    expect(await anomalies('STOCK_NEGATIF', vente.venteId)).toEqual([]);
  });

  it('2. doublon : le même journal rejoué ne crée rien (CA25)', async () => {
    const avant = await compteursVente(lotsEnvoyes[0].venteId);
    const r = await envoyer(D1, [ouvertureS1, lotsEnvoyes[0]]);
    expect(statuts(r)).toEqual(['DEJA_APPLIQUE', 'DEJA_APPLIQUE']);
    expect(r.resultats[1].piece).toEqual({
      type: 'VENTE',
      id: ventePremiere.venteId,
      numero: ventePremiere.numero,
    });
    expect(await compteursVente(lotsEnvoyes[0].venteId)).toEqual(avant);
    expect(await soldeLot(lotF)).toBe(8);
  });

  it('3. CA25 : deux envois simultanés du même journal', async () => {
    const base0 = (await derniere(D1)) + 1;
    const e1 = evVente(D1, base0, S1, [ligne(F, 1)]);
    const e2 = evVente(D1, base0 + 1, S1, [ligne(F, 1)]);
    const [a, b] = await Promise.all([
      envoyer(D1, [e1, e2]),
      envoyer(D1, [e1, e2]),
    ]);
    for (const e of [e1, e2]) {
      const rendus = [...a.resultats, ...b.resultats]
        .filter((x) => x.evenementId === e.evenementId)
        .map((x) => x.statut)
        .sort();
      expect(rendus).toEqual(['APPLIQUE', 'DEJA_APPLIQUE']);
      expect(await mouvementsDe(e.venteId)).toHaveLength(1);
    }
    expect(await soldeLot(lotF)).toBe(6);
  });

  it('4. ordre inversé : attente puis application dans l ordre', async () => {
    const b = (await derniere(D1)) + 1;
    const e5 = evVente(D1, b, S1, [ligne(F, 1)]);
    const e6 = evVente(D1, b + 1, S1, [ligne(F, 1)]);
    const e7 = evVente(D1, b + 2, S1, [ligne(F, 1)]);
    const attente = await envoyer(D1, [e7, e6]);
    expect(statuts(attente)).toEqual(['EN_ATTENTE', 'EN_ATTENTE']);
    expect(await pieceDe(e6.venteId)).toBeUndefined();
    expect(await pieceDe(e7.venteId)).toBeUndefined();

    const r = await envoyer(D1, [e5]);
    expect(statuts(r)).toEqual(['APPLIQUE', 'APPLIQUE', 'APPLIQUE']);
    expect(r.resultats.map((x) => x.evenementId)).toEqual([
      e5.evenementId,
      e6.evenementId,
      e7.evenementId,
    ]);
    expect(r.resultats.map((x) => x.differe === true)).toEqual([
      false,
      true,
      true,
    ]);
    const pieces = await sql(
      `SELECT "id", "numeroTicket" FROM "Vente" WHERE "id" = ANY($1) ORDER BY "sequencePoste"`,
      [[e5.venteId, e6.venteId, e7.venteId]],
    );
    expect(pieces.rows.map((p) => p.id)).toEqual([
      e5.venteId,
      e6.venteId,
      e7.venteId,
    ]);
    const numeros = pieces.rows.map((p) => Number(p.numeroTicket));
    expect([...numeros].sort((x, y) => x - y)).toEqual(numeros);
    expect(await soldeLot(lotF)).toBe(3);
  });

  it('5. stock négatif temporaire, puis rattachement par une réception (CA24)', async () => {
    const { stockId: H, lotId: lotH } = await ficheStockee(1);
    const { e, venteId, resultat } = await vendre(D1, S1, [
      ligne(H, 3, { quantiteProvisoireLocale: 2 }),
    ]);
    expect(resultat.statut).toBe('APPLIQUE');
    expect(await allocationsDe(venteId)).toEqual([
      expect.objectContaining({
        statut: 'DEFINITIVE',
        quantite: 1,
        lotId: lotH,
      }),
      expect.objectContaining({
        statut: 'PROVISOIRE',
        quantite: 2,
        lotId: null,
      }),
    ]);
    const mouvements = await mouvementsDe(venteId);
    expect(mouvements).toHaveLength(2);
    expect(mouvements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evenementId: `synchro:${e.evenementId}:0:${lotH}`,
          lotId: lotH,
          quantite: -1,
        }),
        expect.objectContaining({
          evenementId: `synchro:${e.evenementId}:0:provisoire`,
          lotId: null,
          quantite: -2,
        }),
      ]),
    );
    expect(await soldeProduit(H)).toBe(-2);

    const [anomalie] = await anomalies('STOCK_NEGATIF', venteId);
    expect(anomalie.attribueeAId).toBe(RESPONSABLE);
    expect(anomalie.details).toMatchObject({
      stockId: H,
      quantiteProvisoire: 2,
      quantiteProvisoireLocale: 2,
      origine: 'SYNCHRO',
      posteCode: D1.code,
      evenementId: e.evenementId,
    });
    expect(await rattachementDe(anomalie.id)).toBe('EN_ATTENTE');

    const nouveauLot = await recevoir(H, 5);
    const allocations = await allocationsDe(venteId);
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ statut: 'REMPLACEE', quantite: 2 }),
        expect.objectContaining({
          statut: 'DEFINITIVE',
          quantite: 2,
          lotId: nouveauLot,
        }),
      ]),
    );
    expect(allocations.filter((a) => a.statut === 'PROVISOIRE')).toEqual([]);
    expect(await soldeProduit(H)).toBe(3);
    expect(await rattachementDe(anomalie.id)).toBe('RATTACHEE');
  });

  it('5 bis. fiche à zéro en rejeu : toujours acceptée, provisoire, anomalie, agrégat négatif, lecture écrêtée (D713.2)', async () => {
    // Le rejeu garde son comportement : la vente faite hors ligne est acceptée
    // même sans aucun stock (provisoireAutorise: true), contrairement à la route web
    const stockId = await nouvelleFiche({ prixBoite: 1500 });
    expect(await soldeProduit(stockId)).toBe(0);

    const { venteId, resultat } = await vendre(D1, S1, [ligne(stockId, 2)]);

    expect(resultat.statut).toBe('APPLIQUE');
    expect(await allocationsDe(venteId)).toEqual([
      expect.objectContaining({
        statut: 'PROVISOIRE',
        quantite: 2,
        lotId: null,
      }),
    ]);
    const [anomalie] = await anomalies('STOCK_NEGATIF', venteId);
    expect(anomalie.attribueeAId).toBe(RESPONSABLE);
    expect(anomalie.details).toMatchObject({
      stockId,
      quantiteProvisoire: 2,
      soldeProduit: -2,
      origine: 'SYNCHRO',
    });
    expect(await soldeProduit(stockId)).toBe(-2);

    // Lecture : jamais négative, deux unités à régulariser (D717)
    const etats = await lireEtatsStock(prisma, [stockId], jour(0));
    const lue = avecStock({ archiveLe: null }, etats.get(stockId) as never);
    expect(lue.quantite).toBe(0);
    expect(lue.quantiteARegulariser).toBe(2);
    expect(lue.quantiteVendable).toBe(0);
    expect(lue.disponible).toBe(false);

    // Photographie du poste : même contrat, jamais le négatif (D719)
    const photo = await catalogue.photographier(PHARMACIE, RESPONSABLE, D1.id);
    expect(photo.fiches.find((f) => f.stockId === stockId)).toMatchObject({
      quantite: 0,
      quantiteARegulariser: 2,
    });
    expect(photo.fiches.every((f) => f.quantite >= 0)).toBe(true);

    // Une vente web de cette fiche est en revanche refusée
    await expect(
      service.creerVente(
        PHARMACIE,
        VENDEUR,
        { lignes: [{ stockId, quantite: 1 }] },
        undefined,
        ip,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await soldeProduit(stockId)).toBe(-2);
  });

  it('6. résolution d allocation provisoire à la synchro', async () => {
    const { stockId: K } = await ficheStockee(5);
    const { venteId, resultat } = await vendre(D1, S1, [
      ligne(K, 2, { quantiteProvisoireLocale: 2 }),
    ]);
    expect(resultat.statut).toBe('APPLIQUE');
    const allocations = await allocationsDe(venteId);
    expect(allocations).toEqual([
      expect.objectContaining({ statut: 'DEFINITIVE', quantite: 2 }),
    ]);
    const [anomalie] = await anomalies('STOCK_NEGATIF', venteId);
    expect(anomalie.details).toMatchObject({
      quantiteProvisoire: 0,
      quantiteProvisoireLocale: 2,
    });
    expect(resultat.piece?.numero).toBeTruthy();
    expect(anomalie.details.message).toBe(
      `${String(anomalie.details.nom)} : le poste ${D1.code} a vendu 2 unité(s) sans stock (vente ${String(resultat.piece?.numero)}, ${String(anomalie.details.utilisateurNom)}) ; le serveur a trouvé du stock pour cette vente. Vérifiez le stock de ce médicament sur le poste.`,
    );
    expect(await rattachementDe(anomalie.id)).toBe('RATTACHEE');
    expect(await soldeProduit(K)).toBe(3);
  });

  it('7. il ne reste que du périmé : provisoire, jamais de périmé pris seul', async () => {
    const { stockId: P, lotId: lotP } = await ficheStockee(2);
    await sql(
      `UPDATE "LotStock" SET "dateExpiration" = $2::date WHERE "id" = $1`,
      [lotP, jour(-2)],
    );
    const premiere = await vendre(D1, S1, [ligne(P, 1)]);
    expect(await allocationsDe(premiere.venteId)).toEqual([
      expect.objectContaining({ statut: 'PROVISOIRE', quantite: 1 }),
    ]);
    expect(await soldeLot(lotP)).toBe(2);
    const [anomalie] = await anomalies('STOCK_NEGATIF', premiere.venteId);
    expect(anomalie.details).toMatchObject({
      quantiteProvisoire: 1,
      perimesDisponibles: 1,
    });

    const motif = 'Dernière boîte, client prévenu';
    const manuelle = await vendre(D1, S1, [
      ligne(P, 1, { sortieManuelle: { lotId: lotP, motif } }),
    ]);
    expect(manuelle.resultat.statut).toBe('APPLIQUE');
    expect(await allocationsDe(manuelle.venteId)).toEqual([
      expect.objectContaining({
        statut: 'DEFINITIVE',
        quantite: 1,
        lotId: lotP,
        sortieManuelle: true,
        motif,
      }),
    ]);
    expect(
      (await mouvementsDe(manuelle.venteId)).map((m) => [m.lotId, m.motif]),
    ).toEqual([[lotP, motif]]);
    expect(await soldeLot(lotP)).toBe(1);

    const inconnue = await vendre(D1, S1, [
      ligne(P, 1, {
        sortieManuelle: { lotId: 'lot-inconnu', motif: 'Motif quelconque' },
      }),
    ]);
    expect(inconnue.resultat.statut).toBe('APPLIQUE');
    expect(await allocationsDe(inconnue.venteId)).toEqual([
      expect.objectContaining({
        statut: 'PROVISOIRE',
        quantite: 1,
        sortieManuelle: false,
      }),
    ]);
  });

  it('8. CA23 : deux postes hors ligne vendent en même temps', async () => {
    const { stockId: F2, lotId: lotF2 } = await ficheStockee(10);
    const { stockId: F3 } = await ficheStockee(20);
    const d1 = (await derniere(D1)) + 1;
    const evD1 = [0, 1, 2, 3].map((i) =>
      evVente(D1, d1 + i, S1, [ligne(F2, 2)]),
    );
    const evD2 = [
      evOuverture(1, S2, RESPONSABLE),
      ...[0, 1, 2].map((i) => evVente(D2, 2 + i, S2, [ligne(F2, 2)])),
    ];
    const [rD1, rD2, web] = await Promise.all([
      envoyer(D1, evD1),
      envoyer(D2, evD2),
      service.creerVente(
        PHARMACIE,
        VENDEUR,
        { lignes: [{ stockId: F3, quantite: 1 }] },
        undefined,
        ip,
      ),
    ]);
    expect(statuts(rD1)).toEqual(Array(4).fill('APPLIQUE'));
    expect(statuts(rD2)).toEqual(Array(4).fill('APPLIQUE'));
    const numeroWeb = (web as unknown as { data: { numeroTicket: number } })
      .data.numeroTicket;

    const pieces = (
      await sql(
        `SELECT v."numeroTicket", v."posteId", v."numero" FROM "Vente" v JOIN "LigneVente" l ON l."venteId" = v."id" WHERE l."stockMedicamentId" = $1`,
        [F2],
      )
    ).rows;
    expect(pieces).toHaveLength(7);
    const numeros = pieces.map((p) => Number(p.numeroTicket));
    expect(new Set(numeros).size).toBe(7);
    for (const p of pieces) {
      const poste = p.posteId === D1.id ? D1 : D2;
      expect(Number(p.numeroTicket)).toBeGreaterThanOrEqual(poste.debut);
      expect(Number(p.numeroTicket)).toBeLessThanOrEqual(poste.fin);
    }
    for (const poste of [D1, D2]) {
      expect(numeroWeb < poste.debut || numeroWeb > poste.fin).toBe(true);
    }
    const quantites = await compter(
      `SELECT COALESCE(SUM(l."quantite"), 0) AS n FROM "LigneVente" l WHERE l."stockMedicamentId" = $1`,
      [F2],
    );
    expect(quantites).toBe(14);
    expect(await soldeProduit(F2)).toBe(-4);
    expect(await soldeLot(lotF2)).toBe(0);
    expect(
      await compter(
        `SELECT COALESCE(SUM(a."quantite"), 0) AS n FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" WHERE l."stockMedicamentId" = $1 AND a."statut" = 'PROVISOIRE'`,
        [F2],
      ),
    ).toBe(4);
    const negatifs = await sql(
      `SELECT COALESCE(SUM(("details"->>'quantiteProvisoire')::int), 0) AS n FROM "Anomalie" WHERE "type" = 'STOCK_NEGATIF' AND "details"->>'stockId' = $1`,
      [F2],
    );
    expect(Number(negatifs.rows[0].n)).toBe(4);
    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.totalAnomalies).toBe(0);
  });

  it('9. prix du ticket gardé et anomalies d application', async () => {
    // Prix différent
    const vendu900 = await vendre(
      D1,
      S1,
      [ligne(F, 1, { prixUnitaire: 900 })],
      { avecClient: true },
    );
    const ligne900 = (await lignesDe(vendu900.venteId))[0];
    expect(ligne900).toMatchObject({ sousTotal: 900, quantite: 1 });
    const [divergent] = await anomalies('PRIX_DIVERGENT', vendu900.venteId);
    expect(divergent.attribueeAId).toBe(RESPONSABLE);
    expect(divergent.pieceType).toBe('VENTE');
    const divergentes = divergent.details.lignes as Record<string, unknown>[];
    expect(divergentes[0]).toMatchObject({
      stockId: F,
      prixTicket: 900,
      prixFiche: 1000,
    });
    expect(divergent.details.message).toContain(
      `La vente ${String(divergent.details.numero)}`,
    );

    // Unité sur une fiche non déconditionnable
    const unite = await vendre(
      D1,
      S1,
      [ligne(F, 1, { unite: 'UNITE', prixUnitaire: 100 })],
      { avecClient: true },
    );
    expect(unite.resultat.statut).toBe('APPLIQUE');
    expect((await lignesDe(unite.venteId))[0]).toMatchObject({
      quantite: 1,
      coefficientApplique: 1,
      unite: 'UNITE',
    });
    expect(
      await anomalies('VENTE_UNITE_INTERDITE', unite.venteId),
    ).toHaveLength(1);
    // Une seule anomalie pour une même cause : pas de prix divergent en plus (D666)
    expect(await anomalies('PRIX_DIVERGENT', unite.venteId)).toHaveLength(0);

    // Ordonnance non confirmée
    const { stockId: O } = await ficheStockee(10, {
      prixBoite: 500,
      ordonnance: true,
    });
    const sansOrdonnance = await vendre(D1, S1, [ligne(O, 1)], {
      ordonnanceVerifiee: false,
      avecClient: true,
    });
    expect(sansOrdonnance.resultat.statut).toBe('APPLIQUE');
    expect(
      await anomalies('ORDONNANCE_NON_CONFIRMEE', sansOrdonnance.venteId),
    ).toHaveLength(1);

    // Fiche archivée après la vente sur le poste
    const { stockId: A } = await ficheStockee(3);
    await sql(
      `UPDATE "StockMedicament" SET "archiveLe" = now() WHERE "id" = $1`,
      [A],
    );
    const archivee = await vendre(D1, S1, [ligne(A, 1)], { avecClient: true });
    expect(archivee.resultat.statut).toBe('APPLIQUE');
    expect(await soldeProduit(A)).toBe(2);
    expect(await anomalies('PRODUIT_ARCHIVE', archivee.venteId)).toHaveLength(
      1,
    );

    const fuites = await compter(
      `SELECT count(*) AS n FROM "Anomalie" WHERE "details"::text LIKE $1 OR "details"::text LIKE $2`,
      [`%${CLIENT_NOM}%`, `%${CLIENT_TELEPHONE}%`],
    );
    expect(fuites).toBe(0);
  });

  let G: string;
  let lotG: string;

  it('10. boîte au coefficient du serveur', async () => {
    ({ stockId: G, lotId: lotG } = await ficheStockee(3, {
      prixBoite: 1200,
      coefficient: 10,
      prixUnite: 150,
      deconditionnable: true,
    }));
    const boite = await vendre(D1, S1, [ligne(G, 1)]);
    expect((await lignesDe(boite.venteId))[0]).toMatchObject({
      quantite: 10,
      prixUnitaire: 120,
      coefficientApplique: 10,
      sousTotal: 1200,
    });
    const unites = await vendre(D1, S1, [ligne(G, 3, { unite: 'UNITE' })]);
    expect((await lignesDe(unites.venteId))[0]).toMatchObject({
      quantite: 3,
      prixUnitaire: 150,
      coefficientApplique: 1,
      sousTotal: 450,
    });
    expect(await soldeLot(lotG)).toBe(17);
  });

  it('11. deux boîtes entamées', async () => {
    const r = await vendre(D2, S2, [
      ligne(G, 2, { unite: 'UNITE', ouvertureConditionnement: true }),
    ]);
    expect(r.resultat.statut).toBe('APPLIQUE');
    const [concurrent] = await anomalies(
      'CONDITIONNEMENT_CONCURRENT',
      r.venteId,
    );
    expect(concurrent.details).toMatchObject({ posteCode: D2.code });
    const enCause = concurrent.details.lignes as { stockId: string }[];
    expect(enCause.map((l) => l.stockId)).toEqual([G]);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "ConditionnementOuvert" WHERE "stockMedicamentId" = $1 AND "fermeLe" IS NULL`,
        [G],
      ),
    ).toBe(1);
  });

  it('12. numéros de secours et hors plage', async () => {
    const { stockId: M } = await ficheStockee(30);
    const nombrePlageEpuisee = () =>
      compter(
        `SELECT count(*) AS n FROM "Anomalie" WHERE "type" = 'PLAGE_EPUISEE' AND "statut" = 'OUVERTE' AND "pieceType" = 'Poste' AND "pieceId" = $1`,
        [D1.id],
      );
    const s1 = await vendre(D1, S1, [ligne(M, 1)], { numeroSecours: 1 });
    const piece1 = await pieceDe(s1.venteId);
    expect(piece1.numero).toBe(`S1-${D1.code}-1`);
    expect(piece1.numeroTicket).toBeNull();
    expect(await nombrePlageEpuisee()).toBe(1);
    const [epuisee] = await anomalies('PLAGE_EPUISEE', D1.id);
    expect(epuisee.details).toMatchObject({
      raison: 'PLAGE_EPUISEE',
      posteCode: D1.code,
    });

    const s2 = await vendre(D1, S1, [ligne(M, 1)], { numeroSecours: 2 });
    expect((await pieceDe(s2.venteId)).numero).toBe(`S1-${D1.code}-2`);
    expect(await nombrePlageEpuisee()).toBe(1);

    // Numéro de la plage de l'autre poste
    const horsPlage = await vendre(D1, S1, [ligne(M, 1)], {
      numeroTicket: D2.debut + 900,
    });
    const pieceHors = await pieceDe(horsPlage.venteId);
    const sequenceHors = Number(pieceHors.sequencePoste);
    expect(pieceHors.numero).toBe(`N1-${D1.code}-${sequenceHors}`);
    expect(pieceHors.numeroTicket).toBeNull();
    const [hors] = await anomalies('PLAGE_EPUISEE', horsPlage.venteId);
    expect(hors.details).toMatchObject({
      raison: 'NUMERO_HORS_PLAGE',
      numeroImprime: `T1-${sept(D2.debut + 900)}`,
    });

    // Numéro déjà pris
    const pris = await vendre(D1, S1, [ligne(M, 1)], {
      numeroTicket: D1.debut,
    });
    const piecePris = await pieceDe(pris.venteId);
    expect(piecePris.numero).toBe(
      `N1-${D1.code}-${Number(piecePris.sequencePoste)}`,
    );
    expect(piecePris.numeroTicket).toBeNull();
    const [dejaPris] = await anomalies('PLAGE_EPUISEE', pris.venteId);
    expect(dejaPris.details).toMatchObject({
      raison: 'NUMERO_HORS_PLAGE',
      numeroImprime: `T1-${sept(D1.debut)}`,
    });
  });

  it('13. ventes mises de côté sans bloquer le poste', async () => {
    const { stockId: N } = await ficheStockee(10);
    const b = (await derniere(D1)) + 1;
    const inconnue = evVente(
      D1,
      b,
      S1,
      [ligne('stk-inexistant', 1, { prixUnitaire: 1000 })],
      { avecClient: true },
    );
    const totalFaux = evVente(D1, b + 1, S1, [ligne(N, 1)], { total: 5000 });
    const paiementsFaux = evVente(D1, b + 2, S1, [ligne(N, 1)], {
      paiementTotal: 1500,
    });
    const deuxNumeros = evVente(D1, b + 3, S1, [ligne(N, 1)], {
      deuxNumeros: true,
    });
    const dejaUtilise = evVente(D1, b + 4, S1, [ligne(N, 1)], {
      venteId: ventePremiere.venteId,
    });
    const caisseInconnue = evVente(D1, b + 5, randomUUID(), [ligne(N, 1)]);
    const valide = evVente(D1, b + 6, S1, [ligne(N, 1)]);
    const r = await envoyer(D1, [
      inconnue,
      totalFaux,
      paiementsFaux,
      deuxNumeros,
      dejaUtilise,
      caisseInconnue,
      valide,
    ]);
    expect(statuts(r)).toEqual([
      'REJETE',
      'REJETE',
      'REJETE',
      'REJETE',
      'REJETE',
      'REJETE',
      'APPLIQUE',
    ]);
    expect(r.resultats.map((x) => x.code)).toEqual([
      'STOCK_INTROUVABLE',
      'EVENEMENT_INVALIDE',
      'EVENEMENT_INVALIDE',
      'EVENEMENT_INVALIDE',
      'IDENTIFIANT_DEJA_UTILISE',
      'SESSION_INCONNUE',
      undefined,
    ]);
    expect(r.resultats[1].champs).toEqual(['total']);
    expect(r.resultats[2].champs).toEqual(['paiements']);
    expect(r.resultats[3].champs).toEqual(['numeroTicket']);

    const ligneRejetee = await sql(
      `SELECT "statut"::text AS "statut", "corps" FROM "EvenementSynchro" WHERE "evenementId" = $1`,
      [inconnue.evenementId],
    );
    expect(ligneRejetee.rows[0].statut).toBe('REJETE');
    expect(ligneRejetee.rows[0].corps).toMatchObject({
      venteId: inconnue.venteId,
    });
    const rejets = await sql(
      `SELECT "details" FROM "Anomalie" WHERE "type" = 'EVENEMENT_REJETE' AND "details"->>'evenementId' = $1`,
      [inconnue.evenementId],
    );
    expect(rejets.rows).toHaveLength(1);
    const texte = JSON.stringify(rejets.rows[0].details);
    expect(texte).not.toContain(CLIENT_NOM);
    expect(texte).not.toContain(CLIENT_TELEPHONE);
    expect(await derniere(D1)).toBe(b + 6);
    expect(await pieceDe(valide.venteId)).toBeDefined();
    expect(
      await compter(
        `SELECT count(*) AS n FROM "Anomalie" WHERE "details"::text LIKE $1 OR "details"::text LIKE $2`,
        [`%${CLIENT_NOM}%`, `%${CLIENT_TELEPHONE}%`],
      ),
    ).toBe(0);
  });

  it('14. vente sur une caisse fermée : régularisation', async () => {
    const n = (await derniere(D1)) + 1;
    const fermeture: EvenementEnvoye = {
      evenementId: randomUUID(),
      sequence: n,
      type: 'SESSION_FERMEE',
      horodatageLocal: heure(),
      utilisateurId: VENDEUR,
      corps: { sessionId: S1 },
    };
    expect(statuts(await envoyer(D1, [fermeture]))).toEqual(['APPLIQUE']);

    const vente = evVente(D1, n + 1, S1, [ligne(F, 1)]);
    const resultat = unique(await envoyer(D1, [vente]));
    expect(resultat.statut).toBe('APPLIQUE');
    expect(resultat.piece?.type).toBe('REGULARISATION');
    const piece = await pieceDe(vente.venteId);
    expect(piece.typePiece).toBe('REGULARISATION');
    expect(piece.jour).toBe(jour(0));
    expect(piece.sessionCaisseId).toBe(S1);
    const origine = await sql(
      `SELECT to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "jour", (SELECT to_char("jourMetier", 'YYYY-MM-DD') FROM "SessionCaisse" WHERE "id" = $2) AS "jourSession" FROM "Vente" WHERE "id" = $1`,
      [vente.venteId, S1],
    );
    expect(origine.rows[0].jour).toBe(origine.rows[0].jourSession);
    const remontees = await anomalies('REMONTEE_APRES_CLOTURE', vente.venteId);
    expect(remontees).toHaveLength(1);
    expect(remontees[0].attribueeAId).toBe(VENDEUR);
    expect(remontees[0].details.raison).toBe('CAISSE_FERMEE');
    expect(await derniere(D1)).toBe(n + 1);
  });

  it('15. vente web pendant le rejeu, sans interblocage', async () => {
    const { stockId: F4 } = await ficheStockee(50);
    for (let i = 0; i < 3; i++) {
      const sequence = (await derniere(D2)) + 1;
      const resultats = await Promise.allSettled([
        envoyer(D2, [evVente(D2, sequence, S2, [ligne(F4, 1)])]),
        service.creerVente(
          PHARMACIE,
          VENDEUR,
          { lignes: [{ stockId: F4, quantite: 1 }] },
          undefined,
          ip,
        ),
      ]);
      expect(resultats.map((x) => x.status)).toEqual([
        'fulfilled',
        'fulfilled',
      ]);
      const rejeu = resultats[0];
      if (rejeu.status === 'fulfilled') {
        expect(statuts(rejeu.value)).toEqual(['APPLIQUE']);
      }
    }
  });
});
