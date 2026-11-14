import { HttpException } from '@nestjs/common';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import { PointsDeVenteService } from 'src/pharmacie/points-de-vente.service';
import { PrismaService } from 'src/common/services/prisma.service';
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
import { chargerFormatActuel } from './fixtures/format-actuel';

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

describe('Points de vente, postes et référentiels sur base de test (PB05)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let service: PointsDeVenteService;

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
    service = new PointsDeVenteService(
      prisma,
      new AccesPharmacieService(prisma),
    );
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

  async function dernierAudit(entityType: string, entityId: string) {
    const res = await sql(
      'SELECT "action", "entityType", "entityId", "userId", "metadata" FROM "AuditLog" WHERE "entityType" = $1 AND "entityId" = $2 ORDER BY "createdAt" DESC, "id" DESC LIMIT 1',
      [entityType, entityId],
    );
    return res.rows[0];
  }

  it('1. référentiels : 3 modes et 6 billets dans l ordre, paramètres par défaut, aucun champ interne', async () => {
    const { data, message } = await service.referentiels(
      'str-pharma-1',
      'usr-pharm-p1',
    );
    expect(data.modesPaiement.map((m) => m.code)).toEqual([
      'ESPECES',
      'ORANGE_MONEY',
      'MTN_MOMO',
    ]);
    expect(Object.keys(data.modesPaiement[0]).sort()).toEqual([
      'code',
      'comptagePhysique',
      'libelle',
      'ordre',
      'referenceAutorisee',
    ]);
    expect(data.coupures.map((c) => c.valeurFaciale)).toEqual([
      20000, 10000, 5000, 2000, 1000, 500,
    ]);
    for (const c of data.coupures) {
      expect(c.type).toBe('BILLET');
      expect(c.devise).toBe('GNF');
    }
    expect(Object.keys(data.parametres).sort()).toEqual([
      'debutCaisse',
      'horizonsPeremptionJours',
      'seuilAvertissementPrixPct',
      'seuilEcartCaisse',
      'seuilRechargementPlagePct',
      'seuilStockBas',
      'taillePlageTickets',
    ]);
    expect(data.parametres.seuilStockBas).toBe(10);
    expect(message).toBe('Référentiels de caisse.');
  });

  it('CA17 : un mode de paiement ajouté par un simple INSERT apparaît sans changement de code, un mode inactif n apparaît pas', async () => {
    await sql(
      `INSERT INTO "ModePaiement" ("id", "code", "libelle", "comptagePhysique", "referenceAutorisee", "ordre", "actif") VALUES ('mode-carte', 'CARTE', 'Carte bancaire', false, true, 4, true), ('mode-cheque', 'CHEQUE', 'Chèque', false, true, 5, false)`,
    );
    try {
      const { data } = await service.referentiels(
        'str-pharma-1',
        'usr-pharm-p1',
      );
      expect(data.modesPaiement.map((m) => m.code)).toEqual([
        'ESPECES',
        'ORANGE_MONEY',
        'MTN_MOMO',
        'CARTE',
      ]);
      expect(data.modesPaiement.at(-1)).toEqual({
        code: 'CARTE',
        libelle: 'Carte bancaire',
        comptagePhysique: false,
        referenceAutorisee: true,
        ordre: 4,
      });
    } finally {
      await sql(
        `DELETE FROM "ModePaiement" WHERE "id" IN ('mode-carte', 'mode-cheque')`,
      );
    }
  });

  it('référentiels : hôpital et membre d une autre pharmacie refusés (403)', async () => {
    expect(
      (await refus(service.referentiels('str-hopital-1', 'usr-admin-h1')))
        .statut,
    ).toBe(403);
    expect(
      (await refus(service.referentiels('str-pharma-1', 'usr-pharm-p2')))
        .statut,
    ).toBe(403);
  });

  it('paramètres : modification rangée, tracée et auditée, dates de début inchangées', async () => {
    const avant = (await service.parametres('str-pharma-1', 'usr-admin-p1'))
      .data;
    const reponse = await service.modifierParametres(
      'str-pharma-1',
      'usr-admin-p1',
      { horizonsPeremptionJours: [7, 90, 30, 60], seuilStockBas: 5 },
      '127.0.0.1',
    );
    expect(reponse.data.horizonsPeremptionJours).toEqual([90, 60, 30, 7]);
    expect(reponse.data.seuilStockBas).toBe(5);
    expect(reponse.data.seuilEcartCaisse).toBe(5000);
    expect(reponse.data.debutCaisse.getTime()).toBe(
      avant.debutCaisse.getTime(),
    );
    expect(reponse.message).toBe('Paramètres enregistrés.');

    const ligne = await sql(
      `SELECT "misAJourParId" FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-1'`,
    );
    expect(ligne.rows[0].misAJourParId).toBe('usr-admin-p1');

    const audit = await dernierAudit('ParametresPharmacie', 'str-pharma-1');
    expect(audit.action).toBe('update');
    expect(audit.userId).toBe('usr-admin-p1');
    expect(audit.metadata).toEqual({
      avant: { horizonsPeremptionJours: [90, 30, 7], seuilStockBas: 10 },
      apres: { horizonsPeremptionJours: [90, 60, 30, 7], seuilStockBas: 5 },
    });
  });

  it('paramètres : corps vide ou valeurs identiques, aucune écriture', async () => {
    const auditsAvant = await compter(
      `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityType" = 'ParametresPharmacie'`,
    );
    const majAvant = (
      await sql(
        `SELECT "updatedAt" FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-1'`,
      )
    ).rows[0].updatedAt as Date;

    await service.modifierParametres('str-pharma-1', 'usr-admin-p1', {});
    await service.modifierParametres('str-pharma-1', 'usr-admin-p1', {
      seuilStockBas: 5,
    });

    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "AuditLog" WHERE "entityType" = 'ParametresPharmacie'`,
      ),
    ).toBe(auditsAvant);
    const majApres = (
      await sql(
        `SELECT "updatedAt" FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-1'`,
      )
    ).rows[0].updatedAt as Date;
    expect(majApres.getTime()).toBe(majAvant.getTime());
  });

  it('paramètres : créés avec les défauts pour une pharmacie qui n en a pas', async () => {
    await sql(
      `DELETE FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-2'`,
    );
    const { data } = await service.parametres('str-pharma-2', 'usr-admin-p2');
    expect(data.seuilStockBas).toBe(10);
    expect(data.horizonsPeremptionJours).toEqual([90, 30, 7]);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-2'`,
      ),
    ).toBe(1);
  });

  it('postes : enregistrement web W1 avec libellé par défaut, idempotent par appareilId', async () => {
    const premier = await service.enregistrerPoste(
      'str-pharma-1',
      'usr-pharm-p1',
      { type: 'WEB', appareilId: 'navigateur-essai-0001' },
      '127.0.0.1',
    );
    expect(premier.data.cree).toBe(true);
    expect(premier.data.code).toBe('W1');
    expect(premier.data.libelle).toBe('Navigateur de Mamadou');
    expect(premier.data.type).toBe('WEB');
    expect(premier.data.actif).toBe(true);
    expect(premier.message).toBe('Poste enregistré.');
    expect(premier.data).not.toHaveProperty('enregistreParId');
    expect(premier.data).not.toHaveProperty('pointDeVenteId');

    const ligne = await sql(
      `SELECT "enregistreParId" FROM "Poste" WHERE "id" = $1`,
      [premier.data.id],
    );
    expect(ligne.rows[0].enregistreParId).toBe('usr-pharm-p1');
    const audit = await dernierAudit('Poste', premier.data.id);
    expect(audit.action).toBe('create');

    const second = await service.enregistrerPoste(
      'str-pharma-1',
      'usr-pharm-p1',
      { type: 'WEB', appareilId: 'navigateur-essai-0001', libelle: 'Autre' },
      '127.0.0.1',
    );
    expect(second.data.cree).toBe(false);
    expect(second.data.id).toBe(premier.data.id);
    expect(second.data.libelle).toBe('Navigateur de Mamadou');
    expect(second.message).toBe('Ce poste était déjà enregistré.');
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = 'str-pharma-1' AND p."type" = 'WEB' AND p."appareilId" = 'navigateur-essai-0001'`,
      ),
    ).toBe(1);
  });

  it('postes : second navigateur W2, desktop D1 avec libellé par défaut, libellé fourni rogné et conservé', async () => {
    const w2 = await service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', {
      type: 'WEB',
      appareilId: 'navigateur-essai-0002',
    });
    expect(w2.data.code).toBe('W2');

    const d1 = await service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', {
      type: 'DESKTOP',
      appareilId: 'installation-essai-0001',
    });
    expect(d1.data.code).toBe('D1');
    expect(d1.data.libelle).toBe('Poste D1');

    const d2 = await service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', {
      type: 'DESKTOP',
      appareilId: 'installation-essai-0002',
      libelle: 'Comptoir principal',
    });
    expect(d2.data.code).toBe('D2');
    expect(d2.data.libelle).toBe('Comptoir principal');
  });

  it('postes : même appareil déclaré avec un autre type, 409 POSTE_TYPE_DIFFERENT', async () => {
    const { statut, corps } = await refus(
      service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', {
        type: 'DESKTOP',
        appareilId: 'navigateur-essai-0001',
      }),
    );
    expect(statut).toBe(409);
    expect(corps).toMatchObject({
      code: 'POSTE_TYPE_DIFFERENT',
      message: 'Cet appareil est déjà enregistré comme un autre type de poste.',
    });
  });

  it('postes : cinq enregistrements simultanés du même appareil créent un seul poste', async () => {
    const reponses = await Promise.all(
      Array.from({ length: 5 }, () =>
        service.enregistrerPoste('str-pharma-1', 'usr-pharm-p1', {
          type: 'WEB',
          appareilId: 'navigateur-course-0001',
        }),
      ),
    );
    expect(reponses.filter((r) => r.data.cree)).toHaveLength(1);
    expect(new Set(reponses.map((r) => r.data.id)).size).toBe(1);
    expect(reponses[0].data.code).toBe('W3');
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "Poste" WHERE "appareilId" = 'navigateur-course-0001'`,
      ),
    ).toBe(1);
  });

  it('postes : liste sans le poste technique, modification du libellé et de l activité auditée', async () => {
    const liste = await service.listerPostes('str-pharma-1', 'usr-admin-p1');
    expect(liste.data.map((p) => p.code).sort()).toEqual([
      'D1',
      'D2',
      'W1',
      'W2',
      'W3',
    ]);
    expect(liste.data.map((p) => p.code)).not.toContain('REPRISE');
    expect(liste.message).toBe('5 poste(s).');

    const w1 = liste.data.find((p) => p.code === 'W1');
    if (!w1) throw new Error('Poste W1 introuvable.');
    const modifie = await service.modifierPoste(
      'str-pharma-1',
      'usr-admin-p1',
      w1.id,
      { libelle: 'Caisse 1', actif: false },
      '127.0.0.1',
    );
    expect(modifie.data.libelle).toBe('Caisse 1');
    expect(modifie.data.actif).toBe(false);
    expect(modifie.message).toBe('Poste mis à jour.');

    const audit = await dernierAudit('Poste', w1.id);
    expect(audit.action).toBe('update');
    expect(audit.metadata).toEqual({
      avant: { libelle: 'Navigateur de Mamadou', actif: true },
      apres: { libelle: 'Caisse 1', actif: false },
    });

    const reenregistre = await service.enregistrerPoste(
      'str-pharma-1',
      'usr-pharm-p1',
      { type: 'WEB', appareilId: 'navigateur-essai-0001' },
    );
    expect(reenregistre.data.actif).toBe(false);
    expect(reenregistre.data.cree).toBe(false);
  });

  it('postes : poste technique, poste d une autre pharmacie ou inconnu, 404', async () => {
    const reprise = await sql(
      `SELECT p."id" FROM "Poste" p JOIN "PointDeVente" pv ON pv."id" = p."pointDeVenteId" WHERE pv."structureId" = 'str-pharma-1' AND p."code" = 'REPRISE'`,
    );
    const autrePharmacie = await service.enregistrerPoste(
      'str-pharma-2',
      'usr-pharm-p2',
      { type: 'WEB', appareilId: 'navigateur-essai-0003' },
    );
    const identifiants = [
      reprise.rows[0].id as string,
      autrePharmacie.data.id,
      'poste-inconnu',
    ];
    for (const id of identifiants) {
      const { statut, corps } = await refus(
        service.modifierPoste('str-pharma-1', 'usr-admin-p1', id, {
          actif: false,
        }),
      );
      expect(statut).toBe(404);
      expect(JSON.stringify(corps)).toContain('Ce poste est introuvable.');
    }
  });

  it('démarrage : une pharmacie sans point de vente est complétée, une seconde passe ne crée rien', async () => {
    await sql(
      `INSERT INTO "Structure" ("id", "nom", "type", "email", "ville", "isActive", "isConfigured", "createdAt", "updatedAt") VALUES ('str-pharma-4', 'Pharmacie de Dixinn (harnais)', 'PHARMACIE', 'pharma4@harnais.test', 'Conakry', true, true, now(), now()), ('str-hopital-2', 'Hôpital de Kipé (harnais)', 'HOPITAL', 'hopital2@harnais.test', 'Conakry', true, true, now(), now())`,
    );
    expect(await service.completerPointsDeVente()).toBe(1);

    const pv = await sql(
      `SELECT "id", "ordre", "nom" FROM "PointDeVente" WHERE "structureId" = 'str-pharma-4'`,
    );
    expect(pv.rows).toHaveLength(1);
    expect(pv.rows[0].ordre).toBe(1);
    expect(pv.rows[0].nom).toBe('Pharmacie de Dixinn (harnais)');
    const pvId = pv.rows[0].id as string;
    const poste = await sql(
      `SELECT "code", "actif" FROM "Poste" WHERE "pointDeVenteId" = $1`,
      [pvId],
    );
    expect(poste.rows).toEqual([{ code: 'REPRISE', actif: false }]);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "CompteurTicket" WHERE "pointDeVenteId" = $1 AND "prochainNumero" = 1`,
        [pvId],
      ),
    ).toBe(1);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-4'`,
      ),
    ).toBe(1);
    expect(
      await compter(
        `SELECT count(*)::int AS n FROM "PointDeVente" WHERE "structureId" = 'str-hopital-2'`,
      ),
    ).toBe(0);

    const total = () =>
      compter(
        `SELECT (SELECT count(*) FROM "PointDeVente") + (SELECT count(*) FROM "Poste") + (SELECT count(*) FROM "CompteurTicket") + (SELECT count(*) FROM "ParametresPharmacie") AS n`,
      );
    const avant = await total();
    expect(await service.completerPointsDeVente()).toBe(0);
    expect(await total()).toBe(avant);
  });

  it('suppression d une pharmacie par le super administrateur : sa configuration de caisse part avec elle', async () => {
    const pv = await sql(
      `SELECT "id" FROM "PointDeVente" WHERE "structureId" = 'str-pharma-4'`,
    );
    const pvId = pv.rows[0].id as string;
    await sql(
      `INSERT INTO "Poste" ("id", "pointDeVenteId", "code", "libelle", "type", "appareilId") VALUES ('poste-p4-web', $1, 'W1', 'Navigateur', 'WEB', 'navigateur-p4-0001')`,
      [pvId],
    );
    await sql(
      `INSERT INTO "PlageTicket" ("id", "posteId", "pointDeVenteId", "debut", "fin") VALUES ('plage-p4', 'poste-p4-web', $1, 1, 1000)`,
      [pvId],
    );
    await sql(
      `INSERT INTO "Fournisseur" ("id", "structureId", "nom") VALUES ('four-p4', 'str-pharma-4', 'Laborex Guinée')`,
    );
    await sql(
      `INSERT INTO "Anomalie" ("id", "pointDeVenteId", "type", "pieceType", "details") VALUES ('anom-p4', $1, 'STOCK_NEGATIF', 'VENTE', '{}'::jsonb)`,
      [pvId],
    );

    if (!prisma) throw new Error('Client Prisma non créé.');
    const superAdmin = new SuperAdminService(prisma, {} as never, {} as never);
    const reponse = await superAdmin.deleteStructure('str-pharma-4');
    expect(reponse.success).toBe(true);

    const restes = [
      `SELECT count(*)::int AS n FROM "Structure" WHERE "id" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "PointDeVente" WHERE "structureId" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "Poste" WHERE "pointDeVenteId" = '${pvId}'`,
      `SELECT count(*)::int AS n FROM "PlageTicket" WHERE "pointDeVenteId" = '${pvId}'`,
      `SELECT count(*)::int AS n FROM "CompteurTicket" WHERE "pointDeVenteId" = '${pvId}'`,
      `SELECT count(*)::int AS n FROM "ParametresPharmacie" WHERE "structureId" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "Fournisseur" WHERE "structureId" = 'str-pharma-4'`,
      `SELECT count(*)::int AS n FROM "Anomalie" WHERE "pointDeVenteId" = '${pvId}'`,
    ];
    for (const requete of restes) {
      expect(await compter(requete)).toBe(0);
    }
  });
});
