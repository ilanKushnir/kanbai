# syntax=docker/dockerfile:1

# ---- base: Debian slim + openssl (Prisma needs it) ----
FROM node:22-slim AS base
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- build: install all deps, generate client, build ----
FROM base AS build
COPY package.json package-lock.json ./
# Copy the Prisma schema first so the `postinstall: prisma generate` hook can run.
COPY prisma ./prisma
RUN npm ci
COPY . .
# A dummy URL satisfies PrismaClient construction at build time; pages are
# force-dynamic so no real DB access happens during `next build`.
ENV DATABASE_URL="file:/app/prisma/build.db"
RUN npx prisma generate && npm run build

# ---- run: production image ----
FROM base AS run
ENV NODE_ENV=production PORT=3000
COPY --from=build /app ./
RUN mkdir -p /app/data && chmod +x docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
