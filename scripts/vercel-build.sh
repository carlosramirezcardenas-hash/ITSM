#!/usr/bin/env bash
# Build en Vercel: migraciones → datos demo (solo si la BD está vacía) → build de Next.js
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: falta DATABASE_URL. Conecta una base de datos PostgreSQL al proyecto (Storage → Neon)." >&2
  exit 1
fi
# Las migraciones necesitan conexión directa (sin pooler)
MIGRATE_URL="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}}"
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy
if [ "${SEED_DEMO:-true}" = "true" ]; then
  DATABASE_URL="$MIGRATE_URL" SEED_IF_EMPTY=1 npx tsx prisma/seed.ts
fi
npx next build
