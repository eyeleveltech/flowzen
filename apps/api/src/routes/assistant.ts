import { Router, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireManagement, type AuthRequest } from '../middleware/auth.js';
import {
  askMoneyAssistant,
  streamMoneyAssistant,
  listAvailableModels,
  AssistantNotConfigured,
  AssistantFailed,
} from '../services/moneyAssistant.js';
import { providerChoices } from '../services/ai/index.js';
import { openThread, recordExchange, discardIfUnused } from '../services/zenThreads.js';
import { prisma } from '../lib/prisma.js';

/**
 * Asking about the business.
 *
 * MANAGEMENT only, and that is a preset check rather than a permission one on
 * purpose. The assistant is handed figures from across the whole business —
 * margins by client, the pipeline, what is overdue, who is carrying what — so
 * whoever can ask it can read all of that in one answer. No single permission
 * switch means "may see everything at once": `money.figures` comes closest and
 * ACCOUNTS holds it, which would put the accounts desk through a door meant
 * for the people running the studio.
 */
export const assistantRouter = Router();

assistantRouter.use(authenticate);

const askSchema = z.object({
  question: z.string().trim().min(1, 'Ask something').max(1000, 'That question is too long'),
  /*
   * What has been said so far, from the browser.
   *
   * Validated and capped rather than trusted: it is re-sent with every
   * question, so an uncapped history grows the cost of each ask without bound,
   * and nothing stops a client sending whatever it likes. The service trims to
   * the last eight turns again on its own side.
   */
  history: z
    .array(
      z.object({
        from: z.enum(['you', 'assistant']),
        text: z.string().max(4000),
      }),
    )
    .max(40)
    .optional(),
  /** Which month to answer about. Defaults to the current one. */
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month should look like 2026-09')
    .optional(),
  /**
   * The thread this belongs to. Omitted starts a new one.
   *
   * The history above is now only a fallback for a client that has not been
   * updated; when a thread id arrives, the server reads the conversation from
   * its own table instead — which is both cheaper and the only version that
   * survives closing the panel.
   */
  conversationId: z.string().min(1).optional(),
  /**
   * The screen they asked from.
   *
   * Ids and a route, never the page's data. Zen resolves them with its own
   * tools, so what it can see stays governed by the tools rather than by
   * whatever the browser happened to be holding — which also means a page
   * cannot hand it something the asker was not allowed to read.
   */
  page: z
    .object({
      path: z.string().max(200).optional(),
      search: z.string().max(500).optional(),
      route: z.string().max(200).optional(),
      projectId: z.string().max(40).optional(),
      retainerProjectId: z.string().max(40).optional(),
      assetId: z.string().max(40).optional(),
      retainerId: z.string().max(40).optional(),
      companyId: z.string().max(40).optional(),
      monthCardId: z.string().max(40).optional(),
      internalProjectId: z.string().max(40).optional(),
    })
    .optional(),
});

assistantRouter.post('/ask', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  /** Set once a thread is created, so a failure below can take it away again. */
  let opened: string | null = null;
  try {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const now = new Date();
    const month =
      parsed.data.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    /*
     * The thread, opened before the question is asked.
     *
     * Its turns replace whatever the browser sent: the server's copy is the
     * one that survived the tab closing, and the client's was only ever a
     * convenience. `history` stays accepted for a client that has not caught
     * up, and loses to the stored thread when both arrive.
     */
    const thread = await openThread({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      conversationId: parsed.data.conversationId,
      firstQuestion: parsed.data.question,
    });
    // A thread opened for a question that then failed is an empty row in the
    // list; a run of them after a key expires reads as a broken feature.
    opened = thread.isNew ? thread.id : null;

    const { answer, model, provider, used, draft, cards, note } = await askMoneyAssistant({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      question: parsed.data.question,
      month,
      history: thread.turns.length > 0 ? thread.turns : parsed.data.history,
      page: parsed.data.page,
    });

    // Written after the answer is known, so a question that failed does not
    // leave half an exchange in the thread.
    const { assistantMessageId } = await recordExchange({
      conversationId: thread.id,
      question: parsed.data.question,
      answer,
      draft,
      cards,
    });

    // `used` says what Zen went and read to answer — useful in the panel and
    // the only way to tell a well-sourced answer from a confident guess.
    //
    // `draft` is a task Zen has filled in and nothing more: no row exists, and
    // none will until the browser posts it to POST /tasks on a click.
    res.json({
      success: true,
      answer,
      model,
      provider,
      month,
      used,
      draft,
      // Prepared jobs: steps the browser sends on a click, never sent from here.
      cards,
      // "(Answer cut short.)" when it hit the token ceiling — for showing muted.
      ...(note ? { note } : {}),
      conversationId: thread.id,
      messageId: assistantMessageId,
    });
  } catch (error) {
    /*
     * These two are the user's problem to fix, not a server fault — a missing
     * key and a refused key both need somebody to go to Settings. Sending them
     * through `next` would log a stack trace and return "something went wrong",
     * which is the one thing that does not help.
     */
    if (opened) await discardIfUnused(opened);
    if (error instanceof AssistantNotConfigured) {
      res.status(409).json({ success: false, error: error.message, code: 'NO_KEY' });
      return;
    }
    if (error instanceof AssistantFailed) {
      res.status(502).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * ─── The threads ────────────────────────────────────────────────────────────
 *
 * Every one of these is confined to the caller. Zen answers as though it is
 * talking to one person — it names them, it reads their memory — so a thread
 * belongs to whoever had it, and an id from somebody else reads as not found.
 */

assistantRouter.get('/threads', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const threads = await prisma.zenConversation.findMany({
      where: { userId: req.user!.userId, organizationId: req.user!.organizationId },
      // By when anything was last said, not when it began: a thread you came
      // back to yesterday belongs at the top.
      orderBy: { updatedAt: 'desc' },
      take: 30,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    res.json({ success: true, threads });
  } catch (e) {
    next(e);
  }
});

assistantRouter.get('/threads/:id', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const thread = await prisma.zenConversation.findFirst({
      where: { id: String(req.params.id), userId: req.user!.userId, organizationId: req.user!.organizationId },
      select: {
        id: true,
        title: true,
        messages: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            text: true,
            draft: true,
            actedAt: true,
            createdTaskId: true,
            cards: true,
            stepsDone: true,
            createdAt: true,
          },
        },
      },
    });
    if (!thread) {
      res.status(404).json({ success: false, error: 'Conversation not found' });
      return;
    }
    res.json({ success: true, thread });
  } catch (e) {
    next(e);
  }
});

assistantRouter.delete('/threads/:id', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const owned = await prisma.zenConversation.findFirst({
      where: { id: String(req.params.id), userId: req.user!.userId, organizationId: req.user!.organizationId },
      select: { id: true },
    });
    if (!owned) {
      res.status(404).json({ success: false, error: 'Conversation not found' });
      return;
    }
    // A real delete. A conversation is not a business record — nothing is
    // derived from it, no figure reads it — and §16 is about the rows the
    // studio's numbers rest on.
    await prisma.zenConversation.delete({ where: { id: owned.id } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * Marks what was done on a message, so reopening does not offer it twice.
 *
 * Without `step`, the task draft was created (`taskId` is what it became).
 * With `step` — "card.step", as the panel numbers them — one step of a plan
 * was carried out, and `result` is what came back ("5 moved, 1 refused: …").
 * Recording is all this does: the change itself was the browser's request to
 * the real endpoint, made before this was called.
 */
assistantRouter.post('/messages/:id/acted', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const taskId = typeof req.body?.taskId === 'string' ? req.body.taskId : null;
    const step = typeof req.body?.step === 'string' && /^\d{1,2}\.\d{1,2}$/.test(req.body.step) ? req.body.step : null;
    const result = typeof req.body?.result === 'string' ? req.body.result.slice(0, 500) : null;
    const message = await prisma.zenMessage.findFirst({
      where: {
        id: String(req.params.id),
        conversation: { userId: req.user!.userId, organizationId: req.user!.organizationId },
      },
      select: { id: true, stepsDone: true },
    });
    if (!message) {
      res.status(404).json({ success: false, error: 'Message not found' });
      return;
    }
    if (typeof req.body?.step === 'string' && !step) {
      res.status(400).json({ success: false, error: 'That is not a step.' });
      return;
    }
    if (step) {
      const done = (message.stepsDone && typeof message.stepsDone === 'object' ? message.stepsDone : {}) as Record<string, unknown>;
      await prisma.zenMessage.update({
        where: { id: message.id },
        data: { stepsDone: { ...done, [step]: { at: new Date().toISOString(), result } } },
      });
    } else {
      await prisma.zenMessage.update({
        where: { id: message.id },
        data: { actedAt: new Date(), createdTaskId: taskId },
      });
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * ─── What Zen has learned ───────────────────────────────────────────────────
 *
 * Readable and deletable by the person it is about, which is the whole reason
 * it is stored as one short sentence per row rather than as a model's private
 * notes: a memory nobody can read is a memory nobody can correct.
 */

assistantRouter.get('/memory', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const memories = await prisma.zenMemory.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, text: true, createdAt: true },
    });
    res.json({ success: true, memories });
  } catch (e) {
    next(e);
  }
});

assistantRouter.delete('/memory/:id', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const owned = await prisma.zenMemory.findFirst({
      where: { id: String(req.params.id), userId: req.user!.userId },
      select: { id: true },
    });
    if (!owned) {
      res.status(404).json({ success: false, error: 'Not found' });
      return;
    }
    await prisma.zenMemory.delete({ where: { id: owned.id } });
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

/**
 * What Zen can be pointed at.
 *
 * Served rather than hard-coded in the web app so the two cannot disagree about
 * which providers exist — adding an adapter should not mean editing a list in
 * Settings as well. Carries each one's default model and address so the form
 * can fill itself in when the provider changes.
 *
 * No key is involved, so this answers whether or not one is set.
 */
assistantRouter.get('/providers', requireManagement(), (_req: AuthRequest, res: Response) => {
  res.json({ success: true, providers: providerChoices() });
});

/**
 * The models this organisation's key can call.
 *
 * So Settings can offer a list instead of a text box. A text box here means
 * guessing a name from memory, which is exactly how the default came to be a
 * model Google had already retired.
 */
assistantRouter.get('/models', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const models = await listAvailableModels(req.user!.organizationId);
    res.json({ success: true, models });
  } catch (error) {
    if (error instanceof AssistantNotConfigured) {
      res.status(409).json({ success: false, error: error.message, code: 'NO_KEY' });
      return;
    }
    if (error instanceof AssistantFailed) {
      res.status(502).json({ success: false, error: error.message });
      return;
    }
    next(error);
  }
});

/**
 * The same answer, streamed.
 *
 * Server-sent events rather than a JSON body, so the panel can render the
 * answer as it is written instead of showing three dots for eight seconds.
 * The non-streaming route above stays: it is what the tests use, and what a
 * caller that only wants the finished text should use.
 *
 * Errors are sent as an `error` event rather than a status code, because by
 * the time the provider refuses the key the response has already begun and its
 * status is 200 — you cannot change your mind about that afterwards.
 */
assistantRouter.post('/stream', requireManagement(), async (req: AuthRequest, res: Response) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: parsed.error.issues[0].message });
    return;
  }

  const now = new Date();
  const month =
    parsed.data.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  /*
   * The thread, on this path too.
   *
   * Only `/ask` was given one at first, and the panel streams — so the half
   * that people actually use would have persisted nothing, and "I can close it
   * and carry on" would have been true of a route nobody calls. Opened before
   * the first token, because its history is what the question is answered
   * with; written after the last one, because an answer that failed half way
   * is not an exchange.
   */
  let thread: Awaited<ReturnType<typeof openThread>> | null = null;
  let answered = '';
  let drafted: unknown;
  const carded: unknown[] = [];

  try {
    thread = await openThread({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      conversationId: parsed.data.conversationId,
      firstQuestion: parsed.data.question,
    });
    // Sent first so the panel can hold on to it even if the answer fails: the
    // next question then continues the same thread rather than opening another.
    send('thread', { conversationId: thread.id });

    for await (const event of streamMoneyAssistant({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      question: parsed.data.question,
      month,
      history: thread.turns.length > 0 ? thread.turns : parsed.data.history,
      page: parsed.data.page,
    })) {
      // `tool` says what Zen went to look at. Sent through so a pause of a few
      // seconds has a reason on screen rather than looking like nothing is
      // happening — which is what a silent tool round looks like.
      if (event.kind === 'text') {
        answered += event.text;
        send('piece', { text: event.text });
      } else if (event.kind === 'tool') send('tool', { name: event.name });
      // The model declined: what it had said goes, and this stands in for it —
      // in the panel and in the thread.
      else if (event.kind === 'replace') {
        answered = event.text;
        send('replace', { text: event.text });
      }
      // Cut short at the token ceiling: a muted line under what did come back.
      // Not part of the answer, so it is not stored with it.
      else if (event.kind === 'note') send('note', { text: event.text });
      // A prepared job — a plan of steps, or a message to send. As with the
      // draft, nothing has been written: each step is a request the browser
      // sends to an existing endpoint when it is pressed.
      else if (event.kind === 'card') {
        carded.push(event.card);
        send('card', { card: event.card });
      }
      // A drafted task, for the panel to show as a card with a Create button.
      // Nothing has been written at this point and nothing will be until that
      // button is pressed — the browser then posts it to `POST /tasks` under
      // the asker's own session, which is where the real rules live.
      else {
        drafted = event.draft;
        send('draft', { draft: event.draft });
      }
    }

    if (answered.trim()) {
      const { assistantMessageId } = await recordExchange({
        conversationId: thread.id,
        question: parsed.data.question,
        answer: answered,
        draft: drafted,
        cards: carded,
      });
      send('done', { month, conversationId: thread.id, messageId: assistantMessageId });
    } else {
      // Nothing was said, so there is nothing to keep — and a thread opened for
      // it would sit in the list as an empty row.
      if (thread.isNew) await discardIfUnused(thread.id);
      send('done', { month, conversationId: thread.id });
    }
  } catch (error) {
    if (thread?.isNew) await discardIfUnused(thread.id);
    const message =
      error instanceof AssistantNotConfigured || error instanceof AssistantFailed
        ? error.message
        : 'Something went wrong asking Zen.';
    send('error', { error: message });
  } finally {
    res.end();
  }
});
