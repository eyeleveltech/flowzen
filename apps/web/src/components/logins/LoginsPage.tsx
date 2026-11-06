'use client';

/**
 * Logins (Credentials plan) — one safe place for the studio's own and its
 * clients' logins. Management only: the sidebar offers it to nobody else, the
 * layout refuses the address, and every route behind it refuses too.
 *
 * A password is on this screen only while somebody is looking at it: Show and
 * Copy ask the server for it (which logs who asked), and it is hidden again
 * after thirty seconds. Lists never carry one. Nothing here is cached.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Copy, Check, Eye, EyeOff, ExternalLink, FileUp, History, KeyRound, Pencil, Plus, RotateCcw, Search, StickyNote, Trash2, Wand2 } from 'lucide-react';
import {
  api,
  ApiError,
  type CredentialBody,
  type CredentialImportField,
  type CredentialImportResult,
  type CredentialImportRow,
  type CredentialLogEntry,
  type CredentialRow,
  type CredentialScope,
} from '@/lib/api-v2';
import { useConfig } from '@/hooks/queries';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, FieldSelect } from '@/components/ui/field';
import { Note, ErrorNote } from '@/components/ui/empty-state';
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Drawer } from '@/components/ui/drawer';
import { ScreenMessage } from '@/components/ui/screen-message';
import { Tabs, useTabState, type TabDef } from '@/components/ui/tabs';
import { Table, THead, TH, TBody, TR, TD } from '@/components/ui/table';
import { RowMenu } from '@/components/ui/row-menu';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { Select } from '@/components/ui/select';
import { useConfirmStore } from '@/stores/confirm';
import { cn, plural } from '@/lib/utils';

const KEY = ['credentials'] as const;
/** How long a revealed password stays on the screen, and on the clipboard. */
const REVEAL_SECONDS = 30;

type LoginsTab = 'INTERNAL' | 'CLIENTS' | 'LOG';

const INTERNAL = '__internal__';

const ACTION_LABEL: Record<CredentialLogEntry['action'], string> = {
  SHOW: 'showed the password of',
  COPY: 'copied the password of',
  CREATE: 'added',
  UPDATE: 'edited',
  PASSWORD_CHANGED: 'changed the password of',
  DELETE: 'deleted',
  RESTORE: 'restored',
  IMPORT: '',
  PURGE: 'purged',
};

/** "https://example.com" → "example.com", for the link's text. */
const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
const hrefOf = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears the clipboard after a copied password's thirty seconds — only if it
 * still holds that password, and only if the browser lets us look without
 * asking. Otherwise nothing happens, quietly (decision 5).
 */
function scheduleClipboardClear(password: string) {
  setTimeout(() => {
    void (async () => {
      try {
        const perm = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
        if (perm.state !== 'granted') return;
        if ((await navigator.clipboard.readText()) === password) await navigator.clipboard.writeText('');
      } catch {
        // Not allowed to look, or no clipboard: leave it.
      }
    })();
  }, REVEAL_SECONDS * 1000);
}

export function LoginsPage() {
  usePageHeader('Logins', 'The studio’s and its clients’ logins. Management only — every look is logged.');
  const search = useSearchParams();
  const { data: config } = useConfig();
  const tz = config?.organization.timezone ?? 'Asia/Kolkata';
  const locale = config?.organization.locale ?? 'en-IN';
  const when = useCallback(
    (iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz }).format(new Date(iso)),
    [locale, tz],
  );
  const dayOf = useCallback((iso: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz }).format(new Date(iso)), [locale, tz]);

  const status = useQuery({ queryKey: [...KEY, 'status'], queryFn: () => api.credentials.status() });

  const tabs: TabDef<LoginsTab>[] = [
    { key: 'INTERNAL', label: 'Internal' },
    { key: 'CLIENTS', label: 'Clients' },
    { key: 'LOG', label: 'Log', icon: History },
  ];
  const [tab, setTab] = useTabState(tabs);
  const [q, setQ] = useState('');
  const [client, setClient] = useState<string>(() => search.get('client') ?? '');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CredentialRow | null>(null);
  const [importing, setImporting] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [history, setHistory] = useState<CredentialRow | null>(null);

  // A link from a client's page lands on Clients, filtered to them.
  const openedForClient = useRef(false);
  useEffect(() => {
    if (!openedForClient.current && search.get('client')) {
      openedForClient.current = true;
      setTab('CLIENTS');
    }
  }, [search, setTab]);

  if (status.isPending) return <PageSkeleton />;
  if (status.error || !status.data) return <ErrorNote>{status.error instanceof ApiError ? status.error.message : 'Could not load Logins.'}</ErrorNote>;
  if (!status.data.keyConfigured) {
    return (
      <ScreenMessage
        icon={KeyRound}
        title="Not set up yet"
        message="Logins need their own key on the server (CREDENTIALS_KEY in .env) before anything can be saved. DEPLOY.md has the two steps. The rest of Flowzen works as usual."
        actions={[{ label: 'Back to My Work', href: '/my-work' }]}
      />
    );
  }
  if (status.data.keyMatches === false) {
    return (
      <ScreenMessage
        icon={KeyRound}
        title="The credentials key doesn’t match"
        message="The credentials key on the server doesn’t match the one used to save these logins. Put the original key back in .env and restart — nothing is lost while the saved rows stay as they are."
        actions={[{ label: 'Back to My Work', href: '/my-work' }]}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={setTab} />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setShowDeleted(true)}>
            Recently deleted
          </Button>
          <Button size="sm" variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>
            Import from sheet
          </Button>
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add login
          </Button>
        </div>
      </div>

      {tab !== 'LOG' && (
        <LoginsList
          scope={tab === 'INTERNAL' ? 'INTERNAL' : 'CLIENT'}
          q={q}
          setQ={setQ}
          client={client}
          setClient={setClient}
          dayOf={dayOf}
          onEdit={setEditing}
          onHistory={setHistory}
        />
      )}
      {tab === 'LOG' && <LogTab when={when} initialUser={search.get('user') ?? ''} />}

      {(adding || editing) && <LoginModal row={editing} onClose={() => (editing ? setEditing(null) : setAdding(false))} />}
      {importing && <ImportWizard onClose={() => setImporting(false)} />}
      {showDeleted && <DeletedDrawer dayOf={dayOf} onClose={() => setShowDeleted(false)} />}
      {history && <HistoryDrawer row={history} when={when} onClose={() => setHistory(null)} />}
    </div>
  );
}

// ── The list ─────────────────────────────────────────────────────────────────

type Revealed = { password: string; notes: string | null; until: number };

function LoginsList({
  scope,
  q,
  setQ,
  client,
  setClient,
  dayOf,
  onEdit,
  onHistory,
}: {
  scope: CredentialScope;
  q: string;
  setQ: (v: string) => void;
  client: string;
  setClient: (v: string) => void;
  dayOf: (iso: string) => string;
  onEdit: (row: CredentialRow) => void;
  onHistory: (row: CredentialRow) => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const { data, isPending, error } = useQuery({
    queryKey: [...KEY, 'list', scope, client, q],
    queryFn: () => api.credentials.list({ scope, ...(scope === 'CLIENT' && client ? { companyId: client } : {}), ...(q.trim() ? { q: q.trim() } : {}) }),
    // Typing in the search keeps the rows up rather than blanking per keystroke.
    placeholderData: keepPreviousData,
  });
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [busy, setBusy] = useState<string | null>(null);

  // Hide what has been on the screen for thirty seconds.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      setRevealed((r) => {
        const keep = Object.fromEntries(Object.entries(r).filter(([, v]) => v.until > now));
        return Object.keys(keep).length === Object.keys(r).length ? r : keep;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const show = async (row: CredentialRow) => {
    if (revealed[row.id]) {
      setRevealed((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== row.id)));
      return;
    }
    setBusy(row.id);
    try {
      const out = await api.credentials.reveal(row.id, 'show');
      setRevealed((r) => ({ ...r, [row.id]: { password: out.password, notes: out.notes, until: Date.now() + REVEAL_SECONDS * 1000 } }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not show it');
    } finally {
      setBusy(null);
    }
  };

  const copy = async (row: CredentialRow) => {
    setBusy(row.id);
    try {
      const out = await api.credentials.reveal(row.id, 'copy');
      if (await copyText(out.password)) {
        toast.success('Copied');
        scheduleClipboardClear(out.password);
      } else toast.error('Could not reach the clipboard — use Show instead');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not copy it');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row: CredentialRow) => {
    const ok = await confirm({
      title: `Delete "${row.name}"?`,
      message: 'It goes to Recently deleted for 30 days, where it can be restored. After that it is gone for good.',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.credentials.delete(row.id);
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success('Moved to Recently deleted');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete it');
    }
  };

  const rows = data?.credentials ?? [];
  const companies = data?.companies ?? [];
  // Clients: grouped by client, "No client" last.
  const groups = useMemo(() => {
    if (scope !== 'CLIENT') return [{ key: INTERNAL, label: null as string | null, rows }];
    const map = new Map<string, { key: string; label: string | null; rows: CredentialRow[] }>();
    for (const r of rows) {
      const key = r.company?.id ?? 'none';
      if (!map.has(key)) map.set(key, { key, label: r.company?.name ?? 'No client', rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => (a.key === 'none' ? 1 : b.key === 'none' ? -1 : a.label!.localeCompare(b.label!)));
  }, [rows, scope]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, website or username"
            aria-label="Search logins"
            className="w-full rounded-xl border border-border bg-white py-2 pl-9 pr-3 text-sm text-primary placeholder:text-secondary outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
          />
        </div>
        {scope === 'CLIENT' && (
          <Select
            value={client}
            onChange={setClient}
            options={[{ value: '', label: 'All clients' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
            ariaLabel="Client"
            className="w-56"
          />
        )}
      </div>

      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the logins.'}</ErrorNote>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-secondary">
          {q ? 'Nothing matches.' : scope === 'INTERNAL' ? 'No internal logins yet. Add one, or import your sheet.' : 'No client logins yet.'}
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.key}>
            {g.label && <p className="eyebrow mb-2">{g.label}</p>}
            {/* Wide: a table. */}
            <div className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Login</TH>
                    <TH>Website</TH>
                    <TH>Username</TH>
                    <TH>Password</TH>
                    <TH>Last changed</TH>
                    <TH />
                  </tr>
                </THead>
                <TBody>
                  {g.rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <span className="font-medium text-primary">{row.name}</span>
                        {row.hasNotes && (
                          <button type="button" onClick={() => void show(row)} title="Has notes — Show opens them" className="ml-1.5 align-middle text-secondary hover:text-primary">
                            <StickyNote className="inline h-3.5 w-3.5" />
                          </button>
                        )}
                        {revealed[row.id]?.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-body">{revealed[row.id].notes}</p>}
                      </TD>
                      <TD>{row.website ? <WebsiteLink url={row.website} /> : <span className="text-secondary">—</span>}</TD>
                      <TD>
                        <UsernameCell username={row.username} />
                      </TD>
                      <TD>
                        <PasswordCell row={row} revealed={revealed[row.id]} busy={busy === row.id} onShow={() => void show(row)} onCopy={() => void copy(row)} />
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-secondary">{dayOf(row.passwordChangedAt)}</TD>
                      <TD numeric>
                        <RowMenu
                          label={`Actions for ${row.name}`}
                          actions={[
                            { label: 'Edit', icon: Pencil, onSelect: () => onEdit(row) },
                            { label: 'Who opened this', icon: History, onSelect: () => onHistory(row) },
                            { label: 'Delete', icon: Trash2, onSelect: () => void remove(row), tone: 'danger' },
                          ]}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {/* Phone: cards. */}
            <ul className="space-y-2 md:hidden">
              {g.rows.map((row) => (
                <li key={row.id} className="rounded-xl border border-line bg-white px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary">{row.name}</p>
                      {row.website && (
                        <p className="text-xs">
                          <WebsiteLink url={row.website} />
                        </p>
                      )}
                    </div>
                    <RowMenu
                      label={`Actions for ${row.name}`}
                      actions={[
                        { label: 'Edit', icon: Pencil, onSelect: () => onEdit(row) },
                        { label: 'Who opened this', icon: History, onSelect: () => onHistory(row) },
                        { label: 'Delete', icon: Trash2, onSelect: () => void remove(row), tone: 'danger' },
                      ]}
                    />
                  </div>
                  <div className="mt-2 space-y-1.5 text-sm">
                    <UsernameCell username={row.username} />
                    <PasswordCell row={row} revealed={revealed[row.id]} busy={busy === row.id} onShow={() => void show(row)} onCopy={() => void copy(row)} />
                    {revealed[row.id]?.notes && <p className="whitespace-pre-wrap text-xs text-body">{revealed[row.id].notes}</p>}
                  </div>
                  <p className="mt-2 text-micro text-secondary">
                    Changed {dayOf(row.passwordChangedAt)}
                    {row.hasNotes ? ' · has notes' : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}

function WebsiteLink({ url }: { url: string }) {
  return (
    <a href={hrefOf(url)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary underline-offset-2 hover:underline">
      {hostOf(url)}
      <ExternalLink className="h-3 w-3 text-secondary" />
    </a>
  );
}

/** The username, with a plain copy — not logged, it is not a secret. */
function UsernameCell({ username }: { username: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!username) return <span className="text-secondary">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs text-body">{username}</span>
      <button
        type="button"
        onClick={() =>
          void copyText(username).then((ok) => {
            if (ok) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          })
        }
        title="Copy username"
        className="rounded p-0.5 text-secondary hover:text-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

function PasswordCell({ row, revealed, busy, onShow, onCopy }: { row: CredentialRow; revealed?: Revealed; busy: boolean; onShow: () => void; onCopy: () => void }) {
  const left = revealed ? Math.max(0, Math.ceil((revealed.until - Date.now()) / 1000)) : 0;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('font-mono text-xs', revealed ? 'select-all text-primary' : 'text-secondary')}>{revealed ? revealed.password : '••••••••'}</span>
      <button type="button" onClick={onShow} disabled={busy} title={revealed ? `Hide (${left}s)` : 'Show for 30 seconds'} aria-label={revealed ? 'Hide password' : `Show password of ${row.name}`} className="rounded p-0.5 text-secondary hover:text-primary disabled:opacity-50">
        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onCopy} disabled={busy} title="Copy password" aria-label={`Copy password of ${row.name}`} className="rounded p-0.5 text-secondary hover:text-primary disabled:opacity-50">
        <Copy className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

// ── Add / edit ───────────────────────────────────────────────────────────────

function LoginModal({ row, onClose }: { row: CredentialRow | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: list } = useQuery({ queryKey: [...KEY, 'list', 'CLIENT', '', ''], queryFn: () => api.credentials.list({ scope: 'CLIENT' }) });
  const companies = list?.companies ?? [];
  const [owner, setOwner] = useState<string>(row ? (row.scope === 'INTERNAL' ? INTERNAL : (row.companyId ?? '')) : INTERNAL);
  const [name, setName] = useState(row?.name ?? '');
  const [website, setWebsite] = useState(row?.website ?? '');
  const [username, setUsername] = useState(row?.username ?? '');
  // Never pre-filled: blank keeps the current password.
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesLoaded, setNotesLoaded] = useState(!row || !row.hasNotes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing the notes means seeing them, which is a Show — asked for, not assumed.
  const loadNotes = async () => {
    if (!row) return;
    try {
      const out = await api.credentials.reveal(row.id, 'show');
      setNotes(out.notes ?? '');
      setNotesLoaded(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not open the notes');
    }
  };

  const generate = async () => {
    try {
      const out = await api.credentials.generate();
      setPassword(out.password);
      setShowPassword(true);
    } catch {
      toast.error('Could not generate one');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body: CredentialBody = {
      scope: owner === INTERNAL ? 'INTERNAL' : 'CLIENT',
      companyId: owner === INTERNAL ? null : owner,
      name: name.trim(),
      website: website.trim() || null,
      username: username.trim() || null,
      ...(password ? { password } : {}),
      ...(notesLoaded ? { notes: notes.trim() || null } : {}),
    };
    try {
      if (row) await api.credentials.update(row.id, body);
      else await api.credentials.create({ ...body, password });
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(row ? 'Login updated' : 'Login added');
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={row ? `Edit "${row.name}"` : 'Add login'} size="lg">
      <form onSubmit={submit} autoComplete="off">
        <ModalBody>
          {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSelect label="Belongs to" value={owner} onChange={setOwner} options={[{ value: INTERNAL, label: 'Internal (the studio’s own)' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
            <Field label="Name" value={name} onChange={setName} placeholder="WordPress admin, Meta Business, Hostinger…" required />
            <Field label="Website" value={website} onChange={setWebsite} placeholder="https://" />
            <Field label="Username or email" value={username} onChange={setUsername} autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Field
              label={row ? 'New password (leave empty to keep the current one)' : 'Password'}
              value={password}
              onChange={setPassword}
              type={showPassword ? 'text' : 'password'}
              required={!row}
              autoComplete="new-password"
              className="font-mono"
            />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="ghost" icon={showPassword ? EyeOff : Eye} onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? 'Hide' : 'Show'}
              </Button>
              <Button type="button" size="sm" variant="ghost" icon={Wand2} onClick={() => void generate()}>
                Generate
              </Button>
            </div>
          </div>
          {notesLoaded ? (
            <Field label="Notes" value={notes} onChange={setNotes} textarea rows={3} placeholder="Security questions, who holds the 2FA phone, anything worth knowing." />
          ) : (
            <div className="rounded-xl border border-line bg-subtle px-3 py-2.5 text-xs text-secondary">
              This login has notes. They are encrypted; opening them to edit is logged like a Show.{' '}
              <button type="button" onClick={() => void loadNotes()} className="font-medium text-primary underline-offset-2 hover:underline">
                Open the notes
              </button>
            </div>
          )}
          <p className="text-xs text-secondary">The password and the notes are encrypted on the server. Everything else is plain, so search works.</p>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!name.trim() || (!row && !password) || (owner !== INTERNAL && !owner)}>
            {row ? 'Save' : 'Add login'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── Who opened this / the Log ────────────────────────────────────────────────

function LogLine({ e, when, showLogin = true }: { e: CredentialLogEntry; when: (iso: string) => string; showLogin?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
      <span className="whitespace-nowrap text-xs text-secondary">{when(e.at)}</span>
      <span className="text-body">
        <span className="font-medium text-primary">{e.user.name}</span>{' '}
        {e.action === 'IMPORT' ? (e.detail ?? 'imported logins') : ACTION_LABEL[e.action]}{' '}
        {e.action !== 'IMPORT' && showLogin && <span className="font-medium text-primary">{e.credentialName}</span>}
        {e.action === 'PURGE' && e.detail ? <span className="text-secondary"> · {e.detail}</span> : null}
      </span>
      {e.ip && <span className="font-mono text-micro text-secondary">{e.ip}</span>}
    </li>
  );
}

function HistoryDrawer({ row, when, onClose }: { row: CredentialRow; when: (iso: string) => string; onClose: () => void }) {
  const { data, isPending, error } = useQuery({ queryKey: [...KEY, 'log', row.id], queryFn: () => api.credentials.logFor(row.id) });
  return (
    <Drawer isOpen onClose={onClose} title={`Who opened "${row.name}"`} description="Every show and copy, and every change. Latest first." variant="slideover">
      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error || !data ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the history.'}</ErrorNote>
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-secondary">Nobody has opened it yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.entries.map((e) => (
            <LogLine key={e.id} e={e} when={when} showLogin={false} />
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function LogTab({ when, initialUser }: { when: (iso: string) => string; initialUser: string }) {
  const [user, setUser] = useState(initialUser);
  const { data, isPending, error } = useQuery({ queryKey: [...KEY, 'log', 'all', user], queryFn: () => api.credentials.log(user || undefined) });
  const opened = useMemo(() => {
    if (!user || !data) return null;
    const seen = new Map<string, string>();
    for (const e of data.entries) if ((e.action === 'SHOW' || e.action === 'COPY') && e.credentialId && !seen.has(e.credentialId)) seen.set(e.credentialId, e.credentialName);
    return [...seen.values()];
  }, [data, user]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={user} onChange={setUser} options={[{ value: '', label: 'Everyone' }, ...(data?.people ?? []).map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (left)` }))]} ariaLabel="Person" className="w-56" />
        <p className="text-xs text-secondary">The last 500 entries. Never a password.</p>
      </div>
      {opened && opened.length > 0 && (
        <Note tone="warn">
          Logins this person opened, each once ({opened.length}): {opened.join(', ')}. Review which passwords to change.
        </Note>
      )}
      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error || !data ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load the log.'}</ErrorNote>
      ) : data.entries.length === 0 ? (
        <p className="text-sm text-secondary">Nothing logged yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {data.entries.map((e) => (
            <LogLine key={e.id} e={e} when={when} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Recently deleted ─────────────────────────────────────────────────────────

function DeletedDrawer({ dayOf, onClose }: { dayOf: (iso: string) => string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({ queryKey: [...KEY, 'deleted'], queryFn: () => api.credentials.deleted() });
  const restore = async (row: CredentialRow) => {
    try {
      await api.credentials.restore(row.id);
      await queryClient.invalidateQueries({ queryKey: KEY });
      toast.success(`"${row.name}" restored`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not restore it');
    }
  };
  return (
    <Drawer isOpen onClose={onClose} title="Recently deleted" description="Kept for 30 days, then gone for good." variant="slideover">
      {isPending ? (
        <p className="text-sm text-secondary">Loading…</p>
      ) : error || !data ? (
        <ErrorNote>{error instanceof ApiError ? error.message : 'Could not load.'}</ErrorNote>
      ) : data.credentials.length === 0 ? (
        <p className="text-sm text-secondary">Nothing deleted recently.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {data.credentials.map((row) => (
            <li key={row.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-primary">{row.name}</p>
                <p className="text-xs text-secondary">
                  {row.company?.name ?? 'Internal'} · deleted {row.deletedAt ? dayOf(row.deletedAt) : ''}
                  {row.deletedBy ? ` by ${row.deletedBy.name}` : ''}
                </p>
              </div>
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => void restore(row)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

// ── Import from a sheet ──────────────────────────────────────────────────────

const FIELD_LABEL: Record<CredentialImportField, string> = { name: 'Name', client: 'Belongs to', website: 'Website', username: 'Username', password: 'Password', notes: 'Notes' };
const FIELDS: CredentialImportField[] = ['name', 'client', 'website', 'username', 'password', 'notes'];

function ImportWizard({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: list } = useQuery({ queryKey: [...KEY, 'list', 'CLIENT', '', ''], queryFn: () => api.credentials.list({ scope: 'CLIENT' }) });
  const companies = list?.companies ?? [];
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Partial<Record<CredentialImportField, string | null>>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<CredentialImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CredentialImportResult | null>(null);

  const run = useCallback(
    async (text: string, m: typeof mapping, c: typeof choices, dryRun: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const out = await api.credentials.import({ csv: text, mapping: m, clientChoices: c, dryRun });
        if (dryRun) {
          setPreview(out);
          setMapping(out.mapping ?? {});
        } else {
          setDone(out);
          await queryClient.invalidateQueries({ queryKey: KEY });
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not read the file');
      } finally {
        setBusy(false);
      }
    },
    [queryClient],
  );

  const pick = (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError('The file is over 2 MB. Split it, or remove columns you do not need.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsv(text);
      setFileName(file.name);
      setChoices({});
      void run(text, {}, {}, true);
    };
    reader.readAsText(file);
  };

  const remap = (field: CredentialImportField, header: string) => {
    const next = { ...mapping, [field]: header || null };
    setMapping(next);
    if (csv) void run(csv, next, choices, true);
  };
  const choose = (row: number, value: string) => {
    const next = { ...choices, [String(row)]: value };
    setChoices(next);
    if (csv) void run(csv, mapping, next, true);
  };

  const okCount = preview?.counts.ok ?? 0;

  return (
    <Modal open onClose={onClose} title="Import logins from a sheet" size="xl">
      <ModalBody>
        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}
        {done ? (
          <div className="space-y-3">
            <Note tone="info">
              Imported {plural(done.imported ?? 0, 'login')}
              {done.counts.skipped ? ` (${done.counts.skipped} skipped)` : ''}. Now delete the Google Sheet, empty it from Drive&rsquo;s Bin, and delete the downloaded CSV from this computer (and its Recycle Bin).
            </Note>
          </div>
        ) : !csv ? (
          <div className="space-y-3">
            <Note tone="info">
              Google Sheets: File → Download → CSV. Excel: Save As → CSV UTF-8. At most 1,000 rows and 2 MB. The file is read here and sent once; it is never stored.
            </Note>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-line px-6 py-8 text-center hover:border-primary/50 hover:bg-subtle">
              <FileUp className="h-6 w-6 text-secondary" />
              <span className="text-sm font-medium text-primary">Choose the CSV</span>
              <span className="text-xs text-secondary">Columns are matched from their headers; you can change any of them next.</span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
            </label>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-secondary">
              {fileName} · {preview ? `${preview.counts.total} rows` : 'reading…'}
              {preview?.counts.truncated ? ' · only the first 1,000 rows are read' : ''}
            </p>
            {preview && (
              <>
                <div>
                  <p className="eyebrow mb-2">Columns</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {FIELDS.map((f) => (
                      <FieldSelect
                        key={f}
                        label={FIELD_LABEL[f]}
                        value={mapping[f] ?? ''}
                        onChange={(v) => remap(f, v)}
                        options={[{ value: '', label: f === 'name' || f === 'password' ? '— pick a column —' : '— none —' }, ...(preview.headers ?? []).map((h) => ({ value: h, label: h }))]}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <p className="eyebrow mb-2">
                    Preview · {okCount} to import
                    {preview.counts.skipped ? ` · ${preview.counts.skipped} duplicates skipped` : ''}
                    {preview.counts.problems ? ` · ${preview.counts.problems} to fix` : ''}
                  </p>
                  <div className="max-h-80 overflow-auto rounded-xl border border-line">
                    <Table>
                      <THead>
                        <tr>
                          <TH>Row</TH>
                          <TH>Name</TH>
                          <TH>Belongs to</TH>
                          <TH>Website</TH>
                          <TH>Username</TH>
                          <TH>Password</TH>
                          <TH>Status</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {preview.rows.map((r) => (
                          <ImportRowLine key={r.row} r={r} companies={companies} choice={choices[String(r.row)]} onChoose={(v) => choose(r.row, v)} />
                        ))}
                      </TBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {done ? 'Close' : 'Cancel'}
        </Button>
        {csv && !done && (
          <Button type="button" variant="primary" loading={busy} disabled={!preview || okCount === 0} onClick={() => csv && void run(csv, mapping, choices, false)}>
            Import {okCount ? plural(okCount, 'login') : ''}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}

function ImportRowLine({ r, companies, choice, onChoose }: { r: CredentialImportRow; companies: { id: string; name: string }[]; choice?: string; onChoose: (v: string) => void }) {
  const unknown = r.status === 'UNKNOWN_CLIENT';
  const tone = r.status === 'OK' ? 'good' : r.status === 'DUPLICATE' ? 'neutral' : 'warn';
  return (
    <TR className={cn(unknown && 'bg-warning-tint')}>
      <TD className="text-xs text-secondary">{r.row}</TD>
      <TD className="text-sm text-primary">{r.name || <span className="text-secondary">—</span>}</TD>
      <TD>
        {unknown ? (
          <Select value={choice ?? ''} onChange={onChoose} options={[{ value: '', label: r.clientText ? `"${r.clientText}" — pick` : 'Pick' }, { value: 'INTERNAL', label: 'Internal' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} ariaLabel="Client" className="w-44" rounded="rounded-lg" />
        ) : (
          <span className="text-sm text-body">{r.client === 'INTERNAL' ? 'Internal' : (r.clientName ?? '—')}</span>
        )}
      </TD>
      <TD className="text-xs text-secondary">{r.website ?? '—'}</TD>
      <TD className="font-mono text-xs text-body">{r.username ?? '—'}</TD>
      <TD className="font-mono text-xs text-secondary">{r.hasPassword ? '••••' : '—'}</TD>
      <TD>
        <Badge tone={tone}>{r.status === 'OK' ? 'Ready' : (r.reason ?? r.status)}</Badge>
      </TD>
    </TR>
  );
}
