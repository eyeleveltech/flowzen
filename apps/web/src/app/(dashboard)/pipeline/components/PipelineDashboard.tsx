'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, DollarSign, Target, Briefcase, Clock, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

// Strict Monochromatic Palette matching design system
const COLORS = ['#111827', '#4B5563', '#9CA3AF', '#D1D5DB', '#F3F4F6'];

const STAGE_LABELS: Record<string, string> = {
  LEAD: 'Lead', MQL: 'MQL', SQL: 'SQL', REACH_OUT: 'Reach Out', DISCOVERY: 'Discovery',
  AUDIT: 'Audit', PRESENTATION: 'Presentation', PROPOSAL: 'Proposal', NEGOTIATION: 'Negotiation',
  FINALIZATION: 'Finalization', CONTRACT: 'Contract', ACTIVE_RETAINER: 'Active Retainer', ACTIVE_PROJECT: 'Active Project',
  WON_CLOSED: 'Won Closed', LOST_CLOSED: 'Lost Closed'
};

export function PipelineDashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [recentLeads, setRecentLeads] = useState<any[]>([]);

  useEffect(() => {
    api.get<any[]>('/crm/leads').then(data => {
      const activeLeads = data.filter(l => !['WON_CLOSED', 'LOST_CLOSED'].includes(l.stage));
      const totalPipelineValue = activeLeads.reduce((sum, l) => sum + (l.dealValue || 0), 0);
      const wonValue = data.filter(l => ['WON_CLOSED', 'CONTRACT', 'ACTIVE_RETAINER', 'ACTIVE_PROJECT'].includes(l.stage)).reduce((sum, l) => sum + (l.dealValue || 0), 0);
      
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

      setRecentLeads(data.slice(0, 6)); // 6 most recent
      setMetrics({
        totalLeads: data.length,
        activeLeads: activeLeads.length,
        pipelineValue: totalPipelineValue,
        wonValue: wonValue,
        barData,
        pieData
      });
    }).catch(console.error);
  }, []);

  if (!metrics) {
    return <div className="animate-pulse space-y-6">
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
        <div className="bg-white/95 backdrop-blur-xl border border-[#E5E7EB] shadow-md rounded-xl p-3 min-w-[120px]">
          <p className="text-[10px] font-bold text-[#6B7280] mb-1.5 uppercase tracking-wider">{label || payload[0].name}</p>
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex justify-between gap-4 text-sm items-center">
              <span className="font-medium text-[#111827] flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color || '#111827' }} />
                {entry.name || 'Value'}
              </span>
              <span className="font-semibold text-[#000000]">
                {entry.dataKey === 'value' ? formatCurrency(entry.value) : entry.value}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        
        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-[#6B7280] uppercase tracking-wide">Total Pipeline Value</p>
            <DollarSign className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-[#111827]">{formatCurrency(metrics.pipelineValue)}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-[#6B7280] uppercase tracking-wide">Closed / Won Value</p>
            <TrendingUp className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-[#111827]">{formatCurrency(metrics.wonValue)}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-[#6B7280] uppercase tracking-wide">Active Deals</p>
            <Target className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-[#111827]">{metrics.activeLeads}</p>
        </div>

        <div className="flex flex-col justify-between p-4 sm:p-5 rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow h-full">
          <div className="flex items-start justify-between gap-2 mb-3">
            <p className="text-[11px] sm:text-xs font-medium text-[#6B7280] uppercase tracking-wide">Total Leads Tracked</p>
            <Briefcase className="w-4 h-4 shrink-0 text-[#9CA3AF]" />
          </div>
          <p className="text-3xl font-semibold text-[#111827]">{metrics.totalLeads}</p>
        </div>

      </div>
      
      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        <div className="rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827] mb-6">Leads by Stage</h2>
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

        <div className="rounded-2xl bg-white border border-[#E5E7EB] hover:shadow-sm transition-shadow p-5 flex flex-col">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827] mb-6">Value Distribution</h2>
          <div className="h-[280px] w-full flex flex-col justify-center">
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
                <div key={index} className="flex items-center gap-1.5 text-xs font-medium text-[#6B7280]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                  {entry.name}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* Recent Activity Table */}
      <div className="rounded-2xl bg-white border border-[#E5E7EB] overflow-hidden">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111827]"><Clock className="w-4 h-4 text-[#6B7280]"/> Recent Leads</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[600px]">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#FAFAFA]">
                <th className="px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Client / Company</th>
                <th className="px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Stage</th>
                <th className="px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Value</th>
                <th className="px-5 py-3 text-xs font-semibold text-[#6B7280] uppercase tracking-wider">Added On</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {recentLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-[#FAFAFA] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-[#111827]">{lead.client.name}</span>
                      <span className="text-xs text-[#6B7280]">{lead.client.company}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center text-xs font-medium text-[#111827] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                      {STAGE_LABELS[lead.stage] || lead.stage}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm font-medium text-[#111827]">
                      {lead.dealValue ? formatCurrency(lead.dealValue) : '-'}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-sm text-[#6B7280]">
                      {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </td>
                </tr>
              ))}
              {recentLeads.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-sm text-[#6B7280]">
                    No leads found in your pipeline yet.
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
