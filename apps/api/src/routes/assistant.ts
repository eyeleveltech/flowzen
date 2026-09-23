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
});

assistantRouter.post('/ask', requireManagement(), async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.issues[0].message });
      return;
    }

    const now = new Date();
    const month =
      parsed.data.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const { answer, model, used, draft } = await askMoneyAssistant({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      question: parsed.data.question,
      month,
      history: parsed.data.history,
    });

    // `used` says what Zen went and read to answer — useful in the panel and
    // the only way to tell a well-sourced answer from a confident guess.
    //
    // `draft` is a task Zen has filled in and nothing more: no row exists, and
    // none will until the browser posts it to POST /tasks on a click.
    res.json({ success: true, answer, model, month, used, draft });
  } catch (error) {
    /*
     * These two are the user's problem to fix, not a server fault — a missing
     * key and a refused key both need somebody to go to Settings. Sending them
     * through `next` would log a stack trace and return "something went wrong",
     * which is the one thing that does not help.
     */
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
 * the time Gemini refuses the key the response has already begun and its
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

  try {
    for await (const event of streamMoneyAssistant({
      organizationId: req.user!.organizationId,
      userId: req.user!.userId,
      question: parsed.data.question,
      month,
      history: parsed.data.history,
    })) {
      // `tool` says what Zen went to look at. Sent through so a pause of a few
      // seconds has a reason on screen rather than looking like nothing is
      // happening — which is what a silent tool round looks like.
      if (event.kind === 'text') send('piece', { text: event.text });
      else if (event.kind === 'tool') send('tool', { name: event.name });
      // A drafted task, for the panel to show as a card with a Create button.
      // Nothing has been written at this point and nothing will be until that
      // button is pressed — the browser then posts it to `POST /tasks` under
      // the asker's own session, which is where the real rules live.
      else send('draft', { draft: event.draft });
    }
    send('done', { month });
  } catch (error) {
    const message =
      error instanceof AssistantNotConfigured || error instanceof AssistantFailed
        ? error.message
        : 'Something went wrong asking Zen.';
    send('error', { error: message });
  } finally {
    res.end();
  }
});
