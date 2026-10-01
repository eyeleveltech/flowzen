'use client';

/**
 * The one way a screen says it cannot show what was asked for.
 *
 * A page that does not exist, a screen that crashed, a screen this person does
 * not have, a record that is not there — each used to fail its own way: a white
 * Next.js 404 outside the app, "Application error" with the whole app gone, a
 * silent bounce to My Work, or one of five different "not found" blocks. Now
 * every one of them is the same thing inside Flowzen: one icon, a title, one
 * line, and the buttons that get somebody moving again.
 */

import { useState } from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { buttonClass } from './button';
import { cn } from '@/lib/utils';

export type ScreenAction = {
  label: string;
  /** A link: a real `<a>`, so it can be opened in a new tab like any other. */
  href?: string;
  /** Or something to do. A promise keeps the button busy until it settles. */
  onClick?: () => void | Promise<unknown>;
  primary?: boolean;
};

function ActionButton({ action }: { action: ScreenAction }) {
  const [busy, setBusy] = useState(false);
  const cls = cn(buttonClass(action.primary ? 'primary' : 'secondary'), 'w-full sm:w-auto');

  if (action.href) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      disabled={busy}
      onClick={async () => {
        const done = action.onClick?.();
        if (!(done instanceof Promise)) return;
        setBusy(true);
        try {
          await done;
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {action.label}
    </button>
  );
}

export function ScreenMessage({
  icon: Icon,
  title,
  message,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  message: string;
  actions: ScreenAction[];
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-subtle text-secondary">
        <Icon className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="text-balance text-lg font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-secondary">{message}</p>
      {/* Stacked full-width on a phone, side by side from small screens up. */}
      <div className="mt-6 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">
        {actions.map((a) => (
          <ActionButton key={a.label} action={a} />
        ))}
      </div>
    </div>
  );
}
