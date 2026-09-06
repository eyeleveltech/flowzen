'use client';

/**
 * Setting a new password from a link an admin issued.
 *
 * There is no self-service "forgot password", because the token has to REACH the
 * person and Flowzen has no mail account connected. An admin generates the link
 * from the Team screen and hands it over — the same honest compromise as
 * invitations (master plan §3.12).
 */

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api-v2';
import { useAuthStore } from '@/stores';

function ResetPassword() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const { setAuth } = useAuthStore();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const data = await api.auth.resetPassword(token, password);
      setAuth(data.user as never);
      router.push('/my-work');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the password');
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-8">
      <div className="w-full max-w-sm">
        <img src="/logo_flowzen.png" alt="Flowzen" width={180} height={48} className="mb-10 h-12 w-auto object-contain" />

        {!token ? (
          <>
            <h1 className="text-2xl font-semibold text-primary">This link is incomplete</h1>
            <p className="mt-2 text-sm text-secondary">
              It is missing its token. Ask an admin for a fresh one — they expire after an hour.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold text-primary">Choose a new password</h1>
            <p className="mb-8 mt-1 text-sm text-secondary">
              Every device you are signed in on will be signed out.
            </p>

            <form onSubmit={submit} className="space-y-4">
              {error && (
                <p className="rounded-xl border border-danger/20 bg-danger-tint px-4 py-3 text-sm text-danger">
                  {error}
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-body" htmlFor="new-password-setpassword-e-target-">New password</label>
                <div className="relative">
                  <input
                    aria-label="New password"
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    className="w-full rounded-xl border border-border bg-white px-4 py-2.5 pr-10 text-sm text-primary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-secondary hover:text-primary"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-secondary">At least 8 characters.</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-body">Again</label>
                <input id="new-password-setpassword-e-target-"
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full rounded-xl border border-border bg-white px-4 py-2.5 text-sm text-primary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                />
              </div>

              <button
                type="submit"
                disabled={saving || password.length < 8}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Set password
              </button>
            </form>
          </>
        )}

        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-secondary" />
        </div>
      }
    >
      <ResetPassword />
    </Suspense>
  );
}
