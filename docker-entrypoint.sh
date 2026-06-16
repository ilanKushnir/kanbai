#!/bin/sh
set -e

echo "→ Applying database migrations…"
npx prisma migrate deploy

if [ "${KANBAI_SEED}" = "true" ]; then
  echo "→ Seeding demo data (KANBAI_SEED=true)…"
  npx prisma db seed || echo "  (seed skipped or already applied)"
fi

echo "→ Starting Kanbai on port ${PORT:-3000}…"
exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
