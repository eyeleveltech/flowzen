'use client';

/**
 * Zen — asking about the business.
 *
 * ─── What this sends ────────────────────────────────────────────────────────
 *
 * The server hands the model a snapshot of the month: client names, fees, costs
 * and margins, the open pipeline, how much of the month's work is late, and
 * who is carrying it. That is the point of it — an assistant that cannot see
 * the figures cannot answer the questions anybody actually has — and it is
 * worth saying on the panel rather than only in Settings, since the person
 * asking is the one whose client list is about to leave the building.
 *
 * Salaries are not sent. "Who is overloaded" is answered by task counts.
 *
 * The key never comes near this component. It lives on the organisation, the
 * server reads it, and the browser is told only whether one is set.
 *
 * ─── Where it sits ──────────────────────────────────────────────────────────
 *
 * Mounted once in the dashboard layout, so moving between pages neither
 * closes it nor loses the conversation, and what it is "looking at" follows
 * the page. From 1024px it docks on the right with no backdrop — the page
 * shrinks to make room and both stay usable — or expands over the whole
 * content area with the saved chats down the left. On a phone it is a
 * full-screen sheet.
 *
 * ─── Dictation ──────────────────────────────────────────────────────────────
 *
 * The browser's own SpeechRecognition, not a service. The audio goes wherever
 * the browser sends it — in Chrome, to Google — and nothing is uploaded by
 * this app. It is absent rather than broken where the browser has no support,
 * which today means Firefox and most of Safari.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  CornerDownLeft,
  X,
  Mic,
  Square,
  History,
  Plus,
  Trash2,
  Maximize2,
  Minimize2,
  Copy,
  Check,
} from 'lucide-react';
import { api, ApiError, type TaskDraft, type ZenCard, type ZenStepsDone } from '@/lib/api-v2';
import { cn } from '@/lib/utils';
import { useZenPageContext, zenScreen } from '@/hooks/useZenPageContext';
import { ZenMarkdown } from './ZenMarkdown';
import { ZenMessageCard, ZenPlanCard } from './ZenCards';
import { ZEN_DOCK_WIDTH } from '@/components/layout/zen-dock';

/** Full-screen sheet on a phone; docked or expanded from 1024px. */
export type ZenMode = 'sheet' | 'docked' | 'expanded';

type Message = {
  id: number;
  from: 'you' | 'assistant';
  text: string;
  at: Date;
  /** Set on an assistant turn that failed, so it reads as a problem not an answer. */
  failed?: boolean;
  /** A muted line under the answer: "(Answer cut short.)" */
  note?: string;
  /**
   * A task Zen has filled in, shown under the answer as a card to check.
   *
   * On the message rather than off to one side so it stays where it was said.
   * Scroll back a week and the card is still under the sentence that produced
   * it, which is how you find out what you agreed to.
   */
  proposed?: TaskDraft;
  /** Once pressed: the task exists, or the route refused and said why. */
  outcome?: { created: true } | { created: false; why: string };
  /**
   * The row this turn was stored as.
   *
   * Carried so that pressing Create can mark the draft acted on — otherwise
   * reopening the thread tomorrow offers to create the same task again, and
   * the second one looks just as convincing as the first.
   */
  storedId?: string;
  /**
   * The jobs Zen prepared on this turn (Zen Plan 4): plans of steps, and
   * messages to send yourself. Kept on the message like the draft, so they
   * stay under the sentence that produced them.
   */
  cards?: ZenCard[];
  /** Which of their steps were carried out, and what came back — "card.step". */
  stepsDone?: ZenStepsDone;
};

type ThreadSummary = { id: string; title: string | null; updatedAt: string; _count: { messages: number } };

const SUGGESTIONS = [
  'Which client is least profitable this month?',
  'What is overdue, and how long?',
  'Which deals have gone quiet?',
  'Who is carrying the most late work?',
];

/**
 * What to offer on the screen they are actually on.
 *
 * A blank panel listing four questions about the whole business is the same
 * panel everywhere, and it teaches nobody that Zen can see where they are
 * standing. These say it by being answerable only here — every one of them
 * something Zen can look up or explain from its guide.
 */
const SUGGESTIONS_BY_SCREEN: Record<string, string[]> = {
  project: ['Add a task here for Friday', 'What is left on this project?', 'What has it cost so far?'],
  retainer: ['What still needs billing this month?', 'Add a task to this month', "Why is this month's profit what it is?"],
  internal: ['Add a task here for next week', 'What is still open on this?', 'What changed on this recently?'],
  client: ['Summarise this client', 'What do they owe us?', 'What changed for them this month?'],
  asset: ['Who is holding this right now?', 'Is anything else in this category out?', 'How do I check this out for a shoot?'],
  task: ['Who is on this task, and is it late?', 'What changed on this task?', 'Does this task repeat?'],
  '/my-work': ['What is overdue on my list?', 'What is due this week?', 'Draft a task for me for tomorrow'],
  '/calendar': ['What is due this week?', 'What equipment is out right now?', 'How do I book gear for a shoot?'],
  '/members': ['Who is carrying the most late work?', 'Which department is busiest this month?', 'Who is over-allocated?'],
  '/members:approvals': ['Which videos are waiting for approval, and for how long?', 'Who takes longest to approve?', 'What escalated this week?'],
  '/all-work': ['What is overdue, and how long?', 'What is on hold right now?', 'Which tasks are waiting for approval?'],
  '/companies': ['Which clients have gone quiet?', 'Which clients have no retainer?', 'Who are our biggest clients by monthly fee?'],
  '/outreach': ["Which leads haven't been followed up in 2 weeks?", 'Which follow-ups are due today?', 'Which leads are interested?'],
  '/pipeline': ['Which deals have gone quiet?', 'Which deals are closest to closing?', 'How is weighted pipeline worked out?'],
  '/quotations': ['Which proformas are unpaid?', 'Which proformas are past their valid-till?', 'How do I raise a proforma?'],
  '/live-work': ['Which retainers renew in the next 45 days?', 'Which projects are behind schedule?', 'Which retainers have no contract?'],
  '/brief': ['Summarise last week', 'What needs my action this week?', 'What are the risks right now?'],
  '/money': ['Which invoices are overdue?', 'What alerts are open about money?', 'What did we spend on software this month?'],
  '/money:billing': ['What still needs billing here?', 'Which months are waiting on a proforma?', 'What is invoiced but unpaid?'],
  '/money:costs': ['What did we spend this month, by category?', 'What did we spend on software in September?', 'Which recurring costs need confirming?'],
  '/money:profit': ['Which client is least profitable this month?', 'How is retainer profit calculated?', 'Which projects are heading for a loss?'],
  '/forecast': ["What's the forecast for the next 3 months?", 'What happens if our biggest deal closes?', 'Which month looks tightest?'],
  '/assets': ['What equipment is out right now?', 'Which kit is late back?', 'What is in repair?'],
  '/allocations': ['Who is over-allocated this month?', 'How does the time split work?', 'What does the time split feed?'],
  '/settings': ['How do I add a public holiday?', 'How do I set who approves work?', 'How do I make someone a department head?'],
  '/profile': ['How do I connect Google Calendar?', 'How do I change my password?', 'What kit am I holding?'],
};

const suggestionsFor = (screenKey: string): string[] => SUGGESTIONS_BY_SCREEN[screenKey] ?? SUGGESTIONS;

/**
 * What to say while Zen is looking something up.
 *
 * A lookup is a few seconds of nothing, and silence reads as a hang. The words
 * are what a person would say they were doing, not the function's name.
 */
const ACTIVITY: Record<string, string> = {
  searchClients: 'Looking through clients…',
  getClient: 'Reading the client record…',
  getMonth: 'Checking the month…',
  getTasks: 'Checking tasks…',
  getPipeline: 'Checking the pipeline…',
  getInvoices: 'Checking invoices…',
  getProjects: 'Checking projects…',
  getTeamLoad: 'Checking who is carrying what…',
  getAssets: 'Checking equipment…',
  draftTask: 'Filling in the task…',
  rememberThis: 'Noting that down…',
  getAlerts: 'Checking the alerts…',
  getApprovals: 'Checking approvals…',
  getOutreach: 'Checking outreach…',
  getProformas: 'Checking proformas…',
  getMonthCard: 'Reading the month…',
  getCosts: 'Checking costs…',
  getForecast: 'Checking the forecast…',
  getHistory: 'Reading the history…',
  getBrief: 'Reading the brief…',
  prepareTaskChanges: 'Preparing the changes…',
  prepareApproval: 'Preparing the approval…',
  prepareFollowUp: 'Drafting the message…',
  prepareSalesStep: 'Preparing the sales step…',
  prepareMonthClose: 'Preparing the month…',
  prepareEvent: 'Preparing the booking…',
};

const clock = (d: Date) =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

/* The two shapes the browsers that support this actually expose. */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Copies an answer as it was written, Markdown and all. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (an insecure page, or permission denied): nothing to undo.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? 'Copied' : 'Copy answer'}
      title={copied ? 'Copied' : 'Copy answer'}
      className="rounded-md p-1 text-secondary transition-colors hover:bg-subtle hover:text-primary"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export function ManagementAssistant({
  open,
  onClose,
  configured,
  mode,
  onExpand,
  contentLeft = 0,
  focusToken = 0,
}: {
  open: boolean;
  onClose: () => void;
  configured: boolean;
  mode: ZenMode;
  /** Expand over the content area, or back to docked. Not offered on a phone. */
  onExpand?: (expanded: boolean) => void;
  /** Where the content area starts — the sidebar's width — for the expanded panel. */
  contentLeft?: number;
  /** Changes when somebody opens Zen, which is when the box should take focus. */
  focusToken?: number;
}) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lookingAt, setLookingAt] = useState<string | null>(null);
  const [canDictate, setCanDictate] = useState(false);
  /** Which card is mid-create, so its button can say so and refuse a second click. */
  const [creating, setCreating] = useState<number | null>(null);
  /*
   * The thread this belongs to.
   *
   * The conversation used to live in this component and die with it — close
   * the panel and the thread was gone, including the reasoning behind a task
   * that was half arranged. The server keeps it now; this is the handle.
   */
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [showThreads, setShowThreads] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  /*
   * Where they are standing — a route and an id, never the page's data.
   *
   * It is what makes "add a task here" resolvable without naming the client
   * out loud, which was the thing that made the panel slower than the form it
   * was meant to replace. The panel outlives page changes now, so this follows
   * whichever page is showing.
   */
  const page = useZenPageContext();
  const screen = zenScreen(page);
  const here = screen.label;

  const expanded = mode === 'expanded';
  /** Expanded keeps the list on screen; elsewhere it is a toggle over the thread. */
  const threadsOverlay = showThreads && !expanded;

  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  /** The live message list, for callbacks that must not re-create as it grows. */
  const messagesRef = useRef<Message[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => setCanDictate(Boolean(getRecognition())), []);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  /*
   * Focus the box when somebody opens Zen — not when a reload brings it back
   * docked, which would take the page's own keys (the calendar's T, J and K)
   * away from it.
   */
  useEffect(() => {
    if (open && focusToken > 0) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  /*
   * Open where you left off.
   *
   * The most recent thread, loaded in full, scrolled to the end. Not a fresh
   * blank panel: a conversation you were half way through is the commonest
   * reason to open this again, and starting over is the one thing that makes
   * the history pointless.
   */
  useEffect(() => {
    if (!open || !configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.assistant.threads();
        if (cancelled) return;
        setThreads(res.threads);
        // Only when this panel has nothing in it — reopening mid-conversation
        // must not throw away what is on screen.
        if (res.threads.length > 0 && messages.length === 0 && !conversationId) {
          await openThread(res.threads[0].id);
        }
      } catch {
        // The panel works without its history; it just starts blank.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, configured]);
  /*
   * Always at the latest message.
   *
   * Closing the panel takes the list off the page, and reopening drew it
   * fresh from the top — so it opened on the first message of the thread, and
   * a long conversation had to be scrolled through to reach where it left off.
   * Now it lands on the end the moment it opens. A whole thread arriving at
   * once (opening one from the list) jumps there too; only a reply being
   * written scrolls smoothly.
   */
  const shownCount = useRef(0);
  useEffect(() => {
    const jump = messages.length - shownCount.current > 1 || shownCount.current === 0;
    shownCount.current = messages.length;
    endRef.current?.scrollIntoView({ behavior: jump ? 'auto' : 'smooth', block: 'end' });
  }, [messages, busy]);
  useEffect(() => {
    if (!open) return;
    // After the list is back on the page — on opening, and when expanding or
    // docking draws it again in a different place.
    const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    return () => cancelAnimationFrame(frame);
  }, [open, mode]);

  /** Stop the microphone when the panel closes, rather than leaving it live. */
  useEffect(() => {
    if (!open && recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      setListening(false);
    }
  }, [open]);

  /**
   * A stored thread, back on screen as it was.
   *
   * The draft card comes back with it — kept on the message rather than
   * re-derived from the prose, because a draft worked out again from a
   * sentence is a draft that can come back different. `actedAt` is what stops
   * a task being offered twice.
   */
  const openThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    try {
      const res = await api.assistant.thread(id);
      setConversationId(res.thread.id);
      setShowThreads(false);
      setMessages(
        res.thread.messages.map((m: any) => ({
          id: nextId.current++,
          from: m.role === 'USER' ? ('you' as const) : ('assistant' as const),
          text: m.text,
          at: new Date(m.createdAt),
          storedId: m.id,
          ...(m.draft ? { proposed: m.draft as TaskDraft } : {}),
          ...(m.actedAt ? { outcome: { created: true as const } } : {}),
          ...(Array.isArray(m.cards) ? { cards: m.cards as ZenCard[] } : {}),
          ...(m.stepsDone ? { stepsDone: m.stepsDone as ZenStepsDone } : {}),
        })),
      );
    } catch {
      setConversationId(null);
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  /** A blank one. The old thread stays where it is, in the list. */
  const startFresh = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setShowThreads(false);
    inputRef.current?.focus();
  }, []);

  const removeThread = useCallback(
    async (id: string) => {
      try {
        await api.assistant.removeThread(id);
        setThreads((t) => t.filter((x) => x.id !== id));
        if (id === conversationId) startFresh();
      } catch {
        // Nothing to say — the row simply stays.
      }
    },
    [conversationId, startFresh],
  );

  const say = (from: Message['from'], text: string, failed = false) =>
    setMessages((m) => [...m, { id: nextId.current++, from, text, at: new Date(), failed }]);

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setDraft('');

      /*
       * The thread as it stood BEFORE this question.
       *
       * Every question used to be sent alone, so "why?" had nothing to refer
       * to and Zen would answer about whichever client it picked fresh. The
       * panel is a chat and a chat implies memory; this is what makes that
       * true. Read off the current state rather than after the setState below,
       * which has not applied yet.
       */
      const priorTurns = messages.map((m) => ({ from: m.from, text: m.text }));

      say('you', q);
      setBusy(true);

      // The answer's own bubble, filled in as the text arrives.
      const answerId = nextId.current++;
      setMessages((m) => [...m, { id: answerId, from: 'assistant', text: '', at: new Date() }]);

      try {
        await api.assistant.askStreaming(q, {
          history: priorTurns,
          // Continues the thread when there is one; the server opens a new one
          // and sends its id back when there is not.
          ...(conversationId ? { conversationId } : {}),
          page,
          onThread: (id) => setConversationId(id),
          onSaved: (storedId) =>
            setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, storedId } : msg))),
          onTool: (name) => setLookingAt(ACTIVITY[name] ?? 'Looking things up…'),
          onDraft: (proposed) =>
            setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, proposed } : msg))),
          onCard: (card) =>
            setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, cards: [...(msg.cards ?? []), card] } : msg))),
          onPiece: (piece) => {
            // Writing again: whatever it was looking up is done.
            setLookingAt(null);
            setMessages((m) =>
              m.map((msg) => (msg.id === answerId ? { ...msg, text: msg.text + piece } : msg)),
            );
          },
          onNote: (note) => setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, note } : msg))),
          // Declined: what it had started to say is not an answer, so it goes.
          onReplace: (text) => setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, text } : msg))),
        });
      } catch (e) {
        const message =
          e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not go through';
        setMessages((m) =>
          m.map((msg) => (msg.id === answerId ? { ...msg, text: message, failed: true } : msg)),
        );
      } finally {
        setBusy(false);
        setLookingAt(null);
        inputRef.current?.focus();
        // The list's titles and order come off the server, so it is refreshed
        // rather than patched — a first question also names the thread.
        void api.assistant
          .threads()
          .then((r) => setThreads(r.threads))
          .catch(() => {});
      }
    },
    [busy, messages, conversationId, page],
  );

  /**
   * The write, and the only one in this panel.
   *
   * Posts what Zen filled in to the same route the task modal posts to, under
   * the same session — so the assignment rules, the closed-month refusal and
   * the activity row all happen exactly as they would have had somebody typed
   * the form by hand. Zen prepared it; this click is what creates it.
   */
  const confirm = useCallback(async (id: number, body: TaskDraft['body']) => {
    setCreating(id);
    try {
      const made = await api.tasks.create(body);
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, outcome: { created: true } } : msg)));
      /*
       * Written down as done.
       *
       * Without this the thread reopens tomorrow still offering to create the
       * task, and a second one looks exactly as convincing as the first. The
       * created id goes with it, so the record says what the draft became.
       */
      const stored = messagesRef.current.find((msg) => msg.id === id)?.storedId;
      if (stored) {
        void api.assistant.markActed(stored, (made as { task?: { id: string } })?.task?.id).catch(() => {});
      }
    } catch (e) {
      // Shown on the card rather than as a new message: the refusal is about
      // this task, and reads as nonsense three bubbles further down.
      const why =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not go through';
      setMessages((m) =>
        m.map((msg) => (msg.id === id ? { ...msg, outcome: { created: false, why } } : msg)),
      );
    } finally {
      setCreating(null);
    }
  }, []);

  /**
   * A step of a prepared job was carried out: shown done now, and recorded on
   * the stored message so a reopened thread never offers it again.
   */
  const recordStep = useCallback((id: number, key: string, result: string) => {
    setMessages((m) =>
      m.map((msg) => (msg.id === id ? { ...msg, stepsDone: { ...(msg.stepsDone ?? {}), [key]: { result } } } : msg)),
    );
    const stored = messagesRef.current.find((msg) => msg.id === id)?.storedId;
    if (stored) void api.assistant.markStep(stored, key, result).catch(() => {});
  }, []);

  const discard = (id: number) =>
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, proposed: undefined } : msg)));

  const toggleDictation = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recognition.current = rec;
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = false;
    /*
     * Interim results land in the box as they are heard, so it is obvious the
     * microphone is working. The final pass replaces them rather than
     * appending, otherwise a corrected word arrives twice.
     */
    rec.onresult = (e) => {
      const heard = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join('');
      setDraft(heard);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      recognition.current = null;
      inputRef.current?.focus();
    };
    rec.start();
    setListening(true);
  };

  if (!open) return null;

  const last = messages.at(-1);
  /*
   * What Zen is doing, under the answer it is writing.
   *
   * "Thinking…" until the first word; the lookup in plain words while one
   * runs. Nothing once it is writing — the words arriving say that.
   */
  const activity =
    busy && last?.from === 'assistant' ? (lookingAt ?? (last.text === '' ? 'Thinking…' : null)) : null;

  const threadList =
    threads.length === 0 ? (
      <p className="px-4 py-6 text-center text-xs text-secondary">Nothing yet. Conversations are kept as you have them.</p>
    ) : (
      <ul className="divide-y divide-border">
        {threads.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void openThread(t.id)}
              aria-current={t.id === conversationId ? 'true' : undefined}
              className={cn(
                'min-w-0 flex-1 px-4 py-3 text-left transition-colors hover:bg-subtle',
                t.id === conversationId && 'bg-subtle',
              )}
            >
              <p className="truncate text-sm text-primary">{t.title ?? 'Untitled'}</p>
              <p className="mt-0.5 text-micro text-secondary">
                {new Date(t.updatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {' · '}
                {Math.floor(t._count.messages / 2) || 1} exchange
                {Math.floor(t._count.messages / 2) === 1 ? '' : 's'}
              </p>
            </button>
            <button
              type="button"
              onClick={() => void removeThread(t.id)}
              aria-label={`Delete ${t.title ?? 'this conversation'}`}
              className="mr-2 shrink-0 rounded-lg p-1.5 text-secondary transition-colors hover:bg-danger-tint hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    );

  /** Expanded, the reading column is held to a comfortable width in the middle. */
  const column = expanded ? 'mx-auto w-full max-w-3xl' : '';

  const conversation = (
    <>
      <div className={cn('flex-1 overflow-y-auto bg-subtle/30 px-4 py-4', threadsOverlay && 'hidden')}>
        <div className={cn('space-y-3', column)}>
          {loadingThread && <p className="py-6 text-center text-xs text-secondary">Bringing that back…</p>}
          {messages.length === 0 && !loadingThread && (
            <div className="space-y-3 py-2">
              <p className="text-center text-xs text-secondary">
                Ask about the money, the pipeline, the work, or who is carrying it.
              </p>
              <div className="flex flex-col gap-2">
                {suggestionsFor(screen.key).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void ask(s)}
                    className="rounded-xl border border-border bg-white px-3 py-2 text-left text-xs text-secondary transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <p className="pt-1 text-center text-micro text-secondary">
                Answers come from real figures, which are sent to whichever AI is set in Settings to produce them.
              </p>
            </div>
          )}

          {messages.map((m) => {
            const writing = busy && m === last && m.from === 'assistant';
            return (
              <div
                key={m.id}
                /* A real message, so a test can tell one from the activity
                   line beneath a reply being written. */
                data-message={m.from}
                className={cn('flex flex-col gap-1', m.from === 'you' ? 'items-end' : 'items-start')}
              >
                {/* An answer bubble is empty for a moment before the first
                    piece arrives; the activity line stands in for it. */}
                {(m.from === 'you' || m.text !== '') && (
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
                      m.from === 'you'
                        ? 'whitespace-pre-wrap rounded-br-md bg-primary text-white'
                        : m.failed
                          ? 'whitespace-pre-wrap rounded-bl-md border border-danger/30 bg-danger-tint text-danger'
                          : 'min-w-0 rounded-bl-md border border-border bg-white text-body',
                    )}
                  >
                    {m.from === 'assistant' && !m.failed ? (
                      // Re-rendered on every streamed piece, so the Markdown
                      // takes shape as it is written.
                      <ZenMarkdown text={m.text} onInternalLink={mode === 'sheet' ? onClose : undefined} />
                    ) : (
                      m.text
                    )}
                  </div>
                )}
                {m.note && <p className="px-1 text-micro text-secondary">{m.note}</p>}
                {/*
                  * What Zen filled in, before it is anything.
                  *
                  * The fields are all here because reading them is the point:
                  * between "give Janani the carousel for Friday" and a row
                  * there is an inference — which Friday, which Janani, which
                  * client — and this is where it gets checked. It is also the
                  * thing an instruction hidden in a task note cannot get
                  * past, since a person is looking at the fields.
                  */}
                {m.proposed && (
                  <div
                    data-draft
                    className="mt-1 w-[85%] overflow-hidden rounded-2xl rounded-bl-md border border-border bg-surface"
                  >
                    <div className="flex items-baseline justify-between gap-2 border-b border-border px-3.5 py-2.5">
                      <span className="text-sm font-medium text-body">{m.proposed.shows.title}</span>
                      {m.proposed.shows.client && (
                        <span className="shrink-0 text-micro text-secondary">{m.proposed.shows.client}</span>
                      )}
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-3.5 py-2.5 text-micro">
                      {[
                        ['Belongs to', m.proposed.shows.belongsTo],
                        ['Assigned to', m.proposed.shows.assignedTo],
                        ['Due', m.proposed.shows.due],
                        ['Priority', m.proposed.shows.priority],
                        ...(m.proposed.shows.notes ? [['Notes', m.proposed.shows.notes]] : []),
                      ].map(([label, value]) => (
                        <Fragment key={label}>
                          <dt className="text-secondary">{label}</dt>
                          <dd className="text-body">{value}</dd>
                        </Fragment>
                      ))}
                    </dl>

                    {m.outcome?.created === true ? (
                      <p className="border-t border-border px-3.5 py-2.5 text-micro text-success">
                        Created. It is on the board.
                      </p>
                    ) : (
                      <div className="flex items-center justify-end gap-2 border-t border-border px-3.5 py-2.5">
                        {m.outcome?.created === false && (
                          <span className="mr-auto text-micro text-danger">{m.outcome.why}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => discard(m.id)}
                          className="rounded-lg px-2.5 py-1.5 text-micro text-secondary hover:bg-subtle"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={() => confirm(m.id, m.proposed!.body)}
                          disabled={creating === m.id}
                          className="rounded-lg bg-primary px-3 py-1.5 text-micro font-medium text-white hover:bg-primary-hover disabled:opacity-60"
                        >
                          {creating === m.id ? 'Creating…' : 'Create'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* The jobs Zen prepared: nothing on them has happened yet. */}
                {m.cards?.map((c, ci) =>
                  c.type === 'plan' ? (
                    <ZenPlanCard
                      key={ci}
                      card={c}
                      cardIndex={ci}
                      done={m.stepsDone ?? {}}
                      disabled={writing}
                      onRecorded={(key, result) => recordStep(m.id, key, result)}
                      onNavigate={mode === 'sheet' ? onClose : undefined}
                    />
                  ) : (
                    <ZenMessageCard key={ci} card={c} />
                  ),
                )}
                {(m.from === 'you' || m.text !== '') && (
                  <div className="flex items-center gap-1 px-1">
                    <span className="text-micro text-secondary">{clock(m.at)}</span>
                    {/* Every finished answer, as written — Markdown included. */}
                    {m.from === 'assistant' && !m.failed && !writing && <CopyAnswer text={m.text} />}
                  </div>
                )}
              </div>
            );
          })}

          {activity && (
            <p data-activity className="px-1 text-xs italic text-secondary" aria-live="polite">
              {activity}
            </p>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
        className="shrink-0 border-t border-border px-4 py-3"
      >
        <div className={cn('flex items-center gap-2', column)}>
          {canDictate && (
            <button
              type="button"
              onClick={toggleDictation}
              aria-label={listening ? 'Stop dictating' : 'Dictate'}
              aria-pressed={listening}
              title={listening ? 'Stop dictating' : 'Dictate'}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors',
                listening
                  ? 'border-danger bg-danger-tint text-danger'
                  : 'border-border text-secondary hover:bg-subtle hover:text-primary',
              )}
            >
              {listening ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
            </button>
          )}

          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={listening ? 'Listening…' : 'Ask Zen about the business…'}
            aria-label="Ask Zen"
            disabled={busy}
            className={cn(
              'h-10 min-w-0 flex-1 rounded-full border border-border bg-white px-4 text-sm text-primary',
              'outline-none transition-colors placeholder:text-secondary focus-visible:border-primary',
              busy && 'opacity-60',
            )}
          />

          <button
            type="submit"
            aria-label="Send"
            disabled={busy || !draft.trim()}
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
              draft.trim() && !busy ? 'bg-primary text-white hover:bg-primary/90' : 'border border-border text-secondary',
            )}
          >
            <CornerDownLeft className="h-4 w-4" />
          </button>
        </div>
      </form>
    </>
  );

  const iconButton = 'rounded-lg p-1.5 text-secondary transition-colors hover:bg-subtle hover:text-primary';

  return (
    <aside
      aria-label="Zen"
      // Esc closes it from inside the panel only — the page keeps Esc for its
      // own dialogs while Zen sits docked beside it.
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className={cn(
        'fixed flex flex-col bg-white',
        mode === 'sheet' && 'inset-0 z-50',
        mode === 'docked' && 'top-0 right-0 bottom-0 z-40 border-l border-border shadow-modal',
        mode === 'expanded' && 'top-0 right-0 bottom-0 z-40 border-l border-border',
      )}
      style={
        mode === 'docked' ? { width: ZEN_DOCK_WIDTH } : mode === 'expanded' ? { left: contentLeft } : undefined
      }
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-primary">Zen</h2>
          {/* What it can see. `here` is said out loud rather than left
              implicit: a panel that silently knows which project you are on is
              a panel that surprises you. */}
          <p className="truncate text-micro text-secondary">
            {!configured ? 'not switched on' : here ? `looking at ${here} with you` : 'ask me anything'}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {configured && (
            <>
              <button type="button" onClick={startFresh} aria-label="New conversation" title="New conversation" className={iconButton}>
                <Plus className="h-4 w-4" />
              </button>
              {!expanded && (
                <button
                  type="button"
                  onClick={() => setShowThreads((v) => !v)}
                  aria-label="Earlier conversations"
                  title="Earlier conversations"
                  aria-pressed={showThreads}
                  className={cn(iconButton, showThreads && 'bg-subtle text-primary')}
                >
                  <History className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          {mode !== 'sheet' && onExpand && (
            <button
              type="button"
              onClick={() => onExpand(!expanded)}
              aria-label={expanded ? 'Dock Zen to the side' : 'Expand Zen'}
              title={expanded ? 'Dock to the side' : 'Expand'}
              className={iconButton}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close Zen" title="Close (Ctrl+J)" className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {!configured ? (
        <div className="p-5">
          <p className="text-sm text-secondary">
            Add an AI key in{' '}
            <a href="/settings" className="font-medium text-primary hover:underline">
              Settings → Zen
            </a>{' '}
            to turn this on.
          </p>
        </div>
      ) : expanded ? (
        // The saved chats down the left, the conversation on the right.
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Earlier conversations" className="w-72 shrink-0 overflow-y-auto border-r border-border">
            {threadList}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">{conversation}</div>
        </div>
      ) : (
        <>
          {/*
            Earlier conversations, over the thread rather than beside it: the
            docked panel and a phone are one column, and a sidebar at this
            width leaves neither half usable. Expanded has room, so there they
            sit on the left.
          */}
          {threadsOverlay && <div className="flex-1 overflow-y-auto border-b border-border bg-white">{threadList}</div>}
          {conversation}
        </>
      )}
    </aside>
  );
}
