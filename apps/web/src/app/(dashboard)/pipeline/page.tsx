'use client';

import { useState, useEffect, Suspense } from 'react';
import { useAuthStore } from '@/stores';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getSSE } from '@/lib/sse';
import { LeadListView } from './components/LeadListView';
import { PipelineDashboard } from './components/PipelineDashboard';
import { PipelineBoardView } from './components/PipelineBoardView';
import { Plus, Settings } from 'lucide-react';
import { LeadModal } from './components/LeadModal';
import { AnimatePresence } from 'framer-motion';
import { ViewSettingsPanel } from '@/components/ui/view-settings-panel';
import toast from 'react-hot-toast';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Icon } from '@/components/ui/icon';

function PipelineContent() {
  usePageTitle('Pipeline');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'BOARD' | 'LIST' | 'DASHBOARD'>('BOARD');
  const [totalLeads, setTotalLeads] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Quick Create ("+ → New Lead") lands here as /pipeline?create=true. The page defaults to the
  // BOARD tab, which never read the param — so the header button silently did nothing. Honor it
  // at page level, whatever tab is active.
  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setIsModalOpen(true);
      // Drop the param so tab switches / refreshes don't re-trigger the modal.
      router.replace('/pipeline');
    }
  }, [searchParams, router]);
  const [showViewSettings, setShowViewSettings] = useState(false);
  const [viewName, setViewName] = useState('All Leads');

  const LOCAL_STORAGE_KEY = 'flowzen_view_pipeline';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.name) setViewName(parsed.name);
          if (parsed.visibleColumns) setVisibleColumns(parsed.visibleColumns);
          // Always default CRM pipeline to BOARD (Kanban) on mount
          setActiveTab('BOARD');
        } catch (e) {
          console.error(e);
        }
      }
    }
  }, []);

  const PIPELINE_COLUMNS = [
    { id: 'lead', label: 'Lead' },
    { id: 'company', label: 'Company' },
    { id: 'value', label: 'Value' },
    { id: 'stage', label: 'Stage' },
    { id: 'owner', label: 'Owner' },
  ];
  const [visibleColumns, setVisibleColumns] = useState<string[]>(PIPELINE_COLUMNS.map(c => c.id));

  // Debounced because a bulk action (importing 500 leads, deleting a selection) fires one
  // lead:updated per row. Without this the header would re-count once per event.
  const refreshTotal = useDebouncedCallback(() => { fetchTotal(); }, 300);

  useEffect(() => {
    fetchTotal();
    const sse = getSSE();
    if (sse) {
      sse.on('lead:updated', refreshTotal);
      return () => { sse.off('lead:updated', refreshTotal); };
    }
  }, [refreshTotal]);

  // Removed mobile view-override useEffect to default to BOARD view on both desktop and mobile.

  async function fetchTotal() {
    try {
      // Counts in the database. This used to fetch every lead with all its relations and read
      // `.length` off the array — ~780 KB at 500 leads, to render one number.
      const data = await api.get<{ count: number }>('/crm/leads/count');
      setTotalLeads(data.count || 0);
    } catch (err) { }
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
          <h1 className="text-2xl font-semibold text-primary tracking-tight flex items-center gap-2">
            Pipeline
            <span className="text-xs font-normal text-secondary bg-[#F3F4F6] px-2 py-0.5 rounded-lg border border-border">
              {viewName}
            </span>
          </h1>
          <p className="text-sm text-secondary mt-1">{totalLeads} total leads</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 self-start sm:self-auto w-full sm:w-auto">
          {activeTab === 'BOARD' && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center justify-center rounded-xl bg-primary h-9.5 w-9.5 shrink-0 text-white hover:bg-[#1F2937] transition-all shadow-sm"
              title="Add Lead"
            >
              <Icon as={Plus} size="md" />
            </button>
          )}
          <div className="flex items-center gap-2 shrink-0">
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
            <button
              onClick={() => setShowViewSettings(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary hover:text-primary bg-white border border-border rounded-lg shadow-sm transition-colors hover:bg-gray-50 h-9.5"
              title="Configure View Settings"
            >
              <Icon as={Settings} size="sm" /> View Settings
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
      <ViewSettingsPanel
        isOpen={showViewSettings}
        onClose={() => setShowViewSettings(false)}
        viewName={viewName}
        onViewNameChange={setViewName}
        viewType={activeTab === 'LIST' ? 'list' : 'board'}
        onViewTypeChange={(type) => setActiveTab(type === 'list' ? 'LIST' : 'BOARD')}
        columns={PIPELINE_COLUMNS}
        visibleColumns={visibleColumns}
        onVisibleColumnsChange={setVisibleColumns}
        onSave={() => {
          if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
              name: viewName,
              visibleColumns,
              viewType: activeTab
            }));
          }
          toast.success('View Settings saved successfully!');
          setShowViewSettings(false);
        }}
        onReset={() => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem(LOCAL_STORAGE_KEY);
          }
          setViewName('All Leads');
          setActiveTab('BOARD');
          setVisibleColumns(PIPELINE_COLUMNS.map(c => c.id));
          toast.success('View Settings reset to defaults');
        }}
        onClone={() => {
          const clonedName = viewName + ' (Copy)';
          setViewName(clonedName);
          if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
              name: clonedName,
              visibleColumns,
              viewType: activeTab
            }));
          }
          toast.success('Cloned successfully to a new view copy!');
          setShowViewSettings(false);
        }}
      />
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
