'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency, formatDate, getAvatarColor, getInitials, getClientDisplayName } from '@/lib/utils';
import { Plus, Search, Filter, ChevronRight, TrendingUp, Upload } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { ColumnDropdown } from '@/components/ui/column-dropdown';
import { LeadModal } from './LeadModal';
import { useMembers } from '@/hooks/useQueries';
import { useRouter, useSearchParams } from 'next/navigation';

const STAGES = [
  'NEW_LEAD', 'OUTREACH', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
  'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED', 'ON_HOLD'
];

const LEAD_SOURCES = [
  'EXCEL', 'MANUAL', 'API', 'REFERRAL', 'INBOUND', 'LINKEDIN', 'INSTAGRAM', 'WHATSAPP', 'OTHER', 'OUTBOUND', 'SOCIAL_MEDIA', 'EVENT', 'COLD_CALL', 'EXISTING_CLIENT'
];

const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

export function LeadListView() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters State
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [stageFilter, setStageFilter] = useState<string[]>((searchParams.get('stage') || '').split(',').filter(Boolean));
  const [ownerFilter, setOwnerFilter] = useState<string[]>((searchParams.get('assignedToId') || '').split(',').filter(Boolean));
  const [minDealValue, setMinDealValue] = useState(searchParams.get('minDealValue') || '');
  const [maxDealValue, setMaxDealValue] = useState(searchParams.get('maxDealValue') || '');
  const [leadSource, setLeadSource] = useState<string[]>((searchParams.get('leadSource') || '').split(',').filter(Boolean));
  const [priority, setPriority] = useState<string[]>((searchParams.get('priority') || '').split(',').filter(Boolean));
  const [closeDateFrom, setCloseDateFrom] = useState(searchParams.get('closeDateFrom') || '');
  const [closeDateTo, setCloseDateTo] = useState(searchParams.get('closeDateTo') || '');
  const [dateAddedFrom, setDateAddedFrom] = useState(searchParams.get('dateAddedFrom') || '');
  const [dateAddedTo, setDateAddedTo] = useState(searchParams.get('dateAddedTo') || '');
  const [sort, setSort] = useState(searchParams.get('sort') || '');

  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [showWonLost, setShowWonLost] = useState(false);

  const { data: members = [] } = useMembers();

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setIsModalOpen(true);
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('create');
      window.history.replaceState({}, '', newUrl.toString());
    }
  }, [searchParams]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'MANUAL'|'BULK'>('MANUAL');

  // Filter logic trigger
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (stageFilter.length) params.set('stage', stageFilter.join(','));
    if (ownerFilter.length) params.set('assignedToId', ownerFilter.join(','));
    if (minDealValue) params.set('minDealValue', minDealValue);
    if (maxDealValue) params.set('maxDealValue', maxDealValue);
    if (leadSource.length) params.set('leadSource', leadSource.join(','));
    if (priority.length) params.set('priority', priority.join(','));
    if (closeDateFrom) params.set('closeDateFrom', closeDateFrom);
    if (closeDateTo) params.set('closeDateTo', closeDateTo);
    if (dateAddedFrom) params.set('dateAddedFrom', dateAddedFrom);
    if (dateAddedTo) params.set('dateAddedTo', dateAddedTo);
    if (sort) params.set('sort', sort);

    const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState(null, '', newUrl);

    fetchLeads(params);
    
    const sse = getSSE();
    if (sse) {
      const handleUpdate = () => fetchLeads(params);
      sse.on('lead:updated', handleUpdate);
      return () => {
        sse.off('lead:updated', handleUpdate);
      };
    }
  }, [search, stageFilter, ownerFilter, minDealValue, maxDealValue, leadSource, priority, closeDateFrom, closeDateTo, dateAddedFrom, dateAddedTo, sort]);

  async function fetchLeads(params: URLSearchParams) {
    try {
      setLoading(true);
      const data = await api.get<any[]>(`/crm/leads?${params.toString()}`);
      setLeads(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const activeFilterCount = [minDealValue, maxDealValue, closeDateFrom, closeDateTo, dateAddedFrom, dateAddedTo].filter(Boolean).length
    + (leadSource.length ? 1 : 0) + (priority.length ? 1 : 0);
  const hasAnyFilter = activeFilterCount > 0 || !!search || stageFilter.length > 0 || ownerFilter.length > 0;

  const clearAllFilters = () => {
    setSearch('');
    setStageFilter([]);
    setOwnerFilter([]);
    setMinDealValue('');
    setMaxDealValue('');
    setLeadSource([]);
    setPriority([]);
    setCloseDateFrom('');
    setCloseDateTo('');
    setDateAddedFrom('');
    setDateAddedTo('');
  };

  const filteredLeads = leads.filter(lead => {
    if (!search) return true;
    const term = search.toLowerCase();
    const haystack = [lead.contactName, lead.companyName, lead.client?.name, lead.client?.company]
      .filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(term);
  }).filter(lead => {
    // Hide closed leads by default unless the toggle is on or the user filtered to a closed stage.
    if (showWonLost || stageFilter.includes('PROJECT_COMPLETED') || stageFilter.includes('CHURNED')) return true;
    return lead.stage !== 'PROJECT_COMPLETED' && lead.stage !== 'CHURNED';
  });

  return (
    <div className="flex flex-col space-y-6 relative">
      {/* Filters and Actions */}
      <div className="bg-white border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto flex-1">
            <div className="relative w-full sm:max-w-60 md:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads..."
                className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
              />
            </div>
            
            <div className="w-full sm:hidden">
              <Select
                ariaLabel="Sort Leads"
                value={sort}
                onChange={setSort}
                buttonClassName="w-full h-10.5 rounded-xl border border-border bg-white text-secondary text-sm font-medium focus:ring-1 focus:ring-primary shadow-none"
                options={[
                  { label: 'Sort: Client A-Z', value: 'client_asc' },
                  { label: 'Sort: Client Z-A', value: 'client_desc' },
                  { label: 'Sort: Stage Ascending', value: 'stage_asc' },
                  { label: 'Sort: Stage Descending', value: 'stage_desc' },
                  { label: 'Sort: Value (High-Low)', value: 'value_desc' },
                  { label: 'Sort: Value (Low-High)', value: 'value_asc' },
                ]}
              />
            </div>

            <div className="flex-1 min-w-35 sm:w-40 md:w-45 sm:flex-initial">
              <MultiSelect
                value={stageFilter}
                onChange={setStageFilter}
                placeholder="Stages"
                options={STAGES.map(s => ({ label: s.replace(/_/g, ' '), value: s }))}
              />
            </div>

            <div className="flex-1 min-w-35 sm:w-40 md:w-45 sm:flex-initial">
              <MultiSelect
                value={ownerFilter}
                onChange={setOwnerFilter}
                placeholder="Owners"
                options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
              />
            </div>

            <button
              onClick={() => setShowMoreFilters(!showMoreFilters)}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                showMoreFilters || activeFilterCount > 0 ? 'bg-primary text-white border-primary' : 'bg-white border-border text-secondary hover:bg-gray-50'
              }`}
            >
              <Filter className="h-4 w-4" />
              More Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
            </button>

            <label className="flex items-center gap-2 text-sm font-medium text-secondary cursor-pointer select-none whitespace-nowrap px-1">
              <input
                type="checkbox"
                checked={showWonLost}
                onChange={(e) => setShowWonLost(e.target.checked)}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              Show Won/Lost
            </label>

            {hasAnyFilter && (
              <button onClick={clearAllFilters} className="text-sm text-secondary hover:text-primary underline px-2 py-2 whitespace-nowrap">
                Clear all
              </button>
            )}
          </div>

          <div className="flex flex-row items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => { setModalMode('BULK'); setIsModalOpen(true); }}
              className="flex items-center gap-2 rounded-xl bg-white border border-border px-4 py-2.5 text-sm font-medium text-secondary hover:text-primary hover:bg-gray-50 transition-all flex-1 sm:flex-none justify-center shrink-0"
            >
              <Upload className="h-4 w-4" /> Import
            </button>
            <button
              onClick={() => { setModalMode('MANUAL'); setIsModalOpen(true); }}
              className="flex items-center justify-center rounded-xl bg-primary h-10.5 w-10.5 text-white hover:bg-[#1F2937] transition-all shrink-0"
              title="Add Lead"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Expanded Filters Panel */}
        <AnimatePresence>
          {showMoreFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-5 mt-1 border-t border-border flex flex-wrap gap-6">
                {/* Priority */}
                <div className="space-y-1.5 w-full sm:w-45">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Priority</label>
                  <MultiSelect
                    value={priority}
                    onChange={setPriority}
                    placeholder="Priorities"
                    options={PRIORITIES.map(p => ({ label: p, value: p }))}
                  />
                </div>

                {/* Lead Source */}
                <div className="space-y-1.5 w-full sm:w-45">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Lead Source</label>
                  <MultiSelect
                    value={leadSource}
                    onChange={setLeadSource}
                    placeholder="Sources"
                    options={LEAD_SOURCES.map(s => ({ label: s.replace(/_/g, ' '), value: s }))}
                  />
                </div>

                {/* Close Date */}
                <div className="space-y-1.5 w-full sm:w-auto min-w-70">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Close Date Range</label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input type="date" value={closeDateFrom} onChange={(e) => setCloseDateFrom(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                    <span className="text-secondary hidden sm:inline">-</span>
                    <input type="date" value={closeDateTo} onChange={(e) => setCloseDateTo(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                  </div>
                </div>

                {/* Deal Value */}
                <div className="space-y-1.5 w-full sm:w-auto min-w-70">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Deal Value Range</label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <div className="relative w-full">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary text-sm">₹</span>
                      <input type="number" placeholder="Min" value={minDealValue} onChange={(e) => setMinDealValue(e.target.value)} className="w-full rounded-lg border border-border py-2 pl-6 pr-2 text-sm focus:border-primary outline-none" />
                    </div>
                    <span className="text-secondary hidden sm:inline">-</span>
                    <div className="relative w-full">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary text-sm">₹</span>
                      <input type="number" placeholder="Max" value={maxDealValue} onChange={(e) => setMaxDealValue(e.target.value)} className="w-full rounded-lg border border-border py-2 pl-6 pr-2 text-sm focus:border-primary outline-none" />
                    </div>
                  </div>
                </div>

                {/* Date Added */}
                <div className="space-y-1.5 w-full sm:w-auto min-w-70">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Date Added Range</label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input type="date" value={dateAddedFrom} onChange={(e) => setDateAddedFrom(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                    <span className="text-secondary hidden sm:inline">-</span>
                    <input type="date" value={dateAddedTo} onChange={(e) => setDateAddedTo(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>



        {hasAnyFilter && !loading && (
          <div className="text-sm text-secondary">
            Showing {filteredLeads.length} lead{filteredLeads.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Data Table */}
      <div className="hidden md:block rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-225">
            <thead>
              <tr className="border-b border-[#F3F4F6] bg-white">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                  <ColumnDropdown 
                    title="Client" 
                    sortAscValue="client_asc" 
                    sortDescValue="client_desc" 
                    sortAscLabel="Sort A to Z"
                    sortDescLabel="Sort Z to A"
                    currentSort={sort} 
                    onSortChange={setSort} 
                  />
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                  <ColumnDropdown 
                    title="Stage" 
                    sortAscValue="stage_asc" 
                    sortDescValue="stage_desc" 
                    sortAscLabel="New Lead to End"
                    sortDescLabel="End to New Lead"
                    currentSort={sort} 
                    onSortChange={setSort} 
                  />
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                  <ColumnDropdown 
                    title="Deal Value" 
                    sortAscValue="dealValue_asc" 
                    sortDescValue="dealValue_desc" 
                    sortAscLabel="Sort Lowest to Highest"
                    sortDescLabel="Sort Highest to Lowest"
                    currentSort={sort} 
                    onSortChange={setSort} 
                  />
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                  <ColumnDropdown 
                    title="Close Date" 
                    sortAscValue="closeDate_asc" 
                    sortDescValue="closeDate_desc" 
                    sortAscLabel="Sort Earliest to Latest"
                    sortDescLabel="Sort Latest to Earliest"
                    currentSort={sort} 
                    onSortChange={setSort} 
                  />
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                  <ColumnDropdown 
                    title="Owner" 
                    sortAscValue="owner_asc" 
                    sortDescValue="owner_desc" 
                    sortAscLabel="Sort A to Z"
                    sortDescLabel="Sort Z to A"
                    currentSort={sort} 
                    onSortChange={setSort} 
                  />
                </th>
                <th className="px-6 py-3.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F4F6]">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="h-4 w-24 rounded skeleton" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <TrendingUp className="h-12 w-12 text-[#D1D5DB] mx-auto mb-4" />
                    <h3 className="text-sm font-medium text-primary">No leads found</h3>
                    <p className="text-sm text-secondary mt-1">Try adjusting your filters or search term.</p>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <motion.tr
                    key={lead.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-surface cursor-pointer transition-colors relative"
                    onClick={() => router.push(`/pipeline/${lead.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {lead.priority && (
                           <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${lead.priority === 'HIGH' ? 'bg-red-500' : lead.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-gray-300'}`} title={`Priority: ${lead.priority}`} />
                        )}
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-primary">{lead.contactName || lead.companyName || getClientDisplayName(lead.client)}</span>
                          {(lead.companyName || lead.jobTitle) && (
                            <span className="text-xs text-secondary">{lead.companyName || lead.jobTitle}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${
                        lead.stage === 'PROJECT_COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        lead.stage === 'CHURNED' ? 'bg-red-50 text-red-700 border-red-200' :
                        'text-primary bg-[#F3F4F6] border-border'
                      }`}>
                        {lead.stage.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#374151] font-medium">
                      {lead.dealValue ? formatCurrency(lead.dealValue) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-secondary">
                      {lead.expectedCloseDate ? (
                        <span className={new Date(lead.expectedCloseDate) < new Date() && !['PROJECT_COMPLETED', 'CHURNED'].includes(lead.stage) ? 'text-red-600 font-medium' : ''}>
                          {new Date(lead.expectedCloseDate).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-6 py-4">
                      {lead.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-[#F3F4F6] text-primary text-[9px] font-bold flex items-center justify-center shrink-0 border border-border">
                            {getInitials(lead.assignedTo.name)}
                          </div>
                          <span className="text-sm text-[#374151]">{lead.assignedTo.name}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <ChevronRight className="h-4 w-4 text-[#D1D5DB] inline" />
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-3 pb-4 mt-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border border-border bg-white">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-full skeleton" />
                <div className="space-y-2">
                  <div className="h-4 w-24 rounded skeleton" />
                  <div className="h-3 w-16 rounded skeleton" />
                </div>
              </div>
              <div className="h-3 w-32 rounded skeleton" />
            </div>
          ))
        ) : filteredLeads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted bg-white rounded-xl border border-border">
            No leads found.
          </div>
        ) : (
          filteredLeads.map((lead) => (
            <motion.div
              key={lead.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => router.push(`/pipeline/${lead.id}`)}
              className="bg-white border border-border rounded-xl p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
            >
              <div className="flex justify-between items-start mb-3 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${getAvatarColor(lead.companyName || lead.client?.company || lead.contactName || getClientDisplayName(lead.client) || '?')}`}>
                    {getInitials(lead.companyName || lead.client?.company || lead.contactName || getClientDisplayName(lead.client) || '?')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-primary truncate">
                      {lead.companyName || lead.client?.company || lead.contactName || getClientDisplayName(lead.client) || '—'}
                    </h3>
                    <p className="text-xs text-secondary mt-0.5 truncate">
                      {[lead.contactName || getClientDisplayName(lead.client), lead.jobTitle].filter(Boolean).join(' • ') || '—'}
                    </p>
                  </div>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border shrink-0 ${
                  lead.stage === 'PROJECT_COMPLETED' ? 'bg-green-50 text-green-700 border-green-200' :
                  lead.stage === 'CHURNED' ? 'bg-red-50 text-red-700 border-red-200' :
                  'text-primary bg-[#F3F4F6] border-border'
                }`}>
                  {lead.stage.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F3F4F6]">
                <div className="flex items-center gap-3 text-xs text-secondary">
                  {lead.dealValue ? (
                    <span className="font-semibold text-primary">
                      {formatCurrency(lead.dealValue)}
                    </span>
                  ) : (
                    <span className="text-[#9CA3AF]">—</span>
                  )}
                  {lead.expectedCloseDate && (
                    <span className={new Date(lead.expectedCloseDate) < new Date() && !['PROJECT_COMPLETED', 'CHURNED'].includes(lead.stage) ? 'text-red-600 font-medium' : ''}>
                      📅 {formatDate(lead.expectedCloseDate)}
                    </span>
                  )}
                </div>
                {lead.assignedTo ? (
                  <div className="flex items-center gap-1 text-[11px] text-secondary bg-[#F3F4F6] px-2 py-0.5 rounded border border-border">
                    <span className="font-medium">{lead.assignedTo.name}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#9CA3AF]">Unassigned</span>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <LeadModal
            initialMode={modalMode}
            onClose={() => setIsModalOpen(false)}
            onSuccess={() => {
              setIsModalOpen(false);
              const params = new URLSearchParams(window.location.search);
              fetchLeads(params);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
