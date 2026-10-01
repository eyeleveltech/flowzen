'use client';

/**
 * A record page that has no record to show — and the honest reason why.
 *
 * Two answers, never one: the server said the record is not there (a 404 — it
 * was removed, or the link has a wrong id), or the record could not be loaded
 * at all (the server failed, or this device is offline). The company page used
 * to say "Company Not Found" for both, which told somebody on a bad connection
 * that their client had been deleted.
 *
 * So "isn't here" is said only on a 404. Anything else is "couldn't load", with
 * Try again — and both offer the way back to the record's own list.
 */

import { CloudOff, FileQuestion } from 'lucide-react';
import { ApiError } from '@/lib/api-v2';
import { ScreenMessage, type ScreenAction } from './screen-message';

/** The server's answer was "no such record", not a failure. */
export const isGone = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

export function NotFoundPanel({
  thing,
  error,
  back,
  onRetry,
}: {
  /** What the record is, as people say it: "company", "project", "asset". */
  thing: string;
  /** Why there is no record. Nothing at all reads as "isn't here". */
  error: unknown;
  /** The record's own list: { href: '/assets', label: 'Back to Assets' }. */
  back: { href: string; label: string };
  /** Load the page again; offered only when it could not load. */
  onRetry?: () => void | Promise<unknown>;
}) {
  const failed = Boolean(error) && !isGone(error);

  if (failed) {
    const actions: ScreenAction[] = [];
    if (onRetry) actions.push({ label: 'Try again', onClick: onRetry, primary: true });
    actions.push({ label: back.label, href: back.href });
    return (
      <ScreenMessage
        icon={CloudOff}
        title={`Couldn't load this ${thing}`}
        // The server's own words when it answered; no answer at all is the
        // connection (fetch throws before there is a status).
        message={error instanceof ApiError && error.message ? error.message : 'Check your connection and try again.'}
        actions={actions}
      />
    );
  }

  return (
    <ScreenMessage
      icon={FileQuestion}
      title={`This ${thing} isn't here`}
      message="It may have been removed."
      actions={[{ label: back.label, href: back.href, primary: true }]}
    />
  );
}
