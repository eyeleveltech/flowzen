'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { LeadListView } from './components/LeadListView';
import { PipelineDashboard } from './components/PipelineDashboard';

function PipelineContent() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'LIST' | 'DASHBOARD'>('LIST');
  const [totalLeads, setTotalLeads] = useState(0);

  useEffect(() => {
    fetchTotal();
    const sse = getSSE();
    if (sse) {
      sse.on('lead:updated', fetchTotal);
      return () => { sse.off('lead:updated'); };
    }
  }, []);

  async function fetchTotal() {
    try {
      const data = await api.get<any[]>('/crm/leads');
      setTotalLeads(data.length || 0);
    } catch (err) {}
  }

  if (user && user.role === 'TEAM_MEMBER') {
    router.push('/dashboard');
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[#111827] tracking-tight">Pipeline</h1>
          <p className="text-sm text-[#6B7280] mt-1">{totalLeads} total leads</p>
        </div>
        <div className="flex items-center gap-2 p-1 bg-[#F3F4F6] rounded-xl self-start sm:self-auto">
          <button
            onClick={() => setActiveTab('LIST')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'LIST' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'}`}
          >
            List View
          </button>
          <button
            onClick={() => setActiveTab('DASHBOARD')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'DASHBOARD' ? 'bg-white text-[#111827] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'}`}
          >
            Dashboard
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <motion.div
        key={activeTab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="flex-1"
      >
        {activeTab === 'LIST' ? <LeadListView /> : <PipelineDashboard />}
      </motion.div>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#111827] border-t-transparent" />
      </div>
    }>
      <PipelineContent />
    </Suspense>
  );
}
