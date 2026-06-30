'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/stores';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { LeadListView } from './components/LeadListView';
import { PipelineDashboard } from './components/PipelineDashboard';
import { PipelineBoardView } from './components/PipelineBoardView';
import { Plus } from 'lucide-react';
import { LeadModal } from './components/LeadModal';
import { AnimatePresence } from 'framer-motion';

function PipelineContent() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'BOARD' | 'LIST' | 'DASHBOARD'>('BOARD');
  const [totalLeads, setTotalLeads] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Pipeline</h1>
          <p className="text-sm text-secondary mt-1">{totalLeads} total leads</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 self-start sm:self-auto w-full sm:w-auto">
          {activeTab === 'BOARD' && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-[#1F2937] transition-all shadow-sm"
            >
              <Plus className="h-4 w-4" /> Add Lead
            </button>
          )}
          <div className="flex items-center gap-2 p-1 bg-[#F3F4F6] rounded-xl">
          <button
            onClick={() => setActiveTab('BOARD')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'BOARD' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-[#374151]'}`}
          >
            Board
          </button>
          <button
            onClick={() => setActiveTab('LIST')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'LIST' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-[#374151]'}`}
          >
            List
          </button>
          <button
            onClick={() => setActiveTab('DASHBOARD')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${activeTab === 'DASHBOARD' ? 'bg-white text-primary shadow-sm' : 'text-secondary hover:text-[#374151]'}`}
          >
            Analytics
          </button>
        </div>
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
        {activeTab === 'BOARD' ? <PipelineBoardView /> : activeTab === 'LIST' ? <LeadListView /> : <PipelineDashboard />}
      </motion.div>

      <AnimatePresence>
        {isModalOpen && (
          <LeadModal
            initialMode="MANUAL"
            onClose={() => setIsModalOpen(false)}
            onSuccess={() => {
              setIsModalOpen(false);
              fetchTotal();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default function PipelinePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <PipelineContent />
    </Suspense>
  );
}
