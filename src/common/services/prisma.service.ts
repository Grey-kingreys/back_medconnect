import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from 'generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
    extends PrismaClient
    implements OnModuleInit, OnModuleDestroy {
    private pool: Pool;
    private readonly logger = new Logger(PrismaService.name);

    constructor() {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
        });
        const adapter = new PrismaPg(pool);
        super({ adapter });
        this.pool = pool;
    }

    async onModuleInit() {
        await this.$connect();
        this.logger.log('✅ Base de données connectée');
    }

    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
        this.logger.log('🔌 Base de données déconnectée');
    }
}

/**
 * ⚠️ SOFT-DELETE — règle applicative, sans interception automatique.
 *
 * `Consultation`, `Ordonnance`, `ResultatAnalyse` et `Vaccination` portent un
 * `deletedAt` : ces données de santé ne sont jamais supprimées physiquement.
 *
 * Conséquence pour tout nouveau code touchant ces quatre modèles :
 *   - supprimer  → `update({ data: { deletedAt: new Date() } })`, jamais `delete()`
 *   - lire       → ajouter `deletedAt: null` au `where`
 *
 * Une version antérieure branchait un middleware `$use` global : cette API a été
 * retirée de Prisma 5 et n'existe plus en Prisma 7 (seul `$extends` subsiste),
 * l'appel échouait donc au démarrage. `$extends` n'a pas été retenu car il
 * retourne un *nouveau* client sans les champs propres à ce service (`pool`,
 * `logger`) : le filtrage explicite reste ici plus sûr que l'implicite.
 */