'use client';

/**
 * The "?" beside the page title, and the small panel it opens.
 *
 * Every page, from the address alone (`usePathname`), so it does not depend on
 * the page using `PageHeader`. The words live in `config/pageHelp.ts`; this
 * only draws them: what the page is for, the things you do there, and "Read
 * more" into the matching part of How it works.
 *
 * A page this person cannot open — an address they typed or kept, which the
 * layout answers with "no access" — gets the general card, never that page's.
 */

import { useId, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, CheckCircle2, HelpCircle } from 'lucide-react';
import { Drawer } from '@/components/ui/drawer';
import { useAuthStore } from '@/stores';
import { canSee, headsOnlyAccess, managementOnlyAccess, permissionForPath } from '@/config/navigation';
import { GENERAL_HELP, helpFor, readMoreHref } from '@/config/pageHelp';

export function PageHelp({
  footer,
}: {
  /**
   * The slot at the bottom of the panel, under "Read more": Ease Plan 3's
   * "Something confusing? Tell us". Given the panel's close, so what it opens
   * does not sit on top of the help.
   */
  footer?: (close: () => void) => ReactNode;
}) {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const forId = useId();
  const doId = useId();

  /*
   * Open for one address only. Going to another page — "Read more" included —
   * closes it, without an effect to run: it is open only while the address it
   * was opened on is still the one showing.
   */
  const [openOn, setOpenOn] = useState<string | null>(null);
  const isOpen = openOn === pathname;
  const close = () => setOpenOn(null);

  // The same three questions the layout asks before it shows a page.
  const needs = permissionForPath(pathname);
  const refused =
    (Boolean(needs) && !canSee({ needs }, user?.permissions)) ||
    headsOnlyAccess(pathname, user) === 'refused' ||
    managementOnlyAccess(pathname, user) === 'refused';
  const help = refused ? GENERAL_HELP : helpFor(pathname);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpenOn(pathname)}
        aria-label="Help for this page"
        aria-haspopup="dialog"
        // No `aria-expanded`: the drawer ignores Escape pressed inside an
        // element marked expanded (that is how it lets a dropdown close first),
        // so it would stop Escape closing this panel while the "?" has focus.
        title="Help for this page"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-secondary hover:bg-surface hover:text-primary transition-colors duration-150 motion-reduce:transition-none outline-none focus-visible:ring-2 focus-visible:ring-primary/25 sm:h-8 sm:w-8"
      >
        <HelpCircle className="h-4.5 w-4.5" aria-hidden="true" />
      </button>

      <Drawer
        isOpen={isOpen}
        onClose={close}
        variant="slideover"
        title={help.title}
        description="Help for this page"
        // Narrower than the default panel on a computer. `md:` so a phone's
        // bottom sheet keeps the full width of the screen.
        className="md:max-w-sm"
      >
        <div className="space-y-6 md:px-6 md:py-5">
          <section aria-labelledby={forId}>
            <h4 id={forId} className="eyebrow">
              What this page is for
            </h4>
            <p className="mt-2 text-sm leading-relaxed text-body">{help.purpose}</p>
          </section>

          <section aria-labelledby={doId}>
            <h4 id={doId} className="eyebrow">
              What you do here
            </h4>
            <ul className="mt-3 space-y-2.5">
              {help.steps.map((step) => (
                <li key={step} className="flex gap-2.5 text-sm leading-relaxed text-body">
                  <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ul>
          </section>

          {/*
            `tabIndex` because the drawer's focus trap only cycles through
            elements it lists (buttons, fields and anything with a tabindex),
            and a plain link is not one of them — without it, Tab never
            reaches "Read more". A link in the footer slot needs the same.
          */}
          <Link
            href={readMoreHref(help)}
            onClick={close}
            tabIndex={0}
            className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            Read more in How it works
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>

          {/* The feedback slot (Ease Plan 3). Renders nothing until a footer is passed. */}
          {footer && <div className="border-t border-border pt-4">{footer(close)}</div>}
        </div>
      </Drawer>
    </>
  );
}
