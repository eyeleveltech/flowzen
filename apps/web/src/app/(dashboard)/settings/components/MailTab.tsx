'use client';

/**
 * Setting up sending.
 *
 * Its own tab and its own form, because this is the only part of Settings that
 * can be WRONG rather than merely unset — a timezone typo shows up as a date, a
 * bad SMTP password shows up as an invitation that never arrives, days later,
 * reported by the person who never got it.
 *
 * So the screen is built around proving it works. "Send a test" authenticates
 * first and then sends a real message to you, which makes "it says it worked"
 * and "something arrived" the same claim.
 *
 * The password is never loaded — the server does not return it. `hasPassword`
 * tells the form whether to say "leave blank to keep the current one", which is
 * the only thing it needs to know.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, Mail, Send } from 'lucide-react';
import { api, ApiError, type MailSettings } from '@/lib/api-v2';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';

type Form = {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  mailFromName: string;
  mailFromEmail: string;
  mailReplyTo: string;
};

const blank: Form = {
  smtpHost: '',
  smtpPort: '587',
  smtpUser: '',
  smtpPassword: '',
  mailFromName: '',
  mailFromEmail: '',
  mailReplyTo: '',
};

export function MailTab({
  canEdit,
  orgName,
  onChanged,
}: {
  canEdit: boolean;
  orgName: string;
  /** So the rest of Settings picks up that sending is now on, or off. */
  onChanged: () => void;
}) {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.config.mail();
      setSettings(s);
      setForm({
        smtpHost: s.smtpHost ?? '',
        smtpPort: s.smtpPort ? String(s.smtpPort) : '587',
        smtpUser: s.smtpUser ?? '',
        // Never prefilled. There is nothing to prefill it with.
        smtpPassword: '',
        mailFromName: s.mailFromName ?? '',
        mailFromEmail: s.mailFromEmail ?? '',
        mailReplyTo: s.mailReplyTo ?? '',
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the mail settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setDetail(null);
    setSaved(false);
    setTested(null);
    try {
      await api.config.update({
        smtpHost: form.smtpHost.trim() || null,
        smtpPort: form.smtpPort ? Number(form.smtpPort) : null,
        smtpUser: form.smtpUser.trim() || null,
        // Blank means "keep what is stored", not "clear it" — otherwise
        // correcting the port would wipe a working password as a side effect.
        smtpPassword: form.smtpPassword || null,
        mailFromName: form.mailFromName.trim() || null,
        mailFromEmail: form.mailFromEmail.trim() || null,
        mailReplyTo: form.mailReplyTo.trim() || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setError(null);
    setDetail(null);
    setTested(null);
    try {
      const result = await api.config.testMail();
      setTested(result.message ?? 'Sent.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The test did not go through');
      // The mail server's own words, shown beneath ours rather than instead of
      // them. "535 authentication failed" is the half somebody can act on.
      if (err instanceof ApiError && err.detail) setDetail(err.detail);
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <PageSkeleton />;

  const configured = settings?.configured ?? false;

  return (
    <form onSubmit={save} className="space-y-5">
      {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
      {detail && (
        <p className="rounded-xl border border-border bg-subtle px-3 py-2 font-mono text-[11px] text-secondary">
          {detail}
        </p>
      )}
      {tested && <Note tone="info">{tested}</Note>}

      <Card padding="none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-secondary" strokeWidth={1.75} /> Sending
            <Badge tone={configured ? 'good' : 'neutral'} className="ml-1">
              {configured ? 'On' : 'Off'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-secondary">
            {configured
              ? 'Invitations, password resets and quotations go out on their own.'
              : 'Until a mail server is set up, Flowzen hands you a link to pass on yourself. Nothing is lost either way — only the delivery is manual.'}
          </p>

          {/*
            The case that is otherwise invisible: it works, the form is empty,
            and the mail is leaving from an account nobody here chose. Saying
            whose it is turns a confusing "On" into a decision.
          */}
          {settings?.via === 'ENV_SMTP' && (
            <Note tone="info">
              Sending through the mail account this Flowzen was installed with
              {settings.from ? `, as ${settings.from}` : ''}. Fill in a server below to send as
              yourselves instead.
            </Note>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field
              label="Mail server"
              value={form.smtpHost}
              onChange={(v) => set('smtpHost', v)}
              placeholder="smtp.gmail.com"
              disabled={!canEdit}
              hint="Clearing this turns sending off and forgets the password."
            />
            <Field
              label="Port"
              type="number"
              value={form.smtpPort}
              onChange={(v) => set('smtpPort', v)}
              disabled={!canEdit}
              hint="465 or 587"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Username"
              value={form.smtpUser}
              onChange={(v) => set('smtpUser', v)}
              disabled={!canEdit}
            />
            <Field
              label="Password"
              type="password"
              value={form.smtpPassword}
              onChange={(v) => set('smtpPassword', v)}
              disabled={!canEdit}
              placeholder={settings?.hasPassword ? '••••••••' : ''}
              hint={settings?.hasPassword ? 'Leave blank to keep the current one.' : undefined}
            />
          </div>

          {/*
            Said plainly, because the alternative is somebody pasting their real
            password into a field they assume is special.
          */}
          <Note>
            With Gmail or Google Workspace this is an app password, not the
            account password. Whatever you enter is stored so Flowzen can sign in
            as this account, and is never shown again.
          </Note>
        </CardBody>
      </Card>

      <Card padding="none">
        <CardHeader>
          <CardTitle>How it looks to them</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="From name"
              value={form.mailFromName}
              onChange={(v) => set('mailFromName', v)}
              placeholder={orgName}
              disabled={!canEdit}
              hint="Defaults to the organisation name."
            />
            <Field
              label="From address"
              type="email"
              value={form.mailFromEmail}
              onChange={(v) => set('mailFromEmail', v)}
              placeholder="hello@youragency.com"
              disabled={!canEdit}
            />
          </div>
          <Field
            label="Replies go to"
            type="email"
            value={form.mailReplyTo}
            onChange={(v) => set('mailReplyTo', v)}
            disabled={!canEdit}
            hint="Left blank, a reply to a quotation reaches whoever sent it. That is usually what you want."
          />
        </CardBody>
      </Card>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={saving}>
            Save
          </Button>
          {/*
            Only offered once something is saved. Testing an unsaved form would
            test the settings that are stored, which is the opposite of what the
            button appears to promise.
          */}
          <Button
            type="button"
            icon={Send}
            onClick={test}
            loading={testing}
            disabled={!configured || saving}
          >
            Send a test to me
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      )}
    </form>
  );
}
