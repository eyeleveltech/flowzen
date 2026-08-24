# Flowzen

> A workspace for digital agencies to take a business from first conversation to paid work — without duplicating the customer record along the way.

![Flowzen logo](https://raw.githubusercontent.com/eyeleveltech/flowzen/main/apps/web/public/logo_flowzen.png)

Flowzen is a TypeScript monorepo for agency relationship management, delivery, and revenue operations. Its core model is one company record that gains related leads, quotations, engagements, projects, tasks, invoices, payments, and activity as the relationship progresses.

> **Project status:** Active development. The public repository has no published release, package, repository homepage, or root README at the time this document was drafted. The internal build-status document is dated 2026-08-17; the repository was pushed more recently (2026-08-22), so detailed feature-status claims below should be treated as a documented snapshot rather than a release guarantee.

## What it covers

- **CRM:** companies/clients, contacts, leads, pipeline stages, activities, quotations, and search.
- **Project management:** projects, tasks, personal work, role-aware dashboards, and notifications.
- **Revenue operations:** engagements, quotation-to-win flow, invoices, payments, expenses, and revenue views.
- **Agency configuration:** organisation settings, tax and document numbering, team roles, module enablement, mail settings, and audit logging.

The intended workflow is:

```mermaid
flowchart LR
  A[Company] --> B[Lead]
    B --> C[Quotation]
      C -->|Accepted| D[Engagement]
        D --> E[Project & tasks]
          D --> F[Invoice]
            F --> G[Payment]
              E --> H[Client relationship]
                G --> H
                ```

                The repository also contains a more detailed visual system design and application-flow diagram:

                - [System-design diagram (SVG)](https://github.com/eyeleveltech/flowzen/blob/main/docs/flowzen-system-design.svg)
                - [Application-flow diagram (SVG)](https://github.com/eyeleveltech/flowzen/blob/main/docs/flowzen-application-flow.svg)

                <!-- Add verified product screenshots or a hosted demo URL here when available. -->

                ## Architecture

                ```text
                apps/
                  web/       Next.js web application
                    api/       Express REST API, Prisma schema/migrations, workers and services
                    packages/
                      shared/    Shared TypeScript types, constants, and Zod-related shared code
                      docs/        Product workflow, system design, implementation plan, and build status
                      scripts/     Database baseline, migration-generation, and restore helpers
                      ```

                      - **Web:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, React Query, Zustand, React Hook Form/Zod, Tiptap, Recharts, and Playwright/Vitest.
                      - **API:** Express 4 on Node.js, TypeScript, Prisma 6/PostgreSQL, Zod, JWT/cookies, Helmet, CORS, Redis/BullMQ, cron workers, Nodemailer, Winston, and SSE.
                      - **Data/infrastructure:** PostgreSQL 16 and Redis 7 in Docker Compose; Dockerfiles for both applications; GitHub Actions builds/tests and verifies Docker images.
                      - **Monorepo tooling:** npm workspaces, Turborepo, Node.js 20+ and npm 10.

                      ### Implementation choices documented in the repo

                      - **One company record, no lead-to-client copying.** A company remains the same record from prospecting through delivery and billing; related entities attach to it.
                      - **Multi-tenant, organisation-scoped data.** Organisation configuration, roles, modules, and records are scoped by organisation.
                      - **Business invariants close to the data/service boundary.** The project documentation describes constraints such as one accepted quotation per lead, one engagement per won lead, and append-only activity history.
                      - **Role ladder and server-side access enforcement.** User roles are documented as Super Admin, Admin, Manager, Sales, and Member; UI visibility is not the authorization boundary.
                      - **Financial integrity over convenience.** Server-calculated monetary totals, forward-only document counters, invoice status derived from payments, and migrations instead of production `prisma db push` are explicit design rules.
                      - **Feature modules, not a single universal sidebar.** CRM, PM, and Revenue are switchable modules; shared screens remain outside a module context.

                      For the product rationale and fuller workflow, see [The Journey](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-JOURNEY.md), [workflow reference](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-WORKFLOW.md), and [master plan](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-MASTER-PLAN.md).

                      ## Local development

                      ### Prerequisites

                      - Node.js **20+**
                      - npm **10+**
                      - Docker Desktop / Docker Engine (recommended for PostgreSQL and Redis)
                      - A local PostgreSQL 16-compatible database and Redis instance if you do not use Docker

                      ### 1. Clone and install

                      ```bash
                      git clone https://github.com/eyeleveltech/flowzen.git
                      cd flowzen
                      npm ci
                      cp .env.example .env
                      ```

                      Edit `.env` before running the application. At a minimum, set a strong, unique `JWT_SECRET` and a non-empty `POSTGRES_PASSWORD` if using Docker Compose. Do not commit `.env` or real API, SMTP, or database credentials.

                      ### 2. Start backing services

                      **Recommended: run the complete stack with Docker Compose**

                      ```bash
                      docker compose up --build
                      ```

                      This starts PostgreSQL, Redis, API, web, and a database-backup service. The web application is published on port `3000`; the API is bound to `127.0.0.1:4000`.

                      **Alternative: run only PostgreSQL and Redis in Docker, apps on the host**

                      ```bash
                      docker compose up -d postgres redis
                      ```

                      When using the Compose PostgreSQL database from host-run applications, configure `DATABASE_URL` with host port **5433** (Compose maps host `5433` to container `5432`), for example:

                      ```dotenv
                      DATABASE_URL="postgresql://elitepm:YOUR_PASSWORD@localhost:5433/elitepm?schema=public"
                      ```

                      ### 3. Generate the client, apply migrations, and seed

                      For a clean local database:

                      ```bash
                      npm run db:generate
                      npm run db:migrate
                      npm run db:seed
                      ```

                      `db:migrate` uses Prisma's development migration command. Use it only against a disposable local development database. Do **not** use `prisma db push` or destructive migration flags against production; follow [DEPLOY.md](https://github.com/eyeleveltech/flowzen/blob/main/DEPLOY.md) and [MIGRATIONS.md](https://github.com/eyeleveltech/flowzen/blob/main/MIGRATIONS.md) for production-safe deployment and recovery practices.

                      ### 4. Run the apps

                      From the repository root:

                      ```bash
                      npm run dev
                      ```

                      Or run each service independently:

                      ```bash
                      # terminal 1
                      npm run dev --workspace=apps/api

                      # terminal 2
                      npm run dev --workspace=apps/web
                      ```

                      Defaults:

                      | Service | URL |
                      | --- | --- |
                      | Web | `http://localhost:3000` |
                      | API health check | `http://localhost:4000/api/health` |
                      | API base URL | `http://localhost:4000/api` |

                      `NEXT_PUBLIC_API_URL` defaults to `http://localhost:4000/api`; change it in `.env` if your API runs elsewhere.

                      ### Optional integrations

                      The app can be configured with SMTP credentials for application mail and, where applicable, Apify/OpenAI credentials for intelligence/outreach-related functionality. Leave optional integration fields blank unless you are actively configuring those features. Never place production tokens in example files, commits, issues, or screenshots.

                      ## Quality checks

                      ```bash
                      # Build all workspace packages/apps
                      npm run build

                      # Lint all workspace packages/apps
                      npm run lint

                      # API unit tests
                      npm run test --workspace=apps/api

                      # Web unit tests
                      npm run test --workspace=apps/web

                      # Web Playwright end-to-end tests
                      npm run test:e2e
                      ```

                      The CI workflow runs dependency installation, Prisma client generation, linting, builds, tests when a root test script is present, and Docker image builds for API and web. See [`.github/workflows/ci.yml`](https://github.com/eyeleveltech/flowzen/blob/main/.github/workflows/ci.yml).

                      ## Current implementation status

                      The repository's build-status handover (dated 2026-08-17) reports the v2 database, API routes, principal web pages, role-aware views, settings, mail configuration, and test suites as implemented. It specifically lists these as remaining or incomplete at that point:

                      1. Automated daily scanner/notification production.
                      2. Quotation and invoice PDF generation/storage.
                      3. Editing configured lists (stages, lost reasons, sources, services) in the UI.
                      4. Persisting values for stage forms/custom fields.
                      5. Verified Google OAuth token handling.
                      6. Expenses UI/API, reporting, project membership controls, and recurring task behavior.

                      Consult [docs/BUILD-STATUS.md](https://github.com/eyeleveltech/flowzen/blob/main/docs/BUILD-STATUS.md) before planning work: it is a detailed handover and may be superseded by newer commits.

                      ## Documentation

                      - [Build status and handover](https://github.com/eyeleveltech/flowzen/blob/main/docs/BUILD-STATUS.md)
                      - [Product journey](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-JOURNEY.md)
                      - [End-to-end workflow reference](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-WORKFLOW.md)
                      - [Master plan and system design](https://github.com/eyeleveltech/flowzen/blob/main/docs/FLOWZEN-MASTER-PLAN.md)
                      - [Deployment guide](https://github.com/eyeleveltech/flowzen/blob/main/DEPLOY.md)
                      - [Database migration guidance](https://github.com/eyeleveltech/flowzen/blob/main/MIGRATIONS.md)
                      - [Contributing terminology](https://github.com/eyeleveltech/flowzen/blob/main/CONTRIBUTING.md)
                      - [Known bugs and fixes](https://github.com/eyeleveltech/flowzen/blob/main/BUGS_AND_FIXES.md)

                      ## Contributing

                      Please read [CONTRIBUTING.md](https://github.com/eyeleveltech/flowzen/blob/main/CONTRIBUTING.md) before opening a change. It defines user-facing terminology, including **Client** for the customer record and **Lead** for sales opportunities, while preserving legacy code/API identifiers where necessary.

                      Before submitting a pull request:

                      1. Keep changes scoped and avoid committing secrets, generated local uploads, or database dumps.
                      2. Run the relevant build, lint, and test commands above.
                      3. Add or update tests for behavioral changes.
                      4. For schema changes, generate and review a migration; treat unexpected drops, renames, and `NOT NULL` changes on existing data as a stop-and-review condition.

                      ## Attribution and license

                      GitHub identifies the repository owner as [@eyeleveltech](https://github.com/eyeleveltech). Public commit history shows contributions by multiple GitHub accounts, but it does not establish each contributor's product role or ownership. Add a maintainer/team attribution section only after the project owner confirms the names, roles, and wording.

                      No license file or GitHub license metadata was present when this README was drafted. **All rights are reserved unless and until the repository owner adds an explicit license.**
                      
