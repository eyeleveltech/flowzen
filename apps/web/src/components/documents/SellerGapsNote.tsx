'use client';

/**
 * What the seller block still needs, said where somebody can act on it.
 *
 * A tax invoice must carry the supplier's name, address and GSTIN. Until those
 * are set the renderer refuses to produce one — which is right, but only
 * useful if the refusal arrives before somebody has a client on the phone
 * waiting for the document. So the same list is shown on the Settings tab that
 * owns the fields, and above the invoice register where the download lives.
 *
 * It names the tab for each missing field rather than linking to it: they are
 * three different tabs and one of them is the one you are already on.
 */

import { AlertTriangle, Info } from 'lucide-react';
import type { SellerGap } from '@/lib/api-v2';

export function SellerGapsNote({ gaps, className = '' }: { gaps: SellerGap[]; className?: string }) {
  if (!gaps || gaps.length === 0) return null;

  const required = gaps.filter((g) => g.severity === 'required');
  const recommended = gaps.filter((g) => g.severity === 'recommended');
  const blocking = required.length > 0;

  const list = (items: SellerGap[]) =>
    items.map((g) => `${g.label} (Settings → ${g.where})`).join(', ');

  return (
    <div
      className={`rounded-xl border px-3.5 py-3 ${
        blocking ? 'border-warning/40 bg-warning-tint' : 'border-border bg-subtle'
      } ${className}`}
      role={blocking ? 'alert' : undefined}
    >
      <div className="flex gap-2.5">
        {blocking ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-ink" />
        ) : (
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
        )}
        <div className="space-y-1 text-sm">
          {blocking && (
            <p className="text-body">
              <span className="font-semibold">A tax invoice cannot be printed yet.</span> It has to carry your
              own {required.length > 1 ? 'details' : 'detail'}: {list(required)}.
            </p>
          )}
          {recommended.length > 0 && (
            <p className={blocking ? 'text-secondary' : 'text-body'}>
              {blocking ? 'Also worth setting' : 'Worth setting'}: {list(recommended)}.
            </p>
          )}
          {blocking && (
            <p className="text-micro text-secondary">
              A proforma still prints — it is a quotation, not a tax document.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
