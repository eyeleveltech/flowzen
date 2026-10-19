'use client';

/**
 * Writing a proposal with the AI (phase 2).
 *
 * Ask in plain words: "write the first draft", "shorter intro", "more premium
 * tone". The AI answers in a sentence and suggests changes, each one a card
 * to accept or discard. Nothing reaches the document until it is accepted,
 * prices never go in the text, and anything it does not know comes back as a
 * yellow "Needs input" for somebody to fill.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, ChevronUp, Send, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  api,
  ApiError,
  formatMoney,
  type ProposalAiChange,
  type ProposalAiEntry,
  type ProposalDoc,
  type ProposalDocResponse,
} from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const STARTERS = [
  'Write the first draft',
  'Make the intro shorter',
  'More premium tone',
  'Write the terms for a 6-month retainer',
];

/** "[[Needs input: …]]" as a yellow chip, the way the document prints it. */
function WithFlags({ text }: { text: string }) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\[\[\s*(?:needs input\s*:?\s*)?(.+?)\s*\]\]$/i.exec(part);
        return m ? (
          <span key={i} className="rounded bg-warning-tint px-1.5 py-0.5 font-semibold text-warning-ink">
            Needs input: {m[1]}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </>
  );
}

export function AiPanel({
  doc,
  editable,
  canPrice,
  onChanged,
}: {
  doc: ProposalDoc;
  editable: boolean;
  canPrice: boolean;
  onChanged: (res: ProposalDocResponse) => void;
}) {
  const [message, setMessage] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; noKey?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const thread = doc.aiThread ?? [];

  // The newest answer in view: the conversation scrolls, the page does not.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [thread.length, asking]);

  const ask = async (text: string) => {
    const said = text.trim();
    if (!said || asking) return;
    setAsking(said);
    setMessage('');
    setError(null);
    try {
      onChanged(await api.proposalDocs.askAi(doc.id, said));
    } catch (e) {
      setMessage(said);
      setError(
        e instanceof ApiError
          ? { text: e.message, noKey: e.code === 'NO_KEY' }
          : { text: 'The AI did not answer. Check your connection and try again.' },
      );
    } finally {
      setAsking(null);
    }
  };

  const apply = async (entryId: string, body: { action: 'accept' | 'discard'; changeIds?: string[]; lines?: boolean }, key: string) => {
    setBusy(key);
    try {
      onChanged(await api.proposalDocs.applyAi(doc.id, entryId, body));
      if (body.action === 'accept') toast.success(body.lines ? 'Added to Pricing' : 'Added to the document');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not apply that.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-primary">Write with AI</h2>
        <span className="ml-auto text-micro text-secondary">It suggests. You accept.</span>
      </div>

      <div ref={list} className="max-h-[62vh] min-h-[16rem] space-y-4 overflow-y-auto px-4 py-4">
        {thread.length === 0 && !asking && (
          <div className="rounded-xl bg-subtle px-4 py-4 text-sm text-body">
            <p className="font-semibold text-primary">Tell it about the client, or ask for the first draft.</p>
            <p className="mt-1 text-xs text-secondary">
              It already knows the client record, the services on the Pricing tab and the studio&apos;s terms. It never writes prices,
              and anything it does not know comes back as a yellow &ldquo;Needs input&rdquo; for you to fill.
            </p>
          </div>
        )}

        {thread.map((e) =>
          e.from === 'you' ? (
            <div key={e.id} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-white">
              {e.text}
            </div>
          ) : (
            <AiAnswer key={e.id} entry={e} editable={editable} canPrice={canPrice} busy={busy} onApply={apply} />
          ),
        )}

        {asking && (
          <>
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-white">{asking}</div>
            <p className="flex items-center gap-2 text-sm text-secondary" aria-live="polite">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
              Writing… this can take up to a minute for a full draft.
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="mx-4 mb-2 rounded-xl border border-danger/30 bg-danger-tint px-3 py-2 text-xs text-danger">
          {error.text}{' '}
          {error.noKey && (
            <Link href="/settings" className="font-semibold underline">
              Open Setup
            </Link>
          )}
        </p>
      )}

      {editable ? (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                disabled={Boolean(asking)}
                className="rounded-full border border-border px-2.5 py-1 text-micro text-body transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(message);
            }}
          >
            <textarea
              aria-label="Ask the AI"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(message);
                }
              }}
              placeholder="e.g. They want more clinic bookings from Instagram. 3-month timeline, warm but premium."
              className="min-h-[2.75rem] flex-1 resize-y rounded-xl border border-border bg-white px-3 py-2 text-sm text-body outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
              maxLength={2000}
              disabled={Boolean(asking)}
            />
            <Button type="submit" variant="primary" icon={Send} loading={Boolean(asking)} disabled={!message.trim()}>
              Ask
            </Button>
          </form>
        </div>
      ) : (
        <p className="border-t border-border px-4 py-3 text-xs text-secondary">
          {doc.status === 'FINAL' ? 'This version is final. Start a new version to change it.' : 'This version is with Management for review.'}
        </p>
      )}
    </div>
  );
}

function AiAnswer({
  entry,
  editable,
  canPrice,
  busy,
  onApply,
}: {
  entry: Extract<ProposalAiEntry, { from: 'ai' }>;
  editable: boolean;
  canPrice: boolean;
  busy: string | null;
  onApply: (entryId: string, body: { action: 'accept' | 'discard'; changeIds?: string[]; lines?: boolean }, key: string) => void;
}) {
  const pending = entry.changes.filter((c) => c.status === 'PENDING');
  return (
    <div className="max-w-[95%] space-y-2">
      <p className="text-sm text-body">{entry.text}</p>
      {entry.changes.map((c) => (
        <ChangeCard
          key={c.id}
          change={c}
          editable={editable}
          busy={busy === c.id}
          onAccept={() => onApply(entry.id, { action: 'accept', changeIds: [c.id] }, c.id)}
          onDiscard={() => onApply(entry.id, { action: 'discard', changeIds: [c.id] }, c.id)}
        />
      ))}
      {editable && pending.length > 1 && (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" icon={Check} loading={busy === `${entry.id}:all`} onClick={() => onApply(entry.id, { action: 'accept' }, `${entry.id}:all`)}>
            Accept all {pending.length}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onApply(entry.id, { action: 'discard' }, `${entry.id}:all`)}>
            Discard all
          </Button>
        </div>
      )}
      {entry.lines && (
        <div className="rounded-xl border border-border bg-subtle/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-primary">For the Pricing tab</p>
            {entry.lines.status !== 'PENDING' && (
              <Badge tone={entry.lines.status === 'ACCEPTED' ? 'good' : 'neutral'}>{entry.lines.status === 'ACCEPTED' ? 'Added' : 'Discarded'}</Badge>
            )}
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {entry.lines.items.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="text-body">
                  {l.name} · {l.billing === 'MONTHLY' ? 'monthly' : 'one-time'}
                </span>
                <span className="shrink-0 tabular-nums text-secondary">
                  {l.unitRate == null
                    ? ''
                    : l.rateFrom === 'YOU'
                      ? `${formatMoney(l.unitRate)} · you said`
                      : l.rateFrom === 'SERVICE_LIST'
                        ? `${formatMoney(l.unitRate)} · service list`
                        : 'no rate yet'}
                </span>
              </li>
            ))}
          </ul>
          {editable && canPrice && entry.lines.status === 'PENDING' && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" loading={busy === `${entry.id}:lines`} onClick={() => onApply(entry.id, { action: 'accept', changeIds: [], lines: true }, `${entry.id}:lines`)}>
                Add to Pricing
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onApply(entry.id, { action: 'discard', changeIds: [], lines: true }, `${entry.id}:lines`)}>
                Discard
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangeCard({
  change,
  editable,
  busy,
  onAccept,
  onDiscard,
}: {
  change: ProposalAiChange;
  editable: boolean;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  const done = change.status !== 'PENDING';
  return (
    <div className={`rounded-xl border p-3 ${done ? 'border-border bg-white opacity-70' : 'border-primary/30 bg-white'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-primary">
          {change.title}
          <span className="ml-1.5 font-normal text-secondary">{change.sectionId ? '· rewritten' : '· new section'}</span>
        </p>
        {done && <Badge tone={change.status === 'ACCEPTED' ? 'good' : 'neutral'}>{change.status === 'ACCEPTED' ? 'Accepted' : 'Discarded'}</Badge>}
      </div>
      <div className={`mt-1.5 whitespace-pre-line text-sm text-body ${open ? '' : 'line-clamp-6'}`}>
        <WithFlags text={change.after} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {editable && !done && (
          <>
            <Button size="sm" variant="primary" icon={Check} loading={busy} onClick={onAccept}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" icon={X} onClick={onDiscard}>
              Discard
            </Button>
          </>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="ml-auto inline-flex items-center gap-1 text-micro text-secondary hover:text-primary">
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {open ? 'Show less' : change.before?.trim() ? 'Show all, and what it replaces' : 'Show all'}
        </button>
      </div>
      {open && change.before?.trim() && (
        <div className="mt-2 rounded-lg bg-subtle px-3 py-2">
          <p className="text-micro font-semibold text-secondary">It replaces</p>
          <p className="mt-1 whitespace-pre-line text-xs text-secondary line-through decoration-secondary/40">{change.before}</p>
        </div>
      )}
    </div>
  );
}
