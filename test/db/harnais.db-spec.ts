import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { Client } from 'pg';
import { PrismaService } from 'src/common/services/prisma.service';
import {
  appliquerMigrations,
  appliquerRetourArriere,
  avecConnexionMaintenance,
  BaseDeTest,
  creerBaseVide,
  creerPrismaDeTest,
  DERNIERE_MIGRATION_FORMAT_ACTUEL,
  fermerPrismaDeTest,
  listerMigrations,
  masquerUrls,
  MOTIF_NOM_BASE_DE_TEST,
  RACINE_DEPOT,
  supprimerBaseDeTest,
  urlPourBase,
  urlServeurDeTest,
  verifierNomBaseDeTest,
} from './harnais';
import {
  chargerFormatActuel,
  ResumeFormatActuel,
} from './fixtures/format-actuel';

async function tableExiste(client: Client, nom: string): Promise<boolean> {
  const resultat = await client.query<{ existe: boolean }>(
    'SELECT to_regclass($1) IS NOT NULL AS existe',
    ['public."' + nom + '"'],
  );
  return resultat.rows[0].existe;
}

describe('Harnais de base de test (PB01)', () => {
  let base: BaseDeTest | undefined;
  let prisma: PrismaService | undefined;
  let resume: ResumeFormatActuel;
  let appliqueesAvant: string[];
  let appliqueesApres: string[];

  beforeAll(async () => {
    base = await creerBaseVide();
    appliqueesAvant = await appliquerMigrations(base.client, {
      jusqua: DERNIERE_MIGRATION_FORMAT_ACTUEL,
    });
    resume = await chargerFormatActuel(base.client);
    appliqueesApres = await appliquerMigrations(base.client, {
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

  function baseCreee(): BaseDeTest {
    if (!base) throw new Error('Base de test non créée.');
    return base;
  }

  function prismaCree(): PrismaService {
    if (!prisma) throw new Error('Client Prisma de test non créé.');
    return prisma;
  }

  it("dérive l'URL de la base de test en ne changeant que son nom", () => {
    const source = urlServeurDeTest();
    const derivee = new URL(urlPourBase('mc_test_0123456789ab'));
    expect(derivee.pathname).toBe('/mc_test_0123456789ab');
    expect(
      derivee.protocol === source.protocol &&
        derivee.username === source.username &&
        derivee.password === source.password &&
        derivee.host === source.host &&
        derivee.search === source.search,
    ).toBe(true);
  });

  it('refuse un nom de base hors du préfixe mc_test_', () => {
    expect(() => verifierNomBaseDeTest('medconnecte')).toThrow(
      'Nom de base de test refusé',
    );
    expect(() => verifierNomBaseDeTest('mc_test_XYZ')).toThrow(
      'Nom de base de test refusé',
    );
    expect(() => verifierNomBaseDeTest('mc_test_0123456789ab; DROP')).toThrow(
      'Nom de base de test refusé',
    );
    expect(() => verifierNomBaseDeTest('mc_test_0123456789ab')).not.toThrow();
    expect(MOTIF_NOM_BASE_DE_TEST.test(baseCreee().nom)).toBe(true);
  });

  it('masque toute URL dans un texte', () => {
    expect(
      masquerUrls('échec sur postgresql://u:p@h:5432/b?schema=public fin'),
    ).toBe('échec sur <url masquée> fin');
  });

  it("applique toutes les migrations existantes dans l'ordre de Prisma", async () => {
    expect([...appliqueesAvant, ...appliqueesApres]).toEqual(
      listerMigrations(),
    );
    expect(listerMigrations()[0]).toBe('20260425202451_init');
    expect(listerMigrations()).toContain(DERNIERE_MIGRATION_FORMAT_ACTUEL);
    expect(listerMigrations().length).toBeGreaterThanOrEqual(14);
    expect(listerMigrations()).toEqual([...listerMigrations()].sort());
    for (const table of [
      'Vente',
      'LigneVente',
      'CompteurVente',
      'StockMedicament',
    ]) {
      expect(await tableExiste(baseCreee().client, table)).toBe(true);
    }
  });

  it('charge le jeu au format actuel et le relit par PrismaService', async () => {
    const p = prismaCree();
    expect(await p.structure.count({ where: { type: 'PHARMACIE' } })).toBe(3);
    expect(await p.structure.count({ where: { type: 'HOPITAL' } })).toBe(1);

    expect(await p.stockMedicament.count()).toBe(40);
    const attendus: [string, number][] = [
      ['str-pharma-1', 20],
      ['str-pharma-2', 15],
      ['str-pharma-3', 5],
      ['str-hopital-1', 0],
    ];
    for (const [structureId, nombre] of attendus) {
      expect(await p.stockMedicament.count({ where: { structureId } })).toBe(
        nombre,
      );
    }

    const distinctes = await p.stockMedicament.findMany({
      select: { quantite: true },
      distinct: ['quantite'],
    });
    expect(distinctes.map((d) => d.quantite).sort((a, b) => a - b)).toEqual([
      0, 1, 9, 10, 11, 240,
    ]);
    expect(
      await p.stockMedicament.count({ where: { quantite: { gt: 0 } } }),
    ).toBe(33);

    expect(
      await p.stockMedicament.count({ where: { dateExpiration: null } }),
    ).toBe(10);
    expect(
      await p.stockMedicament.count({
        where: { dateExpiration: { lt: resume.aujourdhui } },
      }),
    ).toBe(10);
    expect(
      await p.stockMedicament.count({
        where: { dateExpiration: resume.aujourdhui },
      }),
    ).toBe(10);
    expect(
      await p.stockMedicament.count({
        where: { dateExpiration: { gt: resume.aujourdhui } },
      }),
    ).toBe(10);

    expect(
      await p.stockMedicament.count({ where: { prixUnitaire: null } }),
    ).toBe(8);
    expect(await p.stockMedicament.count({ where: { prixUnitaire: 0 } })).toBe(
      8,
    );

    const lues = await p.stockMedicament.findMany({ orderBy: { id: 'asc' } });
    expect(lues).toHaveLength(resume.fiches.length);
    lues.forEach((lue, i) => {
      const attendue = resume.fiches[i];
      expect({
        id: lue.id,
        structureId: lue.structureId,
        medicamentId: lue.medicamentId,
        quantite: lue.quantite,
        prixUnitaire: lue.prixUnitaire,
        disponible: lue.disponible,
        notes: lue.notes,
        dateExpiration: lue.dateExpiration?.getTime(),
      }).toEqual({
        id: attendue.id,
        structureId: attendue.structureId,
        medicamentId: attendue.medicamentId,
        quantite: attendue.quantite,
        prixUnitaire: attendue.prixUnitaire,
        disponible: attendue.disponible,
        notes: attendue.notes,
        dateExpiration: attendue.dateExpiration?.getTime(),
      });
    });

    expect(await p.vente.count({ where: { statut: 'VALIDEE' } })).toBe(4);
    expect(await p.vente.count({ where: { statut: 'ANNULEE' } })).toBe(2);
    expect(await p.ligneVente.count()).toBe(7);

    const ventes = await p.vente.findMany({ include: { lignes: true } });
    for (const vente of ventes) {
      const somme = vente.lignes.reduce((s, l) => s + l.sousTotal, 0);
      expect(somme).toBe(vente.total);
      for (const ligne of vente.lignes) {
        expect(ligne.sousTotal).toBe(ligne.prixUnitaire * ligne.quantite);
      }
    }

    const annulee = await p.vente.findUnique({ where: { id: 'vte-p1-3' } });
    expect(annulee?.annuleeParId).toBe('usr-admin-p1');
    expect(annulee?.motifAnnulation).toBe('Erreur de saisie');
    expect(annulee?.annuleeLe).not.toBeNull();
    const validee = await p.vente.findUnique({ where: { id: 'vte-p1-1' } });
    expect(validee?.annuleeLe).toBeNull();

    const compteur = await p.compteurVente.findUnique({
      where: {
        structureId_annee: {
          structureId: 'str-pharma-1',
          annee: resume.aujourdhui.getUTCFullYear(),
        },
      },
    });
    expect(compteur?.dernierNumero).toBe(4);

    const roleAdmin = await p.appRole.findFirst({
      where: {
        structureId: 'str-pharma-1',
        nom: 'Administrateur de structure',
      },
      include: { permissions: { include: { permission: true } } },
    });
    const rolePharmacien = await p.appRole.findFirst({
      where: { structureId: 'str-pharma-1', nom: 'Pharmacien' },
      include: { permissions: { include: { permission: true } } },
    });
    expect(roleAdmin?.permissions.map((rp) => rp.permission.code)).toContain(
      'vente:annuler',
    );
    expect(
      rolePharmacien?.permissions.map((rp) => rp.permission.code),
    ).not.toContain('vente:annuler');

    const structure = await p.structure.findUnique({
      where: { id: 'str-pharma-1' },
    });
    expect(structure?.adminId).toBe('usr-admin-p1');
  });

  it('une migration fautive appliquée par le harnais ne laisse rien', async () => {
    const { client } = baseCreee();
    await expect(
      appliquerMigrations(client, {
        dossier: path.join(
          RACINE_DEPOT,
          'test',
          'db',
          'fixtures',
          'fautive',
          'migrations',
        ),
      }),
    ).rejects.toThrow('La migration 20990101000000_harnais_fautive a échoué');
    expect(await tableExiste(client, 'HarnaisTemoinFautif')).toBe(false);
    const resultat = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM "StockMedicament"',
    );
    expect(resultat.rows[0].n).toBe(40);
  });

  // Constat D451 : Prisma n'applique pas un fichier en transaction implicite. La
  // migration fautive porte donc BEGIN/COMMIT, comme celles de la tranche.
  it("prisma migrate deploy ne laisse rien d'une migration fautive qui porte BEGIN/COMMIT (D432, D451)", async () => {
    const vide = await creerBaseVide();
    try {
      const resultat = spawnSync(
        process.execPath,
        [
          path.join(
            RACINE_DEPOT,
            'node_modules',
            'prisma',
            'build',
            'index.js',
          ),
          'migrate',
          'deploy',
          '--config',
          'test/db/fixtures/fautive/prisma.config.ts',
        ],
        {
          cwd: RACINE_DEPOT,
          env: { ...process.env, HARNAIS_DATABASE_URL: vide.url },
          encoding: 'utf8',
          timeout: 150000,
        },
      );
      const sortie = masquerUrls(
        (resultat.stdout ?? '') + (resultat.stderr ?? ''),
      ).slice(0, 2000);
      if (resultat.status === 0) {
        throw new Error(
          'La migration fautive aurait dû échouer. Sortie : ' + sortie,
        );
      }
      expect(resultat.status).not.toBe(0);
      expect(await tableExiste(vide.client, '_prisma_migrations')).toBe(true);
      expect(await tableExiste(vide.client, 'HarnaisTemoinFautif')).toBe(false);
    } finally {
      await supprimerBaseDeTest(vide);
    }
  });

  it('retour arrière : haut, bas, haut sur la base chargée', async () => {
    const { client } = baseCreee();
    const dossierTemoin = path.join(
      RACINE_DEPOT,
      'test',
      'db',
      'fixtures',
      'temoin',
    );
    const migrations = path.join(dossierTemoin, 'migrations');
    const retours = path.join(dossierTemoin, 'retours-arriere');
    const nom = '20990101000001_harnais_temoin';

    const compter = async (): Promise<number> => {
      const r = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM "HarnaisTemoin"',
      );
      return r.rows[0].n;
    };

    expect(await appliquerMigrations(client, { dossier: migrations })).toEqual([
      nom,
    ]);
    expect(await tableExiste(client, 'HarnaisTemoin')).toBe(true);
    expect(await compter()).toBe(33);

    await appliquerRetourArriere(client, nom, retours);
    expect(await tableExiste(client, 'HarnaisTemoin')).toBe(false);

    await appliquerMigrations(client, { dossier: migrations });
    expect(await tableExiste(client, 'HarnaisTemoin')).toBe(true);
    expect(await compter()).toBe(33);

    await appliquerRetourArriere(client, nom, retours);
    expect(await tableExiste(client, 'HarnaisTemoin')).toBe(false);
  });

  it('refuse un retour arrière introuvable', async () => {
    await expect(
      appliquerRetourArriere(baseCreee().client, '20990101000099_inexistante'),
    ).rejects.toThrow(
      'Retour arrière introuvable : 20990101000099_inexistante.down.sql',
    );
  });

  it('refuse une migration inconnue en borne', async () => {
    const { client } = baseCreee();
    await expect(
      appliquerMigrations(client, { jusqua: 'inexistante' }),
    ).rejects.toThrow('Migration inconnue : inexistante');
    const derniere = listerMigrations().at(-1);
    expect(derniere).toBeDefined();
    await expect(
      appliquerMigrations(client, { apres: derniere }),
    ).resolves.toEqual([]);
  });

  it("supprime la base jetable et n'en laisse aucune trace", async () => {
    const jetable = await creerBaseVide();
    const nom = jetable.nom;
    await supprimerBaseDeTest(jetable);
    const resultat = await avecConnexionMaintenance((c) =>
      c.query('SELECT 1 FROM pg_database WHERE datname = $1', [nom]),
    );
    expect(resultat.rowCount).toBe(0);
  });
});
