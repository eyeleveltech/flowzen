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
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/hooks/queries';
import Link from 'next/link';
import { Check } from 'lucide-react';
import {
  api,
  ApiError,
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
import { DocumentSettingsTab } from './components/DocumentSettingsTab';
import { OnboardingTab } from './components/OnboardingTab';
import { TrashTab } from './components/TrashTab';
import { AssetsTab } from './components/AssetsTab';

const TABS = [
  { key: 'organisation', label: 'Organisation' },
  { key: 'documents', label: 'Tax & numbering' },
  { key: 'proforma', label: 'Documents & billing' },
  { key: 'email', label: 'Email' },
  { key: 'team', label: 'Team' },
  { key: 'assets', label: 'Assets' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'trash', label: 'Trash' },
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
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: number[];
  holidays: string;
  aiProvider: string;
  /** Typed to replace what is stored; blank means "leave it alone". */
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  stageProbProposalSent: string;
  stageProbInNegotiation: string;
  stageProbProformaIssued: string;
  stageProbVerbalYes: string;
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('organisation');
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [team, setTeam] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /*
   * What the key can actually call.
   *
   * The model was a text box with a default picked from memory, and Google had
   * already retired that name — so the assistant's first answer to anybody was
   * a 404 telling them to change a setting they had no way of knowing the
   * right value for. Asking the key is the only honest source: availability
   * varies by key, by region and by month.
   */
  const [models, setModels] = useState<string[] | null>(null);
  /*
   * Which providers exist, from the server.
   *
   * Fetched rather than written in here so this dropdown and the adapters
   * cannot disagree — adding one should not mean editing a list in two places.
   */
  const [providers, setProviders] = useState<
    { id: string; label: string; defaultModel: string; defaultBaseUrl: string; needsBaseUrl: boolean }[]
  >([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
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
        // These arrive only for setup.admin — the same people who can reach
        // this form at all. The fallbacks are for the type, not for a case
        // anybody sees.
        documentPrefix: o.documentPrefix ?? '',
        fiscalYearStart: String(o.fiscalYearStart),
        mailFromName: o.mailFromName ?? '',
        mailFromEmail: o.mailFromEmail ?? '',
        allowPasswordLogin: o.allowPasswordLogin ?? true,
        workingHoursStart: o.workingHoursStart ?? '10:00',
        workingHoursEnd: o.workingHoursEnd ?? '19:00',
        workingDays: o.workingDays ?? [1, 2, 3, 4, 5, 6],
        // One per line is how somebody actually types a year of holidays.
        holidays: (o.holidays ?? []).join('\n'),
        aiProvider: o.aiProvider ?? 'GEMINI',
        // Never prefilled: the server does not send it back, and an empty
        // box that saves as "keep what you have" is the honest shape.
        aiApiKey: '',
        aiModel: o.aiModel ?? '',
        aiBaseUrl: o.aiBaseUrl ?? '',
        stageProbProposalSent: String(o.stageProbabilities?.PROPOSAL_SENT ?? 30),
        stageProbInNegotiation: String(o.stageProbabilities?.IN_NEGOTIATION ?? 60),
        stageProbProformaIssued: String(o.stageProbabilities?.PROFORMA_ISSUED ?? 85),
        stageProbVerbalYes: String(o.stageProbabilities?.VERBAL_YES ?? 90),
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

  // The switch the API enforces on every one of these saves, not a rung on the
  // old role ladder — ACCOUNTS maps to ADMIN there while holding no
  // setup.admin, which offered them fields that every save would refuse.
  // Not gated on a key: the list is what you choose FROM, so it has to be
  // there before there is anything configured.
  useEffect(() => {
    let cancelled = false;
    void api.assistant
      .providers()
      .then((r) => {
        if (!cancelled) setProviders(r.providers);
      })
      .catch(() => {
        // Only MANAGEMENT may ask. Below that the dropdown falls back to
        // showing whatever is stored, which is all they could do anyway.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.organization.aiConfigured) {
      setModels(null);
      return;
    }
    let cancelled = false;
    void api.assistant
      .models()
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch((e) => {
        // Not fatal: the field falls back to free text, which is still usable.
        if (!cancelled) setModelsError(e instanceof Error ? e.message : 'Could not list models');
      });
    return () => {
      cancelled = true;
    };
  }, [config?.organization.aiConfigured, config?.organization.aiProvider]);

  const canEdit = Boolean(config?.me.permissions?.includes('setup.admin'));
  const chosen = providers.find((p) => p.id === form?.aiProvider);

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
        workingHoursStart: form.workingHoursStart,
        workingHoursEnd: form.workingHoursEnd,
        workingDays: form.workingDays,
        // Typed one per line, but a pasted comma-separated list should work too.
        holidays: form.holidays
          .split(/[\n,]/)
          .map((d) => d.trim())
          .filter(Boolean),
        /*
         * Only sent when something was typed. An untouched field is blank, and
         * blank means "leave the stored key alone" — sending it would clear the
         * key every time anybody saved any other setting on this page.
         */
        ...(form.aiApiKey.trim() ? { aiApiKey: form.aiApiKey.trim() } : {}),
        aiProvider: form.aiProvider,
        ...(form.aiModel.trim() ? { aiModel: form.aiModel.trim() } : {}),
        aiBaseUrl: form.aiBaseUrl.trim(),
        stageProbProposalSent: Number(form.stageProbProposalSent),
        stageProbInNegotiation: Number(form.stageProbInNegotiation),
        stageProbProformaIssued: Number(form.stageProbProformaIssued),
        stageProbVerbalYes: Number(form.stageProbVerbalYes),
      });
      // The org config is cached for an hour and read across the app. Without
      // this the other screens would show the old settings for the rest of the
      // session — the one place a long staleTime needs an explicit nudge.
      await queryClient.invalidateQueries({ queryKey: qk.config });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form || !config) return <PageSkeleton />;

  const tz = config.organization.timezone;
  const locale = config.organization.locale;

  return (
    <div className="page-shell">
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

            {/*
              §14 makes both of these settings — "All configurable in Setup" —
              and until now neither had anywhere to be set. The working calendar
              columns existed and nothing read them; the stage probabilities
              were compiled into three different files that disagreed.
            */}
            <Card padding="none">
              <CardHeader>
                <CardTitle>Working calendar</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">
                  What counts as working time. Every elapsed figure in the app — how long a task took, your average
                  close, the medians the aging alert compares against — is measured against this.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Day starts"
                    value={form.workingHoursStart}
                    onChange={(v) => set('workingHoursStart', v)}
                    type="time"
                    disabled={!canEdit}
                  />
                  <Field
                    label="Day ends"
                    value={form.workingHoursEnd}
                    onChange={(v) => set('workingHoursEnd', v)}
                    type="time"
                    disabled={!canEdit}
                  />
                </div>
                <div>
                  <span className="eyebrow mb-1.25 block">Days worked</span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      [1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun'],
                    ].map(([day, label]) => {
                      const on = form.workingDays.includes(day as number);
                      return (
                        <button
                          key={String(day)}
                          type="button"
                          disabled={!canEdit}
                          aria-pressed={on}
                          onClick={() =>
                            set(
                              'workingDays',
                              on
                                ? form.workingDays.filter((d) => d !== day)
                                : [...form.workingDays, day as number].sort(),
                            )
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                            on
                              ? 'border-primary/30 bg-primary/5 text-primary'
                              : 'border-border text-secondary hover:bg-subtle'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Field
                  label="Public holidays"
                  value={form.holidays}
                  onChange={(v) => set('holidays', v)}
                  textarea
                  rows={4}
                  disabled={!canEdit}
                  placeholder={'2026-01-14\n2026-11-08'}
                  hint="One date per line, as YYYY-MM-DD. A day here is not counted as working time, the same way a Sunday is not."
                />
              </CardBody>
            </Card>

            <Card padding="none">
              <CardHeader>
                <CardTitle>Stage probabilities</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">
                  How likely a deal at each stage is to land. Weighted pipeline is the deal&apos;s value multiplied by
                  this, so it decides what the Pipeline board and the Forecast both report. A single deal can still be
                  overridden on its own card.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Proposal sent (%)" value={form.stageProbProposalSent} onChange={(v) => set('stageProbProposalSent', v)} type="number" disabled={!canEdit} />
                  <Field label="In negotiation (%)" value={form.stageProbInNegotiation} onChange={(v) => set('stageProbInNegotiation', v)} type="number" disabled={!canEdit} />
                  <Field label="Proforma issued (%)" value={form.stageProbProformaIssued} onChange={(v) => set('stageProbProformaIssued', v)} type="number" disabled={!canEdit} />
                  <Field label="Verbal yes (%)" value={form.stageProbVerbalYes} onChange={(v) => set('stageProbVerbalYes', v)} type="number" disabled={!canEdit} />
                </div>
                <p className="text-micro text-secondary">
                  Won is always 100% and lost is always nothing — neither is a prediction.
                </p>
              </CardBody>
            </Card>

            <Card padding="none">
              <CardHeader>
                <CardTitle>Zen — the assistant</CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                <p className="text-xs text-secondary">
                  A key turns on Zen. It is asked with the month&apos;s real figures — client names, fees,
                  costs, margins, the pipeline and who is carrying what — so those are sent to whichever
                  provider you choose in order to answer a question. Salaries never are. Only MANAGEMENT can
                  ask it, and every question is recorded in the activity log.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldSelect
                    label="Provider"
                    value={form.aiProvider}
                    onChange={(v) => {
                      /*
                       * Changing provider changes what a model name means, so
                       * the model comes with it. Keeping the old one would
                       * offer `gemini-2.5-flash` to OpenAI and produce a 404
                       * at the moment somebody asks a question.
                       */
                      const picked = providers.find((p) => p.id === v);
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              aiProvider: v,
                              aiModel: picked?.defaultModel ?? '',
                              aiBaseUrl: picked?.needsBaseUrl ? f.aiBaseUrl : '',
                            }
                          : f,
                      );
                      // The list belongs to the old key and the old provider.
                      setModels(null);
                      setModelsError(null);
                    }}
                    options={
                      providers.length
                        ? providers.map((p) => ({ value: p.id, label: p.label }))
                        : [{ value: form.aiProvider, label: form.aiProvider }]
                    }
                    disabled={!canEdit}
                  />
                  <Field
                    label="API key"
                    type="password"
                    value={form.aiApiKey}
                    onChange={(v) => set('aiApiKey', v)}
                    placeholder={config?.organization.aiConfigured ? '•••••••• (a key is set)' : 'Paste a key to turn it on'}
                    hint={
                      config?.organization.aiConfigured
                        ? 'A key is on file. Type a new one to replace it — leaving this blank keeps the one you have.'
                        : `${chosen?.label ?? 'The provider'}'s key. Stored on the server, never sent to the browser.`
                    }
                    disabled={!canEdit}
                  />
                  {/*
                    * Only for the compatible option, where the provider IS the
                    * address: OpenRouter, Groq, a local server. The named three
                    * know where they live.
                    */}
                  {chosen?.needsBaseUrl && (
                    <Field
                      label="API address"
                      value={form.aiBaseUrl}
                      onChange={(v) => set('aiBaseUrl', v)}
                      placeholder="https://openrouter.ai/api/v1"
                      hint="The base URL of an OpenAI-compatible endpoint, up to and including /v1."
                      disabled={!canEdit}
                    />
                  )}
                  {models && models.length > 0 ? (
                    <FieldSelect
                      label="Model"
                      value={form.aiModel}
                      onChange={(v) => set('aiModel', v)}
                      options={
                        // Whatever is stored stays selectable even if the key
                        // can no longer call it — otherwise the dropdown would
                        // silently show something other than what is saved.
                        (models.includes(form.aiModel)
                          ? models
                          : [form.aiModel, ...models].filter(Boolean)
                        ).map((m) => ({ value: m, label: m }))
                      }
                      disabled={!canEdit}
                    />
                  ) : (
                    <Field
                      label="Model"
                      value={form.aiModel}
                      onChange={(v) => set('aiModel', v)}
                      placeholder={chosen?.defaultModel || 'Name the model'}
                      hint={
                        modelsError
                          ? `Could not list models (${modelsError}). Type one if you know it.`
                          : 'Save a key and this becomes a list of what that key can call.'
                      }
                      disabled={!canEdit}
                    />
                  )}
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
                  Compared with each document&apos;s place of supply: same state means CGST+SGST,
                  anywhere else means IGST. The place of supply is set per document and defaults
                  to the client&apos;s state.
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

        {tab === 'proforma' && <DocumentSettingsTab canEdit={canEdit} />}

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
                    <Badge>{(m.role ?? '').replace('_', ' ').toLowerCase()}</Badge>
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


        {tab === 'onboarding' && (
          <OnboardingTab config={config} onSaved={() => void load()} />
        )}

        {tab === 'assets' && (
          <AssetsTab
            canEdit={canEdit}
            tagPrefix={config.organization.assetTagPrefix ?? 'EL'}
            financialYearStart={config.organization.fiscalYearStart ?? 4}
            onSaved={() => void load()}
          />
        )}

        {tab === 'trash' && <TrashTab />}

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
        <span className="inline-flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5" /> Saved
        </span>
      )}
      <Button type="submit" variant="primary" loading={saving}>
        Save
      </Button>
    </div>
  );
}
