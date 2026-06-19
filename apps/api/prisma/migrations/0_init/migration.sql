-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."ActivityEntityType" AS ENUM ('CLIENT', 'PROJECT', 'TASK', 'TEAM', 'ORGANIZATION', 'LEAD');

-- CreateEnum
CREATE TYPE "public"."ClientStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'ONHOLD', 'CHURNED');

-- CreateEnum
CREATE TYPE "public"."ContractType" AS ENUM ('RETAINER', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "public"."HealthStatus" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "public"."LeadSource" AS ENUM ('EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."LeadStage" AS ENUM ('LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY', 'AUDIT', 'PRESENTATION', 'PROPOSAL', 'NEGOTIATION', 'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'WON_CLOSED', 'LOST_CLOSED');

-- CreateEnum
CREATE TYPE "public"."LostReason" AS ENUM ('BUDGET', 'COMPETITOR', 'NO_BUDGET', 'TIMING', 'UNRESPONSIVE', 'SCOPE_MISMATCH', 'INTERNAL_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."NoteType" AS ENUM ('INTERNAL', 'MEETING');

-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_COMPLETED', 'DEADLINE_APPROACHING', 'COMMENT_ADDED', 'PROJECT_STATUS_CHANGED', 'CLIENT_ADDED', 'MENTION');

-- CreateEnum
CREATE TYPE "public"."ProjectPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('PLANNING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED', 'ON_HOLD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."ProjectType" AS ENUM ('RETAINER', 'ONE_TIME', 'EVENT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "public"."ReportingCadence" AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'NONE');

-- CreateEnum
CREATE TYPE "public"."TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'BLOCKED', 'COMPLETED', 'APPROVED');

-- CreateEnum
CREATE TYPE "public"."TaskType" AS ENUM ('DESIGN', 'CONTENT', 'VIDEO', 'DIGITAL_MARKETING', 'DEVELOPMENT', 'STRATEGY', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."WorkflowAction" AS ENUM ('NOTIFY', 'EMAIL', 'NOTIFY_AND_EMAIL', 'CHANGE_TASK_STATUS', 'REASSIGN_TASK');

-- CreateEnum
CREATE TYPE "public"."WorkflowTrigger" AS ENUM ('TASK_STATUS_CHANGE', 'TASK_ASSIGNED', 'TASK_DEADLINE_APPROACHING', 'TASK_OVERDUE', 'TASK_CREATED', 'PROJECT_STATUS_CHANGE');

-- CreateTable
CREATE TABLE "public"."activities" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" "public"."ActivityEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leadId" TEXT,
    "direction" TEXT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."checklist_items" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."client_contacts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "industry" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "contractValue" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "status" "public"."ClientStatus" NOT NULL DEFAULT 'PROSPECT',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountManagerId" TEXT,
    "assetLinks" TEXT,
    "city" TEXT,
    "engagementType" TEXT,
    "scope" TEXT,
    "website" TEXT,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."comments" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "taskId" TEXT,
    "authorId" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."deal_fields" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldValue" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leads" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "public"."LeadSource" NOT NULL DEFAULT 'MANUAL',
    "stage" "public"."LeadStage" NOT NULL DEFAULT 'LEAD',
    "assignedToId" TEXT,
    "dealValue" DOUBLE PRECISION,
    "expectedCloseDate" TIMESTAMP(3),
    "contractType" "public"."ContractType",
    "healthStatus" "public"."HealthStatus",
    "lostReason" "public"."LostReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."milestones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notes" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "public"."NoteType" NOT NULL DEFAULT 'INTERNAL',
    "clientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "website" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "address" TEXT,
    "companySize" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "phone" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_teams" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "structure" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" "public"."ProjectType" NOT NULL DEFAULT 'RETAINER',

    CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "priority" "public"."ProjectPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "budget" DOUBLE PRECISION,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "clientId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clientApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "folderLink" TEXT,
    "projectNotes" TEXT,
    "reportingCadence" "public"."ReportingCadence" NOT NULL DEFAULT 'NONE',
    "scope" TEXT,
    "tags" TEXT[],
    "type" "public"."ProjectType" NOT NULL DEFAULT 'ONE_TIME',

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."stage_history" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" "public"."LeadStage" NOT NULL,
    "toStage" "public"."LeadStage" NOT NULL,
    "notes" TEXT,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "public"."TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'BACKLOG',
    "dueDate" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "projectId" TEXT,
    "assigneeId" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "driveLink" TEXT,
    "estimatedHours" DOUBLE PRECISION DEFAULT 0,
    "loggedHours" DOUBLE PRECISION DEFAULT 0,
    "readAt" TIMESTAMP(3),
    "reviewerId" TEXT,
    "type" "public"."TaskType" NOT NULL DEFAULT 'OTHER',
    "assignedDate" TIMESTAMP(3),
    "clientId" TEXT,
    "leadId" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "leaderId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "role" "public"."UserRole" NOT NULL DEFAULT 'TEAM_MEMBER',
    "department" TEXT,
    "phone" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'PENDING',
    "designation" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."workflow_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "public"."WorkflowTrigger" NOT NULL,
    "condition" JSONB NOT NULL DEFAULT '{}',
    "action" "public"."WorkflowAction" NOT NULL DEFAULT 'NOTIFY',
    "targets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "organizationId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_entityType_entityId_idx" ON "public"."activities"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "api_keys_key_idx" ON "public"."api_keys"("key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "public"."api_keys"("key" ASC);

-- CreateIndex
CREATE INDEX "clients_organizationId_idx" ON "public"."clients"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "clients_organizationId_status_idx" ON "public"."clients"("organizationId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "deal_fields_leadId_fieldKey_key" ON "public"."deal_fields"("leadId" ASC, "fieldKey" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "leads_clientId_key" ON "public"."leads"("clientId" ASC);

-- CreateIndex
CREATE INDEX "leads_organizationId_idx" ON "public"."leads"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "leads_organizationId_stage_idx" ON "public"."leads"("organizationId" ASC, "stage" ASC);

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "public"."notifications"("userId" ASC, "read" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "public"."project_members"("projectId" ASC, "userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "project_teams_projectId_teamId_key" ON "public"."project_teams"("projectId" ASC, "teamId" ASC);

-- CreateIndex
CREATE INDEX "projects_clientId_status_idx" ON "public"."projects"("clientId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "projects_ownerId_status_idx" ON "public"."projects"("ownerId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "stage_history_leadId_idx" ON "public"."stage_history"("leadId" ASC);

-- CreateIndex
CREATE INDEX "tasks_assigneeId_status_idx" ON "public"."tasks"("assigneeId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "tasks_projectId_status_assigneeId_idx" ON "public"."tasks"("projectId" ASC, "status" ASC, "assigneeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "teams_leaderId_key" ON "public"."teams"("leaderId" ASC);

-- CreateIndex
CREATE INDEX "teams_organizationId_idx" ON "public"."teams"("organizationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email" ASC);

-- CreateIndex
CREATE INDEX "users_organizationId_idx" ON "public"."users"("organizationId" ASC);

-- CreateIndex
CREATE INDEX "users_organizationId_status_idx" ON "public"."users"("organizationId" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "public"."users"("resetToken" ASC);

-- CreateIndex
CREATE INDEX "workflow_rules_organizationId_isActive_idx" ON "public"."workflow_rules"("organizationId" ASC, "isActive" ASC);

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."checklist_items" ADD CONSTRAINT "checklist_items_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."client_contacts" ADD CONSTRAINT "client_contacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_accountManagerId_fkey" FOREIGN KEY ("accountManagerId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comments" ADD CONSTRAINT "comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comments" ADD CONSTRAINT "comments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."comments" ADD CONSTRAINT "comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."deal_fields" ADD CONSTRAINT "deal_fields_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notes" ADD CONSTRAINT "notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notes" ADD CONSTRAINT "notes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_teams" ADD CONSTRAINT "project_teams_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_teams" ADD CONSTRAINT "project_teams_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."projects" ADD CONSTRAINT "projects_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."project_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stage_history" ADD CONSTRAINT "stage_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."stage_history" ADD CONSTRAINT "stage_history_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."teams" ADD CONSTRAINT "teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."workflow_rules" ADD CONSTRAINT "workflow_rules_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

