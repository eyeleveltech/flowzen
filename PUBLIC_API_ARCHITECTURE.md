# Flowzen Public API Architecture & Data Safety Document

This document outlines the architectural strategy and strict data safety protocols for exposing a Public API (`/api/v1`) in Flowzen. This API will allow external AI agents and third-party integrations (e.g., Odoo, Zapier) to securely interact with the platform.

## 1. Core Architecture Strategy
To ensure the internal web application remains isolated and secure, the public API will use **API Keys** for authentication instead of session cookies.

- **Internal API (`/api/*`)**: Relies on secure, browser-based HTTP-only session cookies. Optimized for the Flowzen React frontend.
- **External API (`/api/v1/*`)**: Relies on a persistent, scoped `Authorization: Bearer <API_KEY>` header. Optimized for headless, programmatic access by AI or external tools.

## 2. Data Safety Breakdown (Strict Permissions)

When exposing data to an AI, it is critical to enforce the principle of **Least Privilege**. The API layer will hard-code these restrictions, ensuring that even if an AI attempts a destructive action, the server will block it.

### Allowed Actions (What the AI CAN do)
The AI is given functional access to assist with day-to-day operations:
- **Projects**: `GET` (Read project lists and details), `POST` (Create new projects).
- **Tasks**: `GET` (Read task lists), `POST` (Create new tasks), `PUT` (Update task status or assignments).
- **CRM Leads**: `GET` (Read lead details), `POST` (Add a new lead), `POST` (Add an activity note to a timeline).
- **Clients**: `GET` (Read client directory).

### Blocked Actions (What the AI CANNOT do)
The AI is strictly blocked from structural, destructive, or administrative actions:
- **Destructive Deletion**: The API will reject all `DELETE` HTTP requests for Organizations, Users, Projects, and Clients. Data cannot be wiped via the API.

- **User & Admin Management**: The API cannot create new user accounts, invite team members, alter existing user roles (e.g., promoting someone to Admin), or change passwords.

## 3. Implementation Blueprint

### A. Database Modifications (Prisma)
We will introduce an `ApiKey` table linked to the `Organization` to track and scope access:
```prisma
model ApiKey {
  id             String       @id @default(cuid())
  key            String       @unique
  name           String       // E.g., "Odoo Sync Agent"
  userId         String       // The user who generated the key
  organizationId String       // Scope of the key (restricts data access)
  lastUsedAt     DateTime?
  createdAt      DateTime     @default(now())

  user         User         @relation(fields: [userId], references: [id])
  organization Organization @relation(fields: [organizationId], references: [id])
}
```

### B. Dedicated Routing & Middleware
- A new middleware (`apiKeyAuth.ts`) will intercept requests to `/api/v1/*`.
- It will validate the provided API key against the database.
- It will inject the bounded `organizationId` into the request, guaranteeing the AI can only ever read or write data belonging to that specific organization.

### C. OpenAPI / Swagger Specification
Once the routes are built, an `openapi.yaml` file will be generated. This file acts as the explicit instruction manual for the AI. You simply provide this file to OpenAI (or your chosen AI agent), and it will instantly understand the precise JSON shapes required to interact with Flowzen.
