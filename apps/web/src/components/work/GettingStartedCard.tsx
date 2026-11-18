'use client';

/**
 * "Getting started" at the top of My Work (Ease Plan 2), for everybody, new
 * and existing: the few things that make Flowzen worth opening every day.
 *
 * Every tick is worked out on the server from what already exists, so a step
 * done anywhere — How it works, Profile, a phone — shows here on the next
 * look. It stays until every step is done, or until Hide (Profile can bring
 * it back).
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowRight, Check } from 'lucide-react';
import { api, type GettingStartedStep } from '@/lib/api-v2';
import { qk, useGettingStarted } from '@/hooks/queries';
import { GETTING_STARTED_LABEL } from '@/lib/gettingStarted';

export function GettingStartedCard({
  onAddTask,
  onFinishTask,
}: {
  /** "Add your first task": the new-task form. */
  onAddTask: () => void;
  /** "Finish a task": the list below, where each task's status is. */
  onFinishTask: () => void;
}) {
  const { data } = useGettingStarted();
  const queryClient = useQueryClient();
  const [hiding, setHiding] = useState(false);

  if (!data?.success || data.hidden || data.complete) return null;

  const hide = async () => {
    setHiding(true);
    try {
      await api.me.setGettingStartedHidden(true);
      queryClient.setQueryData(qk.gettingStarted, { ...data, hidden: true });
      toast.success('Hidden. Profile can bring it back.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not hide it');
    } finally {
      setHiding(false);
    }
  };

  /** What doing a step means: a page to open, or something on this one. */
  const action = (key: GettingStartedStep): { href: string } | { onClick: () => void } => {
    switch (key) {
      case 'phone':
        return { href: '/profile' };
      case 'phoneApp':
        return { href: '/profile#phone-notifications' };
      case 'firstTask':
        return { onClick: onAddTask };
      case 'finishTask':
        return { onClick: onFinishTask };
      case 'howItWorks':
        return { href: '/how-it-works' };
      case 'google':
        return { href: '/profile#google-calendar' };
    }
  };

  return (
    <section aria-labelledby="getting-started-title" className="mb-4 rounded-card border border-border bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="getting-started-title" className="text-sm font-semibold text-primary">
          Getting started · {data.done} of {data.total} done
        </h2>
        <button
          type="button"
          onClick={() => void hide()}
          disabled={hiding}
          className="rounded-sm text-micro font-medium text-secondary underline-offset-2 outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
        >
          Hide
        </button>
      </div>
      <ul className="divide-y divide-border">
        {data.steps.map((step) => {
          const label = `${GETTING_STARTED_LABEL[step.key]}${step.optional ? ' (optional)' : ''}`;
          const go = action(step.key);
          const body = (
            <>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                  step.done ? 'bg-success text-white' : 'border border-border text-secondary'
                }`}
                aria-hidden="true"
              >
                {step.done ? <Check className="h-3 w-3" strokeWidth={3} /> : <ArrowRight className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm ${step.done ? 'text-secondary line-through' : 'font-medium text-primary'}`}>{label}</span>
                {/* The two ways onto a phone, in two lines — it is the step people skip. */}
                {step.key === 'phoneApp' && !step.done && (
                  <span className="mt-1 block text-micro text-secondary">
                    Android: open Flowzen in Chrome, tap ⋮ then <span className="font-medium">Install app</span> (or Add to Home screen).
                    <br />
                    iPhone: open it in Safari, tap Share then <span className="font-medium">Add to Home Screen</span>, open Flowzen from there and turn on notifications in Profile.
                  </span>
                )}
                {step.key === 'firstTask' && !step.done && (
                  <span className="mt-1 block text-micro text-secondary">Opens the form for a task of your own.</span>
                )}
                {step.key === 'finishTask' && !step.done && (
                  <span className="mt-1 block text-micro text-secondary">Set a task&apos;s status to Done when it is finished.</span>
                )}
              </span>
            </>
          );
          const row = 'flex w-full items-start gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40';
          return (
            <li key={step.key} data-step={step.key} data-done={step.done ? 'yes' : 'no'}>
              {step.done ? (
                <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
              ) : 'href' in go ? (
                <Link href={go.href} className={row}>
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={go.onClick} className={row}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
