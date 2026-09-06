
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RolePreset" AS ENUM ('EMPLOYEE', 'HEAD', 'BD', 'ACCOUNTS', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "CompanyVertical" AS ENUM ('HEALTHCARE', 'REAL_ESTATE', 'D2C', 'SPORTS', 'IT_AND_SAAS', 'RETAIL', 'B2B', 'HOSPITALITY');

-- CreateEnum
CREATE TYPE "CompanySource" AS ENUM ('OUTREACH', 'REFERRAL', 'INBOUND', 'PARTNER_AGENCY', 'NETWORK');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PROSPECT', 'CLIENT', 'PAST');

-- CreateEnum
CREATE TYPE "PersonRole" AS ENUM ('APPROVER', 'PAYER', 'CONTACT');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('NOT_CONTACTED', 'CONTACTED', 'REPLIED', 'DEAD');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('RETAINER', 'PROJECT');

-- CreateEnum
CREATE TYPE "ProposalStage" AS ENUM ('TALKING', 'PROPOSAL_SENT', 'IN_NEGOTIATION', 'PROFORMA_ISSUED', 'VERBAL_YES', 'WON', 'LOST', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProposalOutcome" AS ENUM ('WON', 'LOST', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProformaStatus" AS ENUM ('UNPAID', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProformaSourceType" AS ENUM ('PROPOSAL', 'MONTH_CARD', 'PROJECT');

-- CreateEnum
CREATE TYPE "RetainerStatus" AS ENUM ('ACTIVE', 'STOPPED');

-- CreateEnum
CREATE TYPE "MonthCardStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('LIVE', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'PROFORMA_RAISED', 'INVOICED', 'PAID');

-- CreateEnum
CREATE TYPE "TaskWorkType" AS ENUM ('MONTH_CARD', 'PROJECT', 'INTERNAL');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('DESIGN', 'VIDEO', 'DIGITAL_MARKETING', 'DEVELOPMENT', 'BUSINESS_DEVELOPMENT', 'ACCOUNTS', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WaitingOn" AS ENUM ('CLIENT', 'ANOTHER_PERSON');

-- CreateEnum
CREATE TYPE "CostType" AS ENUM ('DIRECT', 'COMPANY', 'CAPITAL');

-- CreateEnum
CREATE TYPE "CostPaidBy" AS ENUM ('COMPANY', 'AKMAL', 'JAMEEL_N_J_MACSON');

-- CreateEnum
CREATE TYPE "CostTreatment" AS ENUM ('COMPANY_EXPENSE', 'AKMAL_LOAN', 'N_J_MACSON_LOAN');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('RAISED', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('HIGH', 'MED', 'LOW');

-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('LAPTOP', 'DESKTOP', 'MONITOR', 'PHONE', 'STORAGE', 'NETWORK', 'CAMERA_BODY', 'LENS', 'LIGHTING', 'AUDIO', 'GIMBAL_DRONE', 'SUPPORT', 'ACCESSORY', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'BOOKED_OUT', 'IN_REPAIR', 'RETIRED', 'SOLD', 'LOST');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'DAMAGED');

-- CreateEnum
CREATE TYPE "AssetMovementKind" AS ENUM ('CUSTODY', 'BOOKING');

-- CreateEnum
CREATE TYPE "AssetMaintenanceKind" AS ENUM ('SERVICE', 'REPAIR', 'AMC');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "proformaPrefix" TEXT NOT NULL DEFAULT 'EL/PI',
    "financialYearStart" INTEGER NOT NULL DEFAULT 4,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "workingHoursStart" TEXT NOT NULL DEFAULT '10:00',
    "workingHoursEnd" TEXT NOT NULL DEFAULT '19:00',
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "website" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "state" TEXT,
    "gstNumber" TEXT,
    "allowPasswordLogin" BOOLEAN NOT NULL DEFAULT true,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPasswordEncrypted" TEXT,
    "mailFromName" TEXT,
    "mailFromEmail" TEXT,
    "mailReplyTo" TEXT,
    "contactEmail" TEXT,
    "gstStateCode" TEXT DEFAULT '33',
    "bankAccountHolderName" TEXT,
    "bankName" TEXT,
    "bankBranch" TEXT,
    "bankAccountNumber" TEXT,
    "bankIfscCode" TEXT,
    "defaultPaymentTerms" TEXT NOT NULL DEFAULT 'Immediate',
    "defaultProformaValidityDays" INTEGER NOT NULL DEFAULT 30,
    "defaultTermsAndConditions" TEXT[] DEFAULT ARRAY['Monthly retainer fee applicable', 'Ad spend to be borne separately by the client', 'Work execution begins upon confirmation and payment']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assetTagPrefix" TEXT NOT NULL DEFAULT 'EL',

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "dept" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "monthlyCost" DECIMAL(12,2) NOT NULL,
    "preset" "RolePreset" NOT NULL DEFAULT 'EMPLOYEE',
    "permissions" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inviteToken" TEXT,
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiresAt" TIMESTAMP(3),
    "sessionsValidFrom" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" "CompanyVertical" NOT NULL,
    "source" "CompanySource" NOT NULL DEFAULT 'OUTREACH',
    "ownerId" TEXT,
    "city" TEXT NOT NULL,
    "website" TEXT,
    "gstin" TEXT,
    "billingAddress" TEXT,
    "lostReason" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PROSPECT',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL DEFAULT 'CONTACT',
    "email" TEXT,
    "phone" TEXT,
    "linkedin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" "CompanyVertical" NOT NULL,
    "source" "CompanySource" NOT NULL DEFAULT 'OUTREACH',
    "ownerId" TEXT,
    "status" "OutreachStatus" NOT NULL DEFAULT 'NOT_CONTACTED',
    "promotedCompanyId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "stage" "ProposalStage" NOT NULL DEFAULT 'TALKING',
    "outcome" "ProposalOutcome",
    "wonVersionId" TEXT,
    "wonAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "probabilityOverride" INTEGER,
    "verbalYesAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "scopeSummary" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proformas" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" "ProformaSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "milestoneId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "raisedAt" DATE NOT NULL,
    "validTill" DATE NOT NULL,
    "status" "ProformaStatus" NOT NULL DEFAULT 'UNPAID',
    "invoiceId" TEXT,
    "billingName" TEXT NOT NULL,
    "billingContactName" TEXT,
    "billingAddress" TEXT,
    "gstin" TEXT,
    "gstApplicable" BOOLEAN NOT NULL DEFAULT true,
    "gstRatePercent" INTEGER NOT NULL DEFAULT 18,
    "description" TEXT,
    "poNumber" TEXT,
    "poDate" DATE,
    "sacCode" TEXT,
    "terms" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proformas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retainers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "monthlyValue" DECIMAL(12,2) NOT NULL,
    "startDate" DATE NOT NULL,
    "termMonths" INTEGER,
    "renewalDate" DATE,
    "ownerId" TEXT NOT NULL,
    "status" "RetainerStatus" NOT NULL DEFAULT 'ACTIVE',
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "templateId" TEXT,
    "sourceProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_cards" (
    "id" TEXT NOT NULL,
    "retainerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "status" "MonthCardStatus" NOT NULL DEFAULT 'OPEN',
    "invoiceId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "month_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quotedValue" DECIMAL(12,2) NOT NULL,
    "estimatedCost" DECIMAL(12,2),
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'LIVE',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "sourceProposalId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "workType" "TaskWorkType" NOT NULL,
    "workId" TEXT,
    "monthCardId" TEXT,
    "projectId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "assignedById" TEXT,
    "reviewerId" TEXT,
    "taskType" "TaskType",
    "dueDate" DATE NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "waitingOn" "WaitingOn",
    "waitingSince" TIMESTAMP(3),
    "waitingTotalMinutes" INTEGER NOT NULL DEFAULT 0,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "templateItemId" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "CostType" NOT NULL,
    "workType" "TaskWorkType",
    "workId" TEXT,
    "monthCardId" TEXT,
    "projectId" TEXT,
    "category" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurredAt" DATE NOT NULL,
    "committedNotPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidBy" "CostPaidBy" NOT NULL DEFAULT 'COMPANY',
    "treatment" "CostTreatment" NOT NULL DEFAULT 'COMPANY_EXPENSE',
    "enteredById" TEXT NOT NULL,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurringSourceId" TEXT,
    "confirmed" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people_allocations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "workType" "TaskWorkType" NOT NULL,
    "workId" TEXT NOT NULL,
    "monthCardId" TEXT,
    "projectId" TEXT,
    "proposedPercent" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "workType" "TaskWorkType",
    "workId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "raisedAt" DATE NOT NULL,
    "dueAt" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'RAISED',
    "paidAt" DATE,
    "proformaId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedAt" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_reads" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorId" TEXT,
    "verb" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "bookable" BOOLEAN NOT NULL DEFAULT false,
    "costId" TEXT,
    "purchasePrice" DECIMAL(12,2) NOT NULL,
    "purchasedAt" DATE NOT NULL,
    "vendor" TEXT,
    "invoiceNumber" TEXT,
    "usefulLifeMonths" INTEGER NOT NULL,
    "salvageValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "disposedAt" DATE,
    "disposalValue" DECIMAL(12,2),
    "disposalNote" TEXT,
    "warrantyUntil" DATE,
    "insuredUntil" DATE,
    "billUrl" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "currentHolderId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_movements" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "AssetMovementKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "monthCardId" TEXT,
    "purpose" TEXT,
    "outAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "issuedById" TEXT NOT NULL,
    "receivedById" TEXT,
    "conditionOut" "AssetCondition" NOT NULL,
    "conditionIn" "AssetCondition",
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_maintenance" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "kind" "AssetMaintenanceKind" NOT NULL,
    "vendor" TEXT,
    "amount" DECIMAL(12,2),
    "costId" TEXT,
    "sentAt" DATE NOT NULL,
    "returnedAt" DATE,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_maintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");

-- CreateIndex
CREATE INDEX "users_organizationId_active_idx" ON "users"("organizationId", "active");

-- CreateIndex
CREATE INDEX "companies_organizationId_status_idx" ON "companies"("organizationId", "status");

-- CreateIndex
CREATE INDEX "companies_ownerId_idx" ON "companies"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "companies_organizationId_name_key" ON "companies"("organizationId", "name");

-- CreateIndex
CREATE INDEX "people_companyId_active_idx" ON "people"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "outreach_entries_promotedCompanyId_key" ON "outreach_entries"("promotedCompanyId");

-- CreateIndex
CREATE INDEX "outreach_entries_organizationId_status_idx" ON "outreach_entries"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_wonVersionId_key" ON "proposals"("wonVersionId");

-- CreateIndex
CREATE INDEX "proposals_organizationId_stage_idx" ON "proposals"("organizationId", "stage");

-- CreateIndex
CREATE INDEX "proposals_companyId_idx" ON "proposals"("companyId");

-- CreateIndex
CREATE INDEX "proposals_ownerId_idx" ON "proposals"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposalId_n_key" ON "proposal_versions"("proposalId", "n");

-- CreateIndex
CREATE UNIQUE INDEX "proformas_invoiceId_key" ON "proformas"("invoiceId");

-- CreateIndex
CREATE INDEX "proformas_organizationId_status_idx" ON "proformas"("organizationId", "status");

-- CreateIndex
CREATE INDEX "proformas_companyId_idx" ON "proformas"("companyId");

-- CreateIndex
CREATE INDEX "proformas_sourceType_sourceId_idx" ON "proformas"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "proformas_organizationId_number_key" ON "proformas"("organizationId", "number");

-- CreateIndex
CREATE INDEX "retainers_organizationId_status_idx" ON "retainers"("organizationId", "status");

-- CreateIndex
CREATE INDEX "retainers_companyId_idx" ON "retainers"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "month_cards_invoiceId_key" ON "month_cards"("invoiceId");

-- CreateIndex
CREATE INDEX "month_cards_month_status_idx" ON "month_cards"("month", "status");

-- CreateIndex
CREATE UNIQUE INDEX "month_cards_retainerId_month_key" ON "month_cards"("retainerId", "month");

-- CreateIndex
CREATE INDEX "projects_organizationId_status_idx" ON "projects"("organizationId", "status");

-- CreateIndex
CREATE INDEX "projects_companyId_idx" ON "projects"("companyId");

-- CreateIndex
CREATE INDEX "milestones_projectId_order_idx" ON "milestones"("projectId", "order");

-- CreateIndex
CREATE INDEX "task_assignees_userId_idx" ON "task_assignees"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "task_assignees_taskId_userId_key" ON "task_assignees"("taskId", "userId");

-- CreateIndex
CREATE INDEX "tasks_organizationId_assigneeId_status_idx" ON "tasks"("organizationId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "tasks_dueDate_status_idx" ON "tasks"("dueDate", "status");

-- CreateIndex
CREATE INDEX "tasks_monthCardId_idx" ON "tasks"("monthCardId");

-- CreateIndex
CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");

-- CreateIndex
CREATE INDEX "costs_organizationId_type_idx" ON "costs"("organizationId", "type");

-- CreateIndex
CREATE INDEX "costs_monthCardId_idx" ON "costs"("monthCardId");

-- CreateIndex
CREATE INDEX "costs_projectId_idx" ON "costs"("projectId");

-- CreateIndex
CREATE INDEX "costs_incurredAt_idx" ON "costs"("incurredAt");

-- CreateIndex
CREATE INDEX "people_allocations_month_workId_idx" ON "people_allocations"("month", "workId");

-- CreateIndex
CREATE UNIQUE INDEX "people_allocations_userId_month_workId_key" ON "people_allocations"("userId", "month", "workId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_proformaId_key" ON "invoices"("proformaId");

-- CreateIndex
CREATE INDEX "invoices_organizationId_status_idx" ON "invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "invoices_companyId_idx" ON "invoices"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_number_key" ON "invoices"("organizationId", "number");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "alerts_organizationId_resolvedAt_severity_idx" ON "alerts"("organizationId", "resolvedAt", "severity");

-- CreateIndex
CREATE INDEX "alerts_entityType_entityId_idx" ON "alerts"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "alert_reads_userId_idx" ON "alert_reads"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_reads_alertId_userId_key" ON "alert_reads"("alertId", "userId");

-- CreateIndex
CREATE INDEX "activities_organizationId_entityType_entityId_at_idx" ON "activities"("organizationId", "entityType", "entityId", "at");

-- CreateIndex
CREATE INDEX "assets_organizationId_status_idx" ON "assets"("organizationId", "status");

-- CreateIndex
CREATE INDEX "assets_organizationId_category_idx" ON "assets"("organizationId", "category");

-- CreateIndex
CREATE INDEX "assets_currentHolderId_idx" ON "assets"("currentHolderId");

-- CreateIndex
CREATE UNIQUE INDEX "assets_organizationId_tag_key" ON "assets"("organizationId", "tag");

-- CreateIndex
CREATE INDEX "asset_movements_assetId_outAt_idx" ON "asset_movements"("assetId", "outAt");

-- CreateIndex
CREATE INDEX "asset_movements_userId_returnedAt_idx" ON "asset_movements"("userId", "returnedAt");

-- CreateIndex
CREATE INDEX "asset_movements_returnedAt_dueAt_idx" ON "asset_movements"("returnedAt", "dueAt");

-- CreateIndex
CREATE INDEX "asset_maintenance_assetId_sentAt_idx" ON "asset_maintenance"("assetId", "sentAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_entries" ADD CONSTRAINT "outreach_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_entries" ADD CONSTRAINT "outreach_entries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_entries" ADD CONSTRAINT "outreach_entries_promotedCompanyId_fkey" FOREIGN KEY ("promotedCompanyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_wonVersionId_fkey" FOREIGN KEY ("wonVersionId") REFERENCES "proposal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proformas" ADD CONSTRAINT "proformas_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retainers" ADD CONSTRAINT "retainers_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "task_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_cards" ADD CONSTRAINT "month_cards_retainerId_fkey" FOREIGN KEY ("retainerId") REFERENCES "retainers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_cards" ADD CONSTRAINT "month_cards_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_monthCardId_fkey" FOREIGN KEY ("monthCardId") REFERENCES "month_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_monthCardId_fkey" FOREIGN KEY ("monthCardId") REFERENCES "month_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costs" ADD CONSTRAINT "costs_recurringSourceId_fkey" FOREIGN KEY ("recurringSourceId") REFERENCES "costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_allocations" ADD CONSTRAINT "people_allocations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_allocations" ADD CONSTRAINT "people_allocations_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_allocations" ADD CONSTRAINT "people_allocations_monthCardId_fkey" FOREIGN KEY ("monthCardId") REFERENCES "month_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people_allocations" ADD CONSTRAINT "people_allocations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_reads" ADD CONSTRAINT "alert_reads_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_reads" ADD CONSTRAINT "alert_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_costId_fkey" FOREIGN KEY ("costId") REFERENCES "costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_movements" ADD CONSTRAINT "asset_movements_monthCardId_fkey" FOREIGN KEY ("monthCardId") REFERENCES "month_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_costId_fkey" FOREIGN KEY ("costId") REFERENCES "costs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_maintenance" ADD CONSTRAINT "asset_maintenance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

