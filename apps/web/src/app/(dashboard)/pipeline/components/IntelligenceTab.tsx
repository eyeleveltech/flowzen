'use client';

import { useState } from 'react';
import { Sparkles, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { DossierView } from './DossierView';
import { Icon } from '@/components/ui/icon';

export function IntelligenceTab({ leadId, linkedinUrl, dossier, onRefetch }: {
  leadId: string;
  linkedinUrl?: string | null;
  dossier?: any;
  onRefetch?: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [local, setLocal] = useState<any>(dossier || null);

  const d = local || dossier;

  async function run() {
    setRunning(true);
    setError('');
    try {
      const res = await api.post<{ success: boolean; dossier?: any; error?: string }>(`/crm/leads/${leadId}/intelligence`, {});
      setLocal(res.dossier);
      onRefetch?.();
      toast.success('Intelligence generated');
    } catch (e: any) {
      setError(e.message || 'Failed to generate intelligence');
      toast.error(e.message || 'Failed to generate intelligence');
    } finally {
      setRunning(false);
    }
  }

  // Per the brief, the Intelligence tab only appears when a LinkedIn URL is present.
  if (!linkedinUrl) return null;

  return (
    <div className="bg-white rounded-2xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary flex items-center gap-2">
          <Icon as={Sparkles} size="lg" className="text-secondary" /> LinkedIn Intelligence
        </h2>
        {d && !running && (
          <button onClick={run} className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary border border-border rounded-lg px-3 py-1.5 transition-colors">
            <Icon as={RefreshCw} size="sm" /> Regenerate
          </button>
        )}
      </div>

      {running ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin mb-3" />
          <p className="text-sm font-medium text-primary">Analysing profile…</p>
          <p className="text-xs text-secondary mt-1">This takes about 15–30 seconds.</p>
        </div>
      ) : error && !d ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <AlertTriangle className="h-7 w-7 text-amber-500 mb-2" />
          <p className="text-sm text-body">{error}</p>
          <button onClick={run} className="mt-3 text-sm font-medium text-white bg-primary rounded-xl px-4 py-2 hover:bg-primary-hover transition-all">Retry</button>
        </div>
      ) : !d ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <p className="text-sm text-secondary mb-3">Generate a behavioural dossier from this lead's LinkedIn profile.</p>
          <button onClick={run} className="flex items-center gap-2 text-sm font-medium text-white bg-primary rounded-xl px-4 py-2.5 hover:bg-primary-hover transition-all">
            <Icon as={Sparkles} size="md" /> Run Intelligence
          </button>
        </div>
      ) : (
        <DossierView d={d} />
      )}
    </div>
  );
}
