'use client';

/**
 * Your own account.
 *
 * Deliberately narrow. Email is not editable because it is what you sign in as,
 * and your role is not here at all — nobody promotes themselves, and a screen
 * that appears to offer it invites the attempt (master plan §5).
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError, formatDate, type OrgConfig, type Profile, type Role } from '@/lib/api-v2';
import { useAuthStore } from '@/stores';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardBody, CardFooter } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { getInitials, getAvatarColor } from '@/lib/utils';

const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALES: 'Sales',
  MEMBER: 'Member',
};

export default function ProfilePage() {
  const { setAuth, user } = useAuthStore();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState('');
  const [designation, setDesignation] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [me, cfg] = await Promise.all([api.profile.get(), api.config.get()]);
      setProfile(me);
      setConfig(cfg);
      setName(me.name);
      setDesignation(me.designation ?? '');
      setPhone(me.phone ?? '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.profile.update({ name, designation: designation || null, phone: phone || null });
      // Keep the header and sidebar in step without a reload.
      if (user) setAuth({ ...user, name, designation: designation || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageSkeleton />;

  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const locale = config?.organization.locale ?? 'en-IN';

  return (
    <div className="max-w-2xl">
      <PageHeader title="Your profile" subtitle={profile?.organization.name} />

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        <Card padding="none">
          <form onSubmit={save}>
            <CardBody className="space-y-4">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${profile ? getAvatarColor(profile.name) : 'bg-primary text-white'}`}
                >
                  {profile ? getInitials(profile.name) : '—'}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-primary">{profile?.name}</p>
                  <p className="truncate text-xs text-secondary">{profile?.email}</p>
                </div>
              </div>

              <Field label="Name" value={name} onChange={setName} required />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Job title" value={designation} onChange={setDesignation} />
                <Field label="Phone" type="tel" value={phone} onChange={setPhone} />
              </div>
            </CardBody>

            <CardFooter>
              {saved && (
                <span className="mr-auto inline-flex items-center gap-1 text-xs text-green-700">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              <Button type="submit" variant="primary" loading={saving} disabled={!name}>
                Save
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* ── What cannot be changed here, and why ────────────────────────── */}
        <Card padding="none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-secondary" strokeWidth={1.75} />
              Your account
            </CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="space-y-2.5">
              <Row label="Email" value={profile?.email ?? '—'} hint="This is what you sign in as." />
              <Row
                label="Level"
                value={profile ? ROLE_LABEL[profile.role] : '—'}
                hint="Only an admin can change this — nobody promotes themselves."
              />
              <Row label="Organisation" value={profile?.organization.name ?? '—'} />
              <Row label="Joined" value={formatDate(profile?.joiningDate, tz, locale)} />
              <Row
                label="Sign in with"
                value={
                  [profile?.signIn.password && 'a password', profile?.signIn.google && 'Google']
                    .filter(Boolean)
                    .join(' and ') || '—'
                }
              />
            </dl>
          </CardBody>
        </Card>

        <PasswordCard hasPassword={Boolean(profile?.signIn.password)} />
      </div>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <dt className="w-28 shrink-0 text-xs text-secondary">{label}</dt>
        <dd className="text-sm text-body">{value}</dd>
      </div>
      {hint && <p className="mt-0.5 pl-28 text-xs text-secondary">{hint}</p>}
    </div>
  );
}

/**
 * Changing a password ends every session, including this one.
 *
 * Said before the button rather than discovered after it — otherwise the
 * redirect to the sign-in screen reads as the app breaking.
 */
function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.profile.setPassword({
        currentPassword: hasPassword ? current : undefined,
        newPassword: next,
      });
      // The cookie this page holds is now stale, so go and sign in rather than
      // letting the next click look like a random logout.
      window.location.href = '/login';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password');
      setSaving(false);
    }
  };

  return (
    <Card padding="none">
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-secondary" strokeWidth={1.75} />
            {hasPassword ? 'Change your password' : 'Set a password'}
          </CardTitle>
        </CardHeader>

        <CardBody className="space-y-4">
          {!hasPassword && (
            <Note>
              You signed in with Google. Setting a password gives you a second way in, and does not
              remove the first.
            </Note>
          )}

          {hasPassword && (
            <Field
              label="Current password"
              type="password"
              value={current}
              onChange={setCurrent}
              required
              autoComplete="current-password"
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="New password"
              type="password"
              value={next}
              onChange={setNext}
              required
              autoComplete="new-password"
              hint="At least 8 characters."
            />
            <Field
              label="Again"
              type="password"
              value={confirm}
              onChange={setConfirm}
              required
              autoComplete="new-password"
            />
          </div>

          {error && <ErrorNote>{error}</ErrorNote>}
        </CardBody>

        <CardFooter>
          <p className="mr-auto text-xs text-secondary">
            This signs you out everywhere, including here.
          </p>
          <Button type="submit" variant="primary" loading={saving} disabled={next.length < 8}>
            {hasPassword ? 'Change it' : 'Set it'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
