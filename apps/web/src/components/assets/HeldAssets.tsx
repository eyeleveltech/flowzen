'use client';

/**
 * What one person is holding.
 *
 * This block matters more than it sounds. Alerts chase people; a list sitting
 * against your own name on your own profile does something better — people
 * return gear when they can see it counted against them, without anybody having
 * to ask. That is the entire argument for putting it here rather than only on
 * an admin screen.
 *
 * It renders nothing at all when the person holds nothing. An empty "Equipment"
 * card on every profile in the office teaches people to scroll past the place
 * the answer will eventually appear.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { api, type HeldAsset } from '@/lib/api-v2';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { assetCategoryLabel, dueLabel, rupees, shortDate } from '@/lib/assets';

export function HeldAssets({
  userId,
  title = "What I'm holding",
  emptyHint,
}: {
  userId: string;
  /** "What I'm holding" on /profile; "Equipment" on somebody else's record. */
  title?: string;
  /** Shown instead of nothing when the caller wants the card to stay put. */
  emptyHint?: string;
}) {
  const [assets, setAssets] = useState<HeldAsset[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.assets
      .heldBy(userId)
      .then((res) => {
        if (!cancelled) setAssets(res);
      })
      // A failure here is not worth a banner on somebody's profile. The block
      // simply does not appear, exactly as it would if they held nothing.
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (assets === null) return null;
  if (assets.length === 0 && !emptyHint) return null;

  const overdue = assets.filter((a) => a.overdue).length;

  return (
    <Card padding="none">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <span className="eyebrow">
          {assets.length} item{assets.length === 1 ? '' : 's'}
          {overdue > 0 ? ` · ${overdue} late` : ''}
        </span>
      </CardHeader>
      <CardBody>
        {assets.length === 0 ? (
          <p className="text-sm text-secondary">{emptyHint}</p>
        ) : (
          <ul className="space-y-3">
            {assets.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/assets/${a.id}`}
                    className="text-sm font-semibold text-primary transition-colors hover:text-accent"
                  >
                    {a.name}
                  </Link>
                  <p className="text-micro text-secondary">
                    <span className="font-mono">{a.tag}</span> · {assetCategoryLabel(a.category)}
                    {a.heldSince ? ` · since ${shortDate(a.heldSince)}` : ''}
                    {a.purpose ? ` · ${a.purpose}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {a.bookValue !== undefined && (
                    <span className="text-xs tabular-nums text-secondary">{rupees(a.bookValue)}</span>
                  )}
                  {a.kind === 'BOOKING' ? (
                    <Badge tone={a.overdue ? 'bad' : 'warn'}>{dueLabel(a.dueAt)}</Badge>
                  ) : (
                    <Badge tone="info">Yours</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 flex items-center gap-1.5 border-t border-border pt-3 text-micro text-secondary">
          <Package className="h-3.5 w-3.5" strokeWidth={1.75} />
          Bring anything with a date on it back to the office, or ask for the date to be moved.
        </p>
      </CardBody>
    </Card>
  );
}
