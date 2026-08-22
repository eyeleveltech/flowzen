'use client';

/**
 * Clients.
 *
 * One record per company whether or not they have ever bought — there is no
 * separate lead list and no conversion step. Winning a deal changes this
 * record's status; it never creates a second one (master plan §3.2).
 */

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Building2, Search } from 'lucide-react';
import { api, type Company, type CompanyStatus, type OrgConfig } from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge, COMPANY_TONE } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState, ErrorNote } from '@/components/ui/empty-state';
import { TableSkeleton } from '@/components/ui/skeleton-loaders';
import { NewClientModal } from '@/components/clients/NewClientModal';
import { useModuleStore } from '@/stores';
import { Select } from '@/components/ui/select';

const STATUSES = Object.keys(COMPANY_TONE) as CompanyStatus[];

export default function ClientsPage() {
  const params = useSearchParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [companies, setCompanies] = useState<any[]>([]);
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [status, setStatus] = useState<CompanyStatus | ''>(
    (params.get('status') as CompanyStatus) ?? '',
  );
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [industry, setIndustry] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sourceId, setSourceId] = useState('');

  const activeModule = useModuleStore((s) => s.activeModule);
  const hydrateModule = useModuleStore((s) => s.hydrate);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    hydrateModule();
    setMounted(true);
  }, [hydrateModule]);

  const load = useCallback(async () => {
    if (!mounted) return;
    setLoading(true);
    try {
      const query: Record<string, string> = {};
      const actualStatus = activeModule === 'PM' ? 'ACTIVE' : status;
      if (actualStatus) query.status = actualStatus;
      if (search) query.search = search;
      if (industry) query.industry = industry;
      if (stateFilter) query.state = stateFilter;
      if (sourceId) query.sourceId = sourceId;
      const [list, cfg] = await Promise.all([api.companies.list(query), api.config.get()]);
      setCompanies(list);
      setConfig(cfg);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load clients');
    } finally {
      setLoading(false);
    }
  }, [status, search, mounted, activeModule]);

  useEffect(() => {
    if (!mounted) return;
    const t = setTimeout(() => void load(), search || industry || stateFilter ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search, industry, stateFilter, sourceId, mounted]);

  void config;

  if (!mounted) return <TableSkeleton rows={5} />;

  return (
    <>
      <PageHeader 
        title={activeModule === 'PM' ? 'Active Clients' : 'Companies'} 
        subtitle={`${companies.length} shown`} 
        action={activeModule !== 'PM' ? <Button variant="primary" onClick={() => setCreating(true)}>New Company</Button> : undefined}
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
              strokeWidth={1.75}
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or phone"
              aria-label="Search clients"
              className="w-full rounded-input border border-border bg-white py-2.5 pl-9 pr-3 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            />
          </div>

          {activeModule !== 'PM' && (
            <>
              <div className="relative w-40">
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="Industry..."
                  className="w-full rounded-input border border-border bg-white py-2 px-3 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                />
              </div>
              <div className="relative w-32">
                <input
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  placeholder="State..."
                  className="w-full rounded-input border border-border bg-white py-2 px-3 text-sm text-body outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
                />
              </div>
              <div className="w-48">
                <Select
                  value={sourceId}
                  onChange={setSourceId}
                  options={[
                    { label: 'All Sources', value: '' },
                    ...(config?.sources?.map(s => ({ label: s.name, value: s.id })) || [])
                  ]}
                  placeholder="Source..."
                  buttonClassName="py-2"
                />
              </div>
            </>
          )}

          {activeModule !== 'PM' && (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={status === '' ? 'primary' : 'ghost'}
                onClick={() => setStatus('')}
              >
                All
              </Button>
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={status === s ? 'primary' : 'ghost'}
                  onClick={() => setStatus(s === status ? '' : s)}
                >
                  {COMPANY_TONE[s].label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {error && <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>}

        {loading ? (
          <TableSkeleton rows={5} />
        ) : companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={status || search ? 'Nothing matches that' : 'No clients yet'}
            hint={
              status || search
                ? 'Try a different filter.'
                : 'A company appears here the moment a deal is created against it — there is no separate lead list.'
            }
          />
        ) : (
          <Table>
            <THead>
              {activeModule === 'PM' ? (
                <TR className="hover:bg-transparent">
                  <TH>CLIENT</TH>
                  <TH>INDUSTRY</TH>
                  <TH>CONTACT</TH>
                  <TH numeric>PROJECTS</TH>
                  <TH>LIFECYCLE STAGE</TH>
                </TR>
              ) : (
                <TR className="hover:bg-transparent">
                  <TH>Company</TH>
                  <TH>Status</TH>
                  <TH>Owner</TH>
                  <TH numeric>Deals</TH>
                  <TH>What to do</TH>
                </TR>
              )}
            </THead>
            <TBody>
              {companies.map((c) => (
                <TR 
                  key={c.id}
                  onClick={() => router.push(`/clients/${c.id}`)}
                  className="cursor-pointer hover:bg-subtle transition-colors"
                >
                  <TD>
                    <div className="font-medium text-primary">
                      {c.name}
                    </div>
                    {c.email && <p className="text-xs text-secondary">{c.email}</p>}
                  </TD>
                  {activeModule === 'PM' ? (
                    <>
                      <TD className="text-secondary">{c.industry ?? 'Other'}</TD>
                      <TD className="text-secondary">{c.contactName ?? c.owner?.name ?? '—'}</TD>
                      <TD numeric className="text-secondary">{c._count?.projects ?? c.projects?.length ?? 0}</TD>
                      <TD>
                        <Badge tone={COMPANY_TONE[c.status].tone}>{COMPANY_TONE[c.status].label}</Badge>
                      </TD>
                    </>
                  ) : (
                    <>
                      <TD>
                        <Badge tone={COMPANY_TONE[c.status].tone}>{COMPANY_TONE[c.status].label}</Badge>
                      </TD>
                      <TD className="text-secondary">{c.owner?.name ?? '—'}</TD>
                      <TD numeric className="text-secondary">
                        {c._count?.deals ?? 0}
                      </TD>
                      <TD className="text-xs text-secondary">{c.statusMeaning?.nextAction}</TD>
                    </>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      {creating && (
        <NewClientModal 
          onConfirm={(client) => {
            setCreating(false);
            window.location.href = `/clients/${client.id}`;
          }} 
          onCancel={() => setCreating(false)} 
        />
      )}
    </>
  );
}
