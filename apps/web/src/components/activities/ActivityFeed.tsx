

export type FeedItem = {
  key: string;
  at: string;
  text: string;
  body: string | null;
  userName?: string;
  type?: string;
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
          <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
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
