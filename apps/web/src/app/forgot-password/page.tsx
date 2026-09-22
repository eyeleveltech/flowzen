'use client';

/**
 * Asking for a password reset link.
 *
 * §16: "Password reset by email." Half of it already existed — an admin could
 * issue a link from Team, and /reset-password consumes it — but the person
 * could not ask for one themselves, so the login screen said to go and find an
 * admin, which out of hours is the next working day.
 *
 * ─── Why the screen never says whether the account exists ───────────────────
 *
 * The server answers identically for a real account, a switched-off one and a
 * stranger, because anything else would make this a way to find out who works
 * here. This screen shows that same answer as-is rather than trying to be more
 * helpful than it is allowed to be — so it says "if that address has an
 * account", and means the "if".
 */

import { useState } from 'react';
import Link from 'next/link';
import { apiPost, ApiError } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      setSent(res.message);
    } catch (err) {
      // Only a malformed address gets here; the server does not distinguish
      // between accounts, so there is nothing else it can refuse for.
      setError(err instanceof ApiError ? err.message : 'Could not send that request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle px-4 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-white p-7">
        <h1 className="text-lg font-semibold text-primary">Reset your password</h1>

        {sent ? (
          <>
            <p className="mt-3 text-sm text-body">{sent}</p>
            <p className="mt-2 text-xs text-secondary">
              The link works once and expires in an hour. If it does not arrive, check the spam folder — or ask an
              admin, who can issue one from the Team screen.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            <p className="text-sm text-secondary">
              Enter the address you sign in with and we will send a link to set a new password.
            </p>

            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-body">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@eyelevelstudio.in"
                className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary placeholder:text-secondary outline-none transition-colors duration-150 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 motion-reduce:transition-none"
              />
            </div>

            {error && <p className="text-xs text-danger">{error}</p>}

            <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!email.trim() || busy}>
              Send the link
            </Button>

            <Link
              href="/login"
              className="block text-center text-xs text-secondary underline-offset-2 hover:text-primary hover:underline"
            >
              Back to sign in
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
