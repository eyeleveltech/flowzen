'use client';

import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, CirclePause, UserRound, X } from 'lucide-react';
import { Icon } from '@/components/ui/icon';
import { useWaitingOnStore, type WaitChoice } from '@/stores/waitingOn';

/**
 * "Waiting on…" — asked whenever a task goes on hold (QA19 fixes plan, F06).
 *
 * Every screen used to put a task on hold as waiting on the client, hard-coded,
 * so an internal task with no client read "waiting on the client". Three
 * answers now: the client (offered only when the task has one), someone else,
 * or just on hold. The clock pauses the same for all three.
 *
 * Mounted once, beside the confirm dialog; `changeTaskStatus` asks it.
 */
export function WaitingOnDialog() {
  const { open, hasClient, title, choose, cancel } = useWaitingOnStore();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, cancel]);

  const options: { value: WaitChoice; label: string; hint: string; icon: typeof Building2 }[] = [
    ...(hasClient
      ? [{ value: 'CLIENT' as const, label: 'The client', hint: 'Their feedback, files or sign-off', icon: Building2 }]
      : []),
    { value: 'ANOTHER_PERSON', label: 'Someone else', hint: 'A colleague, a supplier, anyone outside this task', icon: UserRound },
    { value: null, label: 'Just on hold', hint: 'Paused, with nothing in particular to wait for', icon: CirclePause },
  ];

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="waiting-on-title"
          className="fixed inset-0 z-999 flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancel}
            className="absolute inset-0 bg-black/30 backdrop-blur-xs"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-white p-6 shadow-modal"
          >
            <button
              type="button"
              onClick={cancel}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-lg p-1.5 text-secondary transition-colors hover:bg-subtle hover:text-body-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <Icon as={X} size="md" />
            </button>
            <h3 id="waiting-on-title" className="pr-8 text-base font-semibold leading-6 text-primary">
              Waiting on…
            </h3>
            {title && <p className="mt-1 truncate pr-8 text-sm text-secondary">{title}</p>}

            <div className="mt-4 space-y-2">
              {options.map((o, i) => (
                <button
                  key={o.label}
                  type="button"
                  autoFocus={i === 0}
                  onClick={() => choose(o.value)}
                  className="flex w-full items-start gap-3 rounded-xl border border-border px-3.5 py-3 text-left transition-colors hover:border-line hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                >
                  <Icon as={o.icon} size="md" className="mt-0.5 shrink-0 text-secondary" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary">{o.label}</span>
                    <span className="block text-xs text-secondary">{o.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            {!hasClient && (
              <p className="mt-3 text-micro text-secondary">This task has no client, so there is no client to wait on.</p>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
