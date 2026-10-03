'use client';

/**
 * A filled-in money form, handed from a Zen card to the screen that owns it.
 *
 * Zen never creates a proforma, an invoice, a retainer or a project. Its card
 * writes the values here under a one-time key and goes to the screen with
 * `?zen=<key>`; the screen opens its own create form with those values and
 * forgets the key. The person reads the whole form and presses its Save.
 *
 * The key starts with the form's name, so a screen whose stored values are
 * gone (another tab, storage switched off) still knows which form was meant
 * and opens it empty. Every read and write is guarded: storage can refuse.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ZenForm } from '@/lib/api-v2';

const PREFIX = 'flowzen-zen-form:';

export type ZenFormHandoff = { name: ZenForm['name']; values: Record<string, unknown> };

/** Stores the values and returns the key for `?zen=`. */
export function stashZenForm(form: Pick<ZenForm, 'name' | 'values'>): string {
  const key = `${form.name}.${Math.random().toString(36).slice(2, 10)}`;
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(form.values));
  } catch {
    // The screen opens the form empty; the key still says which one.
  }
  return key;
}

/** The screen's address with the key on it. */
export const zenFormHref = (path: string, key: string) => `${path}${path.includes('?') ? '&' : '?'}zen=${encodeURIComponent(key)}`;

const NAMES: ZenForm['name'][] = ['proposalProforma', 'monthProforma', 'monthInvoice', 'retainer', 'project'];

/*
 * Keys already taken in this tab, with what they held. A screen's effect can
 * run twice for one visit (React does exactly that in development), and the
 * second read must find the same values rather than the emptiness the first
 * read left behind.
 */
const taken = new Map<string, ZenFormHandoff>();

/** Reads the values once, and deletes them. Values are `{}` when they are gone. */
export function takeZenForm(key: string | null): ZenFormHandoff | null {
  if (!key) return null;
  const seen = taken.get(key);
  if (seen) return seen;
  const name = key.split('.')[0] as ZenForm['name'];
  if (!NAMES.includes(name)) return null;
  let values: Record<string, unknown> = {};
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    sessionStorage.removeItem(PREFIX + key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') values = parsed;
  } catch {
    // Unreadable: the form opens empty.
  }
  const handoff = { name, values };
  taken.set(key, handoff);
  return handoff;
}

/**
 * For a screen: the form a Zen card asked it to open, if any — and a way to
 * say it has been opened. The key comes off the address straight away, so a
 * reload does not open it again.
 */
export function useZenForm(): [ZenFormHandoff | null, () => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const key = params.get('zen');
  const [form, setForm] = useState<ZenFormHandoff | null>(null);

  useEffect(() => {
    if (!key) return;
    setForm(takeZenForm(key));
    const rest = new URLSearchParams(params.toString());
    rest.delete('zen');
    router.replace(`${pathname}${rest.size ? `?${rest}` : ''}`, { scroll: false });
    // Once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const opened = useCallback(() => setForm(null), []);
  return [form, opened];
}
