# Flowzen — Comprehensive Project Memory & AI System Context

**CRITICAL INSTRUCTION FOR ALL AI AGENTS**: Before writing any code, modifying configurations, or proposing UI changes, you MUST read this entire document. This file contains the exact technical rules, architecture constraints, database schemas, and historical bug fixes for the Flowzen SaaS platform. Deviating from these constraints will break the production environment.

## 1. Project Overview & Vision
**Name**: Flowzen
**Type**: Internal SaaS Agency Project Management Platform
**Philosophy**: "Apple-level simplicity, Linear-level productivity, Notion-level flexibility."
**Goal**: Combine Client Management, Project Management, Task Management, Team Collaboration, and Operational Visibility into a single, highly focused, and premium workspace.

---

## 2. Directory Structure & Architecture Overview
Flowzen is a **Turborepo Monorepo** containing two main apps: `apps/web` (Frontend) and `apps/api` (Backend).

### `apps/web` (Frontend)
- **`src/app`**: Next.js 16 App Router. Divided into `(auth)` for login/registration and `(dashboard)` for protected views.
- **`src/components`**: 
  - `ui/`: Highly reusable atomic components (buttons, custom selects, modals, dialogs). 
  - `layout/`: AppShell, TopNav, Sidebar.
- **`src/lib/api.ts`**: **CRITICAL FILE.** The global Axios wrapper. It automatically attaches the JWT token from cookies/Zustand state to every outgoing request. If an API call returns `401 Unauthorized`, this wrapper automatically catches it, forces `useAuthStore.getState().logout()`, and clears the local session to trigger a redirect to `/login`.
- **`src/stores/`**: Zustand state management.
  - `useAuthStore.ts`: Hydrates from local storage. Manages JWT persistence and user context.
  - `useNotificationStore.ts`: Manages the real-time notification queue and active toasts.
  - `useUIStore.ts` & `useConfirmStore.ts`: Manages global UI elements (Sidebar, Command Palette, Confirmation Modals).

### `apps/api` (Backend)
- **`src/routes/`**: Express route handlers (Auth, Dashboard, Clients, Projects, Tasks, Teams, Settings).
- **`src/middleware/`**: 
  - `auth.ts`: Contains `authenticate` (validates JWT) and `authorize` (enforces RBAC).
  - `validate.ts`: Zod schema validation middleware.
- **`src/services/email.ts`**: Nodemailer service for handling Verification, Welcome Emails, and Password Resets.

---

## 3. Strict AI Coding Rules & Guidelines

**UI/UX Design Constraints:**
1. **Never Use Native Selects**: NEVER use native HTML `<select>` elements. Always use `@/components/ui/select` or `@/components/ui/multi-select` to maintain styling.
2. **Apple-Level Minimalism**: Avoid clunky data grids, heavy badges, and bulky progress bars. Keep the UI ultra-clean.
3. **No Emojis**: Never use emojis in the UI. Exclusively use `lucide-react` icons for all visual indicators.
4. **Strict Color Palette**: 
   - Backgrounds: `#FFFFFF` (White) and `#FAFAFA` (Surfaces).
   - Borders: `#E5E7EB`.
   - Text: `#111827` (Primary) and `#6B7280` (Secondary).
   - Accent: `#000000` (Black).
   - *Do not arbitrarily introduce heavy colors or a dark mode.*

**Backend Constraints:**
1. **Never Remove RBAC**: All protected routes MUST use the `authorize` middleware appropriately. `TEAM_MEMBER` roles are strictly forbidden from accessing `Clients`, `Teams`, and `Settings`.
2. **Transactions**: Use Prisma transactions `$transaction` when updating tasks, projects, or milestones to prevent race conditions.

---

## 4. Deep-Dive Prisma Relationships

The database is powered by PostgreSQL via Prisma.
- **Organization**: The root tenant (`name`, `settings`). 
- **User**: Belongs to an `Organization`. Holds `role` (`SUPER_ADMIN`, `ADMIN`, `PROJECT_MANAGER`, `TEAM_MEMBER`). Tracks email verification via `isEmailVerified` and `emailVerifyToken`.
- **Team**: Has a designated `leaderId` (User) and multiple `members` (User[]).
- **Project**: Owned by a `User`. Tied to a `Client`. Has a direct `members` array (User[]) AND a `teams` array (Team[]).
- **Task**: Belongs to a `Project`. Assigned to a `User`. Can have a parent `Task` (subtasks). Statuses: `BACKLOG`, `TODO`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `COMPLETED`.

*(File uploads and attachments have been explicitly removed from this architecture to save storage costs. Do not implement file upload features.)*

---

## 5. Deployment & Execution Quirks (CRITICAL)

The deployment architecture is fully containerized via Docker on a VPS. **Any AI modifying Docker or build configurations must adhere to these rules:**

1. **Next.js Build-Time Variables (`NEXT_PUBLIC_*`)**:
   - Next.js hardcodes `NEXT_PUBLIC_*` variables into the static HTML *during the build process*. 
   - The `apps/web/Dockerfile` has been specifically modified to accept `ARG NEXT_PUBLIC_API_URL` and `ARG NEXT_PUBLIC_APP_URL`. 
   - `docker-compose.yml` passes these `args` into the web build block. *Do not remove these `args`, or the frontend will break in production.*

2. **PostgreSQL Custom Port (`5433`)**:
   - To avoid conflicts on the host VPS, the database port is mapped to `5433` on the host side (`5433:5432` in `docker-compose.yml`).
   - Locally, ensure `DATABASE_URL` uses port `5433` when connecting from the host machine.

3. **Email & SMTP Configurations**:
   - Email is handled via Nodemailer in `EmailService`.
   - The `docker-compose.yml` file explicitly maps `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` into the backend `api` service.

4. **WebSockets (`/socket.io/`) Reverse Proxy**:
   - The platform relies on Socket.IO for real-time updates.
   - The production VPS runs Apache (or Nginx) which MUST be configured to pass `/socket.io/` traffic via proxy to the `api` container port `4000` with WebSockets upgraded (`Upgrade: websocket`).

---

## 6. Authentication & Email Workflows

- **Registration (`/api/auth/register`)**: Creates an organization, the first user (`SUPER_ADMIN`), generates an `emailVerifyToken`, and sends a Verification Email.
- **Admin User Creation (`/api/settings/users`)**: When an Admin creates a new team member from the settings page, the system immediately generates a password and triggers `EmailService.sendWelcomeEmail`, which emails the user their login credentials.
- **Resend Verification (`/api/auth/resend-verification`)**: If an unverified user logs in, the dashboard layout (`apps/web/src/app/(dashboard)/layout.tsx`) displays a red banner. This banner contains a "Resend Email" button which hits this endpoint to generate a new token and send a fresh verification email.

---

*(End of Document - Flowzen v1.0 Architecture & Memory)*
