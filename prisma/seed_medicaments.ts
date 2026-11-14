import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

/**
 * Catalogue global des médicaments du jeu de démonstration (liste recopiée de
 * `src/demo/demo.donnees.ts`). Aucun stock, aucun lot, aucune structure : un stock
 * ne naît que par le journal (réception ou inventaire).
 */
const MEDICAMENTS = [
  {
    nom: 'Doliprane 1000mg',
    nomGenerique: 'Paracétamol',
    categorie: 'Antalgique',
    description: 'Soulage la douleur et fait baisser la fièvre.',
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
  {
    nom: 'Augmentin 1g/125mg',
    nomGenerique: 'Amoxicilline et acide clavulanique',
    categorie: 'Antibiotique',
    description: 'Antibiotique pour les infections bactériennes courantes.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Coartem 20/120',
    nomGenerique: 'Artéméther et luméfantrine',
    categorie: 'Antipaludéen',
    description: 'Traitement du paludisme simple.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Ventoline 100 µg',
    nomGenerique: 'Salbutamol',
    categorie: 'Bronchodilatateur',
    description: "Soulage rapidement la crise d'asthme.",
    ordonnanceRequise: true,
    formes: ['Inhalation'],
  },
  {
    nom: 'Amlor 5mg',
    nomGenerique: 'Amlodipine',
    categorie: 'Antihypertenseur',
    description: "Traitement de l'hypertension artérielle.",
    ordonnanceRequise: true,
    formes: ['Gélule'],
  },
  {
    nom: 'Glucophage 850mg',
    nomGenerique: 'Metformine',
    categorie: 'Antidiabétique',
    description: 'Traitement du diabète de type 2.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'Spasfon',
    nomGenerique: 'Phloroglucinol',
    categorie: 'Antispasmodique',
    description: 'Soulage les douleurs abdominales.',
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
  {
    nom: 'Gaviscon Pro',
    nomGenerique: 'Alginate de sodium et bicarbonate de potassium',
    categorie: 'Anti-acide',
    description: "Soulage les brûlures d'estomac.",
    ordonnanceRequise: false,
    formes: ['Suspension buvable'],
  },
  {
    nom: 'Flagyl 500mg',
    nomGenerique: 'Métronidazole',
    categorie: 'Antiparasitaire',
    description: 'Traitement des amibiases et de certaines infections.',
    ordonnanceRequise: true,
    formes: ['Comprimé'],
  },
  {
    nom: 'SRO',
    nomGenerique: 'Sels de réhydratation orale',
    categorie: 'Réhydratation',
    description: 'Compense les pertes en eau et en sels en cas de diarrhée.',
    ordonnanceRequise: false,
    formes: ['Sachet'],
  },
  {
    nom: 'Amoxicilline 500mg',
    nomGenerique: 'Amoxicilline',
    categorie: 'Antibiotique',
    description: 'Antibiotique de la famille des pénicillines.',
    ordonnanceRequise: true,
    formes: ['Gélule'],
  },
  {
    nom: 'Ibuprofène 400mg',
    nomGenerique: 'Ibuprofène',
    categorie: 'Anti-inflammatoire',
    description: "Soulage la douleur et l'inflammation.",
    ordonnanceRequise: false,
    formes: ['Comprimé'],
  },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  let ajoutes = 0;
  let presents = 0;
  for (const medicament of MEDICAMENTS) {
    const existant = await prisma.medicament.findFirst({
      where: { nom: medicament.nom },
      select: { id: true },
    });
    if (existant) {
      presents++;
      continue;
    }
    await prisma.medicament.create({ data: medicament });
    ajoutes++;
  }
  console.log(
    `Catalogue : ${ajoutes} médicament(s) ajouté(s), ${presents} déjà présent(s).`,
  );
}

main()
  .catch((e: unknown) => {
    console.error(
      'Échec du seed du catalogue :',
      e instanceof Error ? e.message : 'erreur inconnue',
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
