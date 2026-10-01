-- Calendar Plan 3: the optional Google Calendar connection.
-- Additive only: two enums, three new tables with their indexes and foreign keys,
-- and organizations.googleCalendarEnabled (default false). Nothing is dropped or altered.

-- CreateEnum
CREATE TYPE "GoogleConnectionStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT');

-- CreateEnum
CREATE TYPE "GooglePushState" AS ENUM ('PENDING_UPSERT', 'PENDING_DELETE', 'SYNCED', 'FAILED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "googleCalendarEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "google_calendar_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "flowzenCalendarId" TEXT,
    "syncToken" TEXT,
    "status" "GoogleConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_busy_blocks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "title" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_busy_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_event_links" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEventId" TEXT,
    "state" "GooglePushState" NOT NULL DEFAULT 'PENDING_UPSERT',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_event_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_userId_key" ON "google_calendar_connections"("userId");

-- CreateIndex
CREATE INDEX "external_busy_blocks_organizationId_startsAt_idx" ON "external_busy_blocks"("organizationId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "external_busy_blocks_userId_googleEventId_key" ON "external_busy_blocks"("userId", "googleEventId");

-- CreateIndex
CREATE INDEX "google_event_links_state_idx" ON "google_event_links"("state");

-- CreateIndex
CREATE UNIQUE INDEX "google_event_links_eventId_userId_key" ON "google_event_links"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_busy_blocks" ADD CONSTRAINT "external_busy_blocks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_busy_blocks" ADD CONSTRAINT "external_busy_blocks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_event_links" ADD CONSTRAINT "google_event_links_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendar_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_event_links" ADD CONSTRAINT "google_event_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

