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
 * ─── Dictation ──────────────────────────────────────────────────────────────
 *
 * The browser's own SpeechRecognition, not a service. The audio goes wherever
 * the browser sends it — in Chrome, to Google — and nothing is uploaded by
 * this app. It is absent rather than broken where the browser has no support,
 * which today means Firefox and most of Safari.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, CornerDownLeft, X, Mic, Square } from 'lucide-react';
import { api, ApiError, type TaskDraft } from '@/lib/api-v2';
import { cn } from '@/lib/utils';

type Message = {
  id: number;
  from: 'you' | 'assistant';
  text: string;
  at: Date;
  /** Set on an assistant turn that failed, so it reads as a problem not an answer. */
  failed?: boolean;
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
};

const SUGGESTIONS = [
  'Which client is least profitable this month?',
  'What is overdue, and how long?',
  'Which deals have gone quiet?',
  'Who is carrying the most late work?',
];

/**
 * What to say while Zen is looking something up.
 *
 * A tool round is a few seconds of nothing, and silence reads as a hang. The
 * names are what a person would say they were doing, not the function name —
 * "checking the pipeline" rather than "getPipeline".
 */
const LOOKING_AT: Record<string, string> = {
  searchClients: 'looking through the clients',
  getClient: 'reading the client record',
  getMonth: 'checking the month',
  getTasks: 'going through the tasks',
  getPipeline: 'checking the pipeline',
  getInvoices: 'checking the invoices',
  getProjects: 'checking the projects',
  getTeamLoad: 'checking who is carrying what',
  getAssets: 'checking the equipment',
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

export function ManagementAssistant({
  open,
  onClose,
  configured,
}: {
  open: boolean;
  onClose: () => void;
  configured: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [lookingAt, setLookingAt] = useState<string | null>(null);
  const [canDictate, setCanDictate] = useState(false);
  /** Which card is mid-create, so its button can say so and refuse a second click. */
  const [creating, setCreating] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => setCanDictate(Boolean(getRecognition())), []);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  /** Stop the microphone when the panel closes, rather than leaving it live. */
  useEffect(() => {
    if (!open && recognition.current) {
      recognition.current.stop();
      recognition.current = null;
      setListening(false);
    }
  }, [open]);

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
          onTool: (name) => setLookingAt(LOOKING_AT[name] ?? 'having a look'),
          onDraft: (proposed) =>
            setMessages((m) => m.map((msg) => (msg.id === answerId ? { ...msg, proposed } : msg))),
          onPiece: (piece) =>
            setMessages((m) =>
              m.map((msg) => (msg.id === answerId ? { ...msg, text: msg.text + piece } : msg)),
            ),
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
      }
    },
    [busy, messages],
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
      await api.tasks.create(body);
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, outcome: { created: true } } : msg)));
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Zen"
        className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-white shadow-modal"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
            <Sparkles className="h-4 w-4 text-white" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-primary">Zen</h2>
            <p className="text-micro text-secondary">
              {busy ? (lookingAt ?? 'typing…') : configured ? 'ask me anything' : 'not switched on'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-secondary transition-colors hover:bg-subtle hover:text-primary"
          >
            <X className="h-4 w-4" />
          </button>
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
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto bg-subtle/30 px-4 py-4">
              {messages.length === 0 && (
                <div className="space-y-3 py-2">
                  <p className="text-center text-xs text-secondary">
                    Ask about the money, the pipeline, the work, or who is carrying it.
                  </p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
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
                    Answers come from real figures, which are sent to Google to produce them.
                  </p>
                </div>
              )}

              {messages.map((m) => (
                <div
                  key={m.id}
                  /* A real message, so a test can tell one from the typing
                     indicator — which wears the same bubble shape. */
                  data-message={m.from}
                  className={cn('flex flex-col gap-1', m.from === 'you' ? 'items-end' : 'items-start')}
                >
                  {/* An answer bubble is empty for a moment before the
                      first piece arrives; the dots stand in for it. */}
                  {(m.from === 'you' || m.text !== '') && (
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap',
                      m.from === 'you'
                        ? 'rounded-br-md bg-primary text-white'
                        : m.failed
                          ? 'rounded-bl-md border border-danger/30 bg-danger-tint text-danger'
                          : 'rounded-bl-md border border-border bg-white text-body',
                    )}
                  >
                    {m.text}
                  </div>
                  )}
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
                          <span className="shrink-0 text-micro text-secondary">
                            {m.proposed.shows.client}
                          </span>
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
                  {(m.from === 'you' || m.text !== '') && (
                    <span className="px-1 text-micro text-secondary">{clock(m.at)}</span>
                  )}
                </div>
              ))}

              {/* Only until the first piece lands — after that the answer
                  is writing itself and the dots would sit under it. */}
              {busy && messages.at(-1)?.from === 'assistant' && messages.at(-1)?.text === '' && (
                <div className="flex items-start">
                  {/* Three dots rather than the word "Thinking", because the
                      shape of a pending bubble is what a messenger reader
                      already understands. */}
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-border bg-white px-3.5 py-3">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-secondary/60"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
              className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3"
            >
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
                  draft.trim() && !busy
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'border border-border text-secondary',
                )}
              >
                <CornerDownLeft className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
