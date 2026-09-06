import { Button } from '@/components/ui/button';

/**
 * The way to reach row 201.
 *
 * ─── What this is fixing ────────────────────────────────────────────────────
 *
 * Every list endpoint paginates — 200 rows by default, 100 for the register —
 * and the app rendered no pagination control of any kind. Not a next-page
 * button, not a page number, not a `page` parameter sent by anything. So a
 * list simply stopped at 200 with no indication that it had, and the rows past
 * it were unreachable through the interface.
 *
 * Silence is the whole problem. A truncated list looks exactly like a complete
 * one, which means the first symptom is somebody insisting a client exists
 * while the screen says it does not.
 *
 * So this states the count out loud even when nothing is hidden — "20 of 20"
 * is a fact worth showing, and it means the number is always in the same place
 * rather than appearing only in the bad case.
 */
export function ShowMore({
  shown,
  total,
  loading,
  onMore,
  noun = 'row',
  nounPlural,
}: {
  shown: number;
  total: number;
  loading?: boolean;
  onMore: () => void;
  noun?: string;
  nounPlural?: string;
}) {
  const more = total > shown;
  const word = total === 1 ? noun : (nounPlural ?? `${noun}s`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3.5">
      <p className="text-micro text-secondary">
        {more ? `Showing ${shown} of ${total} ${word}` : `${total} ${word}`}
      </p>
      {more && (
        <Button size="sm" onClick={onMore} disabled={loading}>
          {loading ? 'Loading…' : `Show ${Math.min(total - shown, 200)} more`}
        </Button>
      )}
    </div>
  );
}
