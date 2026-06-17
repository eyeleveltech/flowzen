'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { formatCurrency, getAvatarColor, getInitials, getClientDisplayName } from '@/lib/utils';
import { Plus, Search, Filter, ChevronRight, TrendingUp } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { LeadModal } from './LeadModal';
import { useMembers } from '@/hooks/useQueries';
import { useRouter } from 'next/navigation';

const STAGES = [
  'LEAD', 'MQL', 'SQL', 'REACH_OUT', 'DISCOVERY',
  'AUDIT', 'PRESENTATION', 'PROPOSAL', 'NEGOTIATION',
  'FINALIZATION', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT',
  'WON_CLOSED', 'LOST_CLOSED'
];

export function LeadListView() {
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const { data: members = [] } = useMembers();

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchLeads();
    const sse = getSSE();
    if (sse) {
      sse.on('lead:updated', fetchLeads);
      return () => {
        sse.off('lead:updated');
      };
    }
  }, [stageFilter, ownerFilter]);

  async function fetchLeads() {
    try {
      const params = new URLSearchParams();
      if (stageFilter) params.set('stage', stageFilter);
      if (ownerFilter) params.set('assignedToId', ownerFilter);
      
      const data = await api.get<any[]>(`/crm/leads?${params}`);
      setLeads(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const filteredLeads = leads.filter(lead => {
    if (!search) return true;
    const term = search.toLowerCase();
    const clientName = lead.client?.name?.toLowerCase() || '';
    const company = lead.client?.company?.toLowerCase() || '';
    return clientName.includes(term) || company.includes(term);
  });

  return (
    <div className="flex flex-col space-y-6">
      {/* Filters and Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads..."
              className="w-full rounded-xl border border-[#E5E7EB] bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
            />
          </div>
          <div className="w-full sm:w-[180px]">
            <Select
              value={stageFilter}
              onChange={setStageFilter}
              options={[
                { label: 'All Stages', value: '' },
                ...STAGES.map(s => ({ label: s.replace('_', ' '), value: s }))
              ]}
            />
          </div>
          <div className="w-full sm:w-[180px]">
            <Select
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={[
                { label: 'All Owners', value: '' },
                ...members.map((m: any) => ({ label: m.name, value: m.id }))
              ]}
            />
          </div>
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all w-full sm:w-auto justify-center"
        >
          <Plus className="h-4 w-4" /> Add Lead
        </button>
      </div>

      {/* Data Table */}
      <div className="rounded-2xl border border-[#E5E7EB] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Client</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Stage</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Deal Value</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Close Date</th>
                <th className="px-6 py-3.5 text-left text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Owner</th>
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
                    <h3 className="text-sm font-medium text-[#111827]">No leads found</h3>
                    <p className="text-sm text-[#6B7280] mt-1">Get started by creating a new lead.</p>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => (
                  <motion.tr
                    key={lead.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-[#FAFAFA] cursor-pointer transition-colors"
                    onClick={() => router.push(`/pipeline/${lead.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[#111827]">{getClientDisplayName(lead.client)}</span>
                        {lead.client?.company && lead.client?.name && lead.client.name !== 'Internal' && (
                          <span className="text-xs text-[#6B7280]">{lead.client.name}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center text-xs font-medium text-[#111827] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                        {lead.stage.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-[#374151] font-medium">
                      {lead.dealValue ? formatCurrency(lead.dealValue) : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-[#6B7280]">
                      {lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-4">
                      {lead.assignedTo ? (
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-[#F3F4F6] text-[#111827] text-[9px] font-bold flex items-center justify-center shrink-0 border border-[#E5E7EB]">
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
            onClose={() => setIsModalOpen(false)}
            onSuccess={() => {
              setIsModalOpen(false);
              fetchLeads();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
