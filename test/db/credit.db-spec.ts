import { HttpException } from '@nestjs/common';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { PrismaService } from 'src/common/services/prisma.service';
import type { StorageService } from 'src/storage/storage.service';
import type { NotificationsService } from 'src/notifications/notifications.service';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { SessionsCaisseService } from 'src/pharmacie/caisse/sessions-caisse.service';
import { CreditService } from 'src/pharmacie/credit/credit.service';
import type { CreerVenteDto } from 'src/pharmacie/dto/vente.dto';
import { jourVersDate } from 'src/pharmacie/stock/lecture-stock';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import { SynchroService } from 'src/pharmacie/synchro/synchro.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
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
const AUTRE_PHARMACIE = 'str-pharma-2';
/** Vendeur avec credit:write ; le responsable n'a pas credit:write (test de refus). */
const VENDEUR = 'usr-pharm-p1';
const RESPONSABLE = 'usr-admin-p1';

interface Resultat<T> {
  data: T;
  message: string;
}
interface FicheRep {
  id: string;
  resteAPayer: number;
  statut: string;
  totalPris: number;
  totalRembourse: number;
  prises: {
    venteId: string;
    total: number;
    annulee: boolean;
    soldee: boolean;
    dateLimite: string | null;
  }[];
  remboursements: { montant: number; verseEnCaisse: boolean }[];
}

describe('Cahier de crédit de bout en bout, sur base de test (M11)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService;
  let ventes: VenteService;
  let credit: CreditService;
  let sessions: SessionsCaisseService;
  let mouvements: MouvementsStockService;
  let pv1: string;
  let stockId: string;
  let clientId: string;
  let venteCreditId: string;

  const jour = (n: number) =>
    new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  function sql(requete: string, valeurs: unknown[] = []) {
    if (!base) throw new Error('Base de test non créée.');
    return base.client.query<Record<string, unknown>>(requete, valeurs);
  }

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
            ? ['vente:write', 'caisse:utiliser', 'caisse:superviser']
            : ['vente:write', 'caisse:utiliser', 'credit:write'],
        ),
    } as unknown as PermissionsService;
    mouvements = new MouvementsStockService();
    sessions = new SessionsCaisseService(prisma, acces, permissions);
    ventes = new VenteService(
      prisma,
      {
        createManyNotifications: jest.fn().mockResolvedValue(undefined),
      } as unknown as NotificationsService,
      { getPublicUrl: (c: string) => c } as unknown as StorageService,
      acces,
      permissions,
      mouvements,
      sessions,
    );
    credit = new CreditService(prisma, acces, sessions);
    // Garde de typage : ces services restent branchés comme en production.
    void PointsDeVenteService;
    void SynchroService;
    const pvs = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [PHARMACIE],
    );
    pv1 = String(pvs.rows[0].id);

    await sql(
      `INSERT INTO "Medicament" ("id", "nom", "categorie", "ordonnanceRequise", "updatedAt") VALUES ('med-credit-1', 'Paracétamol crédit', 'Test M11', false, now())`,
    );
    await sql(
      `INSERT INTO "StockMedicament" ("id", "medicamentId", "structureId", "quantite", "disponible", "prixUnitaire", "coefficientBoite", "deconditionnable", "updatedAt") VALUES ('stk-credit-1', 'med-credit-1', $1, 0, false, 1000, 1, false, now())`,
      [PHARMACIE],
    );
    stockId = 'stk-credit-1';
    await prisma.$transaction((tx) =>
      mouvements.creerLot(tx, {
        stockMedicamentId: stockId,
        pointDeVenteId: pv1,
        numeroLot: null,
        dateExpiration: jourVersDate(jour(200)),
        quantite: 20,
        coutUnitaire: 300,
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
  });

  afterAll(async () => {
    try {
      if (prisma) await fermerPrismaDeTest(prisma);
    } finally {
      if (base) await supprimerBaseDeTest(base);
    }
  });

  const stock = async () =>
    Number(
      (
        await sql(
          'SELECT "quantite" FROM "AgregatStockProduit" WHERE "stockMedicamentId" = $1 AND "pointDeVenteId" = $2',
          [stockId, pv1],
        )
      ).rows[0].quantite,
    );

  const vendre = (dto: Partial<CreerVenteDto>, user = VENDEUR) =>
    ventes.creerVente(
      PHARMACIE,
      user,
      { lignes: [{ stockId, quantite: 2 }], ...dto } as CreerVenteDto,
      undefined,
      '127.0.0.1',
    ) as unknown as Promise<
      Resultat<{
        id: string;
        total: number;
        session: { id: string };
        paiements: { mode: string; montant: number }[];
        credit: { clientCreditId: string; dateLimite: string | null } | null;
      }>
    >;

  const fiche = async () =>
    (await credit.detail(
      PHARMACIE,
      VENDEUR,
      clientId,
    )) as unknown as Resultat<FicheRep>;

  async function bilanVendeur(sessionId: string) {
    return (await sessions.bilan(PHARMACIE, VENDEUR, sessionId)).data;
  }

  it('1. vente à crédit sans le droit credit:write : 403, rien créé', async () => {
    const r = await refus(
      vendre(
        { nouveauClientCredit: { nomComplet: 'Mamadou Bah' } },
        RESPONSABLE,
      ),
    );
    expect(r.statut).toBe(403);
    expect(await stock()).toBe(20);
  });

  it('2. vente à crédit : client créé dans la transaction, stock baissé, mode CREDIT', async () => {
    const r = await vendre({
      nouveauClientCredit: {
        nomComplet: 'Mamadou Bah',
        telephone: '+224 621 00 00 00',
      },
      dateLimiteCredit: jour(10),
    });
    expect(r.data.total).toBe(2000);
    expect(r.data.paiements).toEqual([
      expect.objectContaining({ mode: 'CREDIT', montant: 2000 }),
    ]);
    expect(r.data.credit?.dateLimite).toBe(jour(10));
    expect(await stock()).toBe(18);
    venteCreditId = r.data.id;
    clientId = r.data.credit?.clientCreditId ?? '';
    expect(clientId).not.toBe('');
    const f = await fiche();
    expect(f.data.resteAPayer).toBe(2000);
    expect(f.data.statut).toBe('EN_COURS');
  });

  it('3. CREDIT jamais compté comme encaissé : récapitulatif, théorique et écart', async () => {
    // Une vente en espèces dans la même caisse, pour comparer.
    const normale = await vendre({ lignes: [{ stockId, quantite: 1 }] });
    const bilan = await bilanVendeur(normale.data.session.id);
    expect(bilan.activite.montantEncaisse).toBe(1000);
    expect(bilan.activite.ventesCredit).toEqual({
      montant: 2000,
      nombrePaiements: 1,
    });
    expect(bilan.activite.parMode.map((m) => m.mode)).toEqual(['ESPECES']);
    expect(bilan.theorique.map((t) => t.mode)).not.toContain('CREDIT');
    const especes = bilan.theorique.find((t) => t.mode === 'ESPECES');
    expect(especes?.montant).toBe(1000);
  });

  it('4. mode CREDIT sans client, ou mélangé à un autre paiement : refus', async () => {
    const sansClient = await refus(
      vendre({ paiements: [{ mode: 'CREDIT', montant: 2000 }] }),
    );
    expect(sansClient.statut).toBe(400);
    expect(sansClient.corps.code).toBe('CREDIT_CLIENT_REQUIS');
    const mixte = await refus(
      vendre({
        clientCreditId: clientId,
        paiements: [
          { mode: 'CREDIT', montant: 1000 },
          { mode: 'ESPECES', montant: 1000 },
        ],
      }),
    );
    expect(mixte.corps.code).toBe('CREDIT_PAIEMENTS_INCOHERENTS');
    const etranger = await refus(vendre({ clientCreditId: 'inexistant' }));
    expect(etranger.statut).toBe(404);
    expect(etranger.corps.code).toBe('CLIENT_CREDIT_INTROUVABLE');
    const passe = await refus(
      vendre({ clientCreditId: clientId, dateLimiteCredit: jour(-1) }),
    );
    expect(passe.corps.code).toBe('DATE_LIMITE_PASSEE');
    expect(await stock()).toBe(17);
  });

  it('5. structure étrangère : le client est introuvable', async () => {
    const r = await refus(
      credit.detail(AUTRE_PHARMACIE, 'usr-admin-p2', clientId),
    );
    expect([403, 404]).toContain(r.statut);
    const lecture = await refus(
      credit.detail(PHARMACIE, VENDEUR, 'inexistant'),
    );
    expect(lecture.statut).toBe(404);
  });

  it('6. liste : reste, résumé, date limite, recherche et filtre de statut', async () => {
    const liste = (await credit.lister(PHARMACIE, VENDEUR, { q: 'bah' })).data;
    expect(liste.total).toBe(1);
    expect(liste.clients[0]).toMatchObject({
      nomComplet: 'Mamadou Bah',
      resteAPayer: 2000,
      statut: 'EN_COURS',
      dateLimite: jour(10),
      resume: 'Paracétamol crédit',
    });
    expect(
      (await credit.lister(PHARMACIE, VENDEUR, { q: '621000' })).data.total,
    ).toBe(1);
    expect(
      (await credit.lister(PHARMACIE, VENDEUR, { statut: 'SOLDE' })).data.total,
    ).toBe(0);
    expect(
      (await credit.lister(PHARMACIE, VENDEUR, { q: 'zzz' })).data.total,
    ).toBe(0);
  });

  it('7. date limite modifiable, EN_RETARD une fois dépassée', async () => {
    await credit.modifierDateLimite(
      PHARMACIE,
      VENDEUR,
      venteCreditId,
      { dateLimite: jour(20) },
      null,
    );
    expect((await fiche()).data.prises[0].dateLimite).toBe(jour(20));
    // Simule le temps qui passe : la date limite est maintenant dépassée.
    await sql(
      'UPDATE "EcheanceCredit" SET "dateLimite" = $1 WHERE "venteId" = $2',
      [jour(-3), venteCreditId],
    );
    expect((await fiche()).data.statut).toBe('EN_RETARD');
    expect(
      (await credit.lister(PHARMACIE, VENDEUR, { statut: 'EN_RETARD' })).data
        .total,
    ).toBe(1);
  });

  it('8. remboursement partiel sans caisse : aucun mouvement, reste diminué', async () => {
    const avant = Number(
      (await sql('SELECT count(*) AS n FROM "MouvementCaisse"')).rows[0].n,
    );
    const r = await credit.enregistrerRemboursement(
      PHARMACIE,
      VENDEUR,
      clientId,
      { montant: 500, note: 'Acompte' },
      null,
    );
    expect(r.data.resteAPayer).toBe(1500);
    expect(r.data.statut).toBe('EN_RETARD');
    expect(r.data.remboursement.verseEnCaisse).toBe(false);
    expect(r.data.remboursement.mouvementCaisseId).toBeNull();
    const apres = Number(
      (await sql('SELECT count(*) AS n FROM "MouvementCaisse"')).rows[0].n,
    );
    expect(apres).toBe(avant);
  });

  it('9. remboursement supérieur au reste refusé ; versé en caisse sans caisse ouverte refusé', async () => {
    const trop = await refus(
      credit.enregistrerRemboursement(
        PHARMACIE,
        VENDEUR,
        clientId,
        { montant: 1501 },
        null,
      ),
    );
    expect(trop.statut).toBe(400);
    expect(trop.corps.code).toBe('MONTANT_SUPERIEUR_AU_RESTE');
    // Le responsable n'a aucune caisse ouverte.
    const sansCaisse = await refus(
      credit.enregistrerRemboursement(
        PHARMACIE,
        RESPONSABLE,
        clientId,
        { montant: 100, verseEnCaisse: true },
        null,
      ),
    );
    expect(sansCaisse.statut).toBe(409);
    expect(sansCaisse.corps.code).toBe('CAISSE_NON_OUVERTE');
    expect((await fiche()).data.resteAPayer).toBe(1500);
  });

  it('10. remboursement final versé en caisse : mouvement APPORT, théorique des espèces augmenté, crédit soldé', async () => {
    const r = await credit.enregistrerRemboursement(
      PHARMACIE,
      VENDEUR,
      clientId,
      { montant: 1500, verseEnCaisse: true },
      null,
    );
    expect(r.data.resteAPayer).toBe(0);
    expect(r.data.statut).toBe('SOLDE');
    expect(r.data.remboursement.mouvementCaisseId).not.toBeNull();
    const mvt = await sql(
      'SELECT "type", "montant", "sessionCaisseId" FROM "MouvementCaisse" WHERE "id" = $1',
      [r.data.remboursement.mouvementCaisseId],
    );
    expect(mvt.rows[0]).toMatchObject({ type: 'APPORT', montant: 1500 });
    const bilan = await bilanVendeur(String(mvt.rows[0].sessionCaisseId));
    expect(bilan.theorique.find((t) => t.mode === 'ESPECES')?.montant).toBe(
      2500,
    );
    const f = await fiche();
    expect(f.data.totalRembourse).toBe(2000);
    expect(f.data.prises[0].soldee).toBe(true);
    const deja = await refus(
      credit.enregistrerRemboursement(
        PHARMACIE,
        VENDEUR,
        clientId,
        { montant: 1 },
        null,
      ),
    );
    expect(deja.corps.code).toBe('CREDIT_DEJA_SOLDE');
    const soldee = await refus(
      credit.modifierDateLimite(
        PHARMACIE,
        VENDEUR,
        venteCreditId,
        { dateLimite: null },
        null,
      ),
    );
    expect(soldee.corps.code).toBe('PRISE_SOLDEE');
  });

  it('11. journal : une ligne par écriture, sans nom ni téléphone', async () => {
    const lignes = await sql(
      `SELECT "entityType", "action", "metadata"::text AS "meta" FROM "AuditLog" WHERE "entityType" IN ('ClientCredit', 'EcheanceCredit', 'RemboursementCredit')`,
    );
    const types = lignes.rows.map((l) => String(l.entityType)).sort();
    expect(types).toEqual([
      'ClientCredit',
      'EcheanceCredit',
      'RemboursementCredit',
      'RemboursementCredit',
    ]);
    for (const l of lignes.rows) {
      expect(String(l.meta)).not.toContain('Mamadou');
      expect(String(l.meta)).not.toContain('621');
    }
  });

  it('12. vente à crédit annulée : sort du reste à payer, le crédit est réduit', async () => {
    const r = await vendre({ clientCreditId: clientId });
    expect((await fiche()).data.resteAPayer).toBe(2000);
    expect((await fiche()).data.statut).toBe('EN_COURS');
    await ventes.annulerVente(
      PHARMACIE,
      r.data.id,
      VENDEUR,
      { motif: 'Erreur de saisie' },
      '127.0.0.1',
    );
    const f = (await fiche()).data;
    expect(f.resteAPayer).toBe(0);
    expect(f.statut).toBe('SOLDE');
    expect(f.prises.find((p) => p.venteId === r.data.id)?.annulee).toBe(true);
    expect(await stock()).toBe(17);
  });

  it('13. client : création et modification journalisées', async () => {
    const cree = (
      await credit.creerClient(
        PHARMACIE,
        VENDEUR,
        { nomComplet: 'Fatoumata Diallo' },
        null,
      )
    ).data;
    const modif = (
      await credit.modifierClient(
        PHARMACIE,
        VENDEUR,
        cree.id,
        { telephone: '622 11 22 33', note: 'Voisine' },
        null,
      )
    ).data;
    expect(modif).toMatchObject({ telephone: '622 11 22 33', note: 'Voisine' });
    const audits = await sql(
      `SELECT "action" FROM "AuditLog" WHERE "entityType" = 'ClientCredit' AND "entityId" = $1 ORDER BY "createdAt"`,
      [cree.id],
    );
    expect(audits.rows.map((a) => a.action)).toEqual(['create', 'update']);
  });

  it('14. concurrence : remboursement et annulation lancés ensemble, le remboursé ne dépasse jamais le dû', async () => {
    for (let essai = 0; essai < 3; essai++) {
      const c = (
        await credit.creerClient(
          PHARMACIE,
          VENDEUR,
          { nomComplet: `Client concurrent ${essai}` },
          null,
        )
      ).data;
      const a = await vendre({ clientCreditId: c.id });
      const b = await vendre({ clientCreditId: c.id });
      // Dû : 4000. Annuler la prise a (2000) pendant qu'on rembourse 3000.
      const [annulation, remboursement] = await Promise.allSettled([
        ventes.annulerVente(
          PHARMACIE,
          a.data.id,
          VENDEUR,
          { motif: 'Annulation concurrente' },
          '127.0.0.1',
        ),
        credit.enregistrerRemboursement(
          PHARMACIE,
          VENDEUR,
          c.id,
          { montant: 3000 },
          null,
        ),
      ]);
      expect(annulation.status).toBe('fulfilled');
      const f = (
        (await credit.detail(
          PHARMACIE,
          VENDEUR,
          c.id,
        )) as unknown as Resultat<FicheRep>
      ).data;
      // Reste dû après annulation : 2000. Soit le remboursement passe d'abord (3000 sur 4000), soit il est refusé (3000 sur 2000).
      if (remboursement.status === 'fulfilled') {
        expect(f.totalRembourse).toBe(3000);
        // Remboursé avant l'annulation : la fiche reste cohérente, jamais de reste négatif.
        expect(f.resteAPayer).toBe(0);
      } else {
        const r = remboursement.reason as HttpException;
        expect(r.getStatus()).toBe(400);
        expect(f.totalRembourse).toBe(0);
        expect(f.resteAPayer).toBe(2000);
      }
      expect(b.data.id).toBeDefined();
    }
  });
});
