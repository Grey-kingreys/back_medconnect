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

        // Brancher les middlewares Prisma pour soft-delete
        this.applySoftDeleteMiddleware();
    }

    async onModuleDestroy() {
        await this.$disconnect();
        await this.pool.end();
        this.logger.log('🔌 Base de données déconnectée');
    }

    /**
     * Middleware Prisma pour soft-delete (Consultation, Ordonnance,
     * ResultatAnalyse, Vaccination). Intercepte `delete`/`deleteMany` et les
     * transforme en `update`/`updateMany` avec `deletedAt: now()`. Filtre les
     * lectures pour exclure les enregistrements soft-deleted par défaut.
     */
    private applySoftDeleteMiddleware() {
        const softDeleteModels = ['consultation', 'ordonnance', 'resultatAnalyse', 'vaccination'];

        (this as any).$use(async (params, next) => {
            // Si le modèle est marqué pour soft-delete
            if (softDeleteModels.includes(params.model?.toLowerCase())) {
                // Intercepter delete → update avec deletedAt
                if (params.action === 'delete') {
                    params.action = 'update';
                    params.args.data = { deletedAt: new Date() };
                }
                // Intercepter deleteMany → updateMany avec deletedAt
                else if (params.action === 'deleteMany') {
                    params.action = 'updateMany';
                    params.args.data = { deletedAt: new Date() };
                }
                // Ajouter un filtre par défaut pour findUnique/findFirst/findMany : excluder les soft-deleted
                else if (['findUnique', 'findFirst', 'findMany'].includes(params.action)) {
                    if (params.args.where) {
                        // Vérifier que deletedAt n'est pas explicitement cherché
                        if (!('deletedAt' in params.args.where)) {
                            params.args.where.deletedAt = null;
                        }
                    } else {
                        params.args.where = { deletedAt: null };
                    }
                }
            }

            return next(params);
        });
    }
}