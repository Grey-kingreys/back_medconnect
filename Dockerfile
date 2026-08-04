# syntax=docker/dockerfile:1

# ============================================================
#  MedConnecte — Backend (NestJS 11 + Prisma 7)
#  Multi-stage : base → deps → (dev | build → prod)
# ============================================================

# ---------- base : runtime commun ----------
FROM node:22-slim AS base
WORKDIR /app
# openssl est requis par Prisma ; ca-certificates pour les appels HTTPS sortants (Resend/Nimba)
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY docker-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENTRYPOINT ["entrypoint.sh"]

# ---------- deps : toutes les dépendances (dev incluses, pour build + CLI Prisma) ----------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---------- dev : hot-reload (le code est monté en volume via compose.override.yml) ----------
FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
# Empreintes de référence : l'entrypoint compare ces hashes pour décider
# de relancer `npm ci` / `prisma generate` quand le volume devient périmé.
RUN sha256sum package-lock.json | cut -d' ' -f1 > node_modules/.deps-hash \
 && sha256sum prisma/schema.prisma | cut -d' ' -f1 > generated/.schema-hash
EXPOSE 3001
CMD ["npm", "run", "dev"]

# ---------- build : génération du client Prisma + compilation Nest ----------
FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---------- prod : image d'exécution ----------
FROM base AS prod
ENV NODE_ENV=production
# node_modules complet (inclut le CLI prisma pour `migrate deploy` au démarrage
# et le client généré dans ./generated importé en bare specifier)
COPY --from=build /app/node_modules        ./node_modules
COPY --from=build /app/dist                ./dist
COPY --from=build /app/generated           ./generated
COPY --from=build /app/prisma              ./prisma
COPY --from=build /app/prisma.config.ts    ./prisma.config.ts
COPY --from=build /app/tsconfig.json       ./tsconfig.json
COPY --from=build /app/tsconfig.build.json ./tsconfig.build.json
# Utilitaires d'exploitation lancés à la main (r2-cors.cjs), jamais au démarrage.
COPY --from=build /app/scripts              ./scripts
COPY package.json package-lock.json        ./
EXPOSE 3001
# Sonde de santé (GET /). node:*-slim n'a ni curl ni wget → fetch global de Node 22.
# start-period long : l'entrypoint joue `prisma migrate deploy` avant le boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# `import { PrismaClient } from 'generated/prisma/client'` est un bare specifier :
# tsconfig-paths/register le résout via baseUrl (./) → ./generated/prisma/client au runtime.
CMD ["node", "-r", "tsconfig-paths/register", "dist/src/main.js"]
