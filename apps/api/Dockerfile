FROM node:20-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

# Don't let Puppeteer download Chromium during install — we use a system Chromium at runtime.
ENV PUPPETEER_SKIP_DOWNLOAD=1

# Copy root config and API package
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/

# Install dependencies (workspaces need root install)
RUN npm ci

# Copy the rest of the API source
COPY apps/api ./apps/api

# Generate Prisma Client and build TypeScript
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

# Production image
FROM node:20-slim AS runner

# Install OpenSSL (Prisma) and the PostgreSQL 16 client so the entrypoint can
# take a pre-migration pg_dump that matches the Postgres 16 server.
RUN apt-get update -y \
  && apt-get install -y openssl curl ca-certificates gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -y \
  && apt-get install -y postgresql-client-16 chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
# Puppeteer uses the system Chromium installed above (no bundled download).
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

# Copy built app and required files
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh

WORKDIR /app/apps/api

EXPOSE 4000

# Safe default boot: pre-migration backup -> prisma migrate deploy -> start.
CMD ["sh", "./docker-entrypoint.sh"]
