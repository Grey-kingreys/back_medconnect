import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Client } from 'pg';
import {
  appliquerMigrations,
  appliquerRetourArriere,
  appliquerSql,
  BaseDeTest,
  creerBaseVide,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  DOSSIER_MIGRATIONS,
  DOSSIER_RETOURS_ARRIERE,
  supprimerBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  type ResumeFormatActuel,
} from './fixtures/format-actuel';

const M1 = '20261026090000_pharmacie_t1_permissions';
const M2 = '20261026100000_pharmacie_t1_points_de_vente';
const M3 = '20261026110000_pharmacie_t1_fiche_produit';
const M4 = '20261026120000_pharmacie_t1_lots_mouvements';
const M5 = '20261026130000_pharmacie_t1_caisse';
const JOUR_MS = 24 * 60 * 60 * 1000;
const MESSAGE_PIECES = /ne se modifient ni ne se suppriment jamais/;

function lignesSql(fichier: string): string[] {
  return readFileSync(fichier, 'utf8')
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== '' && !ligne.startsWith('--'));
}

function jourIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function compter(client: Client, sql: string): Promise<number> {
  const res = await client.query<{ n: number }>(sql);
  return res.rows[0].n;
}

async function pv(client: Client, structureId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "PointDeVente" WHERE "structureId" = $1 AND "ordre" = 1',
    [structureId],
  );
  return res.rows[0].id;
}

async function posteReprise(client: Client, pvId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "Poste" WHERE "pointDeVenteId" = $1 AND "code" = \'REPRISE\'',
    [pvId],
  );
  return res.rows[0].id;
}

async function mode(client: Client, code: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "ModePaiement" WHERE "code" = $1',
    [code],
  );
  return res.rows[0].id;
}

async function lotTechnique(client: Client, stockId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    'SELECT "id" FROM "LotStock" WHERE "stockMedicamentId" = $1 AND "lotTechnique"',
    [stockId],
  );
  return res.rows[0].id;
}

async function session(
  client: Client,
  id: string,
  posteId: string,
  pvId: string,
  options: {
    technique?: boolean;
    utilisateurId?: string | null;
    jour: string;
  },
): Promise<void> {
  await client.query(
    'INSERT INTO "SessionCaisse" ("id","pointDeVenteId","posteId","utilisateurId","utilisateurNom","technique","jourMetier","evenementOuvertureId") VALUES ($1,$2,$3,$4,\'Mamadou Diallo\',$5,$6::date,$7)',
    [
      id,
      pvId,
      posteId,
      options.utilisateurId === undefined
        ? 'usr-pharm-p1'
        : options.utilisateurId,
      options.technique ?? false,
      options.jour,
      'ouv-' + id,
    ],
  );
}

async function photographieSessions(client: Client) {
  const res = await client.query<Record<string, unknown>>(
    'SELECT * FROM "SessionCaisse" ORDER BY "id"',
  );
  return res.rows;
}

describe('Migration M5, caisse, réceptions, inventaires et synchronisation (PB09)', () => {
  let base: BaseDeTest | undefined;
  let appliquees: string[];
  let resume: ResumeFormatActuel;

  beforeAll(async () => {
    base = await creerBaseVide();
    await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    // Jamais au-delà de M5 : le retour arrière de M5 doit rester applicable.
    appliquees = await appliquerMigrations(base.client, {
      apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      jusqua: M5,
    });
  });

  afterAll(async () => {
    if (base) {
      await supprimerBaseDeTest(base);
    }
  });

  function client(): Client {
    if (!base) throw new Error('Base de test non créée.');
    return base.client;
  }

  const plus = (jours: number): Date =>
    new Date(resume.aujourdhui.getTime() + jours * JOUR_MS);

  it('M5 et son retour arrière commencent par BEGIN; et finissent par COMMIT; (D456)', () => {
    for (const fichier of [
      path.join(DOSSIER_MIGRATIONS, M5, 'migration.sql'),
      path.join(DOSSIER_RETOURS_ARRIERE, `${M5}.down.sql`),
    ]) {
      const lignes = lignesSql(fichier);
      expect(lignes[0]).toBe('BEGIN;');
      expect(lignes.at(-1)).toBe('COMMIT;');
    }
    const texte = readFileSync(
      path.join(DOSSIER_MIGRATIONS, M5, 'migration.sql'),
      'utf8',
    ).split(/\r?\n/);
    expect(
      texte.filter(
        (l) => l === '-- REPRISE: DEBUT (rejouable sans doublon, D421, D517)',
      ),
    ).toHaveLength(1);
    expect(texte.filter((l) => l === '-- REPRISE: FIN')).toHaveLength(1);
  });

  it('reprise : une session technique fermée par point de vente, sur le poste REPRISE', async () => {
    const c = client();
    expect(appliquees).toEqual([M1, M2, M3, M4, M5]);
    const toutes = await c.query<{
      technique: boolean;
      pointDeVenteId: string;
      statut: string;
      utilisateurId: string | null;
      utilisateurNom: string;
      posteId: string;
      evenementOuvertureId: string;
      fermeeLe: Date | null;
      evenementFermetureId: string | null;
      clotureJournaliereId: string | null;
      memeJour: boolean;
      ouverte: string;
    }>(
      'SELECT s.*, ("jourMetier" = "ouverteLe"::date) AS "memeJour", to_char("ouverteLe", \'YYYY-MM-DD HH24:MI:SS\') AS "ouverte" FROM "SessionCaisse" s',
    );
    expect(toutes.rows).toHaveLength(3);
    for (const s of toutes.rows) {
      expect(s.technique).toBe(true);
    }
    for (const structure of resume.pharmacies) {
      const pvId = await pv(c, structure);
      const s = toutes.rows.find((r) => r.pointDeVenteId === pvId);
      expect(s).toBeDefined();
      expect(s?.statut).toBe('FERMEE');
      expect(s?.utilisateurId).toBeNull();
      expect(s?.utilisateurNom).toBe('Reprise historique');
      expect(s?.posteId).toBe(await posteReprise(c, pvId));
      expect(s?.evenementOuvertureId).toBe('reprise:' + pvId);
      expect(s?.fermeeLe).not.toBeNull();
      expect(s?.evenementFermetureId).toBeNull();
      expect(s?.clotureJournaliereId).toBeNull();
      expect(s?.memeJour).toBe(true);
    }
    const ouverte = async (structure: string) => {
      const pvId = await pv(c, structure);
      return toutes.rows.find((r) => r.pointDeVenteId === pvId)?.ouverte;
    };
    expect(await ouverte('str-pharma-1')).toBe(
      jourIso(resume.aujourdhui) + ' 08:00:00',
    );
    expect(await ouverte('str-pharma-2')).toBe(jourIso(plus(-1)) + ' 15:00:00');
    const p3 = await c.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM "SessionCaisse" s JOIN "PointDeVente" p ON p."id" = s."pointDeVenteId" WHERE p."structureId" = \'str-pharma-3\' AND s."ouverteLe" >= $1',
      [resume.aujourdhui],
    );
    expect(p3.rows[0].n).toBe(1);
  });

  it('reprise rejouable sans doublon', async () => {
    const c = client();
    const lignes = readFileSync(
      path.join(DOSSIER_MIGRATIONS, M5, 'migration.sql'),
      'utf8',
    ).split(/\r?\n/);
    const debut = lignes.findIndex((l) => l.startsWith('-- REPRISE: DEBUT'));
    const fin = lignes.findIndex((l) => l === '-- REPRISE: FIN');
    const bloc = lignes.slice(debut, fin + 1).join('\n');
    const avant = await photographieSessions(c);
    await appliquerSql(c, bloc);
    expect(await photographieSessions(c)).toEqual(avant);
  });

  it('aucune ligne pièces et autres : comptage par coupure seulement (CORRECTIONS-PORTEUR point 1)', async () => {
    const c = client();
    const colonnes = async (table: string) =>
      (
        await c.query<{ column_name: string }>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
          [table],
        )
      ).rows
        .map((r) => r.column_name)
        .sort();
    expect(await colonnes('ComptageCaisse')).toEqual([
      'auteurId',
      'createdAt',
      'evenementId',
      'horodatageLocal',
      'id',
      'moment',
      'sessionCaisseId',
      'totalEspeces',
    ]);
    expect(await colonnes('LigneComptage')).toEqual([
      'comptageId',
      'id',
      'nombre',
      'valeurFaciale',
    ]);
    const coupures = await c.query<{ valeurFaciale: number; type: string }>(
      'SELECT "valeurFaciale", "type" FROM "CoupureMonnaie" WHERE "actif" ORDER BY "ordre"',
    );
    expect(coupures.rows).toEqual(
      [20000, 10000, 5000, 2000, 1000, 500].map((valeurFaciale) => ({
        valeurFaciale,
        type: 'BILLET',
      })),
    );
  });

  it('session : poste du même point de vente, technique seulement sur le poste technique, utilisateur obligatoire', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const pv2 = await pv(c, 'str-pharma-2');
    await c.query(
      'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","appareilId") VALUES ($1,$2,\'W1\',\'Navigateur\',\'WEB\',$3)',
      ['poste-p1-w1', pv1, 'harnais-p1-w1'],
    );
    await c.query(
      'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","appareilId") VALUES ($1,$2,\'W1\',\'Navigateur\',\'WEB\',$3)',
      ['poste-p2-w1', pv2, 'harnais-p2-w1'],
    );
    const jour = jourIso(resume.aujourdhui);
    await expect(
      session(c, 's-x1', 'poste-p1-w1', pv1, { technique: true, jour }),
    ).rejects.toThrow(/Session refusée/);
    await expect(
      session(c, 's-x2', await posteReprise(c, pv1), pv1, { jour }),
    ).rejects.toThrow(/Session refusée/);
    await expect(
      session(c, 's-x3', 'poste-p2-w1', pv1, { jour }),
    ).rejects.toThrow(/Session refusée/);
    await expect(
      session(c, 's-x4', 'poste-p1-w1', pv1, { utilisateurId: null, jour }),
    ).rejects.toMatchObject({ constraint: 'SessionCaisse_utilisateur_check' });
    await session(c, 's-p1-1', 'poste-p1-w1', pv1, { jour });
    await expect(
      session(c, 's-p1-2', 'poste-p1-w1', pv1, { jour }),
    ).rejects.toMatchObject({
      constraint: 'SessionCaisse_posteId_ouverte_key',
    });
  });

  it('session : transitions OUVERTE vers FERMEE puis FERMEE vers INCLUSE_DANS_CLOTURE seulement', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const pv3 = await pv(c, 'str-pharma-3');
    const maj = (colonnes: string) =>
      c.query(`UPDATE "SessionCaisse" SET ${colonnes} WHERE "id" = 's-p1-1'`);

    await expect(maj('"utilisateurNom" = \'Autre\'')).rejects.toThrow(
      /ne peut pas être modifiée/,
    );
    expect((await maj('"utilisateurNom" = \'Mamadou Diallo\'')).rowCount).toBe(
      1,
    );
    await expect(maj('"statut" = \'INCLUSE_DANS_CLOTURE\'')).rejects.toThrow(
      /OUVERTE vers INCLUSE_DANS_CLOTURE/,
    );
    await expect(maj('"statut" = \'FERMEE\'')).rejects.toMatchObject({
      constraint: 'SessionCaisse_fermeture_check',
    });
    const fermeture = await maj(
      '"statut" = \'FERMEE\', "fermeeLe" = now(), "evenementFermetureId" = \'ferm-s-p1-1\', "commentaireEcart" = \'Écart de 500 GNF\', "commentaireParId" = \'usr-pharm-p1\'',
    );
    expect(fermeture.rowCount).toBe(1);
    await expect(maj('"commentaireEcart" = \'Autre\'')).rejects.toThrow(
      /FERMEE vers FERMEE/,
    );
    await expect(
      maj('"statut" = \'OUVERTE\', "fermeeLe" = NULL'),
    ).rejects.toThrow(/FERMEE vers OUVERTE/);

    await c.query(
      'INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES (\'clo-p1-j\',$1,$2::date,\'usr-admin-p1\')',
      [pv1, jourIso(resume.aujourdhui)],
    );
    await expect(
      maj('"statut" = \'INCLUSE_DANS_CLOTURE\''),
    ).rejects.toMatchObject({ constraint: 'SessionCaisse_cloture_check' });
    const inclusion = await maj(
      '"statut" = \'INCLUSE_DANS_CLOTURE\', "clotureJournaliereId" = \'clo-p1-j\'',
    );
    expect(inclusion.rowCount).toBe(1);
    await expect(
      maj('"statut" = \'FERMEE\', "clotureJournaliereId" = NULL'),
    ).rejects.toThrow(/INCLUSE_DANS_CLOTURE vers FERMEE/);

    await expect(
      c.query(
        'UPDATE "SessionCaisse" SET "utilisateurNom" = \'x\' WHERE "pointDeVenteId" = $1 AND "technique"',
        [pv1],
      ),
    ).rejects.toThrow(/La session technique .* ne se modifie pas/);
    await expect(
      c.query('DELETE FROM "SessionCaisse" WHERE "id" = \'s-p1-1\''),
    ).rejects.toThrow(/ne peut pas être supprimée/);

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    const purge = await c.query(
      'DELETE FROM "SessionCaisse" WHERE "id" = \'s-p1-1\'',
    );
    expect(purge.rowCount).toBe(1);
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    const technique = await c.query(
      'DELETE FROM "SessionCaisse" WHERE "pointDeVenteId" = $1 AND "technique"',
      [pv3],
    );
    expect(technique.rowCount).toBe(1);
    await c.query('ROLLBACK');

    await expect(c.query('TRUNCATE "SessionCaisse" CASCADE')).rejects.toThrow(
      MESSAGE_PIECES,
    );
  });

  it('pièces immuables : ni modification, ni suppression, ni troncature ; la purge ne fait que supprimer', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const especes = await mode(c, 'ESPECES');
    const orange = await mode(c, 'ORANGE_MONEY');
    const lotTech = await lotTechnique(c, 'stk-03');

    await c.query(
      'INSERT INTO "ComptageCaisse" ("id","sessionCaisseId","moment","totalEspeces","auteurId","evenementId") VALUES (\'cpt-1\',\'s-p1-1\',\'OUVERTURE\',200000,\'usr-pharm-p1\',\'evt-cpt-1\')',
    );
    await c.query(
      'INSERT INTO "LigneComptage" ("id","comptageId","valeurFaciale","nombre") VALUES (\'lc-1\',\'cpt-1\',20000,10)',
    );
    await c.query(
      'INSERT INTO "ReleveModePaiement" ("id","comptageId","modePaiementId","montantDeclare") VALUES (\'rel-1\',\'cpt-1\',$1,50000)',
      [orange],
    );
    await c.query(
      'INSERT INTO "MouvementCaisse" ("id","sessionCaisseId","pointDeVenteId","type","modePaiementId","montant","motif","auteurId","evenementId") VALUES (\'mvc-1\',\'s-p1-1\',$1,\'PRELEVEMENT\',$2,100000,\'Dépôt à la banque\',\'usr-pharm-p1\',\'evt-mvc-1\')',
      [pv1, especes],
    );
    await c.query(
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant","montantRecu") VALUES (\'pai-1\',\'vte-p1-1\',\'s-p1-1\',$1,15000,20000)',
      [especes],
    );
    await c.query(
      'INSERT INTO "ResultatSessionMode" ("id","sessionCaisseId","modePaiementId","theorique","compte","ecart") VALUES (\'res-1\',\'s-p1-1\',$1,500000,490000,-10000)',
      [especes],
    );
    await c.query(
      'INSERT INTO "TotalClotureMode" ("id","clotureId","modePaiementId","theorique","compte","ecart") VALUES (\'tot-1\',\'clo-p1-j\',$1,500000,490000,-10000)',
      [especes],
    );
    await c.query(
      'INSERT INTO "Reception" ("id","pointDeVenteId","recueLe","auteurId") VALUES (\'rec-1\',$1,now(),\'usr-admin-p1\')',
      [pv1],
    );
    await c.query(
      'INSERT INTO "Inventaire" ("id","pointDeVenteId","auteurId") VALUES (\'inv-1\',$1,\'usr-admin-p1\')',
      [pv1],
    );
    await c.query(
      'INSERT INTO "LigneInventaire" ("id","inventaireId","stockMedicamentId","lotId","quantiteTheorique","quantiteComptee","ecart","sousTolerance") VALUES (\'li-1\',\'inv-1\',\'stk-03\',$1,9,8,-1,false)',
      [lotTech],
    );

    const couples: [string, string][] = [
      ['ComptageCaisse', 'cpt-1'],
      ['LigneComptage', 'lc-1'],
      ['ReleveModePaiement', 'rel-1'],
      ['MouvementCaisse', 'mvc-1'],
      ['Paiement', 'pai-1'],
      ['ResultatSessionMode', 'res-1'],
      ['ClotureJournaliere', 'clo-p1-j'],
      ['TotalClotureMode', 'tot-1'],
      ['Reception', 'rec-1'],
      ['Inventaire', 'inv-1'],
      ['LigneInventaire', 'li-1'],
    ];
    for (const [table, id] of couples) {
      await expect(
        c.query(`UPDATE "${table}" SET "id" = "id" WHERE "id" = $1`, [id]),
      ).rejects.toThrow(`Écriture refusée sur la table ${table}`);
      await expect(
        c.query(`DELETE FROM "${table}" WHERE "id" = $1`, [id]),
      ).rejects.toThrow(`Écriture refusée sur la table ${table}`);
      await expect(c.query(`TRUNCATE "${table}" CASCADE`)).rejects.toThrow(
        MESSAGE_PIECES,
      );
    }

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    await expect(
      c.query('UPDATE "Paiement" SET "montant" = 1 WHERE "id" = \'pai-1\''),
    ).rejects.toThrow();
    await c.query('ROLLBACK');

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    expect(
      (await c.query('DELETE FROM "LigneComptage" WHERE "id" = \'lc-1\''))
        .rowCount,
    ).toBe(1);
    expect(
      (await c.query('DELETE FROM "Paiement" WHERE "id" = \'pai-1\'')).rowCount,
    ).toBe(1);
    await c.query('ROLLBACK');

    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "LigneComptage" WHERE "id" = \'lc-1\'',
      ),
    ).toBe(1);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "Paiement" WHERE "id" = \'pai-1\'',
      ),
    ).toBe(1);
  });

  it('contraintes nommées des pièces de caisse (D516)', async () => {
    const c = client();
    const pv1 = await pv(c, 'str-pharma-1');
    const especes = await mode(c, 'ESPECES');
    const orange = await mode(c, 'ORANGE_MONEY');
    const mtn = await mode(c, 'MTN_MOMO');
    const lotTech = await lotTechnique(c, 'stk-03');
    const refus = (sql: string, valeurs: unknown[], contrainte: string) =>
      expect(c.query(sql, valeurs)).rejects.toMatchObject({
        constraint: contrainte,
      });

    const ligneComptage =
      'INSERT INTO "LigneComptage" ("id","comptageId","valeurFaciale","nombre") VALUES ($1,\'cpt-1\',$2,$3)';
    await refus(
      ligneComptage,
      ['lc-n1', 10000, -1],
      'LigneComptage_nombre_check',
    );
    await refus(
      ligneComptage,
      ['lc-n2', 0, 1],
      'LigneComptage_valeurFaciale_check',
    );
    await refus(
      ligneComptage,
      ['lc-n3', 20000, 1],
      'LigneComptage_comptageId_valeurFaciale_key',
    );

    const comptage =
      'INSERT INTO "ComptageCaisse" ("id","sessionCaisseId","moment","totalEspeces","auteurId","evenementId") VALUES ($1,\'s-p1-1\',$2::"MomentComptage",$3,\'usr-pharm-p1\',$4)';
    await refus(
      comptage,
      ['cpt-n1', 'OUVERTURE', 1000, 'evt-cpt-n1'],
      'ComptageCaisse_sessionCaisseId_moment_key',
    );
    await refus(
      comptage,
      ['cpt-n2', 'FERMETURE', -1, 'evt-cpt-n2'],
      'ComptageCaisse_totalEspeces_check',
    );

    await refus(
      'INSERT INTO "ReleveModePaiement" ("id","comptageId","modePaiementId","montantDeclare") VALUES (\'rel-n1\',\'cpt-1\',$1,-1)',
      [mtn],
      'ReleveModePaiement_montantDeclare_check',
    );

    const mouvementCaisse =
      'INSERT INTO "MouvementCaisse" ("id","sessionCaisseId","pointDeVenteId","type","modePaiementId","montant","motif","auteurId","evenementId") VALUES ($1,\'s-p1-1\',$2,\'APPORT\',$3,$4,$5,\'usr-pharm-p1\',$6)';
    await refus(
      mouvementCaisse,
      ['mvc-n1', pv1, especes, 0, 'Fond', 'evt-mvc-n1'],
      'MouvementCaisse_montant_check',
    );
    await refus(
      mouvementCaisse,
      ['mvc-n2', pv1, especes, 100, '   ', 'evt-mvc-n2'],
      'MouvementCaisse_motif_check',
    );

    const paiement =
      'INSERT INTO "Paiement" ("id","venteId","sessionCaisseId","modePaiementId","montant","montantRecu") VALUES ($1,\'vte-p1-1\',\'s-p1-1\',$2,$3,$4)';
    await refus(
      paiement,
      ['pai-n1', especes, 0, null],
      'Paiement_montant_check',
    );
    await refus(
      paiement,
      ['pai-n2', especes, 1000, -1],
      'Paiement_montantRecu_check',
    );

    const resultat =
      'INSERT INTO "ResultatSessionMode" ("id","sessionCaisseId","modePaiementId","theorique","compte","ecart") VALUES ($1,\'s-p1-1\',$2,$3,$4,$5)';
    await refus(
      resultat,
      ['res-n1', orange, 500000, 490000, 10000],
      'ResultatSessionMode_ecart_check',
    );
    await refus(
      resultat,
      ['res-n2', orange, 500000, null, 5],
      'ResultatSessionMode_ecart_check',
    );

    await refus(
      'INSERT INTO "TotalClotureMode" ("id","clotureId","modePaiementId","theorique","compte","ecart") VALUES (\'tot-n1\',\'clo-p1-j\',$1,500000,490000,10000)',
      [orange],
      'TotalClotureMode_ecart_check',
    );

    await refus(
      'INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId","forcee") VALUES (\'clo-n1\',$1,$2::date,\'usr-admin-p1\',true)',
      [pv1, jourIso(plus(-1))],
      'ClotureJournaliere_forcage_check',
    );
    await refus(
      'INSERT INTO "ClotureJournaliere" ("id","pointDeVenteId","jourMetier","clotureParId") VALUES (\'clo-n2\',$1,$2::date,\'usr-admin-p1\')',
      [pv1, jourIso(resume.aujourdhui)],
      'ClotureJournaliere_pointDeVenteId_jourMetier_key',
    );

    const ligneInventaire =
      'INSERT INTO "LigneInventaire" ("id","inventaireId","stockMedicamentId","lotId","quantiteTheorique","quantiteComptee","ecart","sousTolerance") VALUES ($1,\'inv-1\',\'stk-03\',$2,$3,$4,$5,false)';
    await refus(
      ligneInventaire,
      ['li-n1', lotTech, 9, -1, -10],
      'LigneInventaire_quantiteComptee_check',
    );
    await refus(
      ligneInventaire,
      ['li-n2', lotTech, 9, 8, 2],
      'LigneInventaire_ecart_check',
    );

    await refus(
      'INSERT INTO "EvenementSynchro" ("id","evenementId","posteId","sequence","type","statut","empreinte","corps") VALUES (\'evs-n1\',\'evt-sync-n1\',\'poste-p1-w1\',0,\'VENTE\',\'EN_ATTENTE\',\'abc\',\'{}\'::jsonb)',
      [],
      'EvenementSynchro_sequence_check',
    );

    const lot =
      'INSERT INTO "LotStock" ("id","stockMedicamentId","pointDeVenteId","quantiteRecue","coutUnitaire","coefficientReception","dateReception","receptionId") VALUES ($1,\'stk-03\',$2,10,0,1,now(),$3)';
    await refus(
      lot,
      ['lot-rec-0', pv1, 'rec-inconnue'],
      'LotStock_receptionId_fkey',
    );
    await c.query(lot, ['lot-rec-1', pv1, 'rec-1']);
  });

  it('événement de synchronisation : seule la sortie de EN_ATTENTE vers APPLIQUE ou REJETE', async () => {
    const c = client();
    const inserer = (
      id: string,
      evenementId: string,
      sequence: number,
      statut: string,
      utilisateurId: string | null,
    ) =>
      c.query(
        'INSERT INTO "EvenementSynchro" ("id","evenementId","posteId","sequence","type","utilisateurId","statut","empreinte","corps") VALUES ($1,$2,\'poste-p1-w1\',$3,\'VENTE\',$4,$5::"StatutEvenementSynchro",\'abc\',\'{"a":1}\'::jsonb)',
        [id, evenementId, sequence, utilisateurId, statut],
      );
    await inserer('evs-1', 'evt-sync-1', 1, 'EN_ATTENTE', 'usr-pharm-p1');
    await expect(
      inserer('evs-x', 'evt-sync-x', 1, 'EN_ATTENTE', 'usr-pharm-p1'),
    ).rejects.toMatchObject({
      constraint: 'EvenementSynchro_posteId_sequence_key',
    });
    const maj = (colonnes: string) =>
      c.query(`UPDATE "EvenementSynchro" SET ${colonnes} WHERE "id" = 'evs-1'`);
    await expect(
      maj('"corps" = \'{"a":2}\'::jsonb, "statut" = \'APPLIQUE\''),
    ).rejects.toThrow(/seule la sortie de EN_ATTENTE/);
    expect(
      (
        await maj(
          '"statut" = \'APPLIQUE\', "resultat" = \'{"ok":true}\'::jsonb',
        )
      ).rowCount,
    ).toBe(1);
    await expect(maj('"statut" = \'REJETE\'')).rejects.toThrow(
      /seule la sortie de EN_ATTENTE/,
    );
    await expect(
      c.query('DELETE FROM "EvenementSynchro" WHERE "id" = \'evs-1\''),
    ).rejects.toThrow(/ne peut pas être supprimé/);

    await c.query('BEGIN');
    await c.query(
      "SELECT set_config('medconnecte.purge_autorisee', 'on', true)",
    );
    expect(
      (await c.query('DELETE FROM "EvenementSynchro" WHERE "id" = \'evs-1\''))
        .rowCount,
    ).toBe(1);
    await c.query('ROLLBACK');

    // Événement illisible : ni utilisateur ni horodatage local, déjà rejeté.
    await inserer('evs-2', 'evt-sync-2', 2, 'REJETE', null);
  });

  it('retour arrière après activité : tables, fonctions et types de M5 retirés, réceptions des lots remises à nul', async () => {
    const c = client();
    const notices: string[] = [];
    const ecouteur = (n: { message?: string }) => {
      notices.push(n.message ?? '');
    };
    c.on('notice', ecouteur);
    try {
      await appliquerRetourArriere(c, M5);
    } finally {
      c.off('notice', ecouteur);
    }
    expect(
      notices.some((m) =>
        m.includes(
          'supprimés 1 session(s) de caisse, 1 paiement(s), 1 clôture(s), 1 réception(s), 1 inventaire(s), 2 événement(s) de synchronisation',
        ),
      ),
    ).toBe(true);

    for (const table of [
      'SessionCaisse',
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
    ]) {
      const res = await c.query<{ r: string | null }>(
        'SELECT to_regclass($1)::text AS "r"',
        [`"${table}"`],
      );
      expect(res.rows[0].r).toBeNull();
    }
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname IN ('session_caisse_proteger', 'evenement_synchro_proteger')",
      ),
    ).toBe(0);
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'journal_refuser_modification'",
      ),
    ).toBe(1);
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_type WHERE typname IN ('StatutSession', 'MomentComptage', 'TypeMouvementCaisse', 'StatutEvenementSynchro')",
      ),
    ).toBe(0);
    const lot = await c.query<{ receptionId: string | null }>(
      'SELECT "receptionId" FROM "LotStock" WHERE "id" = \'lot-rec-1\'',
    );
    expect(lot.rows[0].receptionId).toBeNull();
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'LotStock_receptionId_fkey'",
      ),
    ).toBe(0);
    const etat = await c.query<{ tgenabled: string }>(
      'SELECT "tgenabled" FROM pg_trigger WHERE "tgname" = \'lot_stock_proteger\'',
    );
    expect(etat.rows[0].tgenabled).toBe('O');
  });

  it('retour arrière puis haut de nouveau', async () => {
    const c = client();
    expect(await appliquerMigrations(c, { apres: M4, jusqua: M5 })).toEqual([
      M5,
    ]);
    expect(
      await compter(
        c,
        'SELECT count(*)::int AS n FROM "SessionCaisse" WHERE "technique"',
      ),
    ).toBe(3);
    expect(
      await compter(
        c,
        "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'LotStock_receptionId_fkey'",
      ),
    ).toBe(1);
  });

  describe('arrêt de M5', () => {
    let autre: BaseDeTest | undefined;

    beforeAll(async () => {
      autre = await creerBaseVide();
      await appliquerMigrations(autre.client, {
        jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
      });
      await chargerFormatActuel(autre.client);
      await appliquerMigrations(autre.client, {
        apres: DERNIERE_MIGRATION_FORMAT_ACTUEL,
        jusqua: M4,
      });
    });

    afterAll(async () => {
      if (autre) {
        await supprimerBaseDeTest(autre);
      }
    });

    function cible(): Client {
      if (!autre) throw new Error('Base de test non créée.');
      return autre.client;
    }

    it('arrêt : point de vente sans poste REPRISE listé, rien est créé, puis M5 passe une fois corrigé', async () => {
      const c = cible();
      const pv3 = await pv(c, 'str-pharma-3');
      await c.query(
        'DELETE FROM "Poste" WHERE "code" = \'REPRISE\' AND "pointDeVenteId" = $1',
        [pv3],
      );
      await expect(
        appliquerMigrations(c, { apres: M4, jusqua: M5 }),
      ).rejects.toThrow(`La migration ${M5} a échoué`);
      await expect(
        appliquerMigrations(c, { apres: M4, jusqua: M5 }),
      ).rejects.toThrow('1 point(s) de vente sans poste technique REPRISE');
      await expect(
        appliquerMigrations(c, { apres: M4, jusqua: M5 }),
      ).rejects.toThrow(`Points de vente en cause (50 au plus) : ${pv3}`);
      const table = await c.query<{ r: string | null }>(
        'SELECT to_regclass(\'"SessionCaisse"\')::text AS "r"',
      );
      expect(table.rows[0].r).toBeNull();
      expect(
        await compter(
          c,
          "SELECT count(*)::int AS n FROM pg_type WHERE typname = 'StatutSession'",
        ),
      ).toBe(0);

      await c.query(
        'INSERT INTO "Poste" ("id","pointDeVenteId","code","libelle","type","actif") VALUES (\'poste-reprise-p3\',$1,\'REPRISE\',\'Reprise des ventes historiques\',\'TECHNIQUE\',false)',
        [pv3],
      );
      expect(await appliquerMigrations(c, { apres: M4, jusqua: M5 })).toEqual([
        M5,
      ]);
    });
  });
});
