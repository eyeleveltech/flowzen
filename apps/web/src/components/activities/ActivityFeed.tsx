

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

export type FeedItem = {
  key: string;
  at: string;
  text: string;
  body: string | null;
  userName?: string;
  type?: string;
  /** 'IN' = they came to us, 'OUT' = we reached out. Null for notes and system rows. */
  direction?: string | null;
};

export function ActivityFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-secondary">Nothing recorded yet.</p>;
  }

  // Ordered by when it HAPPENED. Something agreed on Tuesday
  // and written up on Friday belongs on Tuesday (§3.9).
  const sorted = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <ol className="space-y-3">
      {sorted.map((item) => (
        <li key={item.key} className="flex gap-3">
          {/*
            Which way it went, as the bullet itself. Read down the column you can
            see a chase that went one way four times, which is the thing a plain
            list of contacts hides (§3.12).
          */}
          {item.direction === 'IN' ? (
            <ArrowDownLeft
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success"
              strokeWidth={2}
              aria-label="They came to us"
            />
          ) : item.direction === 'OUT' ? (
            <ArrowUpRight
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-secondary"
              strokeWidth={2}
              aria-label="We reached out"
            />
          ) : (
            <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
          )}
          <div className="min-w-0">
            <p className="text-sm text-body">{item.text}</p>
            {item.body && <p className="text-xs text-secondary whitespace-pre-wrap mt-0.5">{item.body}</p>}
            <p className="text-xs text-secondary mt-0.5">
              {new Date(item.at).toLocaleDateString()}
              {item.userName && ` · by ${item.userName}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
