'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export type Crumb = { label: string; href?: string };

/**
 * Where a work page sits: Companies › Acme › Retainer › Monthly delivery
 * (QA19 fixes plan, small wins). The last crumb is the page itself, so it is
 * text, not a link. A long name truncates rather than pushing the row wide.
 */
export function Breadcrumbs({ items, className = '' }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`mb-4 min-w-0 ${className}`}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-secondary">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="flex min-w-0 max-w-full items-center gap-1">
              {c.href && !last ? (
                <Link href={c.href} className="truncate underline-offset-2 transition-colors hover:text-primary hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={`truncate ${last ? 'font-medium text-primary' : ''}`}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
