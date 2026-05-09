import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🚀 Début du seed massif (Guinée)...');
    const hashed = await bcrypt.hash('Password123!', 12);

    const villes = [
        { nom: 'Conakry', lat: 9.5370, lng: -13.6773 },
        { nom: 'Kindia', lat: 10.0563, lng: -12.8654 },
        { nom: 'Labé', lat: 11.3217, lng: -12.2833 },
        { nom: 'Kankan', lat: 10.3853, lng: -9.3057 },
        { nom: 'Nzérékoré', lat: 7.7562, lng: -8.8179 },
        { nom: 'Mamou', lat: 10.3734, lng: -12.0915 },
        { nom: 'Boké', lat: 10.9321, lng: -14.2958 }
    ];

    const types = ['HOPITAL', 'CLINIQUE', 'PHARMACIE'];
    const nomsStructures = [
        'Hôpital Donka', 'Clinique Ambroise Paré', 'Hôpital Ignace Deen', 'Clinique Pasteur',
        'Pharmacie Centrale', 'Hôpital Régional de Labé', 'Clinique de la Paix', 'Hôpital de Kankan',
        'Pharmacie Guinéenne', 'Clinique Mère-Enfant', 'Hôpital de Nzérékoré', 'Centre de Santé Ratoma',
        'Clinique Saint-Gabriel', 'Hôpital de Kindia', 'Pharmacie de l\'Amitié', 'Clinique des Anges',
        'Hôpital de Boké', 'Centre Médical Kaloum', 'Pharmacie Moderne', 'Clinique Espérance'
    ];

    // 1. Création des 20 structures
    console.log('🏥 Création des 20 structures...');
    const structures: any[] = [];
    for (let i = 0; i < 20; i++) {
        const ville = villes[i % villes.length];
        // On ajoute un petit offset aléatoire pour ne pas qu'elles soient toutes au même point
        const latOffset = (Math.random() - 0.5) * 0.05;
        const lngOffset = (Math.random() - 0.5) * 0.05;

        const structure = await prisma.structure.create({
            data: {
                nom: nomsStructures[i],
                type: types[i % types.length] as any,
                email: `contact@${nomsStructures[i].toLowerCase().replace(/ /g, '-')}.gn`,
                telephone: `+224622${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
                ville: ville.nom,
                latitude: ville.lat + latOffset,
                longitude: ville.lng + lngOffset,
                isActive: true,
                isConfigured: true
            }
        });
        structures.push(structure);
    }

    // 2. Création des membres pour chaque structure (10 à 20 par structure)
    console.log('👨‍⚕️ Création des membres (~300 professionnels)...');
    for (const s of structures) {
        const nbMembres = Math.floor(Math.random() * 11) + 10; // 10 à 20
        for (let j = 0; j < nbMembres; j++) {
            const role = j === 0 ? 'STRUCTURE_ADMIN' : (s.type === 'PHARMACIE' ? 'PHARMACIEN' : 'MEDECIN');
            await prisma.user.create({
                data: {
                    email: `member${j}@${s.email.split('@')[1]}`,
                    password: hashed,
                    nom: `Nom${j}`,
                    prenom: `Prenom${j}`,
                    role: role as any,
                    structureId: s.id,
                    specialite: role === 'MEDECIN' ? 'Urgences' : undefined
                }
            });
        }
    }

    // 3. Création des 30 patients avec profils médicaux
    console.log('👤 Création des 30 patients...');
    const groupes = ['A_POSITIF', 'B_POSITIF', 'O_POSITIF', 'AB_POSITIF', 'O_NEGATIF'];
    const pathologiesList = ['Diabète', 'Hypertension', 'Asthme', 'Anémie', 'Allergie Pollen'];
    
    for (let k = 0; k < 30; k++) {
        const user = await prisma.user.create({
            data: {
                email: `patient${k}@gmail.com`,
                password: hashed,
                nom: `PatientNom${k}`,
                prenom: `PatientPrenom${k}`,
                telephone: `+224664${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
                role: 'PATIENT'
            }
        });

        await prisma.profilMedical.create({
            data: {
                userId: user.id,
                groupeSanguin: groupes[k % groupes.length] as any,
                allergies: k % 3 === 0 ? ['Pénicilline'] : [],
                pathologies: k % 4 === 0 ? [pathologiesList[k % pathologiesList.length]] : [],
                contactNom: 'Proche Secours',
                contactTelephone: '+224620000000',
                contactEmail: 'soulmamoudou0@gmail.com'
            }
        });
    }

    console.log('✅ Seed terminé avec succès !');
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
