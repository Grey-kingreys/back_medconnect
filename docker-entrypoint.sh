#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────────────────
#  DEV uniquement : auto-synchronisation des artefacts montés en volume nommé.
#  En dev, le code est bind-monté et node_modules / generated vivent dans des
#  volumes nommés que Docker NE repeuple PAS quand l'image est reconstruite.
#  → on resynchronise via une comparaison de hash (rapide si rien n'a changé).
# ─────────────────────────────────────────────────────────────────────────────
if [ "$NODE_ENV" = "development" ]; then

  # 1) Dépendances : npm ci si package-lock.json a changé (ou node_modules vide)
  if [ -f package-lock.json ]; then
    CUR_DEPS="$(sha256sum package-lock.json | cut -d' ' -f1)"
    OLD_DEPS="$(cat node_modules/.deps-hash 2>/dev/null || echo '')"
    if [ "$CUR_DEPS" != "$OLD_DEPS" ] || [ ! -d node_modules/.bin ]; then
      echo "📦 Dépendances modifiées (ou node_modules vide) → npm ci…"
      npm ci
      echo "$CUR_DEPS" > node_modules/.deps-hash
      echo "✅ node_modules synchronisé."
    else
      echo "📦 Dépendances à jour — install ignoré."
    fi
  fi

  # 2) Client Prisma : regénère si prisma/schema.prisma a changé (ou client absent)
  if [ -f prisma/schema.prisma ]; then
    CUR_SCHEMA="$(sha256sum prisma/schema.prisma | cut -d' ' -f1)"
    OLD_SCHEMA="$(cat generated/.schema-hash 2>/dev/null || echo '')"
    if [ "$CUR_SCHEMA" != "$OLD_SCHEMA" ] || [ ! -d generated/prisma ]; then
      echo "🔧 Schéma Prisma modifié → prisma generate…"
      npx prisma generate
      mkdir -p generated && echo "$CUR_SCHEMA" > generated/.schema-hash
      echo "✅ Client Prisma régénéré."
    fi
  fi
fi

# ─── Migrations Prisma (dev & prod) ──────────────────────────────────────────
# Idempotent : `migrate deploy` n'applique que les migrations non encore jouées.
echo "▶ Prisma : application des migrations (migrate deploy)…"
npx prisma migrate deploy
echo "✅ Migrations à jour."

exec "$@"
