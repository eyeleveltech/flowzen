'use client';

/**
 * Two versions of a proposal side by side (phase 3): what the price did, then
 * what the words did, section by section. Removed words struck through in
 * red, added ones in green. Prices only where both versions may be seen —
 * Management, or two finals.
 */

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { api, ApiError, formatMoney, type ProposalCompare, type ProposalCompareLine, type ProposalDocSummary } from '@/lib/api-v2';
import { readableDiff } from '@/lib/wordDiff';

const SELECT =
  'rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-body outline-none focus-visible:ring-2 focus-visible:ring-primary/25';

export function CompareView({ proposalId, documents }: { proposalId: string; documents: ProposalDocSummary[] }) {
  // Newest first in the list: by default, the one before the latest against the latest.
  const [a, setA] = useState(documents[1]?.id ?? '');
  const [b, setB] = useState(documents[0]?.id ?? '');
  const [data, setData] = useState<ProposalCompare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!a || !b || a === b) return;
    let live = true;
    api.proposalDocs
      .compare(proposalId, a, b)
      .then((r) => {
        if (!live) return;
        setData(r);
        setError(null);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not compare those versions.'));
    return () => {
      live = false;
    };
  }, [proposalId, a, b]);

  if (documents.length < 2) {
    return <p className="text-sm text-secondary">There is only one version so far. Compare appears once there is a second.</p>;
  }

  const shown = data && data.a.id === a && data.b.id === b ? data : null;
  const options = documents.map((d) => (
    <option key={d.id} value={d.id}>
      v{d.n} · {d.status === 'FINAL' ? (d.sentAt ? 'sent' : 'final') : d.status === 'IN_REVIEW' ? 'in review' : 'draft'}
    </option>
  ));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm text-secondary">
        Compare
        <select aria-label="Earlier version" className={SELECT} value={a} onChange={(e) => setA(e.target.value)}>
          {options}
        </select>
        <ArrowRight className="h-4 w-4" />
        <select aria-label="Later version" className={SELECT} value={b} onChange={(e) => setB(e.target.value)}>
          {options}
        </select>
        {a === b && <span className="text-xs text-warning-ink">Pick two different versions.</span>}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!shown && !error && a !== b && <p className="text-sm text-secondary">Comparing…</p>}

      {shown && (
        <>
          {shown.price ? (
            <PriceChanges compare={shown} />
          ) : (
            <p className="rounded-xl bg-subtle px-3 py-2.5 text-xs text-secondary">Price changes show to Management, or between two final versions.</p>
          )}
          <TextChanges compare={shown} />
        </>
      )}
    </div>
  );
}

function Delta({ before, after }: { before: number; after: number }) {
  const d = after - before;
  if (!d) return <span className="text-secondary">no change</span>;
  return <span className={d > 0 ? 'text-success' : 'text-danger'}>{d > 0 ? '+' : '−'}{formatMoney(Math.abs(d))}</span>;
}

const lineWords = (l: ProposalCompareLine | null) =>
  l ? `${formatMoney(l.unitRate)}${l.qty !== 1 ? ` × ${l.qty}` : ''}${l.unit ? ` / ${l.unit}` : ''}${l.discountAmount ? `, less ${formatMoney(l.discountAmount)}` : ''}` : '—';

function PriceChanges({ compare }: { compare: ProposalCompare }) {
  const price = compare.price!;
  const rows: { label: string; a: number; b: number }[] = [
    { label: 'Monthly fee', a: price.a.monthly, b: price.b.monthly },
    { label: 'One-time fee', a: price.a.oneTime, b: price.b.oneTime },
    { label: 'Paid by the client directly', a: price.a.passthrough, b: price.b.passthrough },
    { label: 'Discounts', a: price.a.discount, b: price.b.discount },
  ].filter((r) => r.a || r.b);
  const changed = price.lines.filter((l) => JSON.stringify(l.a) !== JSON.stringify(l.b));
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <h3 className="eyebrow text-secondary">The price</h3>
      <table className="mt-2 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-micro text-secondary">
            <th className="py-1 font-medium" />
            <th className="py-1 text-right font-medium">v{compare.a.n}</th>
            <th className="py-1 text-right font-medium">v{compare.b.n}</th>
            <th className="py-1 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border">
              <td className="py-1.5 text-body">{r.label}</td>
              <td className="py-1.5 text-right text-secondary">{formatMoney(r.a)}</td>
              <td className="py-1.5 text-right font-semibold text-primary">{formatMoney(r.b)}</td>
              <td className="py-1.5 text-right">
                <Delta before={r.a} after={r.b} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {changed.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {changed.map((l) => (
            <li key={l.name} className="flex flex-wrap gap-x-2">
              <span className="font-semibold text-primary">{l.name}</span>
              <span className="text-secondary">
                {!l.a ? 'added at ' : !l.b ? 'removed, was ' : ''}
                {l.a && l.b ? `${lineWords(l.a)} → ${lineWords(l.b)}` : lineWords(l.a ?? l.b)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextChanges({ compare }: { compare: ProposalCompare }) {
  const byId = new Map(compare.a.sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const rows = compare.b.sections.map((s) => {
    seen.add(s.id);
    return { title: s.title, before: byId.get(s.id) ?? null, after: s };
  });
  const removed = compare.a.sections.filter((s) => !seen.has(s.id));
  const titleChanged = (compare.a.title ?? '') !== (compare.b.title ?? '');

  return (
    <div className="space-y-3">
      {titleChanged && (
        <div className="rounded-2xl border border-border bg-white p-4">
          <h3 className="text-sm font-semibold text-primary">Title</h3>
          <Words before={compare.a.title ?? ''} after={compare.b.title ?? ''} />
        </div>
      )}
      {rows.map(({ title, before, after }) => {
        if (after.type === 'COMMERCIAL') return null;
        const same = before && before.body === after.body && before.title === after.title && before.visible === after.visible;
        return (
          <div key={after.id} className={`rounded-2xl border bg-white p-4 ${same ? 'border-border opacity-60' : 'border-primary/30'}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-primary">{title}</h3>
              <span className="text-micro text-secondary">
                {!before ? 'new section' : same ? 'unchanged' : before.visible !== after.visible ? (after.visible ? 'now shown' : 'now hidden') : 'changed'}
              </span>
            </div>
            {!same && <Words before={before?.body ?? ''} after={after.body} />}
          </div>
        );
      })}
      {removed.map((s) => (
        <div key={s.id} className="rounded-2xl border border-danger/30 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-primary">{s.title}</h3>
            <span className="text-micro text-danger">removed</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Words({ before, after }: { before: string; after: string }) {
  const { replaced, parts } = readableDiff(before, after);
  if (replaced) {
    // Rewritten rather than edited: the old text, then the new, each whole.
    return (
      <div className="mt-2 space-y-2 text-sm leading-relaxed">
        <p className="whitespace-pre-line text-secondary line-through decoration-danger/50">{before}</p>
        <p className="whitespace-pre-line rounded-lg bg-success-tint/50 px-2 py-1 text-body">{after}</p>
      </div>
    );
  }
  return (
    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-body">
      {parts.map((part, i) =>
        part.kind === 'same' ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === 'added' ? (
          <ins key={i} className="rounded-sm bg-success-tint text-success no-underline">
            {part.text}
          </ins>
        ) : (
          <del key={i} className="rounded-sm bg-danger-tint text-danger">
            {part.text}
          </del>
        ),
      )}
    </p>
  );
}
