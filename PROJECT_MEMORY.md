# Flowzen — Project Memory & Architecture Document

This document serves as the comprehensive memory bank for the Flowzen project. It details the system architecture, database schemas, API routes, frontend pages, design system, and technical decisions.

## 1. Project Overview & Vision
**Name**: Flowzen
**Type**: Internal SaaS Agency Project Management Platform
**Philosophy**: "Apple-level simplicity, Linear-level productivity, Notion-level flexibility."
**Goal**: Combine Client Management, Project Management, Task Management, Team Collaboration, and Operational Visibility into a single, highly focused, and premium workspace.

---

## 2. System Architecture
The project is structured as a **Turborepo Monorepo** separating the frontend, backend, and shared configurations.

### Tech Stack
- **Frontend (`apps/web`)**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Framer Motion, Zustand (State), Socket.IO Client, Lucide React (Icons).
- **Backend (`apps/api`)**: Node.js, Express, Socket.IO (Real-time), Prisma ORM, PostgreSQL, JWT Authentication, Zod (Validation).
- **Tooling**: TypeScript across the stack, Turborepo for build orchestration.

### Real-Time Infrastructure
- Instant UI updates are powered by **Socket.IO**.
- Connections are authenticated via JWT tokens passed during the socket handshake.
- Users are joined to two primary rooms upon connection:
  - `org:<organizationId>` for organization-wide broadcasts (e.g., project updates, new tasks).
  - `user:<userId>` for direct notifications (e.g., being assigned a task).

---

## 3. Design System & UI
The design system strictly avoids "cluttered enterprise software aesthetics" in favor of a modern, fast, and premium feel.

- **Typography**: Inter font family (clean, modern sans-serif).
- **Branding**: Custom logo (`logo_flowzen.png`) integrated into the app shell sidebar and auth screens.
- **Colors**:
  - Background: `#FFFFFF` (White)
  - Surface: `#FAFAFA`
  - Border: `#E5E7EB`
  - Primary Text: `#111827`
  - Secondary Text: `#6B7280`
  - Accent: `#000000` (Black)
  - Semantic: `#22C55E` (Success), `#F59E0B` (Warning), `#EF4444` (Danger)
- **Aesthetics**:
  - **Glassmorphism**: Used on the Top Navigation bar and modal overlays.
  - **Borders & Shadows**: Soft borders (`border-[#E5E7EB]`) and subtle hover shadows (`hover:shadow-sm`).
  - **Micro-animations**: Staggered fade-ins, animated layout shifts (Framer Motion), and custom gradient skeleton loaders.
  - **Scrollbars**: Custom ultra-thin styled scrollbars (`::-webkit-scrollbar`).

### AI Development Procedures & Guidelines
When extending or modifying the application, any AI agent or developer MUST follow these rules:
1. **Theme Consistency**: Strictly use the default theme colors (White backgrounds, `#FAFAFA` secondary surfaces, `#E5E7EB` borders, `#111827` primary text). Do not arbitrarily introduce heavy colors, dark modes, or excessive glassmorphism.
2. **Custom UI Components**: NEVER use native HTML `<select>` elements. Always use the custom `@/components/ui/select` and `@/components/ui/multi-select` components for all dropdowns to maintain validation and visual consistency.
3. **Apple-Level Minimalism**: Keep the UI ultra-clean and premium.
   - Avoid clunky data grids, heavy badges, and bulky progress bars. 
   - Use elegant inline text, center-dot separators (`•`), and delicate micro-indicators (e.g., tiny colored dots).
   - Use soft translucent rings (`ring-1 ring-black/[0.04]`) and subtle hover lift effects (`-translate-y-0.5`) with soft shadows instead of thick, harsh borders.
   - **No Emojis**: Never use emojis in the UI. Exclusively use `lucide-react` icons for all visual indicators.

---

## 4. Role-Based Access Control (RBAC)
The system implements a strict Role-Based Access Control matrix enforced on both the UI and backend levels.

1. **`SUPER_ADMIN` & `ADMIN`**:
   - Full unrestricted access to all endpoints, configuration, and data across the organization.
2. **`PROJECT_MANAGER`**:
   - Authorized to access the Dashboard, Projects, Tasks, Teams, Clients, Calendar, and Reports.
   - Can create and edit Projects and Clients.
   - Restricted from accessing Organization Settings (`/settings`).
3. **`TEAM_MEMBER`**:
   - Restricted to operational execution (Dashboard, Projects, Tasks, Calendar, Members).
   - Entirely blocked from accessing Clients, Teams, Reports, and Settings via frontend URL protection and backend middleware.
   - Cannot create, edit, or delete Projects or Clients.
   - Can only create tasks if they are assigned to a project.
   - Can only edit tasks and update task statuses if they are the designated task Assignee.

---

## 5. Database Schema (Prisma)
The PostgreSQL database uses Prisma. *(Note: File upload/attachment capabilities were explicitly removed from the system).*

### Core Entities
1. **Organization**: Root tenant for the SaaS (Name, Settings).
2. **User**: Authentication, Role (`SUPER_ADMIN`, `ADMIN`, `PROJECT_MANAGER`, `TEAM_MEMBER`), Department, and Team association.
3. **Team**: Represents functional groups. Has a designated Leader (`leaderId`) and multiple Members.
4. **Client**: CRM entity. Stores contact info, status, contract value, notes, and activity history.
5. **Project**: Linked to a Client and Owner. Tracks budget, progress, status, priority, milestones, direct members, and assigned Teams.
6. **Task**: Kanban-style tasks. Supports priority, status (`BACKLOG`, `TODO`, `IN_PROGRESS`, `REVIEW`, `BLOCKED`, `COMPLETED`), due dates, parent-child subtasks, and checklists.
7. **ProjectTemplate**: Reusable JSON structures for standardized project creation.
8. **Comment & Note**: Threaded communications for tasks and clients.
9. **Activity**: Global audit log mapping actions to entities for the real-time activity feed.
10. **Notification**: User-specific alerts for assignments and deadlines.

---

## 6. Backend API Routes
All API routes are prefixed with `/api` and require a valid Bearer JWT token. Protected routes execute role authorization via the `authorize` middleware.

### Auth (`/api/auth`)
- `POST /register`: Create a new organization and admin user.
- `POST /login`: Authenticate and receive JWT.
- `GET /me`: Validate token and return current user.

### Dashboard (`/api/dashboard`)
- `GET /stats`: High-level metrics (active projects, tasks due, etc.).
- `GET /health`: Project progress aggregations.
- `GET /activity`: Global recent activity feed.
- `GET /workload`: Team task capacity.

### Clients (`/api/clients`)
- `GET /`, `POST /`: List (with search/filters) and create clients. (POST protected for Admin/Manager).
- `GET /:id`, `PUT /:id`, `DELETE /:id`: Client detail operations. (PUT protected for Admin/Manager).
- `POST /:id/notes`: Add internal notes to a client.

### Projects (`/api/projects`)
- `GET /`: List projects. Automatically filters for `TEAM_MEMBER`s to only return their assigned projects.
- `POST /`: Create project (Protected for Admin/Manager).
- `GET /:id`, `PUT /:id`, `DELETE /:id`: Details and updates (PUT/DELETE protected for Admin/Manager).
- `POST /from-template`: Scaffolds a project from a JSON template.
- `POST /:id/milestones`, `PUT /:id/milestones/:milestoneId`, `DELETE /:id/milestones/:milestoneId`: Add, edit, or delete project milestones.

### Tasks (`/api/tasks`)
- `GET /`, `POST /`: List and create tasks (auto-assigns order for Kanban).
- `GET /:id`, `PUT /:id`, `DELETE /:id`: Update status, assignee, or priority. (Delete protected for creator/assignee).
- `PATCH /reorder`: Bulk update task orders/columns after a drag-and-drop.
- `POST /:id/comments`: Add a comment.

### Teams (`/api/teams`)
- `GET /`, `POST /`: List teams with their members and create new teams (auto-includes leader in members array).
- `PUT /:id`, `DELETE /:id`: Update team details/membership or delete a team.

### Settings & Notifications
- `GET /api/settings/users`: User directory mapping.
- `GET /api/settings/templates`: Fetch organizational project templates.
- `GET /api/notifications`: Fetch user notifications.

---

## 7. Frontend Pages & Structure
The Next.js App Router is used, divided into the `(auth)` and `(dashboard)` route groups.

### Layout & Shell
- `AppShell`: Wraps the authenticated experience. Contains the `Sidebar` (collapsible, spring-animated, conditionally renders links based on user role) and `TopNav` (glassmorphism, global search trigger, notifications dropdown).
- `CommandPalette`: Global `Cmd+K` interface for instantly jumping to Clients, Projects, Tasks, or Team members.
- `Providers`: Context providers for Zustand state and Socket.IO initialization.

### Pages
1. **Dashboard (`/dashboard`)**:
   - 6 gradient-icon Stat Cards.
   - Project Health widget (progress bars).
   - Activity Feed widget.
   - Upcoming Deadlines & Team Workload widget.
2. **Clients (`/clients`)**:
   - List View: Clean table with status badges.
   - Detail View: Tabbed interface (Overview, Projects, Activity, Notes).
3. **Projects (`/projects`)**:
   - Multi-View: Table List, Kanban Board, Timeline (Gantt-style), Calendar (Clean, icon-based timeline showing Project Start Dates, Deadlines, and Milestones without task clutter).
   - Detail View: Tabbed interface (Tasks, Milestones, Team, Activity). Header separates the Project Owner from the unified list of direct members and assigned team members. Modals for project editing conditionally hidden for normal members.
4. **Tasks (`/tasks`)**:
   - Board View: 5-column Kanban board.
   - Slide-over Detail: Clicking a task opens a right-side panel for inline status updates, checklist management, and commenting. Restricted status updating based on role/assignment.
5. **Teams (`/teams`)**:
   - Dedicated Team management grid showing leader, member count, and dynamically colored user avatars.
6. **Reports (`/reports`)**:
   - Tabbed analytics views for Projects, Team performance, and Client metrics.
7. **Calendar (`/calendar`)**:
   - Monthly grid visualizing task due dates across all projects.
8. **Settings (`/settings`)**:
   - Organization details, User management (with Team assignment), Template configuration, and Permissions.

### UX & Form Management
- **Validation**: Custom `Select` and `MultiSelect` components use visually hidden HTML5 `<input required>` fields to trigger native browser validation tooltips.
- **API Errors**: `formError` alerts are absolutely positioned at the top of forms to prevent jarring layout shifts when API submissions fail. Both Login and Registration forms explicitly intercept 400/401/409 errors from Zod/Auth to display these cleanly.
- **Confirmation Dialogs**: Replaces default browser `window.confirm` with a global, promise-based `<ConfirmDialog />` rendered in `providers.tsx` and managed via a Zustand store (`useConfirmStore`), ensuring consistent UI for destructive actions.
- **Avatars**: Across the application (Tags, Headers, Tables), user avatars feature dynamically generated, deterministic background colors based on their name for visual distinction.

---

## 8. State Management
- **Zustand (`stores/index.ts` & `stores/confirm.ts`)**:
  - `useAuthStore`: Persists the JWT token, user object, and handles login/logout logic.
  - `useUIStore`: Manages the state of the collapsible Sidebar and the visibility of the global Command Palette.
  - `useConfirmStore`: Manages the open/close state and promise resolution for the global custom confirmation dialog.
- **Data Fetching**: Handled by custom React hooks and `useEffect` blocks utilizing the `api.ts` wrapper. The `api.ts` wrapper automatically intercepts requests to inject the JWT token and handles 401 Unauthorized redirects.

---

## 9. Deployment & Execution
- **Environment Variables**: Managed via `.env` in the root (symlinked/copied to packages as needed). Contains `DATABASE_URL`, `JWT_SECRET`, and Ports.
- **Bootstrapping**: Run `npm run dev` from the root to leverage Turborepo, simultaneously starting the Next.js frontend (port 3000) and the Express/Socket.IO backend (port 4000).

*(This document represents the final build state as of June 2026. No file upload capabilities are included in this system).*
