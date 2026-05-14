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
    
    // Helper pour nettoyer les emails
    const cleanForEmail = (str: string) => {
        return str
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Supprime les accents
            .toLowerCase()
            .replace(/[^\w\.]/g, '') // Garde seulement alphanumérique et points
            .replace(/\s+/g, ''); // Supprime les espaces
    };

    const hashed = await bcrypt.hash('Password123!', 12);
    const hashedAdmin = await bcrypt.hash('AdminStructure123!', 12);

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
        'Hopital Donka', 'Clinique Ambroise Pare', 'Hopital Ignace Deen', 'Clinique Pasteur',
        'Pharmacie Centrale', 'Hopital Regional de Labe', 'Clinique de la Paix', 'Hopital de Kankan',
        'Pharmacie Guineenne', 'Clinique Mere-Enfant', 'Hopital de Nzerekore', 'Centre de Sante Ratoma',
        'Clinique Saint-Gabriel', 'Hopital de Kindia', 'Pharmacie de l Amitie', 'Clinique des Anges',
        'Hopital de Boke', 'Centre Medical Kaloum', 'Pharmacie Moderne', 'Clinique Esperance'
    ];

    // 1. Création des 20 structures
    console.log('🏥 Création des 20 structures...');
    const structures: any[] = [];
    for (let i = 0; i < 20; i++) {
        const ville = villes[i % villes.length];
        const latOffset = (Math.random() - 0.5) * 0.05;
        const lngOffset = (Math.random() - 0.5) * 0.05;

        const structureEmail = `contact@${cleanForEmail(nomsStructures[i])}.gn`;

        const structure = await prisma.structure.upsert({
            where: { email: structureEmail },
            update: {}, // On ne change rien si elle existe déjà
            create: {
                nom: nomsStructures[i],
                type: types[i % types.length] as any,
                email: structureEmail,
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
        const domain = s.email.split('@')[1];
        
        for (let j = 0; j < nbMembres; j++) {
            const role = j === 0 ? 'STRUCTURE_ADMIN' : (s.type === 'PHARMACIE' ? 'PHARMACIEN' : 'MEDECIN');
            const userEmail = j === 0 ? `admin@${domain}` : `member${j}@${domain}`;
            
            await prisma.user.upsert({
                where: { email: userEmail },
                update: {},
                create: {
                    email: userEmail,
                    password: role === 'STRUCTURE_ADMIN' ? hashedAdmin : hashed,
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
    const pathologiesList = ['Diabete', 'Hypertension', 'Asthme', 'Anemie', 'Allergie Pollen'];
    
    for (let k = 0; k < 30; k++) {
        const user = await prisma.user.upsert({
            where: { email: `patient${k}@gmail.com` },
            update: {},
            create: {
                email: `patient${k}@gmail.com`,
                password: hashed,
                nom: `PatientNom${k}`,
                prenom: `PatientPrenom${k}`,
                telephone: `+224664${Math.floor(Math.random() * 1000000).toString().padStart(6, '0')}`,
                role: 'PATIENT'
            }
        });

        await prisma.profilMedical.upsert({
            where: { userId: user.id },
            update: {},
            create: {
                userId: user.id,
                groupeSanguin: groupes[k % groupes.length] as any,
                allergies: k % 3 === 0 ? JSON.stringify(['Penicilline']) : JSON.stringify([]),
                pathologies: k % 4 === 0 ? JSON.stringify([pathologiesList[k % pathologiesList.length]]) : JSON.stringify([]),
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
