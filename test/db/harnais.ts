/**
 * Harnais de base de test (PB01).
 *
 * Crée une vraie base PostgreSQL jetable (`mc_test_<12 hexadécimaux>`) sur le serveur
 * de TEST_DATABASE_URL, à défaut de DATABASE_URL, en ne changeant que le nom de la base.
 * Applique les fichiers de migration comme Prisma (un seul envoi par fichier, dans l'ordre
 * des noms de dossiers), applique les retours arrière, et construit un `PrismaService`
 * branché sur la base jetable. Aucune URL, aucun mot de passe n'est affiché ni journalisé.
 * Voir les décisions D448 à D455 du run pharmacie-t1.
 */
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PrismaService } from 'src/common/services/prisma.service';

export const RACINE_DEPOT = path.resolve(__dirname, '..', '..');
export const DOSSIER_MIGRATIONS = path.join(
  RACINE_DEPOT,
  'prisma',
  'migrations',
);
export const DOSSIER_RETOURS_ARRIERE = path.join(
  RACINE_DEPOT,
  'prisma',
  'retours-arriere',
);
export const DERNIERE_MIGRATION_FORMAT_ACTUEL =
  '20261022120000_ventes_pharmacie';
export const MOTIF_NOM_BASE_DE_TEST = /^mc_test_[0-9a-f]{12}$/;

export interface BaseDeTest {
  nom: string;
  url: string;
  client: Client;
}

/** Remplace toute URL d'un texte, pour qu'aucun identifiant de connexion ne fuite. */
export function masquerUrls(texte: string): string {
  return texte.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '<url masquée>');
}

export function urlServeurDeTest(): URL {
  const brute = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!brute) {
    throw new Error(
      'Ni TEST_DATABASE_URL ni DATABASE_URL ne sont définies : le harnais ne sait pas où créer la base de test.',
    );
  }
  try {
    return new URL(brute);
  } catch {
    // L'erreur d'origine contient l'URL : on ne la relance pas.
    throw new Error("L'URL du serveur de test est illisible.");
  }
}

export function urlPourBase(nom: string): string {
  const url = urlServeurDeTest();
  url.pathname = '/' + nom;
  return url.toString();
}

export function verifierNomBaseDeTest(nom: string): void {
  if (!MOTIF_NOM_BASE_DE_TEST.test(nom)) {
    throw new Error(
      `Nom de base de test refusé : ${nom}. Seules les bases mc_test_<12 hexadécimaux> sont créées ou supprimées par le harnais.`,
    );
  }
}

export async function avecConnexionMaintenance<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: urlPourBase('postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function creerBaseVide(): Promise<BaseDeTest> {
  const nom = 'mc_test_' + randomBytes(6).toString('hex');
  verifierNomBaseDeTest(nom);
  await avecConnexionMaintenance((maintenance) =>
    maintenance.query(`CREATE DATABASE "${nom}"`),
  );
  const url = urlPourBase(nom);
  const client = new Client({ connectionString: url });
  await client.connect();
  return { nom, url, client };
}

export async function supprimerBaseDeTest(base: BaseDeTest): Promise<void> {
  verifierNomBaseDeTest(base.nom);
  try {
    await base.client.end();
  } catch {
    // Client déjà fermé : rien à faire.
  }
  await avecConnexionMaintenance((maintenance) =>
    maintenance.query(`DROP DATABASE IF EXISTS "${base.nom}" WITH (FORCE)`),
  );
}

export function listerMigrations(
  dossier: string = DOSSIER_MIGRATIONS,
): string[] {
  return readdirSync(dossier)
    .filter((entree) => {
      const chemin = path.join(dossier, entree);
      return (
        statSync(chemin).isDirectory() &&
        existsSync(path.join(chemin, 'migration.sql'))
      );
    })
    .sort();
}

/**
 * Un seul envoi, sans paramètre : PostgreSQL l'exécute en transaction implicite.
 * Prisma n'en fait pas autant (constat D451, D456) : une migration de la tranche qui
 * ne porte pas BEGIN/COMMIT passerait ici sans rien laisser mais pas en déploiement.
 */
export async function appliquerSql(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (erreur) {
    // Un fichier qui porte BEGIN/COMMIT laisse la connexion dans une transaction
    // avortée après l'échec : on l'annule pour que la connexion reste utilisable.
    // Prisma, lui, ouvre une connexion neuve (le test migrate deploy fait foi).
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rien à annuler.
    }
    throw erreur;
  }
}

function messageDe(erreur: unknown): string {
  return erreur instanceof Error ? erreur.message : String(erreur);
}

export async function appliquerMigrations(
  client: Client,
  options: { dossier?: string; apres?: string; jusqua?: string } = {},
): Promise<string[]> {
  const { dossier = DOSSIER_MIGRATIONS, apres, jusqua } = options;
  const noms = listerMigrations(dossier);
  if (apres !== undefined && !noms.includes(apres)) {
    throw new Error(`Migration inconnue : ${apres}`);
  }
  if (jusqua !== undefined && !noms.includes(jusqua)) {
    throw new Error(`Migration inconnue : ${jusqua}`);
  }
  const selection = noms.filter(
    (nom) =>
      (apres === undefined || nom > apres) &&
      (jusqua === undefined || nom <= jusqua),
  );
  const appliquees: string[] = [];
  for (const nom of selection) {
    const sql = readFileSync(path.join(dossier, nom, 'migration.sql'), 'utf8');
    try {
      await appliquerSql(client, sql);
    } catch (erreur) {
      throw new Error(
        `La migration ${nom} a échoué : ${masquerUrls(messageDe(erreur))}`,
        { cause: erreur },
      );
    }
    appliquees.push(nom);
  }
  return appliquees;
}

export async function appliquerRetourArriere(
  client: Client,
  nom: string,
  dossier: string = DOSSIER_RETOURS_ARRIERE,
): Promise<void> {
  const fichier = path.join(dossier, `${nom}.down.sql`);
  if (!existsSync(fichier)) {
    throw new Error(`Retour arrière introuvable : ${nom}.down.sql`);
  }
  try {
    await appliquerSql(client, readFileSync(fichier, 'utf8'));
  } catch (erreur) {
    throw new Error(
      `Le retour arrière ${nom} a échoué : ${masquerUrls(messageDe(erreur))}`,
      { cause: erreur },
    );
  }
}

export function creerPrismaDeTest(base: BaseDeTest): PrismaService {
  const ancienne = process.env.DATABASE_URL;
  process.env.DATABASE_URL = base.url;
  try {
    return new PrismaService();
  } finally {
    if (ancienne === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = ancienne;
    }
  }
}

export async function fermerPrismaDeTest(prisma: PrismaService): Promise<void> {
  await prisma.onModuleDestroy();
}
