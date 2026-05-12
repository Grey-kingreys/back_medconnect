import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('💊 Seed des médicaments...');

    const medicines = [
        {
            nom: 'Doliprane 1000mg',
            nomGenerique: 'Paracétamol',
            categorie: 'Antalgique',
            description: 'Utilisé pour soulager la douleur et réduire la fièvre. Comprimés sécables.',
            ordonnanceRequise: false,
            formes: ['Comprimé', 'Gélule', 'Suppositoire']
        },
        {
            nom: 'Augmentin 1g/125mg',
            nomGenerique: 'Amoxicilline / Acide clavulanique',
            categorie: 'Antibiotique',
            description: 'Antibiotique de la famille des pénicillines. Traitement des infections bactériennes.',
            ordonnanceRequise: true,
            formes: ['Comprimé', 'Poudre pour suspension buvable']
        },
        {
            nom: 'Coartem 20/120',
            nomGenerique: 'Artéméther / Luméfantrine',
            categorie: 'Antipaludéen',
            description: 'Traitement du paludisme non compliqué à Plasmodium falciparum.',
            ordonnanceRequise: true,
            formes: ['Comprimé']
        },
        {
            nom: 'Spasfon',
            nomGenerique: 'Phloroglucinol',
            categorie: 'Antispasmodique',
            description: 'Traitement des douleurs spasmodiques des intestins, des voies biliaires, de la vessie et de l\'utérus.',
            ordonnanceRequise: false,
            formes: ['Comprimé', 'Suppositoire', 'Solution injectable']
        },
        {
            nom: 'Ventoline 100 µg',
            nomGenerique: 'Salbutamol',
            categorie: 'Bronchodilatateur',
            description: 'Traitement de la crise d\'asthme et de la bronchite chronique obstructive.',
            ordonnanceRequise: true,
            formes: ['Inhalation', 'Solution pour nébulisation']
        },
        {
            nom: 'Gaviscon Pro',
            nomGenerique: 'Alginate de sodium / Bicarbonate de potassium',
            categorie: 'Anti-acide',
            description: 'Traitement des brûlures d\'estomac et des remontées acides.',
            ordonnanceRequise: false,
            formes: ['Suspension buvable', 'Comprimé à croquer']
        },
        {
            nom: 'Glucophage 850mg',
            nomGenerique: 'Metformine',
            categorie: 'Antidiabétique',
            description: 'Traitement du diabète de type 2, en particulier chez les patients en surpoids.',
            ordonnanceRequise: true,
            formes: ['Comprimé']
        },
        {
            nom: 'Amlor 5mg',
            nomGenerique: 'Amlodipine',
            categorie: 'Antihypertenseur',
            description: 'Traitement de l\'hypertension artérielle et de l\'angine de poitrine.',
            ordonnanceRequise: true,
            formes: ['Gélule']
        }
    ];

    for (const med of medicines) {
        await prisma.medicament.upsert({
            where: { id: 'dummy' }, // Use a dummy ID to force upsert by other fields if needed, or just use findFirst
            update: med,
            create: med,
        }).catch(async () => {
            // Since we don't have a unique constraint on 'nom' yet (except if I added it), 
            // we should probably check by name first.
            const existing = await prisma.medicament.findFirst({
                where: { nom: med.nom }
            });
            if (!existing) {
                await prisma.medicament.create({ data: med });
            } else {
                await prisma.medicament.update({
                    where: { id: existing.id },
                    data: med
                });
            }
        });
    }

    // Ajouter du stock dans quelques pharmacies
    const pharmacies = await prisma.structure.findMany({
        where: { type: 'PHARMACIE' },
        take: 5
    });

    const allMeds = await prisma.medicament.findMany();

    for (const p of pharmacies) {
        for (const m of allMeds) {
            if (Math.random() > 0.3) { // 70% de chance d'avoir le médicament en stock
                await prisma.stockMedicament.upsert({
                    where: {
                        medicamentId_structureId: {
                            medicamentId: m.id,
                            structureId: p.id
                        }
                    },
                    update: {
                        quantite: Math.floor(Math.random() * 100) + 10,
                        prixUnitaire: Math.floor(Math.random() * 50000) + 5000,
                        disponible: true
                    },
                    create: {
                        medicamentId: m.id,
                        structureId: p.id,
                        quantite: Math.floor(Math.random() * 100) + 10,
                        prixUnitaire: Math.floor(Math.random() * 50000) + 5000,
                        disponible: true
                    }
                });
            }
        }
    }

    console.log('✅ Seed des médicaments terminé !');
}

main()
    .catch((e) => {
        console.error('❌ Erreur :', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
