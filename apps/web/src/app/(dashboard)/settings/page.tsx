'use client';

/**
 * Settings.
 *
 * Everything here is read by something that would otherwise be a constant: the
 * timezone decides where a day ends, the state decides CGST+SGST versus IGST,
 * the prefix and financial year decide what a document is called (master plan
 * §3.11). That is why it is a screen and not a config file.
 *
 * Tabbed rather than one long form, because the sections answer different
 * questions and are edited at different times — the tax identity is set once,
 * the team changes constantly.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import {
  api,
  ApiError,
  atLeast,
  formatDate,
  type AuditEntry,
  type Member,
  type OrgConfig,
  type Role,
} from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardBody } from '@/components/ui/card';
import { Field, FieldSelect } from '@/components/ui/field';
import { Toggle } from '@/components/ui/toggle';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { MailTab } from './components/MailTab';
import { ConfigList } from './components/ConfigList';
import { OnboardingTab } from './components/OnboardingTab';

const TABS = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'documents', label: 'Tax & numbering' },
  { key: 'email', label: 'Email' },
  { key: 'team', label: 'Team' },
  { key: 'modules', label: 'Modules' },
  { key: 'lists', label: 'Lists' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'activity', label: 'Activity' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: String(i + 1), label }));

/**
 * The states and union territories GST recognises.
 *
 * A free-text box would let "TN", "Tamilnadu" and "Tamil Nadu" all exist, and
 * the split is decided by comparing the seller's state to the buyer's — so a
 * spelling difference silently becomes an IGST invoice that should have been
 * CGST+SGST (§3.11).
 */
const STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar',
  'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
].map((s) => ({ value: s, label: s }));

const MODULE_META: Record<string, { label: string; what: string }> = {
  CRM: { label: 'CRM', what: 'The pipeline, quotations and everything before a client is won.' },
  PM: { label: 'Project Management', what: 'Projects, tasks and who is doing what.' },
  REVENUE: { label: 'Revenue', what: 'What clients agreed to pay, invoices and payments.' },
};

type Form = {
  name: string;
  website: string;
  phone: string;
  address: string;
  state: string;
  gstNumber: string;
  currency: string;
  timezone: string;
  locale: string;
  documentPrefix: string;
  fiscalYearStart: string;
  mailFromName: string;
  mailFromEmail: string;
  allowPasswordLogin: boolean;
};

export default function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('organisation');
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cfg = await api.config.get();
      const o = cfg.organization;
      setConfig(cfg);
      setForm({
        name: o.name,
        website: o.website ?? '',
        phone: o.phone ?? '',
        address: o.address ?? '',
        state: o.state ?? '',
        gstNumber: o.gstNumber ?? '',
        currency: o.currency,
        timezone: o.timezone,
        locale: o.locale,
        documentPrefix: o.documentPrefix,
        fiscalYearStart: String(o.fiscalYearStart),
        mailFromName: o.mailFromName ?? '',
        mailFromEmail: o.mailFromEmail ?? '',
        allowPasswordLogin: o.allowPasswordLogin,
      });
      setError(null);
      // Both are admin-only, so a refusal is expected for anyone below and is
      // not worth showing as an error.
      void api.users.list().then(setTeam).catch(() => {});
      void api.config.auditLog().then(setAudit).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = atLeast(config?.me.role as Role | undefined, 'ADMIN');

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.config.update({
        name: form.name,
        website: form.website || null,
        phone: form.phone || null,
        address: form.address || null,
        state: form.state || null,
        gstNumber: form.gstNumber || null,
        currency: form.currency,
        timezone: form.timezone,
        locale: form.locale,
        documentPrefix: form.documentPrefix,
        fiscalYearStart: Number(form.fiscalYearStart),
        mailFromName: form.mailFromName || null,
        mailFromEmail: form.mailFromEmail || null,
        allowPasswordLogin: form.allowPasswordLogin,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = async (key: string, enabled: boolean) => {
    setBusy(key);
    setError(null);
    try {
      await api.config.setModule(key, enabled);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that');
    } finally {
      setBusy(null);
    }
  };

  if (loading || !form || !config) return <PageSkeleton />;

  const tz = config.organization.timezone;
  const locale = config.organization.locale;

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle={config.organization.name} />

      <div className="space-y-5">
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        {/*
          The one setting whose absence stops work. Shown on every tab, not just
          the one it belongs to — quotations refuse without it, which is correct
          and unhelpful if nothing says which setting is missing.
        */}
        {!config.organization.state && (
          <Note tone="warn">
            No state is set, so quotations and invoices cannot work out the tax.{' '}
            <button onClick={() => setTab('documents')} className="font-medium underline">
              Set it under Tax &amp; numbering
            </button>
            .
          </Note>
        )}

        <div className="flex flex-wrap gap-1 border-b border-border pb-3">
          {TABS.map((t) => (
            <Button
              key={t.key}
              size="sm"
              variant={tab === t.key ? 'primary' : 'ghost'}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </Button>
          ))}
        </div>

        {tab === 'organisation' && (
          <form onSubmit={save} className="space-y-5">
            <Card padding="none">
              <CardHeader>
                <CardTitle>Who you are</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">Printed on every document you send out.</p>
                <Field
                  label="Organisation name"
                  value={form.name}
                  onChange={(v) => set('name', v)}
                  required
                  disabled={!canEdit}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Website" value={form.website} onChange={(v) => set('website', v)} disabled={!canEdit} />
                  <Field label="Phone" value={form.phone} onChange={(v) => set('phone', v)} disabled={!canEdit} />
                </div>
                <Field
                  label="Address"
                  value={form.address}
                  onChange={(v) => set('address', v)}
                  textarea
                  rows={3}
                  disabled={!canEdit}
                />
              </CardBody>
            </Card>

            <Card padding="none">
              <CardHeader>
                <CardTitle>Authentication & Security</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <Toggle
                    checked={form.allowPasswordLogin}
                    onChange={(v) => set('allowPasswordLogin', v)}
                    label="Allow signing in with a password"
                  />
                  <p className="mt-1 text-xs text-secondary">
                    Turn off only once everyone is using Google Workspace authentication, or people will be locked out.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-primary">Outbound Mail Server (SMTP)</p>
                      <p className="text-xs text-secondary mt-0.5">
                        Configure SMTP credentials and sender identities for quotations, invitations, and alerts.
                      </p>
                    </div>
                    <Button type="button" size="sm" onClick={() => setTab('email')}>
                      Configure Email
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>

            {canEdit && <SaveBar saving={saving} saved={saved} />}
          </form>
        )}

        {tab === 'documents' && (
          <form onSubmit={save} className="space-y-5">
            <Card padding="none">
              <CardHeader>
                <CardTitle>Tax identity</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">
                  Decides which tax applies on every quotation and invoice.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldSelect
                    label="State"
                    value={form.state}
                    onChange={(v) => set('state', v)}
                    disabled={!canEdit}
                    placeholder="Not set"
                    options={STATES}
                  />
                  <Field
                    label="GSTIN"
                    value={form.gstNumber}
                    onChange={(v) => set('gstNumber', v.toUpperCase())}
                    placeholder="33ABCDE1234F1Z5"
                    disabled={!canEdit}
                  />
                </div>
                <p className="text-xs text-secondary">
                  Compared with the client&apos;s state: same means CGST+SGST, different means IGST.
                </p>
              </CardBody>
            </Card>

            <Card padding="none">
              <CardHeader>
                <CardTitle>Numbering</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="font-mono text-xs text-secondary">
                  {form.documentPrefix || 'XX'}/QT/2026-27/001
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Prefix"
                    value={form.documentPrefix}
                    onChange={(v) => set('documentPrefix', v.toUpperCase())}
                    required
                    disabled={!canEdit}
                  />
                  <FieldSelect
                    label="Financial year starts"
                    value={form.fiscalYearStart}
                    onChange={(v) => set('fiscalYearStart', v)}
                    disabled={!canEdit}
                    options={MONTHS}
                  />
                </div>
                {/*
                  Counters only ever go forward. Saying so stops somebody
                  "tidying up" a gap and handing out a number already taken.
                */}
                <Note>
                  Numbers are never reused. A gap means a document was created and removed, which is
                  expected.
                </Note>
              </CardBody>
            </Card>

            <Card padding="none">
              <CardHeader>
                <CardTitle>Dates and money</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">
                  Every due date and day boundary is worked out here, never in the browser.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  {/* "IST" is a valid identifier meaning India, Israel AND Ireland. */}
                  <Field
                    label="Timezone"
                    value={form.timezone}
                    onChange={(v) => set('timezone', v)}
                    placeholder="Asia/Kolkata"
                    hint="Full name, e.g. Asia/Kolkata."
                    disabled={!canEdit}
                  />
                  <Field
                    label="Currency"
                    value={form.currency}
                    onChange={(v) => set('currency', v.toUpperCase())}
                    disabled={!canEdit}
                  />
                  <Field
                    label="Number format"
                    value={form.locale}
                    onChange={(v) => set('locale', v)}
                    placeholder="en-IN"
                    disabled={!canEdit}
                  />
                </div>
              </CardBody>
            </Card>

            {canEdit && <SaveBar saving={saving} saved={saved} />}
          </form>
        )}

        {tab === 'email' && (
          <MailTab
            canEdit={canEdit}
            orgName={config.organization.name}
            // Reloads the page's own config, so `mailConfigured` is current
            // everywhere else the moment sending is switched on.
            onChanged={() => void load()}
          />
        )}

        {tab === 'team' && (
          <Card padding="none">
            <CardHeader>
              <CardTitle>The people here</CardTitle>
              <Link href="/members">
                <Button size="sm">Invite and change levels</Button>
              </Link>
            </CardHeader>
            <CardBody>
              <ul className="divide-y divide-border">
                {team.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 py-2.5 first:pt-0">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-primary">{m.name}</p>
                      <p className="truncate text-xs text-secondary">{m.email}</p>
                    </div>
                    <Badge>{m.role.replace('_', ' ').toLowerCase()}</Badge>
                    <Badge
                      tone={m.status === 'ACTIVE' ? 'good' : m.status === 'PENDING' ? 'warn' : 'neutral'}
                    >
                      {m.status.toLowerCase()}
                    </Badge>
                  </li>
                ))}
                {team.length === 0 && (
                  <li className="py-2 text-sm text-secondary">Just you so far.</li>
                )}
              </ul>
              <p className="mt-3 text-xs text-secondary">
                Roles are a ladder — each level includes everything below it.
              </p>
            </CardBody>
          </Card>
        )}

        {tab === 'modules' && (
          <Card padding="none">
            <CardHeader>
              <CardTitle>What this organisation uses</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-xs text-secondary">
                Turning one off hides its screens and refuses its endpoints — it is not only
                cosmetic.
              </p>
              {Object.entries(config.modules).map(([key, on]) => (
                <div key={key} className="flex items-start gap-3 rounded-xl border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary">
                      {MODULE_META[key]?.label ?? key}
                    </p>
                    <p className="text-xs text-secondary">{MODULE_META[key]?.what ?? ''}</p>
                  </div>
                  <Toggle
                    checked={on}
                    onChange={(v) => toggleModule(key, v)}
                    className={!canEdit || busy === key ? 'pointer-events-none opacity-50' : ''}
                  />
                </div>
              ))}
              <Note>
                At least one has to stay on. Which one you are working in is chosen from the
                sidebar.
              </Note>
            </CardBody>
          </Card>
        )}

        {tab === 'lists' && (
          <Card padding="none">
            <CardHeader>
              <CardTitle>Your lists</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs text-secondary">
                Rows in the database rather than values baked into the code — renaming one is an
                edit, not a migration (§3.4).
              </p>
              <div className="grid gap-5 sm:grid-cols-2">
                <ConfigList
                  label="Pipeline stages"
                  items={config.stages}
                  endpoint="stages"
                  onChanged={() => void load()}
                  canEdit={canEdit}
                  canReorder={true}
                  renderExtra={(s) => s.requiresForecast ? <p className="text-xs text-secondary mt-1">Needs a forecast</p> : null}
                />
                <ConfigList 
                  label="Services" 
                  items={config.services} 
                  endpoint="services"
                  onChanged={() => void load()}
                  canEdit={canEdit}
                />
                <ConfigList 
                  label="Lost reasons" 
                  items={config.lostReasons} 
                  endpoint="lost-reasons"
                  onChanged={() => void load()}
                  canEdit={canEdit}
                />
                <ConfigList 
                  label="Lead sources" 
                  items={config.sources} 
                  endpoint="sources"
                  onChanged={() => void load()}
                  canEdit={canEdit}
                />
              </div>
            </CardBody>
          </Card>
        )}

        {tab === 'onboarding' && (
          <OnboardingTab config={config} onSaved={() => void load()} />
        )}

        {tab === 'activity' && (
          <Card padding="none">
            <CardHeader>
              <CardTitle>Who changed what</CardTitle>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-xs text-secondary">
                The last hundred changes to people and money. Read-only — an audit log something can
                edit is not one.
              </p>
              {audit.length === 0 ? (
                <p className="text-sm text-secondary">Nothing recorded yet.</p>
              ) : (
                <ol className="divide-y divide-border">
                  {audit.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex flex-wrap items-baseline gap-2 py-2.5 first:pt-0"
                    >
                      <span className="text-sm text-body">
                        {entry.action.replace(/_/g, ' ').toLowerCase()}
                      </span>
                      <span className="text-xs text-secondary">
                        {entry.user?.name ?? 'System'} · {entry.entityType}
                      </span>
                      <span className="ml-auto text-xs text-secondary">
                        {formatDate(entry.createdAt, tz, locale)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function SaveBar({ saving, saved }: { saving: boolean; saved: boolean }) {
  return (
    <div className="flex items-center justify-end gap-3">
      {saved && (
        <span className="inline-flex items-center gap-1 text-xs text-green-700">
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      )}
      <Button type="submit" variant="primary" loading={saving}>
        Save
      </Button>
    </div>
  );
}
