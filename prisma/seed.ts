/**
 * Seed — Crée le compte SUPER_ADMIN initial
 * Usage : npx ts-node prisma/seed.ts
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

// ✅ Même pattern que PrismaService
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const email = process.env.SUPER_ADMIN_EMAIL || 'superadmin@medconnect.gn';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!';
    const nom = 'Admin';
    const prenom = 'Super';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        console.log(`✅ Le compte SUPER_ADMIN existe déjà : ${email}`);
        return;
    }

    const hashed = await bcrypt.hash(password, 12);
    const superAdmin = await prisma.user.create({
        data: {
            nom,
            prenom,
            email,
            password: hashed,
            role: 'SUPER_ADMIN',
            isActive: true,
        },
    });

    console.log('');
    console.log('🎉 Compte SUPER_ADMIN créé avec succès !');
    console.log('─────────────────────────────────────────');
    console.log(`   ID     : ${superAdmin.id}`);
    console.log(`   Email  : ${email}`);
    console.log(`   Mot de passe : ${password}`);
    console.log('─────────────────────────────────────────');
    console.log('⚠️  Changez ce mot de passe après la première connexion !');
    console.log('');
}

main()
    .catch((e) => {
        console.error('❌ Erreur lors du seed :', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end(); // ✅ Fermer aussi le pool pg
    });