'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, getInitials } from '@/lib/utils';
import { TrendingUp, IndianRupee, Target, Briefcase, Clock, ChevronRight, Filter, Calendar, CheckSquare, Square, ChevronDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Select } from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { useMembers } from '@/hooks/useQueries';
import { startOfMonth, startOfQuarter, startOfYear, subMonths, subQuarters, endOfMonth, endOfQuarter, endOfYear } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

// Strict Monochromatic Palette matching design system
const COLORS = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#F3F4F6'];

const STAGE_LABELS: Record<string, string> = {
  NEW_LEAD: 'New Lead', OUTREACH: 'Outreach', MEETING: 'Meeting', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation',
  CONTRACT: 'Contract', ACTIVE_RETAINER: 'Active Retainer', ACTIVE_PROJECT: 'Active Project',
  PROJECT_COMPLETED: 'Project Completed', CHURNED: 'Churned'
};

const ALL_STAGES = Object.keys(STAGE_LABELS);

export function PipelineDashboard() {
  const { data: members = [] } = useMembers();

  const [allLeads, setAllLeads] = useState<any[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  
  // Filters State
  const [dateRange, setDateRange] = useState('ALL'); 
  const [dateFilterType, setDateFilterType] = useState<'CREATED'|'CLOSE'>('CREATED');
  const [customDateFrom, setCustomDateFrom] = useState('');
  const [customDateTo, setCustomDateTo] = useState('');
  
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);
  
  const [selectedStages, setSelectedStages] = useState<string[]>(ALL_STAGES);
  const [showStageDropdown, setShowStageDropdown] = useState(false);
  const stageDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<any[]>('/crm/leads').then(data => {
      setAllLeads(data);
      setLoadingInitial(false);
    }).catch(console.error);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (stageDropdownRef.current && !stageDropdownRef.current.contains(event.target as Node)) {
        setShowStageDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Trigger loading state briefly when filters change to show reactivity
  useEffect(() => {
    if (!loadingInitial) {
      setIsFiltering(true);
      const t = setTimeout(() => setIsFiltering(false), 300);
      return () => clearTimeout(t);
    }
  }, [dateRange, dateFilterType, customDateFrom, customDateTo, ownerFilter, selectedStages, loadingInitial]);

  const filteredLeads = useMemo(() => {
    return allLeads.filter(lead => {
      // 1. Stage Filter
      if (!selectedStages.includes(lead.stage)) return false;

      // 2. Owner Filter
      if (ownerFilter.length > 0 && !ownerFilter.includes(lead.assignedToId)) return false;

      // 3. Date Filter
      if (dateRange !== 'ALL') {
        const targetDateStr = dateFilterType === 'CREATED' ? lead.createdAt : lead.expectedCloseDate;
        if (!targetDateStr) return false;
        
        const targetDate = new Date(targetDateStr);
        const now = new Date();
        
        let start = new Date(0);
        let end = new Date('2100-01-01');
        
        switch (dateRange) {
          case 'THIS_MONTH':
            start = startOfMonth(now);
            end = endOfMonth(now);
            break;
          case 'LAST_MONTH':
            start = startOfMonth(subMonths(now, 1));
            end = endOfMonth(subMonths(now, 1));
            break;
          case 'THIS_QUARTER':
            start = startOfQuarter(now);
            end = endOfQuarter(now);
            break;
          case 'LAST_QUARTER':
            start = startOfQuarter(subQuarters(now, 1));
            end = endOfQuarter(subQuarters(now, 1));
            break;
          case 'THIS_YEAR':
            start = startOfYear(now);
            end = endOfYear(now);
            break;
          case 'CUSTOM':
            if (customDateFrom) start = new Date(customDateFrom);
            if (customDateTo) end = new Date(customDateTo);
            break;
        }

        if (targetDate < start || targetDate > end) return false;
      }

      return true;
    });
  }, [allLeads, selectedStages, ownerFilter, dateRange, dateFilterType, customDateFrom, customDateTo]);

  const metrics = useMemo(() => {
    const activeLeads = filteredLeads.filter(l => !['PROJECT_COMPLETED', 'CHURNED'].includes(l.stage));
    // Open pipeline only — exclude won/active/closed stages so this doesn't double-count value already in wonValue.
    const openLeads = filteredLeads.filter(l => !['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED', 'CHURNED'].includes(l.stage));
    const totalPipelineValue = openLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
    const wonValue = filteredLeads.filter(l => ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED'].includes(l.stage)).reduce((sum, l) => sum + (l.dealValue || 0), 0);
    
    // Stage Distribution for Bar Chart
    const stageCounts: Record<string, number> = {};
    activeLeads.forEach(l => {
      stageCounts[l.stage] = (stageCounts[l.stage] || 0) + 1;
    });
    const barData = Object.entries(stageCounts)
      .map(([stage, count]) => ({ name: STAGE_LABELS[stage] || stage, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);

    // Value Distribution for Pie Chart
    const stageValues: Record<string, number> = {};
    activeLeads.forEach(l => {
      if (l.dealValue) {
        stageValues[l.stage] = (stageValues[l.stage] || 0) + l.dealValue;
      }
    });
    const pieData = Object.entries(stageValues)
      .map(([stage, value]) => ({ name: STAGE_LABELS[stage] || stage, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

    // Won & Lost closed deals + lost-reason breakdown
    const wonClosed = filteredLeads.filter(l => ['CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT', 'PROJECT_COMPLETED'].includes(l.stage));
    const lostClosed = filteredLeads.filter(l => l.stage === 'CHURNED');
    const lostReasonLabels: Record<string, string> = {
      BUDGET: 'Price too high', COMPETITOR: 'Competitor', NO_BUDGET: 'No budget',
      UNRESPONSIVE: 'No decision', TIMING: 'Timing', SCOPE_MISMATCH: 'Requirements',
      INTERNAL_CHANGE: 'Internal change', OTHER: 'Other',
    };
    const reasonCounts: Record<string, number> = {};
    lostClosed.forEach(l => {
      const key = l.lostReason || 'OTHER';
      reasonCounts[key] = (reasonCounts[key] || 0) + 1;
    });
    const lostReasonData = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ name: lostReasonLabels[reason] || reason, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalLeads: filteredLeads.length,
      activeLeads: activeLeads.length,
      pipelineValue: totalPipelineValue,
      wonValue: wonValue,
      barData,
      pieData,
      wonCount: wonClosed.length,
      wonClosedValue: wonClosed.reduce((sum, l) => sum + (l.dealValue || 0), 0),
      lostCount: lostClosed.length,
      lostValue: lostClosed.reduce((sum, l) => sum + (l.dealValue || 0), 0),
      lostReasonData,
    };
  }, [filteredLeads]);

  const recentLeads = useMemo(() => {
    return [...filteredLeads].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6);
  }, [filteredLeads]);


  if (loadingInitial) {
    return <div className="animate-pulse space-y-6">
      <div className="h-20 bg-gray-200/50 rounded-2xl mb-6"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-32 bg-gray-200/50 rounded-2xl"></div>)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="h-80 bg-gray-200/50 rounded-2xl"></div>
        <div className="h-80 bg-gray-200/50 rounded-2xl"></div>
      </div>
    </div>;
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 backdrop-blur-xl border border-border shadow-md rounded-xl p-3 min-w-30">
          <p className="text-[10px] font-bold text-secondary mb-1.5 uppercase tracking-wider">{label || payload[0].name}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-4 text-sm items-center">
              <span className="font-medium text-primary flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || '#111827' }} />
                {entry.name || 'Value'}
              </span>
              <span className="font-semibold text-accent">
                {entry.dataKey === 'value' ? formatCurrency(entry.value) : entry.value}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  const toggleStage = (stage: string) => {
    setSelectedStages(prev => prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]);
  };

  return (
    <div className="space-y-6 pb-8">
      
      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-border shadow-sm">
        
        {/* Date Range */}
        <div className="flex items-center gap-2">
          <Select
            value={dateRange}
            onChange={setDateRange}
            options={[
              { label: 'All Time', value: 'ALL' },
              { label: 'This Month', value: 'THIS_MONTH' },
              { label: 'Last Month', value: 'LAST_MONTH' },
              { label: 'This Quarter', value: 'THIS_QUARTER' },
              { label: 'Last Quarter', value: 'LAST_QUARTER' },
              { label: 'This Year', value: 'THIS_YEAR' },
              { label: 'Custom Range', value: 'CUSTOM' }
            ]}
          />
          {dateRange !== 'ALL' && (
            <button
              onClick={() => setDateFilterType(prev => prev === 'CREATED' ? 'CLOSE' : 'CREATED')}
              className="px-3 py-2 text-xs font-medium rounded-lg border border-border bg-gray-50 text-secondary hover:text-primary transition-colors whitespace-nowrap"
            >
              By {dateFilterType === 'CREATED' ? 'Created Date' : 'Close Date'}
            </button>
          )}
        </div>

        {dateRange === 'CUSTOM' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customDateFrom} onChange={(e) => setCustomDateFrom(e.target.value)} className="rounded-lg border border-border p-2 text-sm outline-none focus:border-primary text-secondary" />
            <span className="text-secondary">-</span>
            <input type="date" value={customDateTo} onChange={(e) => setCustomDateTo(e.target.value)} className="rounded-lg border border-border p-2 text-sm outline-none focus:border-primary text-secondary" />
          </div>
        )}

        {/* Owner Filter */}
        <div className="w-56">
          <MultiSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            placeholder="Owners"
            options={members.map((m: any) => ({ label: m.name, value: m.id, image: getInitials(m.name) }))}
          />
        </div>

        {/* Stage Multi-Select */}
        <div className="relative" ref={stageDropdownRef}>
          <button
            onClick={() => setShowStageDropdown(!showStageDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-border rounded-xl text-sm font-medium text-secondary hover:text-primary transition-colors min-w-40 justify-between"
          >
            <span>Stages ({selectedStages.length === ALL_STAGES.length ? 'All' : selectedStages.length})</span>
            <ChevronDown className="w-4 h-4" />
          </button>
          
          <AnimatePresence>
            {showStageDropdown && (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                className="absolute top-full left-0 mt-2 w-64 bg-white border border-border rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto"
              >
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => setSelectedStages(selectedStages.length === ALL_STAGES.length ? [] : ALL_STAGES)}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-primary hover:bg-gray-50 rounded-lg flex justify-between items-center"
                  >
                    {selectedStages.length === ALL_STAGES.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <div className="h-px bg-border my-1" />
                  {ALL_STAGES.map(stage => (
                    <button
                      key={stage}
                      onClick={() => toggleStage(stage)}
                      className="w-full text-left px-3 py-2 text-sm text-secondary hover:bg-gray-50 rounded-lg flex items-center gap-3 transition-colors"
                    >
                      {selectedStages.includes(stage) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-300" />
                      )}
                      {STAGE_LABELS[stage] || stage}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 relative">
        {isFiltering && <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-2xl"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
        
        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full relative overflow-hidden">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Total Pipeline Value</p>
            <IndianRupee className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-primary">{formatCurrency(metrics.pipelineValue)}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Closed / Won Value</p>
            <TrendingUp className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-primary">{formatCurrency(metrics.wonValue)}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Active Deals</p>
            <Target className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-primary">{metrics.activeLeads}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-secondary uppercase tracking-wide">Total Leads Tracked</p>
            <Briefcase className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-primary">{metrics.totalLeads}</p>
        </div>

      </div>
      
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
        {isFiltering && <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-2xl"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
        
        <div className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-6">Leads by Stage</h2>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.barData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6B7280' }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#FAFAFA' }} />
                <Bar dataKey="count" name="Leads" radius={[2, 2, 0, 0]}>
                  {metrics.barData.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-6">Value Distribution</h2>
          <div className="h-[280px] w-full flex flex-col justify-center">
            {metrics.pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="80%">
                  <PieChart>
                    <Pie
                      data={metrics.pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {metrics.pieData.map((entry: any, index: number) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-2">
                  {metrics.pieData.map((entry: any, index: number) => (
                    <div key={index} className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                      {entry.name}
                    </div>
                  ))}
                </div>
              </>
            ) : (
               <div className="flex-1 flex items-center justify-center text-sm text-secondary">No data for selected filters</div>
            )}
          </div>
        </div>

      </div>

      {/* Won & Lost Deals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
        {isFiltering && <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-2xl"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}

        {/* Won Deals */}
        <div className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" /> Won Deals
          </h2>
          <div className="flex items-end gap-8">
            <div>
              <p className="text-3xl font-semibold text-emerald-600">{metrics.wonCount}</p>
              <p className="text-xs text-secondary mt-1">deals won</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-primary">{formatCurrency(metrics.wonClosedValue)}</p>
              <p className="text-xs text-secondary mt-1">total won value</p>
            </div>
          </div>
        </div>

        {/* Lost Deals + Reason for Loss breakdown */}
        <div className="rounded-2xl bg-white border border-border hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500" /> Lost Deals
          </h2>
          <div className="flex items-end gap-8 mb-4">
            <div>
              <p className="text-3xl font-semibold text-red-600">{metrics.lostCount}</p>
              <p className="text-xs text-secondary mt-1">deals lost</p>
            </div>
            <div>
              <p className="text-2xl font-semibold text-primary">{formatCurrency(metrics.lostValue)}</p>
              <p className="text-xs text-secondary mt-1">value lost</p>
            </div>
          </div>
          <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">Reason for Loss</p>
          {metrics.lostReasonData.length > 0 ? (
            <div className="h-[160px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.lostReasonData} layout="vertical" margin={{ top: 0, right: 12, left: 10, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={90} tick={{ fontSize: 10, fill: '#6B7280' }} />
                  <Tooltip cursor={{ fill: '#FAFAFA' }} />
                  <Bar dataKey="count" name="Lost" radius={[0, 4, 4, 0]} fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[160px] flex items-center justify-center text-sm text-secondary">No lost deals in range</div>
          )}
        </div>
      </div>

      {/* Recent Activity Table */}
      <div className="rounded-2xl bg-white border border-border overflow-hidden relative">
        {isFiltering && <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>}
        
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-primary"><Clock className="w-4 h-4 text-secondary"/> Recent Leads</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-150">
            <thead>
              <tr className="border-b border-border bg-surface">
                <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Client / Company</th>
                <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Stage</th>
                <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Value</th>
                <th className="px-5 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Added On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-primary">{lead.contactName || lead.companyName || lead.client?.name || 'Unknown'}</span>
                      <span className="text-xs text-secondary">{lead.companyName || lead.client?.company || ''}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${
                      lead.stage === 'PROJECT_COMPLETED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      lead.stage === 'CHURNED' ? 'bg-red-50 text-red-700 border-red-200' :
                      'text-primary bg-[#F3F4F6] border-border'
                    }`}>
                      {STAGE_LABELS[lead.stage] || lead.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm font-medium text-primary">
                      {lead.dealValue ? formatCurrency(lead.dealValue) : '-'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm text-secondary">
                      {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </td>
                </tr>
              ))}
              {recentLeads.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-sm text-secondary">
                    No leads found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
    </div>
  );
}
