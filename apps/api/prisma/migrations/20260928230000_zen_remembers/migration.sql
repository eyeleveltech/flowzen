-- Zen keeps the conversation, and what it learns about how somebody works.
--
-- The history lived in the browser. It was sent up with every question and it
-- died with the tab, so closing the panel lost the thread — including the
-- reasoning behind a task that was half arranged — and the cost of each
-- question grew with how long the conversation had been going, because the
-- whole of it went up again every time.
--
-- Memory is deliberately narrow: preferences and corrections, one short
-- sentence each, readable and deletable by the person they are about. Not
-- facts about clients or money. Those come from the tools, which read the
-- database as it is this second; a remembered figure goes stale and then
-- contradicts the thing that fetched it.
--
-- Additive: three new tables and one enum. Nothing existing is touched.

CREATE TYPE "ZenRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "zen_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zen_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zen_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ZenRole" NOT NULL,
    "text" TEXT NOT NULL,
    "draft" JSONB,
    "actedAt" TIMESTAMP(3),
    "createdTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zen_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zen_memories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "zen_memories_pkey" PRIMARY KEY ("id")
);

-- The list sorts by when anything was last said, not by when the thread began.
CREATE INDEX "zen_conversations_userId_updatedAt_idx" ON "zen_conversations"("userId", "updatedAt");
CREATE INDEX "zen_messages_conversationId_createdAt_idx" ON "zen_messages"("conversationId", "createdAt");
CREATE INDEX "zen_memories_userId_createdAt_idx" ON "zen_memories"("userId", "createdAt");

ALTER TABLE "zen_conversations" ADD CONSTRAINT "zen_conversations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zen_conversations" ADD CONSTRAINT "zen_conversations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zen_messages" ADD CONSTRAINT "zen_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "zen_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zen_memories" ADD CONSTRAINT "zen_memories_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "zen_memories" ADD CONSTRAINT "zen_memories_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
