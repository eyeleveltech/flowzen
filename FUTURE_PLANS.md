# Future Development Plans

This document tracks planned features, architectural changes, and future improvements for the application.

---

## Feature: Transfer Ownership (Super Admin)

### Problem Statement
Currently, the system enforces a strict security rule: a `SUPER_ADMIN` cannot be demoted, and an `ADMIN` cannot be directly promoted to `SUPER_ADMIN` from the general team directory. This prevents accidental lockouts where an organization loses its only Super Admin. However, we need a secure way to transfer ownership of the organization to another administrator.

### Proposed Workflow
To enable this securely, we will build a dedicated "Transfer Ownership" feature rather than allowing role changes through standard dropdowns.

#### 1. User Interface
- **Location:** Add a dedicated "Transfer Ownership" button in a "Security" or "Organization Settings" tab, only visible to the current `SUPER_ADMIN`.
- **Transfer Modal:** A specific interface where the Super Admin can select an existing `ADMIN` from a dropdown to receive ownership.
- **Confirmation Check:** A strict confirmation modal requiring the user to type a confirmation phrase (e.g., "TRANSFER"). It must explicitly warn them: *"You will immediately lose Super Admin privileges and become a regular Admin. This action cannot be undone."*

#### 2. Backend Implementation
- **New API Endpoint:** `POST /api/settings/transfer-ownership`
- **Security Check:** Verify the requestor is the current `SUPER_ADMIN`.
- **Validation:** Verify the target user exists, belongs to the same organization, and is currently an `ADMIN`.
- **Database Transaction:** Execute a Prisma transaction (`prisma.$transaction`) to perform exactly two operations simultaneously:
  1. Promote the target user: `update { role: 'SUPER_ADMIN' }`
  2. Demote the current user: `update { role: 'ADMIN' }`
  This atomic transaction guarantees the organization always has exactly one Super Admin.

#### 3. Client State Updates
- Upon successful transfer, the frontend will force a session refresh or redirect the user, immediately downgrading their local UI permissions to `ADMIN`.

---

## Feature: Silent Session Refresh (Dynamic Role Updates)

### Problem Statement
Currently, a user's role and permissions are stored locally in the browser (`localStorage`) at the exact moment they log in. If an Admin promotes or demotes a user, the target user will not see their new permissions until they log out and log back in, which can cause confusion.

### Proposed Workflow
To ensure role changes are immediately picked up without forcing a re-login, we will implement a background silent refresh mechanism.

#### Implementation Details
- **Dashboard Layout Hook:** Add a `useEffect` inside `apps/web/src/app/(dashboard)/layout.tsx` that triggers once on mount (e.g., when the user opens the app or refreshes the page).
- **Silent Fetch:** This hook will silently make a background `GET` request to `/api/profile`.
- **State Update:** When the response returns, update the `useAuthStore` with the latest user object. This instantly propagates any role or permission changes (e.g., `TEAM_MEMBER` -> `PROJECT_MANAGER`) throughout the UI seamlessly.

---

## Feature: Advanced Team Workload Calculation

### Problem Statement
Currently, the system calculates team capacity using a simple task count ratio (Active Tasks / 10 * 100). While functional as a baseline, it assumes all tasks require equal effort, treating a 5-minute update the same as a 2-week deliverable. To accurately track and manage team burnout and availability, we need a more granular approach.

### Proposed Solutions (To Be Evaluated)

#### Option 1: Estimated Hours (Most Accurate)
- Add an `estimatedHours` integer field to the Task model.
- **Calculation:** Sum the total `estimatedHours` of tasks due within the current week for a user.
- **Capacity Formula:** `(Total Estimated Hours / 40) * 100` (assuming a standard 40-hour work week).
- **Pros:** Extremely accurate; industry standard for agency billing and allocation.

#### Option 2: Complexity Points / Story Points (Agile Method)
- Add a `complexity` or `storyPoints` field to the Task model (e.g., Fibonacci values 1, 2, 3, 5, 8).
- **Calculation:** Sum the complexity points assigned to active tasks.
- **Capacity Formula:** `(Total Points / Max Points Threshold) * 100` (where max threshold is a configurable sprint/week limit, e.g., 20 points).
- **Pros:** Quicker for managers to estimate than exact hours, fits naturally into agile workflows.

#### Option 3: Priority Weighting (Fastest Implementation)
- Repurpose the existing `priority` field to assign a mathematical weight to tasks (e.g., Low = 1, Medium = 2, High = 3, Urgent = 5).
- **Calculation:** Sum the weighted values of all active tasks.
- **Capacity Formula:** `(Total Weight / Max Weight Threshold) * 100`.
- **Pros:** Requires zero schema changes or new UI inputs; instantly provides a more realistic workload metric than a flat count.
