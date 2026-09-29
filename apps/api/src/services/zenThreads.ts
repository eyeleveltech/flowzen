/**
 * What Zen keeps: the conversation, and what it has learned about how somebody
 * works.
 *
 * Both used to be nothing. The history lived in the browser, went up with every
 * question and died with the tab — so closing the panel lost the thread,
 * including the reasoning behind a task that was half arranged, and the cost of
 * asking grew with how long you had been talking. There was no memory at all.
 *
 * Everything here is scoped to one person. Zen answers as though it is talking
 * to one — it names them, it reads their memory — and a shared thread would
 * mean somebody's half-finished task turning up in another person's panel.
 */

import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';

/** Enough to answer with, not so much that it costs more than the answer. */
const TURNS_SENT_TO_THE_MODEL = 16;

/** A short sentence. Longer than this is a paragraph, and a paragraph is a note. */
const MEMORY_MAX = 200;

/** No more than this per person, oldest dropped — see `remember`. */
const MEMORY_CAP = 40;

export type ThreadTurn = { from: 'you' | 'assistant'; text: string };

/**
 * The thread to answer in: the one named, or a new one.
 *
 * Confined to the caller both ways — an id belonging to somebody else reads as
 * "not found" and starts a fresh thread rather than answering with a 403, which
 * is the same outcome without telling a stranger that the id was real.
 */
export async function openThread(opts: {
  organizationId: string;
  userId: string;
  conversationId?: string | null;
  firstQuestion: string;
}): Promise<{ id: string; turns: ThreadTurn[]; isNew: boolean }> {
  const { organizationId, userId, conversationId, firstQuestion } = opts;

  if (conversationId) {
    const found = await prisma.zenConversation.findFirst({
      where: { id: conversationId, userId, organizationId },
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: TURNS_SENT_TO_THE_MODEL,
          select: { role: true, text: true },
        },
      },
    });
    if (found) {
      return {
        isNew: false,
        id: found.id,
        // Read newest-first for the limit, handed over oldest-first to read as
        // a conversation.
        turns: found.messages
          .reverse()
          .map((m) => ({ from: m.role === 'USER' ? ('you' as const) : ('assistant' as const), text: m.text })),
      };
    }
  }

  const made = await prisma.zenConversation.create({
    data: {
      organizationId,
      userId,
      // The first thing asked, so the list reads as questions rather than as
      // timestamps. Trimmed rather than summarised: a title is for finding the
      // thread again, and the opening words are what somebody remembers.
      title: firstQuestion.length > 70 ? `${firstQuestion.slice(0, 70).trimEnd()}…` : firstQuestion,
    },
    select: { id: true },
  });
  return { id: made.id, turns: [], isNew: true };
}

/**
 * Throw away a thread that never got an answer.
 *
 * The thread has to be opened before the question is asked — its history is
 * what the question is answered WITH — so a failure between the two leaves an
 * empty one in the list. One is clutter; a run of them after a key expires is
 * a list of nothing, which is how somebody concludes the feature is broken.
 *
 * Only a brand new one, and only when it is still empty: a thread that already
 * held a conversation keeps it, whatever went wrong this time.
 */
export async function discardIfUnused(conversationId: string): Promise<void> {
  try {
    const messages = await prisma.zenMessage.count({ where: { conversationId } });
    if (messages === 0) await prisma.zenConversation.delete({ where: { id: conversationId } });
  } catch {
    // Tidying only. It must never turn one failure into two.
  }
}

/** Both halves of one exchange, written after the answer is known. */
export async function recordExchange(opts: {
  conversationId: string;
  question: string;
  answer: string;
  draft?: unknown;
}): Promise<{ assistantMessageId: string }> {
  const { conversationId, question, answer, draft } = opts;
  await prisma.zenMessage.create({ data: { conversationId, role: 'USER', text: question } });
  const assistant = await prisma.zenMessage.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      text: answer,
      // Kept as it was, rather than rebuilt from the prose later: a draft
      // re-derived from a sentence is a draft that can come back different.
      ...(draft ? { draft: draft as never } : {}),
    },
    select: { id: true },
  });
  // Touch the thread so the list sorts by when anything was last said.
  await prisma.zenConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  return { assistantMessageId: assistant.id };
}

/**
 * What Zen has learned about how this person works.
 *
 * Handed to the model as plain sentences. Deliberately not facts about clients
 * or money — those come from the tools, which read the database as it is this
 * second, and a remembered figure goes stale and then contradicts the thing
 * that fetched it.
 */
export async function recall(userId: string): Promise<string[]> {
  const rows = await prisma.zenMemory.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MEMORY_CAP,
    select: { text: true },
  });
  return rows.map((r) => r.text);
}

/**
 * Write one down.
 *
 * Silent on failure and deliberately so: remembering is a side effect of
 * answering, and an answer that already worked should not turn into an error
 * because a note could not be filed.
 */
export async function remember(opts: {
  organizationId: string;
  userId: string;
  text: string;
  sourceId?: string;
}): Promise<void> {
  const text = opts.text.trim().slice(0, MEMORY_MAX);
  if (!text) return;
  try {
    const already = await prisma.zenMemory.findFirst({
      where: { userId: opts.userId, text },
      select: { id: true },
    });
    if (already) return;

    await prisma.zenMemory.create({
      data: {
        organizationId: opts.organizationId,
        userId: opts.userId,
        text,
        sourceId: opts.sourceId ?? null,
      },
    });

    // Oldest out, so the list stays something a person can actually read back.
    const count = await prisma.zenMemory.count({ where: { userId: opts.userId } });
    if (count > MEMORY_CAP) {
      const stale = await prisma.zenMemory.findMany({
        where: { userId: opts.userId },
        orderBy: { createdAt: 'asc' },
        take: count - MEMORY_CAP,
        select: { id: true },
      });
      await prisma.zenMemory.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  } catch (e) {
    logger.error(`Zen could not save a memory for ${opts.userId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Where the person is standing, in words the model can use.
 *
 * The panel sends a small typed context — a route and one or two ids — and
 * never the page's data. Zen then uses its own tools to read whatever it
 * needs, so what it can see stays governed by the tools rather than by
 * whatever the screen happened to be holding.
 */
export type PageContext = {
  route?: string;
  projectId?: string;
  retainerId?: string;
  companyId?: string;
  monthCardId?: string;
  internalProjectId?: string;
};

export async function describeWhereTheyAre(
  ctx: PageContext | undefined,
  organizationId: string,
): Promise<string | null> {
  if (!ctx) return null;
  try {
    if (ctx.projectId) {
      const p = await prisma.project.findFirst({
        where: { id: ctx.projectId, organizationId },
        select: { name: true, isSample: true, company: { select: { name: true } } },
      });
      if (p) {
        return `They are looking at the ${p.isSample ? 'sample work' : 'project'} "${p.name}" for ${p.company.name} (projectId ${ctx.projectId}). "Here", "this project" and "this" mean that one.`;
      }
    }
    if (ctx.retainerId) {
      const r = await prisma.retainer.findFirst({
        where: { id: ctx.retainerId, organizationId },
        select: { company: { select: { name: true } }, monthCards: { orderBy: { month: 'desc' }, take: 1, select: { id: true, month: true } } },
      });
      if (r) {
        const card = r.monthCards[0];
        return `They are looking at ${r.company.name}'s retainer (retainerId ${ctx.retainerId}${card ? `, month ${card.month}, monthCardId ${card.id}` : ''}). "Here" and "this retainer" mean that one.`;
      }
    }
    if (ctx.internalProjectId) {
      const ip = await prisma.internalProject.findFirst({
        where: { id: ctx.internalProjectId, organizationId },
        select: { name: true },
      });
      if (ip) {
        return `They are looking at the internal project "${ip.name}" (internalProjectId ${ctx.internalProjectId}) — the studio's own work, no client. "Here" means that one.`;
      }
    }
    if (ctx.companyId) {
      const c = await prisma.company.findFirst({
        where: { id: ctx.companyId, organizationId },
        select: { name: true, status: true },
      });
      if (c) {
        return `They are looking at the client ${c.name} (companyId ${ctx.companyId}, ${c.status.toLowerCase()}). "They", "this client" and "here" mean ${c.name}.`;
      }
    }
    if (ctx.route) return `They are on the ${ctx.route} screen.`;
  } catch (e) {
    // Context is a convenience. Losing it must never lose the answer.
    logger.error(`Zen could not resolve page context: ${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}
