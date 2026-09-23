import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';
import { prisma } from '../lib/prisma.js';
import { signJwt } from '../utils/jwt.js';
import { RolePreset } from '@prisma/client';

/**
 * The money assistant, and the two things that matter about it.
 *
 * It is handed real figures — client names, fees, costs, margins — and sends
 * them to Google. So the questions are not "does it answer nicely" but:
 *
 *   1. Can the key get out? It is stored on the organisation so it can be
 *      changed from Settings, which means it is one careless `select` away
 *      from being in every signed-in browser.
 *   2. Can somebody who is refused /money get the same figures by asking?
 */

type Persona = { id: string; preset: RolePreset; permissions: string[] };

const MANAGEMENT: Persona = {
  id: 'usr-boss',
  preset: RolePreset.MANAGEMENT,
  permissions: ['work.own', 'money.status', 'money.figures', 'setup.admin'],
};

const DESIGNER: Persona = {
  id: 'usr-des',
  preset: RolePreset.EMPLOYEE,
  permissions: ['work.own'],
};

/*
 * Accounts is the reason this gate is a PRESET check and not a permission one.
 * Priya carries `money.figures` — she has to, she raises the invoices — so a
 * `requirePermission('money.figures')` gate would let the accounts desk ask
 * the assistant what every client's margin is and who is behind on their work.
 */
const ACCOUNTS: Persona = {
  id: 'usr-acc',
  preset: RolePreset.ACCOUNTS,
  permissions: ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'],
};

const auth = (who: Persona) =>
  [
    'Authorization',
    `Bearer ${signJwt({
      userId: who.id,
      organizationId: 'org-1',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
    })}`,
  ] as const;

const ORG = {
  id: 'org-1',
  name: 'EyeLevel Growth Studio',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  financialYearStart: 4,
  aiProvider: 'GEMINI',
  aiApiKey: 'AIza-super-secret-key',
  aiModel: 'gemini-2.0-flash',
  aiBaseUrl: null,
  stageProbProposalSent: 30,
  stageProbInNegotiation: 60,
  stageProbProformaIssued: 85,
  stageProbVerbalYes: 90,
};

beforeEach(() => {
  (prisma.user.findUnique as any).mockImplementation(async ({ where }: any) => {
    const who = [MANAGEMENT, DESIGNER, ACCOUNTS].find((p) => p.id === where.id);
    if (!who) return null;
    return {
      id: who.id,
      organizationId: 'org-1',
      name: 'Somebody',
      email: 'x@eyelevel.local',
      preset: who.preset,
      permissions: [...who.permissions],
      active: true,
      sessionsValidFrom: null,
    };
  });
  (prisma.organization.findUnique as any).mockResolvedValue(ORG);
  (prisma.organization.findFirst as any).mockResolvedValue(ORG);
  (prisma.activity.create as any).mockResolvedValue({});
  // Everything the context builder reads. An unmocked one returns undefined
  // and the builder throws before the provider is ever reached, which shows up as a
  // 500 and tells you nothing.
  (prisma.monthCard.findMany as any).mockResolvedValue([]);
  (prisma.invoice.findMany as any).mockResolvedValue([]);
  (prisma.project.findMany as any).mockResolvedValue([]);
  (prisma.proposal.findMany as any).mockResolvedValue([]);
  (prisma.task.findMany as any).mockResolvedValue([]);
  // The orientation block reads these too. An unmocked one returns undefined
  // and the builder throws before the provider is reached, which shows up as a 500
  // and tells you nothing about what went wrong.
  (prisma.company.findMany as any).mockResolvedValue([
    { name: 'Da One', status: 'CLIENT' },
    { name: "Heaven's ELIX", status: 'CLIENT' },
  ]);
  (prisma.user.findMany as any).mockResolvedValue([
    { name: 'Akmal', dept: 'Management' },
    { name: 'Janani', dept: 'Design' },
  ]);
});

describe('the AI key never leaves the server', () => {
  it('is not in GET /config, anywhere in the response', async () => {
    const res = await request(app).get('/api/config').set(...auth(MANAGEMENT));

    expect(res.status).toBe(200);
    // Not "is the field absent" — is the VALUE anywhere in the payload at all.
    // A key can leak through a field nobody thought to check.
    expect(JSON.stringify(res.body)).not.toContain('AIza-super-secret-key');
  });

  it('says only whether one is set', async () => {
    const res = await request(app).get('/api/config').set(...auth(MANAGEMENT));
    expect(res.body.organization.aiConfigured).toBe(true);
    expect(res.body.organization.aiApiKey).toBeUndefined();
  });

  it('reports no key as not configured', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ ...ORG, aiApiKey: null });
    const res = await request(app).get('/api/config').set(...auth(MANAGEMENT));
    expect(res.body.organization.aiConfigured).toBe(false);
  });
});

describe('who may ask it', () => {
  it('refuses a designer', async () => {
    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(DESIGNER))
      .send({ question: 'what is our margin this month' });

    expect(res.status).toBe(403);
  });

  it('refuses ACCOUNTS, who holds money.figures', async () => {
    /*
     * The test that says why this gate is a preset check.
     *
     * Priya raises the invoices, so she carries `money.figures` and must. A
     * permission gate would therefore let her ask one question and read every
     * client's margin, the whole pipeline and who on the team is behind —
     * which is a different thing from being allowed to see an invoice.
     */
    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(ACCOUNTS))
      .send({ question: 'what is our margin this month' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/management/i);
  });

  it('says plainly when no key is set, rather than failing', async () => {
    (prisma.organization.findUnique as any).mockResolvedValue({ ...ORG, aiApiKey: null });
    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'anything' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_KEY');
    expect(res.body.error).toMatch(/Settings/);
  });

  it('will not take an empty question', async () => {
    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('what it sends', () => {
  it('asks the provider with the key in a header, and records the question', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'September is ₹11,000.' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'why is profit down', month: '2026-09' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('September');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // In a header, never the query string — a key in a URL lands in logs.
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-super-secret-key');
    expect(url).not.toContain('AIza-super-secret-key');

    // A record of what was asked is a record of what was sent.
    const activity = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(activity.verb).toBe('assistant_asked');
    expect(activity.payload.question).toBe('why is profit down');

    vi.unstubAllGlobals();
  });

  it('turns a refused key into something the reader can act on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":{"message":"API key not valid"}}', { status: 400 })),
    );

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'anything' });

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Settings/);
    vi.unstubAllGlobals();
  });
});

/**
 * What Zen is actually sent.
 *
 * Three things the plan called for, and each is invisible from the outside —
 * a good answer and a lucky one look identical. So these read the request that
 * went to the provider rather than the reply that came back.
 */
describe('what goes to the provider', () => {
  const capture = () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  const bodyOf = (fetchMock: ReturnType<typeof capture>) =>
    JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);

  it('remembers the conversation', async () => {
    /*
     * Every question used to be sent alone, so "why?" had nothing to refer to.
     * The history goes in as alternating user/model turns, which is the shape
     * Gemini reads a conversation from.
     */
    const fetchMock = capture();
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({
        question: 'Why?',
        history: [
          { from: 'you', text: 'Which client is least profitable?' },
          { from: 'assistant', text: 'Da One, at 36.7%.' },
        ],
      });

    const contents = bodyOf(fetchMock).contents;
    expect(contents).toHaveLength(3);
    expect(contents[0]).toMatchObject({ role: 'user' });
    expect(contents[1]).toMatchObject({ role: 'model' });
    expect(contents[2].parts[0].text).toBe('Why?');
    vi.unstubAllGlobals();
  });

  it('caps the history rather than trusting the browser', async () => {
    // It is re-sent with every question, so an uncapped one grows the cost of
    // each ask without bound.
    const fetchMock = capture();
    const long = Array.from({ length: 30 }, (_, i) => ({
      from: (i % 2 === 0 ? 'you' : 'assistant') as 'you' | 'assistant',
      text: `turn ${i}`,
    }));
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'now what', history: long });

    // Eight turns plus the question itself.
    expect(bodyOf(fetchMock).contents).toHaveLength(9);
    vi.unstubAllGlobals();
  });

  it('offers Zen the tools rather than one fixed block of figures', async () => {
    /*
     * The snapshot used to carry everything on every question, which works
     * while the questions are about this month's money and stops the moment
     * somebody asks about a client, an asset, or August. Zen is given a short
     * orientation and a set of functions instead.
     */
    const fetchMock = capture();
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'what is Voso paying us' });

    const body = bodyOf(fetchMock);
    const names = body.tools[0].functionDeclarations.map((f: { name: string }) => f.name);
    expect(names).toContain('getClient');
    expect(names).toContain('getTasks');
    expect(names).toContain('getMonth');
    expect(names).toContain('getAssets');
    vi.unstubAllGlobals();
  });

  it('orients Zen without making it look anything up first', async () => {
    // Who the clients are, who the team are, and the month's totals — enough
    // to answer the easy ones in one round trip rather than three.
    const fetchMock = capture();
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'who are our clients' });

    const prompt = bodyOf(fetchMock).systemInstruction.parts[0].text;
    const known = JSON.parse(prompt.slice(prompt.indexOf('{'), prompt.lastIndexOf('}') + 1));
    expect(known.clients).toContain('Da One (CLIENT)');
    expect(known.team).toContain('Janani — Design');
    expect(known.thisMonthTotals).toBeDefined();
    vi.unstubAllGlobals();
  });

  it('runs what Zen asks for, then answers with it', async () => {
    /*
     * The loop: a functionCall comes back, the server runs it, the result goes
     * in as a functionResponse, and the second reply is the answer. Without
     * this the model would ask for a tool and be told nothing.
     */
    (prisma.company.findMany as any).mockResolvedValue([{ name: 'Da One', status: 'CLIENT' }]);
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const payload =
        call === 1
          ? { candidates: [{ content: { parts: [{ functionCall: { name: 'searchClients', args: {} } }] } }] }
          : { candidates: [{ content: { parts: [{ text: 'You have one client: Da One.' }] } }] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'who are our clients' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('Da One');
    expect(res.body.used).toEqual(['searchClients']);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // And the audit row says what it went and read, not only what was asked.
    const activity = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(activity.payload.used).toEqual(['searchClients']);
    vi.unstubAllGlobals();
  });

  it('stops looking things up rather than going round for ever', async () => {
    // A vague question could otherwise walk the database a page at a time, and
    // every round is another call against a rate-limited key.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ functionCall: { name: 'searchClients', args: {} } }, { text: 'here is what I found' }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'tell me everything' });

    expect(res.status).toBe(200);
    // Four rounds of tools, then one more that has to answer with what it has.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    vi.unstubAllGlobals();
  });
});

/**
 * Drafting a task, which is the only thing Zen does that is not looking.
 *
 * The thing under test is not "can it fill a form" — it is that it CANNOT do
 * anything else. A draft is a proposal: the row appears when somebody presses
 * Create in the browser, through the same POST /tasks the modal uses, under
 * their own session. So what these check is that nothing here writes, that the
 * ids the browser will post are real, and that a missing field produces a
 * question with real options rather than an invented answer.
 */
describe('drafting a task', () => {
  const TEAM = [
    { id: 'usr-boss', name: 'Akmal', dept: 'Management' },
    { id: 'usr-des', name: 'Janani', dept: 'Design' },
  ];

  const VOSO = {
    id: 'co-voso',
    name: 'VOSO Sports',
    retainers: [
      {
        id: 'ret-voso',
        projects: [
          { id: 'rp-base', name: 'Monthly Retainer Work', isDefault: true, status: 'ACTIVE' },
          { id: 'rp-league', name: 'League Season Launch', isDefault: false, status: 'ACTIVE' },
        ],
      },
    ],
    projects: [],
  };

  /** The model asks for a draft, is told what happened, then speaks. */
  const drafting = (args: Record<string, unknown>) => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const payload =
        call === 1
          ? { candidates: [{ content: { parts: [{ functionCall: { name: 'draftTask', args } }] } }] }
          : { candidates: [{ content: { parts: [{ text: 'Ready for you to check.' }] } }] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  /** What the server handed back to the model after running the tool. */
  const toolReply = (fetchMock: ReturnType<typeof drafting>) => {
    const sent = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    return sent.contents.at(-1).parts[0].functionResponse.response.result;
  };

  beforeEach(() => {
    (prisma.user.findMany as any).mockResolvedValue(TEAM);
    (prisma.company.findMany as any).mockImplementation(async ({ where }: any) =>
      // The drafter asks twice: which client did they mean, and which clients
      // could they have meant. Same model, different shapes.
      where?.name ? [VOSO] : [{ name: 'VOSO Sports' }, { name: 'Elephantine Tales' }],
    );
    (prisma.monthCard.findFirst as any).mockResolvedValue({ id: 'mc-sep', status: 'OPEN' });
  });

  it('offers Zen a way to propose a task, and no way to write one', async () => {
    const fetchMock = drafting({});
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'anything' });

    const names: string[] = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    ).tools[0].functionDeclarations.map((f: { name: string }) => f.name);

    expect(names).toContain('draftTask');
    // Nothing that writes, and nothing that deletes. A mis-parsed sentence must
    // not be able to close a month or reassign somebody's work.
    expect(names.filter((n) => /^(create|update|delete|set|close|remove)/.test(n))).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('fills in the form the browser will post, with real ids', async () => {
    drafting({
      title: 'September social media report',
      dueDate: '2026-09-26',
      client: 'VOSO',
    });

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'task for voso, social media report, friday' });

    expect(res.status).toBe(200);
    // The body is posted to POST /tasks unchanged, so its field names are part
    // of the contract, not an implementation detail.
    expect(res.body.draft.body).toMatchObject({
      title: 'September social media report',
      dueDate: '2026-09-26',
      workType: 'MONTH_CARD',
      monthCardId: 'mc-sep',
      workId: 'mc-sep',
      retainerProjectId: 'rp-base',
      assigneeId: 'usr-boss',
      priority: 'MEDIUM',
    });
    // And the card the person reads before pressing Create says the same thing
    // in words. If these two ever disagree, they confirm one task and get
    // another.
    expect(res.body.draft.shows).toMatchObject({
      client: 'VOSO Sports',
      belongsTo: 'Monthly Retainer Work — 2026-09',
      assignedTo: 'Akmal — Management',
      due: '2026-09-26',
    });
    vi.unstubAllGlobals();
  });

  it('tells the model plainly that nothing has been created', async () => {
    // The failure this prevents is Zen answering "done — I've created it" over
    // a task that exists only as a card waiting for a click.
    const fetchMock = drafting({ title: 'x', dueDate: '2026-09-26', client: 'VOSO' });
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'make a task' });

    const said = JSON.stringify(toolReply(fetchMock));
    expect(said).toContain('NOT created yet');
    expect(said).toContain('Do not say it is done, saved or created');
    vi.unstubAllGlobals();
  });

  it('asks for what is missing instead of inventing it', async () => {
    const fetchMock = drafting({ client: 'VOSO' });

    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'create a task for me' });

    // No draft on the response: there is nothing to confirm yet.
    expect(res.body.draft).toBeUndefined();
    const reply = toolReply(fetchMock);
    expect(reply.needs).toEqual(['title', 'dueDate']);
    // And the dates it offers are real ones, because a suggested date the model
    // made up is a wrong answer offered confidently.
    expect(reply.candidates.dates.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    vi.unstubAllGlobals();
  });

  it('suggests the actual team when a name matches nobody', async () => {
    const fetchMock = drafting({ title: 'x', dueDate: '2026-09-26', assignee: 'Rajesh' });
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'task for rajesh' });

    const reply = toolReply(fetchMock);
    expect(reply.needs).toEqual(['assignee']);
    expect(reply.candidates.team).toEqual(['Akmal — Management', 'Janani — Design']);
    vi.unstubAllGlobals();
  });

  it('refuses a closed month before the draft, not after the button', async () => {
    /*
     * POST /tasks would refuse this anyway — a closed month has had its profit
     * reported. Catching it here is what turns "Create" failing into Zen saying
     * why and offering a month that is open.
     */
    (prisma.monthCard.findFirst as any).mockResolvedValue({ id: 'mc-aug', status: 'CLOSED' });
    // Shaped for both readers: the drafter wants the month, and the
    // orientation — which runs first, on every question — wants the figures.
    (prisma.monthCard.findMany as any).mockResolvedValue([
      { month: '2026-09', revenue: 0, costs: [] },
    ]);

    const fetchMock = drafting({ title: 'x', dueDate: '2026-08-15', client: 'VOSO' });
    const res = await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'task for voso in august' });

    expect(res.body.draft).toBeUndefined();
    const reply = toolReply(fetchMock);
    expect(reply.because).toContain('closed');
    expect(reply.candidates.openMonths).toEqual(['2026-09']);
    vi.unstubAllGlobals();
  });

  it('records that it drafted, so the log says what Zen did', async () => {
    drafting({ title: 'x', dueDate: '2026-09-26', client: 'VOSO' });
    await request(app)
      .post('/api/assistant/ask')
      .set(...auth(MANAGEMENT))
      .send({ question: 'make a task' });

    const activity = (prisma.activity.create as any).mock.calls.at(-1)[0].data;
    expect(activity.payload.used).toContain('draftTask');
    vi.unstubAllGlobals();
  });
});
