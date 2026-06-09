# Flowzen — Comprehensive Project Memory & AI System Context

This document is the ultimate master blueprint of the Flowzen project, detailing everything from micro-interactions on specific pages to the core backend architecture and deployment workflows.

**CRITICAL INSTRUCTION FOR ALL AI AGENTS**: Before writing any code, modifying configurations, or proposing UI changes, you MUST read this entire document. This file contains the exact technical rules, architecture constraints, database schemas, and historical bug fixes for the Flowzen SaaS platform. Deviating from these constraints will break the production environment.

---

## 1. Application Pages & Real-Time Features Map

The frontend is divided into two route groups: `(auth)` and `(dashboard)`. Below is the exhaustive feature breakdown.

### `(dashboard)` Routes
All dashboard pages rely heavily on `@tanstack/react-query` for data fetching and caching, combined with an active `EventSource` (SSE) connection to automatically re-fetch data upon receiving server pushes.

*   **`/dashboard` (Overview):**
    *   **Features:** Renders dynamic KPI stats (Active Clients, Overdue Tasks). For Managers, it displays Recharts visualizations (Team Workload Bar Chart, Project Status Pie Chart) and a Client Health summary. Contains an "Activity Feed" and a "My Tasks" section.
    *   **Real-time:** Listens to `client:created`, `project:created`, `task:created`, `task:updated`, and `project:updated` via SSE. Triggers a full dashboard re-fetch instantly when changes occur.
*   **`/projects`:**
    *   **Features:** Lists projects with rich metadata. The Project Details view features a pristine **Apple-Level Minimalist 4-column grid dashboard** (Key Dates, Client Details, Progress, Assigned Team). Long-form fields like "Scope of Work" and "Internal Notes" utilize a **Rich Text Editor** and truncate automatically, expanding into **Slide-Over Modals** for a clean reading experience. Includes a "Project-Level Comments" tab.
    *   **Real-time:** Webhooks/SSE push updates to project status or new comments, instantly updating the UI for all connected users.
*   **`/tasks`:**
    *   **Features:** Advanced Kanban/List views. Supports sub-tasks, `Reviewer` assignments, and `DriveLink` URLs instead of native file attachments.
*   **`/calendar`:**
    *   **Features:** Advanced Monthly and Weekly timeline views with powerful frontend filtering (by Client, Assignee, Status) driven by the Project's hex color.
*   **`/clients`:**
    *   **Features:** Client CRUD, advanced filtering (City, Engagement Type), and a robust Bulk Import/Export feature using `papaparse` for CSVs.
*   **`/settings` & `/team`:**
    *   **Features:** Organization management. Admin-only sections for inviting new users (triggers secure email workflows).
*   **`/profile`:**
    *   **Features:** User self-management (Name, Department, secure password resets).

### Global Real-Time Events
*   **Notifications:** The `<GlobalEvents />` component is mounted at the root layout. It listens for the `notification:new` SSE event. When received, it triggers a global `toast` and invalidates the `['notifications']` query cache to update the notification bell icon.

---

## 2. Next.js SSR vs. Client Rendering Architecture

Flowzen is built on **Next.js 16 (App Router)**.

### Rendering Strategy
1.  **Server Components (Default):**
    *   The root `layout.tsx` and nested `layout` files are React Server Components (RSCs). They handle basic metadata (title, icons, manifest) and structure without shipping JavaScript to the client.
    *   **Strict SSR Pages:** Only the root `app/layout.tsx` (metadata injection) and `app/page.tsx` (executes a server-side `redirect('/dashboard')`) are pure Server Components.
2.  **Client Components (`"use client"` / CSR):**
    *   Due to the highly interactive nature of this SaaS (Zustand state, React Query, Framer Motion animations, SSE hooks), almost all functional routing is explicitly marked with `"use client"`.
    *   **Strict CSR Pages:** `login`, `register`, `dashboard`, `projects`, `tasks`, `calendar`, `clients`, `settings`, `team`, `profile`, and all auth sub-pages (`forgot-password`, `reset-password`, `verify-email`, `setup-password`). The `(dashboard)/layout.tsx` is also a Client Component.
    *   **How it works:** The initial HTML is pre-rendered on the server (SSR) to improve perceived load times and SEO, but interactivity is fully hydrated on the client for all the pages listed above.
3.  **Data Fetching:**
    *   Server-Side data fetching (`fetch` inside RSCs) is bypassed in favor of Client-Side data fetching via `useQueries.ts` (`@tanstack/react-query`). This allows for complex caching, pagination, and real-time invalidation.

---

## 3. Core Workflows Deep-Dive

### Authentication Workflow
The system utilizes a secure, JWT-based hybrid approach.
1.  **Login (`/api/auth/login`):** The Express backend validates credentials and issues an `HttpOnly`, `Secure` cookie containing the JWT, protecting it from XSS attacks.
2.  **Client Hydration (`useAuthStore.ts`):** The frontend stores basic user metadata (Name, Role, ID) in `localStorage` for fast UI hydration, but the actual security token remains in the HTTP cookie.
3.  **API Wrapper (`api.ts`):** All outgoing requests automatically include `credentials: 'include'` to pass the cookie. If the backend returns a `401 Unauthorized` (e.g., token expired), the `api.ts` wrapper automatically clears the Zustand store and forcefully redirects the user to `/login`.
4.  **Admin Invites (`/api/settings/users`):** Admins trigger an invite. The backend generates a 24-hour cryptographically secure `resetToken` and fires an email via Nodemailer (`EmailService`). The user clicks the link to `/setup-password`, verifying the token and setting their credentials.

### File Attachment Alternative Workflow
To optimize storage costs, native file uploading has been banned.
*   Instead, Task and Client models use a `DriveLink` field. Users paste Google Drive, Figma, or Dropbox URLs.

---

## 4. Frontend Design & UI/UX Audit

*   **Typography:** Strict `Inter` font stack. Apple-Level Minimalism dictates softer weights:
    *   **Page Titles:** `font-semibold` (not bold).
    *   **Table Headers:** `font-medium uppercase tracking-wide` (not tracking-wider).
*   **Color Palette (Apple-Level Minimalism):**
    *   `--color-surface`: `#FAFAFA`
    *   `--color-border`: `#E5E7EB`
    *   `--color-primary`: `#111827` (Main Text)
    *   `--color-secondary`: `#6B7280` (Muted Text)
    *   `--color-accent`: `#000000`
    *   **Status Colors:** Success (`#22C55E`), Warning (`#F59E0B`), Danger (`#EF4444`).
*   **Shadows & Spacing:** 
    *   **NO Static Shadows:** Static shadows (`shadow-sm`, `shadow-md`, etc.) are completely banned on resting UI elements (Cards, Tables, Metrics) to maintain a perfectly flat, crisp aesthetic.
    *   **Modal Depth:** Pop-ups and Slide-Over Modals are the only elements that utilize deep drop shadows (`shadow-2xl shadow-black/10`) to explicitly separate them from the flat background.
    *   **Dynamic Interactive Depth:** Instead of static depth, interactive cards use `border-[#E5E7EB]` combined with `hover:shadow-sm transition-all` to create a smooth, subtle elevation only when the user interacts with them.
*   **Avatars:** Globally standardized to a minimalist grey style (`bg-[#F3F4F6] text-[#111827] border border-[#E5E7EB]`). Multi-colored, randomized Material Design style avatars are banned to maintain monochromatic consistency.
*   **Animations:** Uses Framer Motion for page transitions (`container`/`item` stagger effects) and Tailwind keyframes (`animate-in`, `skeleton`).

---

## 5. System Architecture & Database Schema

*   **Monorepo Structure:** Turborepo handles `apps/web` (Next.js) and `apps/api` (Express).
*   **Database (Prisma/PostgreSQL):** Includes 16 heavily normalized tables. Enforces strict Foreign Key constraints and cascading deletes.
*   **RBAC Matrix:**
    *   `SUPER_ADMIN` / `ADMIN`: Full system access.
    *   `PROJECT_MANAGER`: Can create/edit projects and tasks, but cannot manage organizational billing/settings.
    *   `TEAM_MEMBER`: Isolated view. Can only see assigned tasks. Denied access to `/clients` or `/teams`.

---

## 6. Performance & Testing Status

### Performance Details
*   **Vite/Turbopack:** Ensures rapid local HMR (Hot Module Replacement).
*   **Monolithic Speed:** React 19 optimizations make the SPA routing near instantaneous.
*   **Recharts Optimization:** Dashboard charts are lazy-loaded within `ResponsiveContainer`s, preventing main-thread blocking during initial render.

### Deployment & Testing
*   **Testing Coverage:** ✅ **PASS.** Playwright E2E tests (`apps/web/tests`) successfully cover the 6 core flows (Auth, Clients, Projects, Settings, Tasks, Teams). Vitest handles unit tests.
*   **Deployment Status:** ✅ **READY.** Dockerized via `docker-compose.yml` orchestrating Postgres (Port 5433), Redis, API, Web, and an automated backup sidecar. Automated via `.github/workflows/deploy.yml`. Security headers and rate-limiting are fully active.
