import { HttpException } from '@nestjs/common';
import { PrismaService } from 'src/common/services/prisma.service';
import { purgerPiecesPharmacies } from 'src/pharmacie/caisse/purge-pieces';
import {
  assurerPointDeVente,
  structureAPieces,
  supprimerConfigurationPharmacies,
} from 'src/pharmacie/point-de-vente';
import { verifierStock } from 'src/pharmacie/stock/commandes-stock';
import { purgerStockPharmacies } from 'src/pharmacie/stock/purge-stock';
import { SuperAdminService } from 'src/super-admin/super-admin.service';
import {
  appliquerMigrations,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const JOUR_MS = 24 * 60 * 60 * 1000;

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function refus<T>(
  promesse: Promise<T>,
): Promise<{ statut: number; corps: unknown }> {
  try {
    await promesse;
  } catch (erreur) {
    if (erreur instanceof HttpException) {
      return { statut: erreur.getStatus(), corps: erreur.getResponse() };
    }
    throw erreur;
  }
  throw new Error('Un refus était attendu, la promesse a abouti.');
}

describe('Pièces de caisse et de vente sur base de test (PB09)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let resume: ResumeFormatActuel;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    prisma = creerPrismaDeTest(base);
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

  function client(): PrismaService {
    if (!prisma) throw new Error('Client Prisma non créé.');
    return prisma;
  }

  async function pv(structureId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
      [structureId],
    );
    return res.rows[0].id as string;
  }

  async function mode(code: string): Promise<string> {
    const res = await sql('SELECT "id" FROM "ModePaiement" WHERE "code" = $1', [
      code,
    ]);
    return res.rows[0].id as string;
  }

  async function lotTechnique(stockId: string): Promise<string> {
    const res = await sql(
      'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique"',
      [stockId],
    );
    return res.rows[0].id as string;
  }

  const jourJ = () => jourIso(resume.aujourdhui);
  const plus = (jours: number): Date =>
    new Date(resume.aujourdhui.getTime() + jours * JOUR_MS);

  async function poste(
    id: string,
    pvId: string,
    appareilId: string,
  ): Promise<void> {
    await sql(
      'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","appareilId") VALUES ($1,$2,\'W1\',\'Navigateur\',\'WEB\',$3)',
      [id, pvId, appareilId],
    );
  }

  async function sessionOuverte(
    id: string,
    posteId: string,
    pvId: string,
    utilisateurId: string,
  ): Promise<void> {
    await sql(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","jourMetier","evenementOuvertureId") VALUES ($1,$2,$3,$4,\'Caissier (harnais)\',$5::date,$6)',
      [id, pvId, posteId, utilisateurId, jourJ(), 'ouv-' + id],
    );
  }

  async function vente(v: {
    id: string;
    structureId: string;
    sessionId: string;
    numero: string;
    numeroTicket: number;
    total: number;
    typePiece?: string;
    origine?: string;
    motif?: string;
  }): Promise<void> {
    await sql(
      'INSERT INTO "Vente" ("id","structureId","pointDeVenteId","posteId","sessionCaisseId","numero","numeroTicket","vendeurId","vendeurNom","total","jourMetier","typePiece","venteOrigineId","motifAnnulation") SELECT $1,$2,s."pointDeVenteId",s."posteId",s."id",$4,$5,\'usr-pharm-p1\',\'Caissier (harnais)\',$6,$7::date,$8::"TypePieceVente",$9,$10 FROM "SessionCaisse" s WHERE s."id" = $3',
      [
        v.id,
        v.structureId,
        v.sessionId,
        v.numero,
        v.numeroTicket,
        v.total,
        jourJ(),
        v.typePiece ?? 'VENTE',
        v.origine ?? null,
        v.motif ?? null,
      ],
    );
  }

  async function ligne(l: {
    id: string;
    venteId: string;
    stockId: string;
    prix: number;
    quantite: number;
    sousTotal: number;
    unite: string;
    nombre: number;
    coefficient: number;
  }): Promise<void> {
    await sql(
      'INSERT INTO "LigneVente" ("id","venteId","medicamentId","stockMedicamentId","nomMedicament","prixUnitaire","quantite","sousTotal","uniteAffichee","nombreAffiche","coefficientApplique") SELECT $1,$2,f."medicamentId",f."id",\'Harnais\',$4,$5,$6,$7::"UniteVente",$8,$9 FROM "StockMedicament" f WHERE f."id" = $3',
      [
        l.id,
        l.venteId,
        l.stockId,
        l.prix,
        l.quantite,
        l.sousTotal,
        l.unite,
        l.nombre,
        l.coefficient,
      ],
    );
  }

  async function allocation(
    id: string,
    ligneId: string,
    lotId: string | null,
    quantite: number,
    statut: 'DEFINITIVE' | 'PROVISOIRE',
    technique = false,
  ): Promise<void> {
    await sql(
      'INSERT INTO "AllocationLot" ("id","ligneVenteId","lotId","quantite","coutUnitaire","lotTechnique","statut") VALUES ($1,$2,$3,$4,0,$5,$6::"StatutAllocation")',
      [id, ligneId, lotId, quantite, technique, statut],
    );
  }

  it('structureAPieces : vrai pour une pharmacie qui a des ventes ou un journal, faux sinon', async () => {
    await sql(
      `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-pharma-4', 'Pharmacie de Dixinn (harnais)', 'PHARMACIE', 'pharma4@harnais.test', 'Conakry', true, true, now(), now()), ('str-pharma-5', 'Pharmacie de Matam (harnais)', 'PHARMACIE', 'pharma5@harnais.test', 'Conakry', true, true, now(), now())`,
    );
    for (const [id, nom] of [
      ['str-pharma-4', 'Pharmacie de Dixinn (harnais)'],
      ['str-pharma-5', 'Pharmacie de Matam (harnais)'],
    ]) {
      await client().$transaction((tx) => assurerPointDeVente(tx, { id, nom }));
    }
    const pv4 = await pv('str-pharma-4');
    const reprise4 = await sql(
      'SELECT "id" FROM "Poste" WHERE "pointDeVenteId" = $1 AND "code" = \'REPRISE\'',
      [pv4],
    );
    await sql(
      'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurNom","statut","technique","fermeeLe","jourMetier","evenementOuvertureId") VALUES (\'sess-tech-p4\',$1,$2,\'Reprise historique\',\'FERMEE\',true,now(),$3::date,$4)',
      [pv4, reprise4.rows[0].id, jourJ(), 'reprise:' + pv4],
    );
    const pv5 = await pv('str-pharma-5');
    await poste('poste-p5-w1', pv5, 'harnais-p5-w1');
    await sessionOuverte('sess-p5', 'poste-p5-w1', pv5, 'usr-pharm-p1');

    const a = async (id: string) =>
      client().$transaction((tx) => structureAPieces(tx, id));
    expect(await a('str-pharma-1')).toBe(true);
    expect(await a('str-pharma-3')).toBe(true);
    expect(await a('str-hopital-1')).toBe(false);
    expect(await a('str-pharma-4')).toBe(false);
    expect(await a('str-pharma-5')).toBe(true);
  });

  it('suppression par le super administrateur : 409 STRUCTURE_AVEC_PIECES, rien n est supprimé', async () => {
    const superAdmin = new SuperAdminService(
      client(),
      {} as never,
      {} as never,
    );
    const comptes = () =>
      compter(
        'SELECT count(*)::int AS n FROM "User" WHERE "structureId" = \'str-pharma-1\'',
      );
    const avant = await comptes();
    expect(avant).toBeGreaterThan(0);

    for (const id of ['str-pharma-1', 'str-pharma-5']) {
      const { statut, corps } = await refus(superAdmin.deleteStructure(id));
      expect(statut).toBe(409);
      expect(corps).toMatchObject({
        code: 'STRUCTURE_AVEC_PIECES',
        message:
          'Cette structure a des ventes ou des mouvements de stock : désactivez-la.',
      });
      expect(
        await compter(
          'SELECT count(*)::int AS n FROM "Structure" WHERE "id" = $1',
          [id],
        ),
      ).toBe(1);
    }
    expect(await comptes()).toBe(avant);
  });

  it('suppression d une pharmacie sans pièce : sa session technique part avec sa configuration', async () => {
    const pv4 = await pv('str-pharma-4');
    const superAdmin = new SuperAdminService(
      client(),
      {} as never,
      {} as never,
    );
    const reponse = await superAdmin.deleteStructure('str-pharma-4');
    expect(reponse.success).toBe(true);

    const restes = [
      `SELECT count(*)::int AS n FROM "Structure" WHERE "id" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "PointDeVente" WHERE "structureId" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "Poste" WHERE "pointDeVenteId" = '${pv4}'`,
      `SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "pointDeVenteId" = '${pv4}'`,
      `SELECT count(*)::int AS n FROM "CompteurTicket" WHERE "pointDeVenteId" = '${pv4}'`,
      `SELECT count(*)::int AS n FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-4'`,
    ];
    for (const requete of restes) {
      expect(await compter(requete)).toBe(0);
    }
  });

  it('stock:verifier contrôle les allocations des lignes de vente (D525)', async () => {
    const pv1 = await pv('str-pharma-1');
    await poste('poste-p1-w1', pv1, 'harnais-p1-w1');
    await sessionOuverte('sess-alloc', 'poste-p1-w1', pv1, 'usr-pharm-p1');
    await vente({
      id: 'vte-alloc',
      structureId: 'str-pharma-1',
      sessionId: 'sess-alloc',
      numero: 'T1-0009001',
      numeroTicket: 9001,
      total: 4350,
    });
    const commun = { venteId: 'vte-alloc', prix: 150, unite: 'UNITE' };
    await ligne({
      ...commun,
      id: 'lv-alloc-a',
      stockId: 'stk-06',
      quantite: 20,
      sousTotal: 3000,
      nombre: 20,
      coefficient: 1,
    });
    await ligne({
      ...commun,
      id: 'lv-alloc-b',
      stockId: 'stk-03',
      quantite: 5,
      sousTotal: 750,
      nombre: 5,
      coefficient: 1,
    });
    await ligne({
      ...commun,
      id: 'lv-alloc-c',
      stockId: 'stk-06',
      quantite: 4,
      sousTotal: 600,
      nombre: 4,
      coefficient: 1,
    });
    await allocation('al-a-1', 'lv-alloc-a', 'lot-copie-1', 12, 'DEFINITIVE');
    await allocation('al-a-2', 'lv-alloc-a', 'lot-copie-2', 8, 'DEFINITIVE');
    await allocation('al-b-1', 'lv-alloc-b', 'lot-copie-1', 3, 'DEFINITIVE');
    await allocation('al-c-1', 'lv-alloc-c', 'lot-copie-1', 1, 'DEFINITIVE');
    await allocation('al-c-2', 'lv-alloc-c', null, 3, 'PROVISOIRE');

    if (!base) throw new Error('Base de test non créée.');
    const rapport = await verifierStock(base.client);
    expect(rapport.allocations).toEqual({
      nombre: 1,
      exemples: [{ ligneVenteId: 'lv-alloc-b', quantite: 5, alloue: 3 }],
    });
    expect(rapport.totalAnomalies).toBe(1);
  });

  async function compterStock1() {
    const requetes: Record<string, string> = {
      ventes: `SELECT count(*)::int AS n FROM "Vente" WHERE "structureId" = 'str-pharma-1'`,
      lignes: `SELECT count(*)::int AS n FROM "LigneVente" l JOIN "Vente" v ON v."id" = l."venteId" WHERE v."structureId" = 'str-pharma-1'`,
      allocations: `SELECT count(*)::int AS n FROM "AllocationLot" a JOIN "LigneVente" l ON l."id" = a."ligneVenteId" JOIN "Vente" v ON v."id" = l."venteId" WHERE v."structureId" = 'str-pharma-1'`,
      sessions: `SELECT count(*)::int AS n FROM "SessionCaisse" s JOIN "PointDeVente" p ON p."id" = s."pointDeVenteId" WHERE p."structureId" = 'str-pharma-1'`,
      lots: `SELECT count(*)::int AS n FROM "LotStock" l JOIN "PointDeVente" p ON p."id" = l."pointDeVenteId" WHERE p."structureId" = 'str-pharma-1'`,
      mouvements: `SELECT count(*)::int AS n FROM "MouvementStock" m JOIN "PointDeVente" p ON p."id" = m."pointDeVenteId" WHERE p."structureId" = 'str-pharma-1'`,
      pointsDeVente: `SELECT count(*)::int AS n FROM "PointDeVente" WHERE "structureId" = 'str-pharma-1'`,
    };
    const resultat: Record<string, number> = {};
    for (const [cle, requete] of Object.entries(requetes)) {
      resultat[cle] = await compter(requete);
    }
    return resultat;
  }

  it('purge démo : pièces de caisse et de vente, journal de stock et configuration des seules structures données', async () => {
    const pv2 = await pv('str-pharma-2');
    const especes = await mode('ESPECES');
    const orange = await mode('ORANGE_MONEY');
    const lotTech2 = await lotTechnique('stk-26');

    await poste('poste-p2-w1', pv2, 'harnais-p2-w1');
    await sessionOuverte('s-p2-1', 'poste-p2-w1', pv2, 'usr-pharm-p2');
    await sql(
      'INSERT INTO "ComptageCaisse" ("id","sessionCaisseId","moment","totalEspeces","auteurId","evenementId") VALUES (\'cpt-p2\',\'s-p2-1\',\'OUVERTURE\',50000,\'usr-pharm-p2\',\'evt-cpt-p2\')',
    );
    await sql(
      'INSERT INTO "LigneComptage" ("id","comptageId","valeurFaciale","nombre") VALUES (\'lc-p2-1\',\'cpt-p2\',20000,2), (\'lc-p2-2\',\'cpt-p2\',10000,1)',
    );
    await sql(
      'INSERT INTO "ReleveModePaiement" ("id","comptageId","modePaiementId","montantDeclare") VALUES (\'rel-p2\',\'cpt-p2\',$1,0)',
      [orange],
    );
    await sql(
      'INSERT INTO "MouvementCaisse" ("id","sessionCaisseId","pointDeVenteId","type","modePaiementId","montant","motif","auteurId","evenementId") VALUES (\'mvc-p2\',\'s-p2-1\',$1,\'APPORT\',$2,10000,\'Fond complémentaire\',\'usr-pharm-p2\',\'evt-mvc-p2\')',
      [pv2, especes],
    );
    await vente({
      id: 'vte-p2-t1',
      structureId: 'str-pharma-2',
      sessionId: 's-p2-1',
      numero: 'T1-0000001',
      numeroTicket: 1,
      total: 6000,
    });
    await ligne({
      id: 'lv-p2-t1',
      venteId: 'vte-p2-t1',
      stockId: 'stk-26',
      prix: 1500,
      quantite: 4,
      sousTotal: 6000,
      unite: 'BOITE',
      nombre: 4,
      coefficient: 1,
    });
    await allocation('al-p2-t1', 'lv-p2-t1', lotTech2, 4, 'DEFINITIVE', true);
    await sql(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant") VALUES (\'pai-p2-t1\',\'vte-p2-t1\',\'s-p2-1\',$1,6000)',
      [especes],
    );
    await vente({
      id: 'vte-p2-a1',
      structureId: 'str-pharma-2',
      sessionId: 's-p2-1',
      numero: 'A-T1-0000001',
      numeroTicket: 2,
      total: -6000,
      typePiece: 'ANNULATION',
      origine: 'vte-p2-t1',
      motif: 'Erreur',
    });
    await ligne({
      id: 'lv-p2-a1',
      venteId: 'vte-p2-a1',
      stockId: 'stk-26',
      prix: 1500,
      quantite: -4,
      sousTotal: -6000,
      unite: 'BOITE',
      nombre: -4,
      coefficient: 1,
    });
    await sql(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant") VALUES (\'pai-p2-a1\',\'vte-p2-a1\',\'s-p2-1\',$1,-6000)',
      [especes],
    );
    await sql(
      'UPDATE "SessionCaisse" SET "statut" = \'FERMEE\', "fermeeLe" = now(), "evenementFermetureId" = \'ferm-s-p2-1\' WHERE "id" = \'s-p2-1\'',
    );
    await sql(
      'INSERT INTO "ResultatSessionMode" ("id","sessionCaisseId","modePaiementId","theorique","compte","ecart") VALUES (\'res-p2\',\'s-p2-1\',$1,60000,60000,0)',
      [especes],
    );
    await sql(
      'INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES (\'clo-p2\',$1,$2::date,\'usr-admin-p2\')',
      [pv2, jourJ()],
    );
    await sql(
      'INSERT INTO "TotalClotureMode" ("id","clotureId","modePaiementId","theorique","compte","ecart") VALUES (\'tot-p2\',\'clo-p2\',$1,60000,60000,0)',
      [especes],
    );
    await sql(
      'UPDATE "SessionCaisse" SET "statut" = \'INCLUSE_DANS_CLOTURE\', "clotureJournaliereId" = \'clo-p2\' WHERE "id" = \'s-p2-1\'',
    );
    await sql(
      'INSERT INTO "Reception" ("id","pointDeVenteId","recueLe","auteurId") VALUES (\'rec-p2\',$1,now(),\'usr-admin-p2\')',
      [pv2],
    );
    await sql(
      'INSERT INTO "LotStock" ("id","stockMedicamentId","pointDeVenteId","quantiteRecue","coutUnitaire","coefficientReception","dateExpiration","dateReception","receptionId") VALUES (\'lot-rec-p2\',\'stk-26\',$1,10,100,1,$2::date,now(),\'rec-p2\')',
      [pv2, jourIso(plus(400))],
    );
    await sql(
      'INSERT INTO "MouvementStock" ("id","evenementId","pointDeVenteId","stockMedicamentId","lotId","type","quantite","pieceOrigineType") VALUES (\'evt-rec-p2\',\'evt-rec-p2\',$1,\'stk-26\',\'lot-rec-p2\',\'RECEPTION\',10,\'RECEPTION\')',
      [pv2],
    );
    await sql(
      'INSERT INTO "Anomalie" ("id","pointDeVenteId","type","pieceType","details") VALUES (\'anom-p2\',$1,\'ECART_INVENTAIRE\',\'INVENTAIRE\',\'{}\'::jsonb)',
      [pv2],
    );
    await sql(
      'INSERT INTO "Inventaire" ("id","pointDeVenteId","auteurId") VALUES (\'inv-p2\',$1,\'usr-admin-p2\')',
      [pv2],
    );
    await sql(
      'INSERT INTO "LigneInventaire" ("id","inventaireId","stockMedicamentId","lotId","quantiteTheorique","quantiteComptee","ecart","sousTolerance","anomalieId") VALUES (\'li-p2\',\'inv-p2\',\'stk-26\',\'lot-rec-p2\',10,10,0,true,\'anom-p2\')',
    );
    await sql(
      'INSERT INTO "EvenementSynchro" ("id","evenementId","posteId","sequence","type","statut","empreinte","corps") VALUES (\'evs-p2\',\'evt-sync-p2\',\'poste-p2-w1\',1,\'VENTE\',\'APPLIQUE\',\'abc\',\'{}\'::jsonb)',
    );

    const avant1 = await compterStock1();
    expect(avant1.ventes).toBeGreaterThan(0);

    await client().$transaction(
      async (tx) => {
        await purgerPiecesPharmacies(tx, ['str-pharma-2']);
        await purgerStockPharmacies(tx, ['str-pharma-2']);
        await supprimerConfigurationPharmacies(tx, ['str-pharma-2']);
        const reglage = await tx.$queryRaw<
          { v: string | null }[]
        >`SELECT current_setting('medconnecte.purge_autorisee', true) AS "v"`;
        expect(reglage[0].v).toBe('off');
        await tx.user.deleteMany({ where: { structureId: 'str-pharma-2' } });
        await tx.structure.delete({ where: { id: 'str-pharma-2' } });
      },
      { timeout: 30000 },
    );

    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Structure" WHERE "id" = 'str-pharma-2'`,
      ),
    ).toBe(0);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Vente" WHERE "structureId" = 'str-pharma-2'`,
      ),
    ).toBe(0);
    for (const table of [
      'ComptageCaisse',
      'LigneComptage',
      'ReleveModePaiement',
      'MouvementCaisse',
      'Paiement',
      'ResultatSessionMode',
      'ClotureJournaliere',
      'TotalClotureMode',
      'Reception',
      'Inventaire',
      'LigneInventaire',
      'EvenementSynchro',
      'Anomalie',
    ]) {
      expect(await compter(`SELECT count(*)::int AS n FROM "${table}"`)).toBe(
        0,
      );
    }
    expect(await compterStock1()).toEqual(avant1);
  });

  it('purge démo : le contournement est retiré à la fin, une suppression de pièce suivante échoue et annule tout', async () => {
    const avant = await compter(
      `SELECT count(*)::int AS n FROM "Vente" WHERE "structureId" = 'str-pharma-1'`,
    );
    await expect(
      client().$transaction(async (tx) => {
        await purgerPiecesPharmacies(tx, ['str-pharma-3']);
        await tx.vente.deleteMany({ where: { structureId: 'str-pharma-1' } });
      }),
    ).rejects.toThrow();
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Vente" WHERE "structureId" = 'str-pharma-1'`,
      ),
    ).toBe(avant);
    const pv3 = await pv('str-pharma-3');
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "pointDeVenteId" = '${pv3}' AND "technique"`,
      ),
    ).toBe(1);
  });
});
