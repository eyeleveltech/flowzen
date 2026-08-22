-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES', 'MEMBER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'ONHOLD', 'PROJECT_COMPLETED', 'CHURNED');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('DECISION_MAKER', 'CHAMPION', 'INFLUENCER', 'GATEKEEPER');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('RETAINER', 'PROJECT');

-- CreateEnum
CREATE TYPE "CustomEntity" AS ENUM ('DEAL', 'COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'LINK');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SentVia" AS ENUM ('FLOWZEN_EMAIL', 'MANUAL_EMAIL', 'WHATSAPP', 'IN_PERSON', 'OTHER');

-- CreateEnum
CREATE TYPE "AcceptedVia" AS ENUM ('EMAIL', 'CALL', 'WHATSAPP', 'IN_PERSON', 'SIGNED_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('ADVANCE_100', 'SPLIT_50_50', 'MONTHLY', 'MILESTONE');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'PROFORMA');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('VENDOR', 'TRAVEL', 'EQUIPMENT', 'MARKETING', 'MISC');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('NOTE', 'CALL', 'MEETING', 'EMAIL', 'WHATSAPP', 'STAGE_CHANGE', 'STATUS_CHANGE', 'QUOTE_SENT', 'QUOTE_ACCEPTED', 'QUOTE_DECLINED', 'INVOICE_SENT', 'PAYMENT_RECEIVED', 'TASK', 'SYSTEM');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "companySize" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "description" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "dateFormat" TEXT NOT NULL DEFAULT 'dd MMM yyyy',
    "fiscalYearStart" INTEGER NOT NULL DEFAULT 4,
    "documentPrefix" TEXT NOT NULL DEFAULT 'FZ',
    "state" TEXT,
    "gstNumber" TEXT,
    "mailFromName" TEXT,
    "mailFromEmail" TEXT,
    "mailReplyTo" TEXT,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "googleWorkspaceDomain" TEXT,
    "allowPasswordLogin" BOOLEAN NOT NULL DEFAULT true,
    "autoProvisionUsers" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_modules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "password" TEXT,
    "googleId" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'PASSWORD',
    "designation" TEXT,
    "phone" TEXT,
    "joiningDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "inviteToken" TEXT,
    "inviteExpiry" TIMESTAMP(3),
    "invitedById" TEXT,
    "lastActivityReadAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "country" TEXT,
    "billingAddress" TEXT,
    "gstNumber" TEXT,
    "companySize" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'PROSPECT',
    "ownerId" TEXT,
    "sourceId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "role" "ContactRole",
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'OPEN',
    "probability" DECIMAL(4,3) NOT NULL DEFAULT 0,
    "rottingDays" INTEGER,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reasons" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dealNumber" TEXT,
    "title" TEXT,
    "stageId" TEXT NOT NULL,
    "value" DECIMAL(12,2),
    "expectedCloseDate" TIMESTAMP(3),
    "ownerId" TEXT,
    "sourceId" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "contractType" "ContractType",
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "heldSince" TIMESTAMP(3),
    "holdReason" TEXT,
    "blockedOn" TEXT,
    "nextStepDate" TIMESTAMP(3),
    "lostReasonId" TEXT,
    "lostAt" TIMESTAMP(3),
    "wonAt" TIMESTAMP(3),
    "followUpDate" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_history" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "movedById" TEXT,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entity" "CustomEntity" NOT NULL DEFAULT 'DEAL',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" JSONB,
    "helpText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_fields" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stage_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "dealId" TEXT,
    "companyId" TEXT,
    "contactId" TEXT,
    "valueText" TEXT,
    "valueNumber" DECIMAL(14,4),
    "valueDate" TIMESTAMP(3),
    "valueBool" BOOLEAN,
    "valueOptions" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "engagementType" "ContractType" NOT NULL,
    "billingFrequency" "BillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "paymentTerms" "PaymentTerms",
    "lineItems" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "cgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "pdfKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentVia" "SentVia",
    "sentById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedVia" "AcceptedVia",
    "acceptedNote" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultRate" DECIMAL(12,2),
    "unit" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dealId" TEXT,
    "type" "ContractType" NOT NULL,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "billingFrequency" "BillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "paymentTerms" "PaymentTerms",
    "taxIncluded" BOOLEAN NOT NULL DEFAULT false,
    "cgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advanceAmount" DECIMAL(12,2),
    "advanceReceived" BOOLEAN NOT NULL DEFAULT false,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "reviewIntervalMonths" INTEGER DEFAULT 6,
    "nextReviewDate" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_revisions" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "billingFrequency" "BillingFrequency" NOT NULL,
    "status" "EngagementStatus" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "startDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "dealId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "reviewerId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "parentTaskId" TEXT,
    "recurrence" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "engagementId" TEXT,
    "quoteId" TEXT,
    "number" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'INVOICE',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "lineItems" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "cgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "pdfKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidOn" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT,
    "projectId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'MISC',
    "description" TEXT,
    "vendor" TEXT,
    "isBillable" BOOLEAN NOT NULL DEFAULT false,
    "receiptKey" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "message" TEXT NOT NULL,
    "body" TEXT,
    "direction" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "projectId" TEXT,
    "taskId" TEXT,
    "engagementId" TEXT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_modules_organizationId_idx" ON "organization_modules"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_modules_organizationId_key_key" ON "organization_modules"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "users_resetToken_key" ON "users"("resetToken");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteToken_key" ON "users"("inviteToken");

-- CreateIndex
CREATE INDEX "users_organizationId_status_idx" ON "users"("organizationId", "status");

-- CreateIndex
CREATE INDEX "user_roles_organizationId_role_idx" ON "user_roles"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_role_key" ON "user_roles"("userId", "role");

-- CreateIndex
CREATE INDEX "companies_organizationId_status_idx" ON "companies"("organizationId", "status");

-- CreateIndex
CREATE INDEX "companies_organizationId_name_idx" ON "companies"("organizationId", "name");

-- CreateIndex
CREATE INDEX "companies_ownerId_idx" ON "companies"("ownerId");

-- CreateIndex
CREATE INDEX "contacts_companyId_idx" ON "contacts"("companyId");

-- CreateIndex
CREATE INDEX "pipelines_organizationId_idx" ON "pipelines"("organizationId");

-- CreateIndex
CREATE INDEX "stages_pipelineId_idx" ON "stages"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_pipelineId_position_key" ON "stages"("pipelineId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "lost_reasons_organizationId_name_key" ON "lost_reasons"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_organizationId_name_key" ON "lead_sources"("organizationId", "name");

-- CreateIndex
CREATE INDEX "deals_organizationId_stageId_idx" ON "deals"("organizationId", "stageId");

-- CreateIndex
CREATE INDEX "deals_companyId_idx" ON "deals"("companyId");

-- CreateIndex
CREATE INDEX "deals_ownerId_idx" ON "deals"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "deals_organizationId_dealNumber_key" ON "deals"("organizationId", "dealNumber");

-- CreateIndex
CREATE INDEX "stage_history_dealId_enteredAt_idx" ON "stage_history"("dealId", "enteredAt");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_organizationId_entity_key_key" ON "custom_fields"("organizationId", "entity", "key");

-- CreateIndex
CREATE UNIQUE INDEX "stage_fields_stageId_fieldId_key" ON "stage_fields"("stageId", "fieldId");

-- CreateIndex
CREATE INDEX "custom_field_values_fieldId_idx" ON "custom_field_values"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_fieldId_dealId_key" ON "custom_field_values"("fieldId", "dealId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_fieldId_companyId_key" ON "custom_field_values"("fieldId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_fieldId_contactId_key" ON "custom_field_values"("fieldId", "contactId");

-- CreateIndex
CREATE INDEX "quotes_dealId_idx" ON "quotes"("dealId");

-- CreateIndex
CREATE INDEX "quotes_companyId_idx" ON "quotes"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_organizationId_number_key" ON "quotes"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "services_organizationId_name_key" ON "services"("organizationId", "name");

-- CreateIndex
CREATE INDEX "engagements_organizationId_status_idx" ON "engagements"("organizationId", "status");

-- CreateIndex
CREATE INDEX "engagements_companyId_idx" ON "engagements"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "engagements_dealId_key" ON "engagements"("dealId");

-- CreateIndex
CREATE INDEX "engagement_revisions_engagementId_effectiveFrom_idx" ON "engagement_revisions"("engagementId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "projects_organizationId_status_idx" ON "projects"("organizationId", "status");

-- CreateIndex
CREATE INDEX "projects_companyId_idx" ON "projects"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_projectId_userId_key" ON "project_members"("projectId", "userId");

-- CreateIndex
CREATE INDEX "tasks_projectId_status_idx" ON "tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "tasks_assigneeId_dueDate_idx" ON "tasks"("assigneeId", "dueDate");

-- CreateIndex
CREATE INDEX "tasks_dealId_idx" ON "tasks"("dealId");

-- CreateIndex
CREATE INDEX "invoices_organizationId_status_idx" ON "invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "invoices_companyId_idx" ON "invoices"("companyId");

-- CreateIndex
CREATE INDEX "invoices_engagementId_idx" ON "invoices"("engagementId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_number_key" ON "invoices"("organizationId", "number");

-- CreateIndex
CREATE INDEX "payments_organizationId_paidOn_idx" ON "payments"("organizationId", "paidOn");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "expenses_organizationId_date_idx" ON "expenses"("organizationId", "date");

-- CreateIndex
CREATE INDEX "expenses_companyId_idx" ON "expenses"("companyId");

-- CreateIndex
CREATE INDEX "activities_dealId_occurredAt_idx" ON "activities"("dealId", "occurredAt");

-- CreateIndex
CREATE INDEX "activities_companyId_occurredAt_idx" ON "activities"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "activities_projectId_occurredAt_idx" ON "activities"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "organization_modules" ADD CONSTRAINT "organization_modules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companies" ADD CONSTRAINT "companies_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reasons" ADD CONSTRAINT "lost_reasons_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_lostReasonId_fkey" FOREIGN KEY ("lostReasonId") REFERENCES "lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_fields" ADD CONSTRAINT "stage_fields_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_fields" ADD CONSTRAINT "stage_fields_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "custom_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_revisions" ADD CONSTRAINT "engagement_revisions_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "engagements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ══════════════════════════════════════════════════════════════════════════════
-- RULES PRISMA CANNOT EXPRESS
--
-- Each of these is stated in docs/FLOWZEN-MASTER-PLAN.md. Without them here they
-- are conventions the application can violate by accident, which is not a rule.
-- ══════════════════════════════════════════════════════════════════════════════

-- A task belongs to exactly ONE of a project (delivery) or a deal (pre-sales).
-- Never both, never neither.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_one_parent"
  CHECK (("projectId" IS NULL) <> ("dealId" IS NULL));

-- A custom field value hangs off exactly one record.
ALTER TABLE "custom_field_values"
  ADD CONSTRAINT "custom_field_values_one_owner"
  CHECK (
    (("dealId" IS NOT NULL)::int + ("companyId" IS NOT NULL)::int + ("contactId" IS NOT NULL)::int) = 1
  );

-- At most ONE accepted quote per deal. Accepting version three declines versions
-- one and two, or a deal carries two live prices and the engagement can be built
-- from the wrong one.
CREATE UNIQUE INDEX "quotes_one_accepted_per_deal"
  ON "quotes" ("dealId")
  WHERE "status" = 'ACCEPTED';

-- Exactly one WON and one LOST stage per pipeline. Two of either, and no rule can
-- decide which one creates the engagement.
CREATE UNIQUE INDEX "stages_one_won_per_pipeline"
  ON "stages" ("pipelineId")
  WHERE "kind" = 'WON' AND "archivedAt" IS NULL;

CREATE UNIQUE INDEX "stages_one_lost_per_pipeline"
  ON "stages" ("pipelineId")
  WHERE "kind" = 'LOST' AND "archivedAt" IS NULL;

-- Exactly one PRIMARY contact per company. Prisma cannot express a partial unique
-- index, which is why this lived only in the service layer before.
CREATE UNIQUE INDEX "contacts_one_primary_per_company"
  ON "contacts" ("companyId")
  WHERE "isPrimary" = true;

-- Money is never negative. An invoice or payment that is, is a data-entry error
-- that would otherwise quietly corrupt every total downstream of it.
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_total_non_negative" CHECK ("total" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive"   CHECK ("amount" > 0);
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_amount_non_negative" CHECK ("amount" >= 0);

-- An engagement cannot end before it starts.
ALTER TABLE "engagements"
  ADD CONSTRAINT "engagements_end_after_start"
  CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
