'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency, getAvatarColor, getInitials, getClientDisplayName } from '@/lib/utils';
import { Plus, Search, Filter, ChevronRight, TrendingUp, Upload } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { LeadModal } from './LeadModal';
import { useMembers } from '@/hooks/useQueries';
import { useRouter, useSearchParams } from 'next/navigation';

const STAGES = [
  'LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY',
  'AUDIT', 'PRESENTATION', 'PROPOSAL', 'NEGOTIATION',
  'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT',
  'WON_CLOSED', 'LOST_CLOSED'
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
  const [stageFilter, setStageFilter] = useState(searchParams.get('stage') || '');
  const [ownerFilter, setOwnerFilter] = useState(searchParams.get('assignedToId') || '');
  const [minDealValue, setMinDealValue] = useState(searchParams.get('minDealValue') || '');
  const [maxDealValue, setMaxDealValue] = useState(searchParams.get('maxDealValue') || '');
  const [leadSource, setLeadSource] = useState(searchParams.get('leadSource') || '');
  const [priority, setPriority] = useState(searchParams.get('priority') || '');
  const [closeDateFrom, setCloseDateFrom] = useState(searchParams.get('closeDateFrom') || '');
  const [closeDateTo, setCloseDateTo] = useState(searchParams.get('closeDateTo') || '');
  const [dateAddedFrom, setDateAddedFrom] = useState(searchParams.get('dateAddedFrom') || '');
  const [dateAddedTo, setDateAddedTo] = useState(searchParams.get('dateAddedTo') || '');

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
    if (stageFilter) params.set('stage', stageFilter);
    if (ownerFilter) params.set('assignedToId', ownerFilter);
    if (minDealValue) params.set('minDealValue', minDealValue);
    if (maxDealValue) params.set('maxDealValue', maxDealValue);
    if (leadSource) params.set('leadSource', leadSource);
    if (priority) params.set('priority', priority);
    if (closeDateFrom) params.set('closeDateFrom', closeDateFrom);
    if (closeDateTo) params.set('closeDateTo', closeDateTo);
    if (dateAddedFrom) params.set('dateAddedFrom', dateAddedFrom);
    if (dateAddedTo) params.set('dateAddedTo', dateAddedTo);

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
  }, [search, stageFilter, ownerFilter, minDealValue, maxDealValue, leadSource, priority, closeDateFrom, closeDateTo, dateAddedFrom, dateAddedTo]);

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

  const activeFilterCount = [minDealValue, maxDealValue, leadSource, priority, closeDateFrom, closeDateTo, dateAddedFrom, dateAddedTo].filter(Boolean).length;
  const hasAnyFilter = activeFilterCount > 0 || search || stageFilter || ownerFilter;

  const clearAllFilters = () => {
    setSearch('');
    setStageFilter('');
    setOwnerFilter('');
    setMinDealValue('');
    setMaxDealValue('');
    setLeadSource('');
    setPriority('');
    setCloseDateFrom('');
    setCloseDateTo('');
    setDateAddedFrom('');
    setDateAddedTo('');
  };

  const filteredLeads = leads.filter(lead => {
    if (!search) return true;
    const term = search.toLowerCase();
    const clientName = lead.client?.name?.toLowerCase() || '';
    const company = lead.client?.company?.toLowerCase() || '';
    return clientName.includes(term) || company.includes(term);
  }).filter(lead => {
    // Hide Won/Lost by default unless the toggle is on or the user filtered to that stage.
    if (showWonLost || stageFilter === 'WON_CLOSED' || stageFilter === 'LOST_CLOSED') return true;
    return lead.stage !== 'WON_CLOSED' && lead.stage !== 'LOST_CLOSED';
  });

  return (
    <div className="flex flex-col space-y-6 relative">
      {/* Filters and Actions */}
      <div className="bg-white border border-border rounded-2xl p-4 md:p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto flex-1">
            <div className="relative w-full sm:max-w-[240px] md:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search leads..."
                className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-all"
              />
            </div>
            
            <div className="w-full sm:w-[130px] md:w-[150px]">
              <Select
                value={stageFilter}
                onChange={setStageFilter}
                options={[
                  { label: 'All Stages', value: '' },
                  ...STAGES.map(s => ({ label: s.replace(/_/g, ' '), value: s }))
                ]}
              />
            </div>

            <div className="w-full sm:w-[130px] md:w-[150px]">
              <Select
                value={ownerFilter}
                onChange={setOwnerFilter}
                options={[
                  { label: 'All Owners', value: '' },
                  ...members.map((m: any) => ({ label: m.name, value: m.id }))
                ]}
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

          <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
            <button
              onClick={() => { setModalMode('BULK'); setIsModalOpen(true); }}
              className="flex items-center gap-2 rounded-xl bg-white border border-border px-4 py-2.5 text-sm font-medium text-secondary hover:text-primary hover:bg-gray-50 transition-all w-full sm:w-auto justify-center shrink-0"
            >
              <Upload className="h-4 w-4" /> Import
            </button>
            <button
              onClick={() => { setModalMode('MANUAL'); setIsModalOpen(true); }}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all w-full sm:w-auto justify-center shrink-0"
            >
              <Plus className="h-4 w-4" /> Add Lead
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
                <div className="space-y-1.5 w-full sm:w-[180px]">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Priority</label>
                  <Select
                    value={priority}
                    onChange={setPriority}
                    options={[
                      { label: 'All Priorities', value: '' },
                      ...PRIORITIES.map(p => ({ label: p, value: p }))
                    ]}
                  />
                </div>

                {/* Lead Source */}
                <div className="space-y-1.5 w-full sm:w-[180px]">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Lead Source</label>
                  <Select
                    value={leadSource}
                    onChange={setLeadSource}
                    options={[
                      { label: 'All Sources', value: '' },
                      ...LEAD_SOURCES.map(s => ({ label: s.replace(/_/g, ' '), value: s }))
                    ]}
                  />
                </div>

                {/* Close Date */}
                <div className="space-y-1.5 w-full sm:w-auto min-w-[280px]">
                  <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Close Date Range</label>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    <input type="date" value={closeDateFrom} onChange={(e) => setCloseDateFrom(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                    <span className="text-secondary hidden sm:inline">-</span>
                    <input type="date" value={closeDateTo} onChange={(e) => setCloseDateTo(e.target.value)} className="w-full rounded-lg border border-border p-2 text-sm focus:border-primary outline-none text-[#374151]" />
                  </div>
                </div>

                {/* Deal Value */}
                <div className="space-y-1.5 w-full sm:w-auto min-w-[280px]">
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
                <div className="space-y-1.5 w-full sm:w-auto min-w-[280px]">
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
      <div className="rounded-2xl border border-border bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Client</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Stage</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Deal Value</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Close Date</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-secondary uppercase tracking-wider">Owner</th>
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
                          <span className="text-sm font-medium text-primary">{getClientDisplayName(lead.client)}</span>
                          {lead.client?.company && lead.client?.name && lead.client.name !== 'Internal' && (
                            <span className="text-xs text-secondary">{lead.client.name}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${
                        lead.stage === 'WON_CLOSED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        lead.stage === 'LOST_CLOSED' ? 'bg-red-50 text-red-700 border-red-200' :
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
                        <span className={new Date(lead.expectedCloseDate) < new Date() && !['WON_CLOSED', 'LOST_CLOSED'].includes(lead.stage) ? 'text-red-600 font-medium' : ''}>
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
                        <span className="text-sm text-[#9CA3AF]">—</span>
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
