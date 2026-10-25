import { HttpException } from '@nestjs/common';
import { AccesPharmacieService } from 'src/pharmacie/acces-pharmacie.service';
import {
  FicheProduitService,
  MESSAGE_CONVERSION_REQUISE,
  MESSAGE_FICHE_INTROUVABLE,
  MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT,
} from 'src/pharmacie/fiche-produit.service';
import { cheminsCout } from 'src/pharmacie/masquer-couts';
import { PharmacieService } from 'src/pharmacie/pharmacie.service';
import { MouvementsStockService } from 'src/pharmacie/stock/mouvements-stock.service';
import type { PermissionsService } from 'src/common/rbac/permissions.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { PrismaService } from 'src/common/services/prisma.service';
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

describe('Fiche produit étendue sur base de test (PB06)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let service: FicheProduitService;
  let pharmacie: PharmacieService;

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
    service = new FicheProduitService(prisma, acces);
    const permissionsFactices = {
      getUserPermissions: () => Promise.resolve([] as string[]),
    } as unknown as PermissionsService;
    pharmacie = new PharmacieService(
      prisma,
      new NotificationsService(prisma),
      acces,
      new MouvementsStockService(),
      permissionsFactices,
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

  async function fiche(id: string) {
    const res = await sql(
      'SELECT "prixUnitaire", "prixUnite", "coefficientBoite", "uniteMinimale"::text AS "uniteMinimale", "deconditionnable", "toleranceInventaire", "qualifie", "quantite", "updatedAt" FROM "StockMedicament" WHERE "id" = $1',
      [id],
    );
    return res.rows[0];
  }

  const modifier = (
    stockId: string,
    dto: Parameters<FicheProduitService['modifierFiche']>[3],
    userId = 'usr-admin-p1',
  ) => service.modifierFiche('str-pharma-1', userId, stockId, dto, '127.0.0.1');

  it('CA3 : modifier le prix de la boîte ne change pas le prix à l unité', async () => {
    const r1 = await modifier('stk-06', {
      deconditionnable: true,
      prixUnite: 100,
    });
    expect(r1.data.prixUnite).toBe(100);
    expect(r1.data.prixUnitaire).toBe(1500);
    expect(r1.data.deconditionnable).toBe(true);
    expect(r1.message).toBe('Fiche produit enregistrée.');

    const r2 = await modifier('stk-06', { prixUnitaire: 2000 });
    expect(r2.data.prixUnitaire).toBe(2000);
    expect(r2.data.prixUnite).toBe(100);

    const enBase = await fiche('stk-06');
    expect(enBase.prixUnitaire).toBe(2000);
    expect(enBase.prixUnite).toBe(100);
  });

  it('CA3 : modifier le prix à l unité ne change pas le prix de la boîte', async () => {
    const r = await modifier('stk-06', { prixUnite: 150 });
    expect(r.data.prixUnite).toBe(150);
    expect(r.data.prixUnitaire).toBe(2000);
    const enBase = await fiche('stk-06');
    expect(enBase.prixUnite).toBe(150);
    expect(enBase.prixUnitaire).toBe(2000);
  });

  it('CA3 : l upsert du stock change le prix de la boîte sans toucher au prix à l unité ni à la fiche', async () => {
    const r = await pharmacie.upsertStock('str-pharma-1', 'usr-admin-p1', {
      medicamentId: 'med-06',
      quantite: 240,
      prixUnitaire: 2500,
    });
    expect(r.data.prixUnitaire).toBe(2500);
    expect(r.data.prixUnite).toBe(150);
    const enBase = await fiche('stk-06');
    expect(enBase.prixUnitaire).toBe(2500);
    expect(enBase.prixUnite).toBe(150);
    expect(enBase.deconditionnable).toBe(true);
    expect(enBase.coefficientBoite).toBe(1);
    expect(enBase.uniteMinimale).toBe('UNITE');
    expect(enBase.qualifie).toBe(false);
  });

  it('avertissement ECART_PRIX au-delà du seuil de 25 %, aucun en deçà ni à la frontière, jamais bloquant', async () => {
    const r1 = await modifier('stk-01', {
      prixUnitaire: 2000,
      coefficientBoite: 10,
      deconditionnable: true,
      prixUnite: 200,
    });
    expect(r1.data.avertissements).toEqual([]);
    expect(r1.data.coefficientBoite).toBe(10);

    const r2 = await modifier('stk-01', { prixUnite: 250 });
    expect(r2.data.avertissements).toEqual([]);

    const r3 = await modifier('stk-01', { prixUnite: 251 });
    expect(r3.data.avertissements).toEqual([
      { code: 'ECART_PRIX', ecartPct: 26 },
    ]);
    expect((await fiche('stk-01')).prixUnite).toBe(251);

    const r4 = await modifier('stk-01', { prixUnite: 150 });
    expect(r4.data.avertissements).toEqual([]);

    const r5 = await modifier('stk-01', { prixUnite: 149 });
    expect(r5.data.avertissements).toEqual([
      { code: 'ECART_PRIX', ecartPct: 26 },
    ]);

    await sql(
      'UPDATE "ParametresPharmacie" SET "seuilAvertissementPrixPct" = 50 WHERE "structureId" = \'str-pharma-1\'',
    );
    const r6 = await modifier('stk-01', {});
    expect(r6.data.avertissements).toEqual([]);
    expect(r6.message).toBe('Aucune modification de la fiche produit.');
    await sql(
      'UPDATE "ParametresPharmacie" SET "seuilAvertissementPrixPct" = 25 WHERE "structureId" = \'str-pharma-1\'',
    );
  });

  it('refus : prix à l unité sur une fiche non déconditionnable (400 PRIX_UNITE_SANS_DECONDITIONNEMENT), rien n est écrit', async () => {
    const r1 = await refus(modifier('stk-03', { prixUnite: 100 }));
    expect(r1.statut).toBe(400);
    expect(r1.corps).toMatchObject({
      code: 'PRIX_UNITE_SANS_DECONDITIONNEMENT',
      message: MESSAGE_PRIX_UNITE_SANS_DECONDITIONNEMENT,
    });
    expect((await fiche('stk-03')).prixUnite).toBeNull();

    const r2 = await refus(modifier('stk-01', { deconditionnable: false }));
    expect(r2.statut).toBe(400);
    expect(r2.corps).toMatchObject({
      code: 'PRIX_UNITE_SANS_DECONDITIONNEMENT',
    });
    const enBase = await fiche('stk-01');
    expect(enBase.deconditionnable).toBe(true);
    expect(enBase.prixUnite).toBe(149);

    const ok = await modifier('stk-01', {
      deconditionnable: false,
      prixUnite: null,
    });
    expect(ok.data.deconditionnable).toBe(false);
    expect(ok.data.prixUnite).toBeNull();
  });

  it('refus : coefficient changé sur une fiche non qualifiée qui a du stock (400 CONVERSION_REQUISE), accepté après qualification sans conversion', async () => {
    const r1 = await refus(modifier('stk-05', { coefficientBoite: 20 }));
    expect(r1.statut).toBe(400);
    expect(r1.corps).toMatchObject({
      code: 'CONVERSION_REQUISE',
      message: MESSAGE_CONVERSION_REQUISE,
    });
    expect((await fiche('stk-05')).coefficientBoite).toBe(1);

    const r2 = await refus(
      modifier('stk-05', { coefficientBoite: 20, qualifie: true }),
    );
    expect(r2.statut).toBe(400);
    expect(r2.corps).toMatchObject({ code: 'CONVERSION_REQUISE' });
    expect((await fiche('stk-05')).qualifie).toBe(false);

    const q = await modifier('stk-05', {
      uniteMinimale: 'COMPRIME',
      qualifie: true,
    });
    expect(q.data.qualifie).toBe(true);
    expect(q.data.uniteMinimale).toBe('COMPRIME');

    const c = await modifier('stk-05', { coefficientBoite: 20 });
    expect(c.data.coefficientBoite).toBe(20);
    expect((await fiche('stk-05')).quantite).toBe(11);
  });

  it('audit : seuls les champs changés, aucune écriture sans changement', async () => {
    await modifier(
      'stk-02',
      { toleranceInventaire: 2, uniteMinimale: 'GELULE' },
      'usr-pharm-p1',
    );
    const lire = () =>
      sql(
        'SELECT "action", "userId", "metadata" FROM "AuditLog" WHERE "entityType" = \'StockMedicament\' AND "entityId" = \'stk-02\'',
      );
    const audit = await lire();
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].action).toBe('update');
    expect(audit.rows[0].userId).toBe('usr-pharm-p1');
    expect(audit.rows[0].metadata).toEqual({
      avant: { uniteMinimale: 'UNITE', toleranceInventaire: null },
      apres: { uniteMinimale: 'GELULE', toleranceInventaire: 2 },
    });
    const avant = (await fiche('stk-02')).updatedAt as Date;

    const r = await modifier(
      'stk-02',
      { toleranceInventaire: 2, uniteMinimale: 'GELULE' },
      'usr-pharm-p1',
    );
    expect(r.message).toBe('Aucune modification de la fiche produit.');
    expect((await lire()).rows).toHaveLength(1);
    const apres = (await fiche('stk-02')).updatedAt as Date;
    expect(apres.getTime()).toBe(avant.getTime());
  });

  it('réponse : fiche complète, médicament et avertissements, aucune clé de coût', async () => {
    const r = await modifier('stk-02', {});
    for (const propriete of [
      'id',
      'quantite',
      'prixUnitaire',
      'uniteMinimale',
      'coefficientBoite',
      'prixUnite',
      'deconditionnable',
      'toleranceInventaire',
      'qualifie',
      'archiveLe',
      'createdAt',
      'medicament',
      'avertissements',
    ]) {
      expect(r.data).toHaveProperty(propriete);
    }
    expect(Object.keys(r.data.medicament).sort()).toEqual([
      'categorie',
      'id',
      'nom',
    ]);
    expect(r.data.medicament.id).toBe('med-02');
    expect(cheminsCout(r.data)).toEqual([]);
  });

  it('lecture du stock : les champs de la fiche sont renvoyés pour chaque fiche', async () => {
    const r = await pharmacie.getStockPharmacie('str-pharma-1', 'usr-admin-p1');
    const stocks = r.data.stocks as Record<string, unknown>[];
    expect(stocks.length).toBeGreaterThan(0);
    for (const s of stocks) {
      for (const propriete of [
        'uniteMinimale',
        'coefficientBoite',
        'prixUnite',
        'deconditionnable',
        'toleranceInventaire',
        'qualifie',
      ]) {
        expect(s).toHaveProperty(propriete);
      }
    }
    const s5 = stocks.find((s) => s.id === 'stk-05');
    expect(s5).toMatchObject({
      coefficientBoite: 20,
      qualifie: true,
      uniteMinimale: 'COMPRIME',
    });
  });

  it('accès : hôpital, membre d une autre pharmacie, fiche d une autre pharmacie ou inconnue', async () => {
    const h = await refus(
      service.modifierFiche('str-hopital-1', 'usr-admin-h1', 'stk-01', {}),
    );
    expect(h.statut).toBe(403);
    const autre = await refus(
      service.modifierFiche('str-pharma-1', 'usr-pharm-p2', 'stk-01', {}),
    );
    expect(autre.statut).toBe(403);
    const etrangere = await refus(
      service.modifierFiche('str-pharma-2', 'usr-admin-p2', 'stk-01', {
        qualifie: true,
      }),
    );
    expect(etrangere.statut).toBe(404);
    expect(etrangere.corps).toMatchObject({
      message: MESSAGE_FICHE_INTROUVABLE,
    });
    expect((await fiche('stk-01')).qualifie).toBe(false);
    const inconnue = await refus(
      service.modifierFiche('str-pharma-1', 'usr-admin-p1', 'stk-inconnu', {}),
    );
    expect(inconnue.statut).toBe(404);
  });

  it('concurrence : deux modifications simultanées des deux prix, aucune perdue', async () => {
    await Promise.all([
      modifier('stk-06', { prixUnite: 300 }),
      modifier('stk-06', { prixUnitaire: 4000 }),
    ]);
    const enBase = await fiche('stk-06');
    expect(enBase.prixUnite).toBe(300);
    expect(enBase.prixUnitaire).toBe(4000);
  });
});
