import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import {
  messageCaisseJourneeCloturee,
  messageReceptionJourneeCloturee,
  verrouillerJourneesExclusif,
  verrouillerJourneesPartage,
} from 'src/pharmacie/caisse/journee';
import { ClotureService } from 'src/pharmacie/caisse/clotures.service';
import {
  messageOuvertureJourSuivant,
  SessionsCaisseService,
} from 'src/pharmacie/caisse/sessions-caisse.service';
import { lendemain } from 'src/pharmacie/jour-metier';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { ReceptionsService } from 'src/pharmacie/receptions/receptions.service';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
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

interface VenteRep {
  id: string;
  numero: string;
  statut: string;
  jourMetier: string;
  total: number;
  session: { id: string; ouverteAutomatiquement: boolean };
  annulation: { id: string; numero: string } | null;
}
interface Reponse {
  data: VenteRep;
  message: string;
}

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const ip = '127.0.0.1';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const demain = lendemain(jour(0));

describe('Journée clôturée : verrou des écrivains, rattachement, CA20 et courses, sur base de test (PB17c)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let service: VenteService;
  let sessions: SessionsCaisseService;
  let postes: PointsDeVenteService;
  let mouvements: MouvementsStockService;
  let receptions: ReceptionsService;
  let clotures: ClotureService;
  let synchro: SynchroService;
  let pv1: string;
  let compteurFiche = 0;
  const alertes = jest.fn().mockResolvedValue(undefined);

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
                'vente:annuler',
                'caisse:utiliser',
                'caisse:superviser',
                'cloture:gerer',
                'reception:write',
                'stock:read',
                'stock:write',
                'marge:read',
              ]
            : ['vente:write', 'caisse:utiliser'],
        ),
    } as unknown as PermissionsService;
    mouvements = new MouvementsStockService();
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    service = new VenteService(
      prisma,
      notifications,
      stockage,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    postes = new PointsDeVenteService(prisma, acces);
    receptions = new ReceptionsService(prisma, acces, mouvements, permissions);
    clotures = new ClotureService(prisma, acces);
    synchro = new SynchroService(prisma, acces, mouvements, sessions);
    const pvs = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = String(pvs.rows[0].id);
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

  async function nouvelleFiche(): Promise<{ stockId: string; nom: string }> {
    compteurFiche += 1;
    const n = compteurFiche;
    const nom = `Produit journée ${n}`;
    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ($1, $2, 'Test PB17c', false, now())`,
      [`med-jc-${n}`, nom],
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "prixUnite", "coefficientBoite", "deconditionnable", "updatedAt") VALUES ($1, $2, $3, 0, false, $4, $5, $6, $7, now())`,
      [`stk-jc-${n}`, `med-jc-${n}`, PHARMACIE, 1000, null, 1, false],
    );
    return { stockId: `stk-jc-${n}`, nom };
  }

  async function nouveauLot(
    stockId: string,
    o: { quantite: number; exp?: string | null },
  ): Promise<string> {
    const exp = o.exp === undefined ? jour(200) : o.exp;
    const { lot } = await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: exp ? jourVersDate(exp) : null,
        quantite: o.quantite,
        coutUnitaire: 0,
        coutAchatBoite: null,
        coefficientReception: 1,
        fournisseurId: null,
        receptionId: null,
        lotTechnique: false,
        auteurId: RESPONSABLE,
        pieceOrigineType: 'RECEPTION',
        pieceOrigineId: null,
        motif: null,
      }),
    );
    return lot.id;
  }

  async function soldeLot(lotId: string): Promise<number> {
    const res = await sql(
      'SELECT "quantite" FROM "AgregatStockLot" WHERE "lotId" = $1',
      [lotId],
    );
    return res.rows.length === 0 ? 0 : Number(res.rows[0].quantite);
  }

  async function prochainNumero(): Promise<number> {
    const res = await sql(
      'SELECT "prochainNumero" FROM "CompteurTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    return Number(res.rows[0].prochainNumero);
  }

  const coupures = (montants: Record<number, number>) =>
    Object.entries(montants).map(([valeur, nombre]) => ({
      valeurFaciale: Number(valeur),
      nombre,
    }));

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

  let F: string;
  let lotF: string;

  function vendre(
    utilisateur: string,
    stockId: string,
    quantite: number,
    posteId?: string,
  ): Promise<Reponse> {
    return service.creerVente(
      PHARMACIE,
      utilisateur,
      {
        lignes: [{ stockId, quantite }],
        ordonnanceVerifiee: true,
        ...(posteId ? { posteId } : {}),
      },
      undefined,
      ip,
    ) as unknown as Promise<Reponse>;
  }

  async function etatDuJour() {
    const j = jour(0);
    const pieces = await compter(
      `SELECT count(*) AS n FROM "Vente" WHERE "pointDeVenteId" = $1 AND "jourMetier" = $2::date`,
      [pv1, j],
    );
    const sessionsDuJour = (
      await sql(
        `SELECT "id", "statut"::text AS "statut", "clotureJournaliereId" FROM "SessionCaisse" WHERE "pointDeVenteId" = $1 AND "jourMetier" = $2::date ORDER BY "id"`,
        [pv1, j],
      )
    ).rows;
    const totaux = (
      await sql(
        `SELECT m."code" AS "mode", t."theorique", t."compte", t."ecart" FROM "TotalClotureMode" t JOIN "ClotureJournaliere" c ON c."id" = t."clotureId" JOIN "ModePaiement" m ON m."id" = t."modePaiementId" WHERE c."pointDeVenteId" = $1 AND c."jourMetier" = $2::date ORDER BY m."code"`,
        [pv1, j],
      )
    ).rows;
    return {
      pieces,
      sessions: sessionsDuJour,
      totaux,
      compteur: await prochainNumero(),
    };
  }

  function tenirJournees(
    mode: 'partage' | 'exclusif',
    apres?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    let signaler: () => void = () => undefined;
    const tenu = new Promise<void>((r) => (signaler = r));
    let liberer: () => void = () => undefined;
    const libere = new Promise<void>((r) => (liberer = r));
    const fin = prisma.$transaction(
      async (tx) => {
        if (mode === 'partage') {
          await verrouillerJourneesPartage(tx, PHARMACIE);
        } else {
          await verrouillerJourneesExclusif(tx, PHARMACIE);
        }
        signaler();
        await libere;
        if (apres) await apres(tx);
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    return { tenu, liberer, fin };
  }

  let V1: Reponse;
  let V2: Reponse;
  let V3: Reponse;
  let SV: string;
  let SD: string;
  let D: string;
  let avant: Awaited<ReturnType<typeof etatDuJour>>;
  let soldeApresV3 = 0;

  it('1. avant clôture : la caisse compte pour aujourd’hui', async () => {
    F = (await nouvelleFiche()).stockId;
    lotF = await nouveauLot(F, { quantite: 100 });

    V1 = await vendre(VENDEUR, F, 2);
    SV = V1.data.session.id;

    expect(V1.data.jourMetier).toBe(jour(0));
    const res = await sql(
      `SELECT to_char("jourMetier", 'YYYY-MM-DD') AS "jour", "jourMetierOrigine" FROM "SessionCaisse" WHERE "id" = $1`,
      [SV],
    );
    expect(res.rows[0].jour).toBe(jour(0));
    expect(res.rows[0].jourMetierOrigine).toBeNull();
  });

  it('2. clôture forcée avec un poste desktop ouvert', async () => {
    await sessions.fermer(PHARMACIE, VENDEUR, SV, {
      comptageFermeture: { coupures: coupures({ 1000: 2 }) },
    });
    const poste = await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'DESKTOP',
      appareilId: 'desktop-essai-pb17c',
    });
    D = poste.data.id;
    SD = (await sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: D })).data
      .id;
    V2 = await vendre(RESPONSABLE, F, 1, D);
    expect(V2.data.session.id).toBe(SD);

    const e = await refus(
      clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(0) }, ip),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('CLOTURE_INCOMPLETE');

    const { data } = await clotures.cloturer(
      PHARMACIE,
      RESPONSABLE,
      { jour: jour(0), forcer: true, motifForcage: 'Poste D hors ligne' },
      ip,
    );
    expect(data.forcee).toBe(true);
    expect(data.postesManquants[0].sessionId).toBe(SD);

    const statuts = await sql(
      `SELECT "id", "statut"::text AS "statut" FROM "SessionCaisse" WHERE "id" = ANY($1)`,
      [[SV, SD]],
    );
    const parId = new Map(statuts.rows.map((r) => [r.id, r.statut]));
    expect(parId.get(SV)).toBe('INCLUSE_DANS_CLOTURE');
    expect(parId.get(SD)).toBe('OUVERTE');
    avant = await etatDuJour();
  });

  it('3. CA20 : la journée clôturée refuse toute écriture directe', async () => {
    const message = messageCaisseJourneeCloturee(jour(0));
    const solde = await soldeLot(lotF);
    const tentatives: (() => Promise<unknown>)[] = [
      () => vendre(RESPONSABLE, F, 1, D),
      () =>
        sessions.saisirComptage(PHARMACIE, RESPONSABLE, SD, {
          moment: 'OUVERTURE',
          coupures: [],
        }),
      () =>
        sessions.enregistrerMouvement(PHARMACIE, RESPONSABLE, SD, {
          type: 'APPORT',
          montant: 10000,
          motif: 'Monnaie',
        }),
      () =>
        sessions.fermer(PHARMACIE, RESPONSABLE, SD, {
          comptageFermeture: { coupures: [] },
        }),
      () => sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId: D }),
      () =>
        service.annulerVente(
          PHARMACIE,
          V1.data.id,
          RESPONSABLE,
          { motif: 'Erreur de quantité', posteId: D },
          ip,
        ),
    ];
    for (const t of tentatives) {
      const e = await refus(t());
      expect(e.statut).toBe(409);
      expect(e.corps.code).toBe('JOURNEE_CLOTUREE');
      expect(e.corps.message).toBe(message);
    }

    expect(await etatDuJour()).toEqual(avant);
    expect(await soldeLot(lotF)).toBe(solde);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "ComptageCaisse" WHERE "sessionCaisseId" = $1',
        [SD],
      ),
    ).toBe(0);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "MouvementCaisse" WHERE "sessionCaisseId" = $1',
        [SD],
      ),
    ).toBe(0);

    const ferme = await refus(
      sessions.saisirComptage(PHARMACIE, VENDEUR, SV, {
        moment: 'OUVERTURE',
        coupures: [],
      }),
    );
    expect(ferme.statut).toBe(409);
    expect(ferme.corps.code).toBe('SESSION_FERMEE');
    const rejoue = await sessions.fermer(PHARMACIE, VENDEUR, SV, {});
    expect(rejoue.message).toBe('Cette session était déjà fermée.');
  });

  it('4. rattachement au lendemain après la clôture', async () => {
    V3 = await vendre(VENDEUR, F, 1);
    expect(V3.data.jourMetier).toBe(demain);
    const SV2 = V3.data.session.id;
    expect(SV2).not.toBe(SV);
    const res = await sql(
      `SELECT to_char("jourMetier", 'YYYY-MM-DD') AS "jour", to_char("jourMetierOrigine", 'YYYY-MM-DD') AS "origine" FROM "SessionCaisse" WHERE "id" = $1`,
      [SV2],
    );
    expect(res.rows[0].jour).toBe(demain);
    expect(res.rows[0].origine).toBe(jour(0));

    const posteWeb = await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
      type: 'WEB',
      appareilId: 'appareil-pb17c-web',
    });
    const ouverture = await sessions.ouvrir(PHARMACIE, RESPONSABLE, {
      posteId: posteWeb.data.id,
    });
    expect(ouverture.message).toBe(messageOuvertureJourSuivant(demain));
    expect(ouverture.data.jourMetier).toBe(demain);
    expect(ouverture.data.ouverteMaintenant).toBe(true);

    const apres = await etatDuJour();
    expect({ ...apres, compteur: 0 }).toEqual({ ...avant, compteur: 0 });
    expect(apres.compteur).toBe(avant.compteur + 1);
    soldeApresV3 = await soldeLot(lotF);
  });

  it('5. CA20 : correction par annulation rattachée à la journée en cours, qui pointe l’origine', async () => {
    const A = (await service.annulerVente(
      PHARMACIE,
      V1.data.id,
      RESPONSABLE,
      { motif: 'Erreur de quantité' },
      ip,
    )) as unknown as Reponse;
    expect(A.data.statut).toBe('ANNULEE');
    expect(A.data.annulation?.numero).toBe(`A-${V1.data.numero}`);
    const pieceId = A.data.annulation?.id as string;

    const piece = await sql(
      `SELECT "venteOrigineId", to_char("jourMetier", 'YYYY-MM-DD') AS "jour", "sessionCaisseId", "typePiece"::text AS "typePiece" FROM "Vente" WHERE "id" = $1`,
      [pieceId],
    );
    expect(piece.rows[0].typePiece).toBe('ANNULATION');
    expect(piece.rows[0].venteOrigineId).toBe(V1.data.id);
    expect(piece.rows[0].jour).toBe(demain);
    const session = await sql(
      `SELECT to_char("jourMetier", 'YYYY-MM-DD') AS "jour" FROM "SessionCaisse" WHERE "id" = $1`,
      [piece.rows[0].sessionCaisseId],
    );
    expect(session.rows[0].jour).toBe(demain);

    const apres = await etatDuJour();
    expect(apres.pieces).toBe(avant.pieces);
    expect(apres.sessions).toEqual(avant.sessions);
    expect(apres.totaux).toEqual(avant.totaux);
    expect(await soldeLot(lotF)).toBe(soldeApresV3 + 2);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "MouvementStock" WHERE "type"::text = 'CORRECTION' AND "pieceOrigineType" = 'ANNULATION' AND "pieceOrigineId" = $1 AND "lotId" = $2`,
        [pieceId, lotF],
      ),
    ).toBe(1);

    const listeJour = (await service.listerVentes(PHARMACIE, RESPONSABLE, {
      date: jour(0),
    })) as unknown as {
      data: { ventes: { id: string; statut: string; total: number }[] };
    };
    const v1 = listeJour.data.ventes.find((v) => v.id === V1.data.id);
    expect(v1?.statut).toBe('ANNULEE');
    expect(listeJour.data.ventes.map((v) => v.id)).not.toContain(pieceId);
    const listeDemain = (await service.listerVentes(PHARMACIE, RESPONSABLE, {
      date: demain,
    })) as unknown as {
      data: { ventes: { id: string; total: number }[] };
    };
    const a = listeDemain.data.ventes.find((v) => v.id === pieceId);
    expect(a).toBeDefined();
    expect(a?.total ?? 0).toBeLessThan(0);
  });

  it('6. réception datée d’un jour clôturé', async () => {
    await sql(
      `INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES ('clo-essai-hier', $2, $1::date, 'usr-admin-p1')`,
      [jour(-1), pv1],
    );
    const nombre = () =>
      compter(
        'SELECT count(*) AS n FROM "Reception" WHERE "pointDeVenteId" = $1',
        [pv1],
      );
    const avantReceptions = await nombre();
    const ligne = { stockId: F, nombreBoites: 1, dateExpiration: jour(200) };

    const e = await refus(
      receptions.enregistrer(
        PHARMACIE,
        RESPONSABLE,
        { recueLe: `${jour(-1)}T10:00:00.000Z`, lignes: [ligne] },
        ip,
      ),
    );
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_CLOTUREE');
    expect(e.corps.message).toBe(messageReceptionJourneeCloturee(jour(-1)));
    expect(await nombre()).toBe(avantReceptions);

    await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      {
        recueLe: new Date(Date.now() - 60_000).toISOString(),
        lignes: [ligne],
      },
      ip,
    );
    await receptions.enregistrer(
      PHARMACIE,
      RESPONSABLE,
      { recueLe: `${jour(-2)}T10:00:00.000Z`, lignes: [ligne] },
      ip,
    );
    expect(await nombre()).toBe(avantReceptions + 2);
  });

  it('7. course : la clôture attend une écriture de caisse en cours', async () => {
    await sql(
      `UPDATE "ParametresPharmacie" SET "debutCaisse" = now() - interval '30 days' WHERE "structureId" = 'str-pharma-1'`,
    );
    const h = tenirJournees('partage');
    let resolue = false;
    let attente: ReturnType<ClotureService['cloturer']> | undefined;
    try {
      await h.tenu;
      attente = clotures
        .cloturer(PHARMACIE, RESPONSABLE, { jour: jour(-3) }, ip)
        .then((r) => {
          resolue = true;
          return r;
        });
      await attendreAttentes(1);
      await new Promise((r) => setTimeout(r, 200));
      expect(resolue).toBe(false);
    } finally {
      h.liberer();
      await h.fin;
    }
    const { data } = await attente;
    expect(data.forcee).toBe(false);
  });

  it('8. course réelle sans interblocage', async () => {
    for (const k of [4, 5, 6]) {
      const [c, v] = await Promise.allSettled([
        clotures.cloturer(PHARMACIE, RESPONSABLE, { jour: jour(-k) }, ip),
        vendre(VENDEUR, F, 1),
      ]);
      expect(c.status).toBe('fulfilled');
      expect(v.status).toBe('fulfilled');
      if (v.status === 'fulfilled') {
        expect(v.value.data.jourMetier).toBe(demain);
      }
    }
  });

  it('9. une annulation et une vente qui attendent une clôture en cours', async () => {
    const h = tenirJournees('exclusif');
    let v: Promise<Reponse> | undefined;
    let a: Promise<unknown> | undefined;
    try {
      await h.tenu;
      v = vendre(VENDEUR, F, 1);
      a = service.annulerVente(
        PHARMACIE,
        V3.data.id,
        RESPONSABLE,
        { motif: 'Erreur de prix' },
        ip,
      );
      await attendreAttentes(2);
    } finally {
      h.liberer();
      await h.fin;
    }
    // Aucune clôture n'a été écrite par le test : les deux se poursuivent normalement.
    const [rv, ra] = await Promise.allSettled([v, a]);
    expect(rv.status).toBe('fulfilled');
    expect(ra.status).toBe('fulfilled');
  });

  it('10. une vente qui attendait la clôture voit la journée clôturée', async () => {
    // La clôture du jour de la caisse est simulée par insertion directe dans la
    // transaction exclusive : le service refuse de clôturer un jour futur.
    const h = tenirJournees('exclusif', async (tx) => {
      await tx.$executeRaw`INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES ('clo-essai-demain', ${pv1}, ${demain}::date, 'usr-admin-p1')`;
    });
    let v: Promise<Reponse> | undefined;
    let compteurAvant = 0;
    let ventesAvant = 0;
    try {
      await h.tenu;
      compteurAvant = await prochainNumero();
      ventesAvant = await compter(
        'SELECT count(*) AS n FROM "Vente" WHERE "pointDeVenteId" = $1',
        [pv1],
      );
      v = vendre(VENDEUR, F, 1);
      await attendreAttentes(1);
    } finally {
      h.liberer();
      await h.fin;
    }
    const e = await refus(v);
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('JOURNEE_CLOTUREE');
    expect(e.corps.message).toBe(messageCaisseJourneeCloturee(demain));
    expect(
      await compter(
        'SELECT count(*) AS n FROM "Vente" WHERE "pointDeVenteId" = $1',
        [pv1],
      ),
    ).toBe(ventesAvant);
    expect(await prochainNumero()).toBe(compteurAvant);
  });

  it('11. chaque écrivain de caisse attend la clôture avant toute lecture', async () => {
    // Chaque appel échouerait (ou rejouerait) aussitôt sur sa première lecture :
    // s'il attend, c'est que le verrou de journée partagé est bien sa première
    // instruction (D613, D629). Sept attentes simultanées sont exigées.
    const h = tenirJournees('exclusif');
    let tous: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      await h.tenu;
      tous = Promise.allSettled([
        vendre(VENDEUR, 'jc-fiche-inexistante', 1),
        service.annulerVente(
          PHARMACIE,
          'jc-vente-inexistante',
          RESPONSABLE,
          { motif: 'Erreur de prix' },
          ip,
        ),
        sessions.ouvrir(PHARMACIE, RESPONSABLE, {
          posteId: 'jc-poste-inexistant',
        }),
        sessions.saisirComptage(PHARMACIE, VENDEUR, SV, {
          moment: 'OUVERTURE',
          coupures: [],
        }),
        sessions.enregistrerMouvement(PHARMACIE, VENDEUR, SV, {
          type: 'APPORT',
          montant: 10000,
          motif: 'Monnaie',
        }),
        sessions.fermer(PHARMACIE, VENDEUR, SV, {}),
        synchro.recevoir(
          PHARMACIE,
          RESPONSABLE,
          {
            posteId: D,
            etat: { fileVide: true, sessionOuverte: true, versionApp: '0.1.0' },
            evenements: [
              {
                evenementId: randomUUID(),
                sequence: 1,
                type: 'MOUVEMENT_CAISSE',
                horodatageLocal: new Date().toISOString(),
                utilisateurId: RESPONSABLE,
                corps: {
                  mouvementId: randomUUID(),
                  sessionId: randomUUID(),
                  type: 'APPORT',
                  montant: 1000,
                  motif: 'Monnaie',
                },
              },
            ],
          },
          ip,
        ),
      ]);
      await attendreAttentes(7);
    } finally {
      h.liberer();
      await h.fin;
    }
    const [
      vente,
      annulation,
      ouverture,
      comptage,
      mouvement,
      fermeture,
      rejeu,
    ] = await tous;
    const code = (r: PromiseSettledResult<unknown>) =>
      r.status === 'rejected' && r.reason instanceof HttpException
        ? (r.reason.getResponse() as { code?: string }).code
        : undefined;
    expect(code(vente)).toBe('STOCK_INTROUVABLE');
    expect(annulation.status).toBe('rejected');
    expect(
      annulation.status === 'rejected' &&
        annulation.reason instanceof HttpException
        ? annulation.reason.getStatus()
        : 0,
    ).toBe(404);
    expect(code(ouverture)).toBe('POSTE_INCONNU');
    expect(code(comptage)).toBe('SESSION_FERMEE');
    expect(code(mouvement)).toBe('SESSION_FERMEE');
    expect(fermeture.status).toBe('fulfilled');
    expect(rejeu.status).toBe('fulfilled');
    if (rejeu.status === 'fulfilled') {
      const { data } = rejeu.value as {
        data: { resultats: { statut: string; code?: string }[] };
      };
      expect(data.resultats[0].statut).toBe('REJETE');
      expect(data.resultats[0].code).toBe('SESSION_INCONNUE');
    }
  });
});
