import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import {
  MESSAGE_PLAGE_POSTE_WEB,
  MESSAGE_PLAGES_SUFFISANTES,
  PointsDeVenteService,
} from 'src/pharmacie/points-de-vente.service';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { lirePlagesNonEpuisees } from 'src/pharmacie/synchro/plages';
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

const PHARMACIE = 'str-pharma-1';
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';
const ip = '127.0.0.1';

const jour = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Plages de tickets des postes desktop, sur base de test (PB18a)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let postes: PointsDeVenteService;
  let sessions: SessionsCaisseService;
  let service: VenteService;
  let mouvements: MouvementsStockService;
  let pv1: string;
  let D1: string;
  let D2: string;
  let D3: string;
  let D4: string;
  let W: string;
  const sessionsParPoste = new Map<string, string>();
  const id1 = randomUUID();
  const id2 = randomUUID();
  const id3 = randomUUID();
  let n0 = 0;

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
      createManyNotifications: jest.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    const stockage = {
      getPublicUrl: (cle: string) => `logo/${cle}`,
    } as unknown as StorageService;
    const acces = new AccesPharmacieService(prisma);
    const permissions = {
      getUserPermissions: () =>
        Promise.resolve(['vente:write', 'caisse:utiliser', 'stock:write']),
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

    const pvs = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = String(pvs.rows[0].id);
    const desktop = async (n: number) =>
      (
        await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
          type: 'DESKTOP',
          appareilId: `desktop-pb18a-${n}`,
        })
      ).data.id;
    D1 = await desktop(1);
    D2 = await desktop(2);
    D3 = await desktop(3);
    D4 = await desktop(4);
    W = (
      await postes.enregistrerPoste(PHARMACIE, RESPONSABLE, {
        type: 'WEB',
        appareilId: 'navigateur-pb18a-1',
      })
    ).data.id;
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

  async function compteur(): Promise<number> {
    const res = await sql(
      'SELECT "prochainNumero" FROM "CompteurTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    return Number(res.rows[0].prochainNumero);
  }

  /** Insère une pièce minimale du poste, sur sa caisse ouverte, avec ce numéro de ticket. */
  async function venteSql(
    posteId: string,
    numeroTicket: number,
  ): Promise<void> {
    let sessionId = sessionsParPoste.get(posteId);
    if (!sessionId) {
      sessionId = (await sessions.ouvrir(PHARMACIE, RESPONSABLE, { posteId }))
        .data.id;
      sessionsParPoste.set(posteId, sessionId);
    }
    await sql(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece") SELECT $1,$2,s."pointDeVenteId",s."posteId",s."id",$4,$5,$6,\'Caissier (harnais)\',$7,s."jourMetier",\'VENTE\'::"TypePieceVente" FROM "SessionCaisse" s WHERE s."id" = $3',
      [
        randomUUID(),
        PHARMACIE,
        sessionId,
        `T1-${String(numeroTicket).padStart(7, '0')}`,
        numeroTicket,
        VENDEUR,
        1000,
      ],
    );
  }

  const attribuer = (posteId: string, id: string, structure = PHARMACIE) =>
    postes.attribuerPlage(
      structure,
      structure === PHARMACIE ? RESPONSABLE : 'usr-admin-p2',
      posteId,
      { id },
      ip,
    );

  it('1. première plage prise sur le compteur', async () => {
    n0 = await compteur();
    const { data, success } = await attribuer(D1, id1);
    expect(success).toBe(true);
    expect(data).toEqual({
      id: id1,
      debut: n0,
      fin: n0 + 999,
      taille: 1000,
      cree: true,
      plages: [{ id: id1, debut: n0, fin: n0 + 999 }],
    });
    expect(await compteur()).toBe(n0 + 1000);
    const lignes = await sql(
      'SELECT "attribueeParId" FROM "PlageTicket" WHERE "id" = $1',
      [id1],
    );
    expect(lignes.rows).toHaveLength(1);
    expect(lignes.rows[0].attribueeParId).toBe(RESPONSABLE);
    expect(
      await compter(
        `SELECT count(*) AS n FROM "AuditLog" WHERE "action" = 'create' AND "entityType" = 'PlageTicket' AND "entityId" = $1`,
        [id1],
      ),
    ).toBe(1);
  });

  it('2. rejeu du même identifiant', async () => {
    const avant = await compteur();
    const { data } = await attribuer(D1, id1);
    expect(data.cree).toBe(false);
    expect(data.debut).toBe(n0);
    expect(data.fin).toBe(n0 + 999);
    expect(await compteur()).toBe(avant);
    expect(
      await compter('SELECT count(*) AS n FROM "PlageTicket" WHERE "id" = $1', [
        id1,
      ]),
    ).toBe(1);
  });

  it('3. identifiant d un autre poste', async () => {
    const e = await refus(attribuer(D2, id1));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('IDENTIFIANT_DEJA_UTILISE');
  });

  it('4. deux plages au plus', async () => {
    const { data } = await attribuer(D1, id2);
    expect(data.debut).toBe(n0 + 1000);
    const avant = await compteur();
    const e = await refus(attribuer(D1, id3));
    expect(e.statut).toBe(409);
    expect(e.corps.code).toBe('PLAGES_SUFFISANTES');
    expect(e.corps.message).toBe(MESSAGE_PLAGES_SUFFISANTES);
    expect(await compteur()).toBe(avant);
  });

  it('5. dernier numéro utilisé : la plage est épuisée', async () => {
    await venteSql(D1, n0 + 999);
    const { data } = await attribuer(D1, id3);
    expect(data.cree).toBe(true);
    expect(data.plages.map((p) => p.id)).toEqual([id2, id3]);
  });

  it('6. une vente dans une plage plus récente épuise la précédente', async () => {
    const p1 = (await attribuer(D2, randomUUID())).data;
    const p2 = (await attribuer(D2, randomUUID())).data;
    await venteSql(D2, p2.debut);
    const lues = await lirePlagesNonEpuisees(prisma, D2);
    expect(lues).toEqual([{ id: p2.id, debut: p2.debut, fin: p2.fin }]);
    expect(lues.some((p) => p.id === p1.id)).toBe(false);
    const p3 = await attribuer(D2, randomUUID());
    expect(p3.data.cree).toBe(true);
  });

  it('7. vente web après les plages : aucune collision', async () => {
    await sql(
      `INSERT INTO "Medicament" ("id","nom","categorie","ordonnanceRequise","updatedAt") VALUES ('med-pb18a','Produit plages','Test PB18a',false,now())`,
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id","medicamentId","structureId","quantite","disponible","prixUnitaire","coefficientBoite","deconditionnable","updatedAt") VALUES ('stk-pb18a','med-pb18a',$1,0,false,1000,1,false,now())`,
      [PHARMACIE],
    );
    await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: 'stk-pb18a',
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(200)),
        quantite: 10,
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
    const vente = (await service.creerVente(
      PHARMACIE,
      VENDEUR,
      {
        lignes: [{ stockId: 'stk-pb18a', quantite: 1 }],
        ordonnanceVerifiee: true,
      },
      undefined,
      ip,
    )) as unknown as { data: { id: string } };
    const lue = await sql(
      'SELECT "numeroTicket" FROM "Vente" WHERE "id" = $1',
      [vente.data.id],
    );
    const numero = Number(lue.rows[0].numeroTicket);
    const plusGrandeFin = await compter(
      'SELECT max("fin") AS n FROM "PlageTicket" WHERE "pointDeVenteId" = $1',
      [pv1],
    );
    expect(numero).toBeGreaterThan(plusGrandeFin);
    expect(
      await compter(
        'SELECT count(*) AS n FROM "PlageTicket" WHERE "pointDeVenteId" = $1 AND $2 BETWEEN "debut" AND "fin"',
        [pv1, numero],
      ),
    ).toBe(0);
  });

  it('8. deux postes en même temps', async () => {
    const avant = await compteur();
    const [a, b] = await Promise.all([
      attribuer(D3, randomUUID()),
      attribuer(D4, randomUUID()),
    ]);
    const [premiere, seconde] =
      a.data.debut < b.data.debut ? [a.data, b.data] : [b.data, a.data];
    expect(premiere.fin).toBeLessThan(seconde.debut);
    expect(premiere.taille).toBe(1000);
    expect(seconde.taille).toBe(1000);
    expect(await compteur()).toBe(avant + 2000);
  });

  it('9. taille réglée par la pharmacie', async () => {
    await sql(
      'UPDATE "ParametresPharmacie" SET "taillePlageTickets" = 100 WHERE "structureId" = $1',
      [PHARMACIE],
    );
    try {
      const { data } = await attribuer(D3, randomUUID());
      expect(data.taille).toBe(100);
    } finally {
      await sql(
        'UPDATE "ParametresPharmacie" SET "taillePlageTickets" = 1000 WHERE "structureId" = $1',
        [PHARMACIE],
      );
    }
  });

  it('10. postes refusés', async () => {
    const web = await refus(attribuer(W, randomUUID()));
    expect(web.statut).toBe(409);
    expect(web.corps.code).toBe('POSTE_INCONNU');
    expect(web.corps.message).toBe(MESSAGE_PLAGE_POSTE_WEB);

    await postes.modifierPoste(PHARMACIE, RESPONSABLE, D4, { actif: false });
    const inactif = await refus(attribuer(D4, randomUUID()));
    expect(inactif.statut).toBe(409);
    expect(inactif.corps.code).toBe('POSTE_INCONNU');

    const inconnu = await refus(attribuer(randomUUID(), randomUUID()));
    expect(inconnu.statut).toBe(409);
    expect(inconnu.corps.code).toBe('POSTE_INCONNU');

    const autre = (
      await postes.enregistrerPoste('str-pharma-2', 'usr-admin-p2', {
        type: 'DESKTOP',
        appareilId: 'desktop-pb18a-autre',
      })
    ).data.id;
    const dAilleurs = await refus(attribuer(autre, randomUUID()));
    expect(dAilleurs.statut).toBe(409);
    expect(dAilleurs.corps.code).toBe('POSTE_INCONNU');
  });
});
