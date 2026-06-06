# Flowzen — Developer & DevOps Operations Guide

Welcome to the Flowzen project. This document provides a comprehensive guide for developers and DevOps engineers on how the project operates, how to run it locally, and how the production environment is structured using Docker containers and Apache.

---

## 1. Project Architecture Overview

Flowzen is a **Turborepo Monorepo** containing two main applications:
1. **Frontend (`apps/web`)**: A Next.js 16 (App Router) application serving the UI.
2. **Backend (`apps/api`)**: A Node.js/Express application handling REST APIs and real-time WebSocket (`Socket.IO`) connections.

### Tech Stack
- **Frontend**: Next.js, React, Tailwind CSS, Zustand, Framer Motion.
- **Backend**: Node.js, Express, Socket.IO, Prisma ORM.
- **Database**: PostgreSQL.
- **Cache / PubSub**: Redis (Used for Socket.IO multi-instance scaling if needed).

---

## 2. Local Development Setup

To run the project on your local machine for development:

### Prerequisites
- Node.js (v18+)
- npm (v10+)
- PostgreSQL (or use Docker locally)

### Steps
1. **Install Dependencies**:
   Navigate to the root directory and run:
   ```bash
   npm install
   ```

2. **Environment Variables**:
   Create a `.env` file in the root directory. It should contain at minimum:
   ```env
   DATABASE_URL="postgresql://postgres:password@localhost:5433/eyelevelPm?schema=public"
   JWT_SECRET="your-super-secret-jwt-key"
   NEXT_PUBLIC_API_URL="http://localhost:4000/api"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

3. **Database Initialization**:
   Ensure your local PostgreSQL instance is running. Then apply the Prisma schema:
   ```bash
   npx prisma generate --workspace=apps/api
   npx prisma db push --workspace=apps/api
   ```

4. **Start Development Servers**:
   Run Turborepo's dev command from the root to start both apps concurrently:
   ```bash
   npm run dev
   ```
   - Frontend runs on `http://localhost:3000`
   - Backend API runs on `http://localhost:4000`

---

## 3. DevOps & Containerization (Production)

In production, Flowzen is fully containerized using **Docker Compose**. This ensures identical environments across staging and production servers.

### Container Architecture
The `docker-compose.yml` file orchestrates the following services:
1. **`postgres`**: The database container (image: `postgres:15-alpine`).
2. **`redis`**: Cache and session store (image: `redis:alpine`).
3. **`api`**: The Node.js backend container.
4. **`web`**: The Next.js frontend container.

### Crucial Production Quirks
- **Database Port Mapping**: To avoid conflicting with any native PostgreSQL installations on the host VPS, the database port is mapped to `5433` on the host side (`5433:5432`). Ensure your `DATABASE_URL` references `5433` if connecting from the host machine.
- **Next.js Build-Time Variables**: Next.js bakes `NEXT_PUBLIC_*` variables into the static HTML *during the build phase*. Therefore, the `docker-compose.yml` passes `args` to the frontend `Dockerfile` to inject `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` directly into the container during the build process.

### Deploying a New Build
To pull the latest code and deploy it with zero-downtime container recreation:
```bash
git pull origin main
docker compose up -d --build
```

---

## 4. Apache Reverse Proxy Configuration

The VPS uses Apache (or Nginx) to route public traffic to the internal Docker containers. Because Flowzen relies heavily on real-time **WebSockets (Socket.IO)**, standard proxy routing is not enough. You must explicitly configure the proxy to handle HTTP protocol upgrades for WebSockets.

### Standard Apache VirtualHost Configuration
Below is the reference configuration for routing the domain `project.eyelevelstudio.in` to the Docker containers.

```apache
<VirtualHost *:80>
    ServerName project.eyelevelstudio.in

    # Redirect all HTTP traffic to HTTPS
    RewriteEngine On
    RewriteCond %{HTTPS} off
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
    ServerName project.eyelevelstudio.in

    # SSL Configuration (Let's Encrypt / Certbot)
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/project.eyelevelstudio.in/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/project.eyelevelstudio.in/privkey.pem

    # Enable required Proxy Modules
    # Run: sudo a2enmod proxy proxy_http proxy_wstunnel rewrite

    # 1. Route WebSocket Traffic specifically
    # This MUST come before the standard /api rule
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteRule /(.*) ws://127.0.0.1:4000/$1 [P,L]

    # Socket.IO Polling Fallback Routing
    ProxyPass "/socket.io/" "http://127.0.0.1:4000/socket.io/"
    ProxyPassReverse "/socket.io/" "http://127.0.0.1:4000/socket.io/"

    # 2. Route standard REST API Traffic
    ProxyPass "/api" "http://127.0.0.1:4000/api"
    ProxyPassReverse "/api" "http://127.0.0.1:4000/api"

    # 3. Route all other traffic to the Next.js Frontend
    ProxyPass "/" "http://127.0.0.1:3000/"
    ProxyPassReverse "/" "http://127.0.0.1:3000/"

    # Preserve Host headers to avoid CORS issues
    ProxyPreserveHost On
</VirtualHost>
```

### Applying Apache Changes
If you modify the VirtualHost file (usually located in `/etc/apache2/sites-available/`), verify and reload the server:
```bash
# Check for syntax errors
sudo apache2ctl configtest

# Restart Apache to apply changes
sudo systemctl restart apache2
```

---

## 5. Troubleshooting & Maintenance

- **Viewing Backend Logs**: If an API call is failing (e.g., returning 500), check the backend logs.
  ```bash
  docker logs flowzen-api --tail 50 -f
  ```
- **Running Database Migrations in Production**: If you change the Prisma schema, you must apply those changes to the production database inside the container.
  ```bash
  docker exec -it flowzen-api npx prisma db push
  ```
- **Clearing Next.js Cache**: If frontend UI updates are not reflecting after a build, you may need to clear the Docker build cache.
  ```bash
  docker builder prune -a
  docker compose build --no-cache web
  docker compose up -d web
  ```
