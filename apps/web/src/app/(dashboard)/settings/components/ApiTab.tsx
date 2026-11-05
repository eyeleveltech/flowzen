'use client';

/**
 * Settings → API: apps signed in with Flowzen, and keys for automation tools.
 *
 * Two ways in. Claude.ai, Claude Desktop, Claude mobile and ChatGPT **sign in
 * with Flowzen** (API Plan 2): the person adds Flowzen as a connector, signs
 * in, ticks what the app may do, and the app gets tokens that act as them.
 * Each person's connections are listed here with Revoke; an admin sees
 * everyone's.
 *
 * Everything else takes a **key** (API Plan 1): Management makes one here and
 * hands it to Claude Code, Claude Desktop's config file, or n8n, Make or
 * Zapier (the REST API, /api/v1). A key acts as whoever made it, narrowed to
 * the scopes ticked on it, so it can never see or do more than they can — and
 * the server re-checks that on every request. The key is shown once, when it
 * is made: the server keeps a hash, not the key, so there is nothing to show
 * again.
 *
 * The tab is everyone's, for their own connected apps. The keys, the switch
 * and the connection guide are `setup.admin`'s, and the routes behind them
 * refuse anybody else.
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Ban, Check, Copy, History, KeyRound, Pencil, Plus, Plug, ShieldCheck } from 'lucide-react';
import {
  api,
  ApiError,
  publicApiBase,
  type ApiKeyCall,
  type ApiKeyRow,
  type ApiKeysPage,
  type ApiScopeInfo,
  type ConnectedApp,
} from '@/lib/api-v2';
import { SectionCard } from '@/components/ui/section-card';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, FieldSelect } from '@/components/ui/field';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { ErrorNote, Note } from '@/components/ui/empty-state';
import { RowMenu } from '@/components/ui/row-menu';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/table';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { useConfirmStore } from '@/stores/confirm';
import { cn } from '@/lib/utils';

const KEY = ['api-keys'] as const;

const EXPIRY_LABEL: Record<string, string> = { '30d': '30 days', '90d': '90 days', '1y': '1 year', never: 'Never' };

const STATUS: Record<ApiKeyRow['status'], { label: string; tone: 'good' | 'bad' | 'neutral' }> = {
  active: { label: 'Active', tone: 'good' },
  revoked: { label: 'Revoked', tone: 'bad' },
  expired: { label: 'Expired', tone: 'neutral' },
};

/** "5 Nov 2026, 14:07" and "5 Nov 2026" on the organisation's clock. */
function useWhen(tz: string, locale: string) {
  const when = useMemo(
    () => (iso: string) =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(
        new Date(iso),
      ),
    [locale, tz],
  );
  const dayOf = useMemo(
    () => (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date(iso)),
    [locale, tz],
  );
  return { when, dayOf };
}

export function ApiTab({ tz, locale, admin }: { tz: string; locale: string; admin: boolean }) {
  const { when, dayOf } = useWhen(tz, locale);
  if (!admin) {
    return (
      <div className="space-y-6">
        <ConnectedAppsCard when={when} dayOf={dayOf} />
        <SignInCard />
      </div>
    );
  }
  return <AdminApiTab when={when} dayOf={dayOf} />;
}

function AdminApiTab({ when, dayOf }: { when: (iso: string) => string; dayOf: (iso: string) => string }) {
  const { data, isPending, error } = useQuery({ queryKey: KEY, queryFn: () => api.apiKeys.list() });
  const [creating, setCreating] = useState(false);
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const [editing, setEditing] = useState<ApiKeyRow | null>(null);
  const [usage, setUsage] = useState<ApiKeyRow | null>(null);

  if (isPending) return <PageSkeleton />;
  if (error || !data) return <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the API keys.'}</ErrorNote>;

  return (
    <div className="space-y-6">
      <MasterSwitch enabled={data.enabled} />

      <ConnectedAppsCard when={when} dayOf={dayOf} />

      {!data.configured && (
        <Note tone="warn">
          This server is not set up for API keys yet: add <code className="font-mono">API_KEY_PEPPER</code> (32 or more random
          characters) to its environment and restart it. Until then no key can be made.
        </Note>
      )}

      <SectionCard
        title="Keys"
        description={`Each key acts as the person who made it, with only what is ticked on it. At most ${data.maxActive} working keys at a time; ${data.activeCount} in use.`}
        aside={
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            onClick={() => setCreating(true)}
            disabled={!data.configured || data.activeCount >= data.maxActive}
          >
            New key
          </Button>
        }
      >
        {data.keys.length === 0 ? (
          <p className="text-sm text-secondary">No keys yet. Make one for each tool, so one can be revoked without breaking the others.</p>
        ) : (
          <ul className="-mx-5 divide-y divide-line sm:-mx-6">
            {[...data.keys]
              .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
              .map((k) => (
                <KeyItem
                  key={k.id}
                  row={k}
                  scopes={data.scopes}
                  when={when}
                  dayOf={dayOf}
                  onEdit={() => setEditing(k)}
                  onUsage={() => setUsage(k)}
                />
              ))}
          </ul>
        )}
        {!data.enabled && data.keys.some((k) => k.status === 'active') && (
          <div className="mt-4">
            <Note tone="warn">API keys are switched off, so none of these work right now.</Note>
          </div>
        )}
      </SectionCard>

      <ConnectCard data={data} />

      {creating && (
        <CreateKeyModal
          data={data}
          onClose={() => setCreating(false)}
          onCreated={(key, name) => {
            setCreating(false);
            setShown({ key, name });
          }}
        />
      )}
      {shown && <ShowKeyModal shown={shown} onClose={() => setShown(null)} />}
      {editing && <EditKeyModal row={editing} scopes={data.scopes} onClose={() => setEditing(null)} />}
      {usage && (
        <UsageModal
          title={`Usage of "${usage.name}"`}
          load={() => api.apiKeys.usage(usage.id)}
          queryKey={[...KEY, usage.id, 'usage']}
          when={when}
          keepDays={data.logKeepDays}
          onClose={() => setUsage(null)}
        />
      )}
    </div>
  );
}

// ── Connected apps (API Plan 2) ──────────────────────────────────────────────

const APPS_KEY = ['connected-apps'] as const;

/** The apps that signed in with Flowzen — mine, or everyone's for an admin — with Revoke. */
function ConnectedAppsCard({ when, dayOf }: { when: (iso: string) => string; dayOf: (iso: string) => string }) {
  const { data, isPending, error } = useQuery({ queryKey: APPS_KEY, queryFn: () => api.oauth.grants() });
  const [usage, setUsage] = useState<ConnectedApp | null>(null);

  return (
    <SectionCard
      title="Connected apps"
      description={
        data?.all
          ? 'Everyone’s sign-ins from Claude.ai, Claude Desktop, Claude mobile and ChatGPT. Each acts as the person who connected it, with only what they ticked.'
          : 'Your sign-ins from Claude.ai, Claude Desktop, Claude mobile and ChatGPT. Each acts as you, with only what you ticked.'
      }
    >
      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error || !data ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the connected apps.'}</ErrorNote>
      ) : data.grants.length === 0 ? (
        <p className="text-sm text-secondary">
          Nothing connected yet. In Claude.ai, add Flowzen as a custom connector with the address{' '}
          <code className="font-mono text-xs">{data.mcpUrl}</code> and choose <span className="font-medium">Sign in now</span>.
        </p>
      ) : (
        <ul className="-mx-5 divide-y divide-line sm:-mx-6">
          {[...data.grants]
            .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
            .map((g) => (
              <ConnectedAppItem key={g.id} row={g} showPerson={data.all} scopes={data.scopes} when={when} dayOf={dayOf} onUsage={() => setUsage(g)} />
            ))}
        </ul>
      )}
      {usage && (
        <UsageModal
          title={`Usage of ${usage.app.name}${data?.all ? ` (${usage.person.name})` : ''}`}
          load={() => api.oauth.grantUsage(usage.id)}
          queryKey={[...APPS_KEY, usage.id, 'usage']}
          when={when}
          keepDays={30}
          onClose={() => setUsage(null)}
        />
      )}
    </SectionCard>
  );
}

function ConnectedAppItem({
  row,
  showPerson,
  scopes,
  when,
  dayOf,
  onUsage,
}: {
  row: ConnectedApp;
  showPerson: boolean;
  scopes: ApiScopeInfo[];
  when: (iso: string) => string;
  dayOf: (iso: string) => string;
  onUsage: () => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const active = row.status === 'active';
  const labelOf = (key: string) => scopes.find((s) => s.key === key)?.label ?? key;

  const revoke = async () => {
    const ok = await confirm({
      title: `Disconnect ${row.app.name}?`,
      message: `${row.app.name} stops working in Flowzen${showPerson ? ` as ${row.person.name}` : ''} on its very next request. Connecting again means signing in again.`,
      confirmText: 'Disconnect',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.oauth.revokeGrant(row.id);
      await queryClient.invalidateQueries({ queryKey: APPS_KEY });
      toast.success(`${row.app.name} disconnected`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not disconnect it');
    }
  };

  return (
    <li className={cn('px-5 py-4 sm:px-6', !active && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <Plug className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-primary">{row.app.name}</span>
            <Badge tone={active ? 'good' : 'bad'}>{active ? 'Connected' : 'Disconnected'}</Badge>
            <code className="font-mono text-xs text-secondary">{row.app.host}</code>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.scopes.map((s) => (
              <span key={s} title={labelOf(s)} className="rounded-md border border-line bg-subtle px-1.5 py-0.5 font-mono text-micro text-body-soft">
                {s}
              </span>
            ))}
          </div>
          <p className="text-xs text-secondary">
            {showPerson ? `Acts as ${row.person.name}` : 'Acts as you'}
            {!row.person.active && ' (no longer here, so it does not work)'} · Connected {dayOf(row.createdAt)}
            {' · '}
            {row.lastUsedAt ? `Last used ${when(row.lastUsedAt)}${row.lastUsedIp ? ` from ${row.lastUsedIp}` : ''}` : 'Never used'}
            {row.revokedAt && ` · Disconnected ${dayOf(row.revokedAt)}${row.revokedBy ? ` by ${row.revokedBy.name}` : ''}`}
          </p>
        </div>
        <RowMenu
          label={`Actions for ${row.app.name}`}
          actions={[
            { label: 'Usage', icon: History, onSelect: onUsage },
            { label: 'Disconnect', icon: Ban, onSelect: () => void revoke(), tone: 'danger', visible: active },
          ]}
        />
      </div>
    </li>
  );
}

/** For somebody without setup access: how to connect their own Claude or ChatGPT. */
function SignInCard() {
  const base = publicApiBase();
  const steps = examples(base);
  return (
    <SectionCard title="Connect Claude or ChatGPT" description="No key needed: the app signs in as you, and you tick what it may do.">
      <div className="space-y-4">
        <p className="text-sm text-secondary">{steps.claudeAi.intro}</p>
        <CodeBlock code={steps.claudeAi.code} />
        <p className="text-sm text-secondary">{steps.chatgpt.intro}</p>
        <CodeBlock code={steps.chatgpt.code} />
      </div>
    </SectionCard>
  );
}

// ── The switch ───────────────────────────────────────────────────────────────

function MasterSwitch({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [on, setOn] = useState(enabled);
  const [saving, setSaving] = useState(false);

  const change = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    try {
      await api.apiKeys.setEnabled(next);
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(next ? 'API keys on' : 'API keys off — every key is refused');
    } catch (e) {
      setOn(!next);
      toast.error(e instanceof ApiError ? e.message : 'Could not change that');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Allow API keys"
      description={
        <>
          Lets AI agents (Claude, ChatGPT) and automation tools (n8n, Make, Zapier) read and update Flowzen — signed in, or
          with a key made below. Off refuses every key and every connected app at once; they are kept, so turning it back on
          needs nothing re-issued.
        </>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">{on ? 'On' : 'Off'}</p>
          <p className="text-xs text-secondary">
            {on ? 'Working keys and connected apps are accepted.' : 'Every key and connected app is refused with "api_disabled".'}
          </p>
        </div>
        <Toggle checked={on} onChange={(v) => !saving && void change(v)} label="Allow API keys" labelClassName="sr-only" />
      </div>
    </SectionCard>
  );
}

// ── One key in the list ──────────────────────────────────────────────────────

function KeyItem({
  row,
  scopes,
  when,
  dayOf,
  onEdit,
  onUsage,
}: {
  row: ApiKeyRow;
  scopes: ApiScopeInfo[];
  when: (iso: string) => string;
  dayOf: (iso: string) => string;
  onEdit: () => void;
  onUsage: () => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const status = STATUS[row.status];
  const active = row.status === 'active';
  const labelOf = (key: string) => scopes.find((s) => s.key === key)?.label ?? key;

  const revoke = async () => {
    const ok = await confirm({
      title: `Revoke "${row.name}"?`,
      message: 'It stops working on its very next request, and cannot be switched back on. Anything using it needs a new key.',
      confirmText: 'Revoke it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.apiKeys.revoke(row.id);
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(`"${row.name}" revoked`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not revoke it');
    }
  };

  return (
    <li className={cn('px-5 py-4 sm:px-6', !active && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-primary">{row.name}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
            <code className="font-mono text-xs text-secondary">{row.prefix}…</code>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {row.scopes.map((s) => (
              <span key={s} title={labelOf(s)} className="rounded-md border border-line bg-subtle px-1.5 py-0.5 font-mono text-micro text-body-soft">
                {s}
              </span>
            ))}
          </div>
          <p className="text-xs text-secondary">
            Made by {row.createdBy.name}
            {!row.createdBy.active && ' (no longer here, so it does not work)'} on {dayOf(row.createdAt)}
            {' · '}
            {row.lastUsedAt ? `Last used ${when(row.lastUsedAt)}${row.lastUsedIp ? ` from ${row.lastUsedIp}` : ''}` : 'Never used'}
            {' · '}
            {row.revokedAt
              ? `Revoked ${dayOf(row.revokedAt)}${row.revokedBy ? ` by ${row.revokedBy.name}` : ''}`
              : row.expiresAt
                ? `${row.status === 'expired' ? 'Expired' : 'Expires'} ${dayOf(row.expiresAt)}`
                : 'Never expires'}
          </p>
        </div>
        <RowMenu
          label={`Actions for ${row.name}`}
          actions={[
            { label: 'Usage', icon: History, onSelect: onUsage },
            { label: 'Rename or edit scopes', icon: Pencil, onSelect: onEdit, visible: active },
            { label: 'Revoke', icon: Ban, onSelect: () => void revoke(), tone: 'danger', visible: active },
          ]}
        />
      </div>
    </li>
  );
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/** The scopes as a grid of ticks, grouped. One the creator cannot do is shown, but cannot be ticked. */
function ScopeGrid({
  scopes,
  allowed,
  value,
  onChange,
  whoCannot,
}: {
  scopes: ApiScopeInfo[];
  allowed: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** "You" or the creator's name, for the line under one that cannot be ticked. */
  whoCannot: string;
}) {
  const groups = [...new Set(scopes.map((s) => s.group))];
  const toggle = (key: string, on: boolean) => onChange(on ? [...value, key] : value.filter((k) => k !== key));

  return (
    <fieldset>
      <legend className="eyebrow mb-2">What it can do</legend>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g}>
            <p className="mb-1.5 text-xs font-semibold text-primary">{g}</p>
            <div className="space-y-2">
              {scopes
                .filter((s) => s.group === g)
                .map((s) => {
                  const can = allowed.includes(s.key);
                  return (
                    <label key={s.key} className={cn('flex items-start gap-2.5', can ? 'cursor-pointer' : 'cursor-not-allowed opacity-60')}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-line text-primary focus:ring-primary"
                        checked={value.includes(s.key)}
                        disabled={!can}
                        onChange={(e) => toggle(s.key, e.target.checked)}
                      />
                      <span>
                        <span className="block text-sm text-body">{s.label}</span>
                        <span className="block text-micro text-secondary">
                          {can ? s.description : `${whoCannot} cannot do this in Flowzen, so the key cannot either.`}
                        </span>
                      </span>
                    </label>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

// ── Make, show, change ───────────────────────────────────────────────────────

function CreateKeyModal({
  data,
  onClose,
  onCreated,
}: {
  data: ApiKeysPage;
  onClose: () => void;
  onCreated: (key: string, name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiry, setExpiry] = useState('90d');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const out = await api.apiKeys.create({ name: name.trim(), scopes, expiry });
      await queryClient.invalidateQueries({ queryKey: KEY });
      onCreated(out.key, out.apiKey.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make the key');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New API key" size="lg">
      <form onSubmit={submit}>
        <ModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Field label="Name" value={name} onChange={setName} placeholder="n8n automations, Claude agent…" required />
          <ScopeGrid scopes={data.scopes} allowed={data.myScopes} value={scopes} onChange={setScopes} whoCannot="You" />
          <FieldSelect
            label="Expires after"
            value={expiry}
            onChange={setExpiry}
            options={data.expiryChoices.map((c) => ({ value: c, label: EXPIRY_LABEL[c] ?? c }))}
          />
          <div className="flex items-start gap-2.5 rounded-xl border border-info/30 bg-info-tint px-3 py-2.5 text-xs text-info">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This key acts as you, {data.me.name}. It can never see or do more than you can — and if your access changes,
              so does the key&rsquo;s.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || scopes.length === 0}>
            Make key
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** The whole key, this once. Closing it is the last time anybody sees it. */
function ShowKeyModal({ shown, onClose }: { shown: { key: string; name: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.key);
      setCopied(true);
      toast.success('Key copied');
    } catch {
      toast.error('Could not copy — select the key and copy it by hand');
    }
  };
  return (
    <Modal open onClose={onClose} title={`"${shown.name}" is ready`} size="md">
      <ModalBody>
        <Note tone="warn">Copy it now. You won&rsquo;t see it again.</Note>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-subtle p-3">
          <code className="min-w-0 flex-1 break-all font-mono text-sm text-primary select-all">{shown.key}</code>
          <Button type="button" size="sm" icon={copied ? Check : Copy} onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-secondary">
          Send it as the header <code className="font-mono">Authorization: Bearer &lt;key&gt;</code> — never in a link. If it
          is ever pasted somewhere it should not be, revoke it and make a new one.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="primary" onClick={onClose}>
          I have copied it
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function EditKeyModal({ row, scopes, onClose }: { row: ApiKeyRow; scopes: ApiScopeInfo[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(row.name);
  const [ticked, setTicked] = useState<string[]>(row.scopes.filter((s) => row.allowedScopes.includes(s)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.apiKeys.update(row.id, { name: name.trim(), scopes: ticked });
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success('Key updated');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Edit "${row.name}"`} description={`${row.prefix}…`} size="lg">
      <form onSubmit={submit}>
        <ModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <Field label="Name" value={name} onChange={setName} required />
          <ScopeGrid scopes={scopes} allowed={row.allowedScopes} value={ticked} onChange={setTicked} whoCannot={row.createdBy.name} />
          <p className="text-xs text-secondary">
            The key acts as {row.createdBy.name}, so it can only carry what they can do. Changes apply from its next request.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || ticked.length === 0}>
            Save
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

/** The last 100 calls of a key or a connected app: when, what, and how it went. Never what was sent. */
function UsageModal({
  title,
  load,
  queryKey,
  when,
  keepDays,
  onClose,
}: {
  title: string;
  load: () => Promise<{ calls: ApiKeyCall[] }>;
  queryKey: readonly unknown[];
  when: (iso: string) => string;
  keepDays: number;
  onClose: () => void;
}) {
  const { data, isPending, error } = useQuery({ queryKey, queryFn: load });
  const tone = (status: number) => (status < 300 ? 'text-success' : status < 500 ? 'text-warning-ink' : 'text-danger');
  return (
    <Modal open onClose={onClose} title={title} description={`The last 100 calls. Kept ${keepDays} days; what was sent is never kept.`} size="lg">
      <ModalBody>
        {isPending ? (
          <p className="text-sm text-secondary">Loading…</p>
        ) : error ? (
          <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the calls.'}</ErrorNote>
        ) : data.calls.length === 0 ? (
          <p className="text-sm text-secondary">No calls yet.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Call</TH>
                <TH numeric>Status</TH>
                <TH numeric>Time</TH>
              </tr>
            </THead>
            <TBody>
              {data.calls.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap text-xs">{when(c.at)}</TD>
                  <TD className="font-mono text-xs">
                    {c.method} {c.route}
                  </TD>
                  <TD numeric className={cn('font-mono text-xs', tone(c.status))}>
                    {c.status}
                  </TD>
                  <TD numeric className="text-xs">
                    {c.durationMs} ms
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </ModalBody>
    </Modal>
  );
}

// ── How to connect ───────────────────────────────────────────────────────────

type Example = 'claudeAi' | 'chatgpt' | 'curl' | 'n8n' | 'make' | 'zapier' | 'claudeCode' | 'claudeDesktop';

const EXAMPLES: { key: Example; label: string }[] = [
  { key: 'claudeAi', label: 'Claude.ai' },
  { key: 'chatgpt', label: 'ChatGPT' },
  { key: 'curl', label: 'curl' },
  { key: 'n8n', label: 'n8n' },
  { key: 'make', label: 'Make' },
  { key: 'zapier', label: 'Zapier' },
  { key: 'claudeCode', label: 'Claude Code' },
  { key: 'claudeDesktop', label: 'Claude Desktop' },
];

/** The examples, written for this server's own address. `<your key>` is what to replace. */
function examples(base: string): Record<Example, { intro: string; code: string }> {
  const v1 = `${base}/v1`;
  const mcp = `${base}/mcp`;
  return {
    claudeAi: {
      intro:
        'Claude.ai, Claude Desktop and Claude mobile sign in with Flowzen — no key. Each person connects their own account and ticks what Claude may do; it shows under Connected apps, where it can be disconnected.',
      code: [
        'Claude.ai → Customize → Connectors → Add custom connector',
        '  Name:            Flowzen',
        `  MCP server URL:  ${mcp}`,
        '  Authentication:  Sign in now',
        '  OAuth client:    Use Claude’s published identity',
        '→ Add, then Connect: sign in to Flowzen, tick what Claude may do, Allow.',
        '',
        'On a Team or Enterprise plan an Owner adds it under Organization settings → Connectors;',
        'each person then presses Connect and signs in as themselves.',
      ].join('\n'),
    },
    chatgpt: {
      intro: 'ChatGPT connects the same way: it signs in as you and asks what it may do.',
      code: [
        'ChatGPT → Settings → Connectors → Create (developer mode)',
        '  Name:            Flowzen',
        `  MCP server URL:  ${mcp}`,
        '  Authentication:  OAuth',
        '→ Create, then sign in to Flowzen, tick what ChatGPT may do, Allow.',
      ].join('\n'),
    },
    curl: {
      intro: 'Read your open tasks, then create one. The Idempotency-Key makes a retry safe: the same key within 24 hours never creates twice.',
      code: [
        `curl -H "Authorization: Bearer <your key>" \\`,
        `  "${v1}/tasks?status=TODO,IN_PROGRESS&assigneeId=me"`,
        '',
        `curl -X POST "${v1}/tasks" \\`,
        `  -H "Authorization: Bearer <your key>" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Idempotency-Key: $(uuidgen)" \\`,
        `  -d '{"title":"Send the October report","dueDate":"2026-11-10","priority":"HIGH"}'`,
      ].join('\n'),
    },
    n8n: {
      intro: 'An HTTP Request node, with the key kept in a Header Auth credential. For a "new or updated" trigger, run it on a Schedule and pass the last run’s time as updatedSince.',
      code: [
        'HTTP Request node',
        '  Method:          GET',
        `  URL:             ${v1}/tasks?updatedSince={{ $json.lastRun }}`,
        '  Authentication:  Generic Credential Type → Header Auth',
        '    Name:          Authorization',
        '    Value:         Bearer <your key>',
        '',
        'To create, the same credential with:',
        '  Method:          POST',
        `  URL:             ${v1}/tasks`,
        '  Send Body:       JSON',
        '  Body:            {"title": "{{ $json.title }}", "dueDate": "2026-11-10"}',
      ].join('\n'),
    },
    make: {
      intro: 'The HTTP app’s "Make a request" module.',
      code: [
        'HTTP → Make a request',
        `  URL:            ${v1}/tasks`,
        '  Method:         POST',
        '  Headers:',
        '    Authorization  Bearer <your key>',
        '  Body type:      Raw',
        '  Content type:   JSON (application/json)',
        '  Request content: {"title": "Send the October report", "dueDate": "2026-11-10"}',
        '  Parse response: Yes',
      ].join('\n'),
    },
    zapier: {
      intro: 'Webhooks by Zapier. "Custom Request" to write; "Retrieve Poll" as a trigger for new or updated items.',
      code: [
        'Webhooks by Zapier → Custom Request (action)',
        '  Method:   POST',
        `  URL:      ${v1}/tasks`,
        '  Data:     {"title": "Send the October report", "dueDate": "2026-11-10"}',
        '  Headers:  Authorization | Bearer <your key>',
        '            Content-Type  | application/json',
        '',
        'Webhooks by Zapier → Retrieve Poll (trigger)',
        `  URL:      ${v1}/tasks?order=desc`,
        '  Key:      data',
        '  Headers:  Authorization | Bearer <your key>',
      ].join('\n'),
    },
    claudeCode: {
      intro: 'Run once in a terminal. Claude then sees only the tools this key’s scopes allow, and asks before anything that writes.',
      code: `claude mcp add --transport http flowzen ${mcp} --header "Authorization: Bearer <your key>"`,
    },
    claudeDesktop: {
      intro: 'In Claude Desktop: Settings → Developer → Edit Config, add this, and restart it. It needs Node.js installed.',
      code: JSON.stringify(
        {
          mcpServers: {
            flowzen: {
              command: 'npx',
              args: ['-y', 'mcp-remote', mcp, '--header', 'Authorization:${FLOWZEN_AUTH}'],
              env: { FLOWZEN_AUTH: 'Bearer <your key>' },
            },
          },
        },
        null,
        2,
      ),
    },
  };
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl border border-line bg-subtle p-4 pr-20 font-mono text-xs leading-relaxed text-body">{code}</pre>
      <button
        type="button"
        onClick={() =>
          void navigator.clipboard.writeText(code).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => toast.error('Could not copy'),
          )
        }
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-micro font-medium text-secondary hover:text-primary"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function ConnectCard({ data }: { data: ApiKeysPage }) {
  const [tab, setTab] = useState<Example>('claudeAi');
  const base = publicApiBase();
  const all = examples(base);
  const current = all[tab];
  const scopeLabel = (s: string[]) => (s.length ? s.join(' or ') : 'any key');

  return (
    <SectionCard
      title="Connect"
      description="Where to point a tool, with the steps for each. Claude.ai and ChatGPT sign in; the rest take a key from above in place of <your key>."
    >
      <div className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            { term: 'REST API', value: `${base}/v1` },
            { term: 'MCP (AI agents)', value: `${base}/mcp` },
            { term: 'OpenAPI file', value: `${base}/v1/openapi.json` },
          ].map((r) => (
            <div key={r.term} className="min-w-0 rounded-xl border border-line px-3 py-2.5">
              <dt className="eyebrow">{r.term}</dt>
              <dd className="mt-1 break-all font-mono text-xs text-primary">{r.value}</dd>
            </div>
          ))}
        </dl>

        <div>
          <div role="tablist" aria-label="Examples" className="mb-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <button
                key={e.key}
                type="button"
                role="tab"
                aria-selected={tab === e.key}
                onClick={() => setTab(e.key)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === e.key ? 'bg-primary/[0.07] text-primary' : 'text-secondary hover:bg-subtle hover:text-primary',
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="mb-2 text-sm text-secondary">{current.intro}</p>
          <CodeBlock code={current.code} />
        </div>

        <div className="space-y-2 text-sm text-secondary">
          <p>
            <span className="font-medium text-primary">Every request:</span> the key as{' '}
            <code className="font-mono text-xs">Authorization: Bearer …</code>, over HTTPS — a key in the address is refused.
            Lists answer <code className="font-mono text-xs">{'{ data, nextCursor }'}</code>; pass{' '}
            <code className="font-mono text-xs">?cursor=</code> for the next page, and{' '}
            <code className="font-mono text-xs">?updatedSince=</code> or <code className="font-mono text-xs">?createdSince=</code>{' '}
            to poll for changes, oldest first. Errors answer{' '}
            <code className="font-mono text-xs">{'{ error: { code, message } }'}</code>. Each key may make 120 calls a minute.
          </p>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-primary">REST endpoints</p>
          <Table>
            <THead>
              <tr>
                <TH>Call</TH>
                <TH>What it does</TH>
                <TH>Needs</TH>
              </tr>
            </THead>
            <TBody>
              {data.endpoints.map((e) => (
                <TR key={`${e.method} ${e.path}`}>
                  <TD className="whitespace-nowrap font-mono text-xs">
                    {e.method} {e.path}
                  </TD>
                  <TD className="text-xs">{e.summary}</TD>
                  <TD className="font-mono text-micro text-secondary">{scopeLabel(e.scopes)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-primary">MCP tools</p>
          <div className="flex flex-wrap gap-1.5">
            {data.tools.map((t) => (
              <span
                key={t.name}
                title={`${t.title} — needs ${scopeLabel(t.scopes)}`}
                className={cn(
                  'rounded-md border px-1.5 py-0.5 font-mono text-micro',
                  t.writes ? 'border-warning/30 bg-warning-tint text-warning-ink' : 'border-line bg-subtle text-body-soft',
                )}
              >
                {t.name}
              </span>
            ))}
          </div>
          <p className="mt-2 text-micro text-secondary">
            An agent sees only the tools its key&rsquo;s scopes allow. Tools that change something (shaded) are marked as writes,
            so the AI app asks before using them. Nothing deletes.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}
