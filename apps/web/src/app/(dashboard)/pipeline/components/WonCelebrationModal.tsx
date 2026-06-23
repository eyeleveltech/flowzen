'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Trophy, FolderPlus, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

interface WonCelebrationModalProps {
  lead: any;
  onClose: () => void;
}

// Shown after a lead is moved to CONTRACT (deal signed). The client is already auto-activated
// server-side; here we offer to spin up a project pre-filled from the won lead.
export function WonCelebrationModal({ lead, onClose }: WonCelebrationModalProps) {
  const router = useRouter();
  const clientName = lead?.client?.company || lead?.client?.name || 'Client';

  const handleCreateProject = () => {
    const params = new URLSearchParams({ create: 'true' });
    params.set('prefillName', `${clientName} Project`);
    const clientId = lead?.clientId || lead?.client?.id;
    if (clientId) params.set('prefillClientId', clientId);
    if (lead?.dealValue) params.set('prefillBudget', String(lead.dealValue));
    if (lead?.assignedToId) params.set('prefillOwnerId', lead.assignedToId);
    onClose();
    router.push(`/projects?${params.toString()}`);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-border p-6 text-center"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <X className="h-4 w-4 text-secondary" />
        </button>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
          <Trophy className="h-7 w-7 text-emerald-600" />
        </div>
        <h2 className="text-xl font-bold text-primary">🎉 Deal Won!</h2>
        <p className="mt-1 text-sm text-secondary">What would you like to do next?</p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
          ✓ {clientName} marked as Active client
        </p>
        {lead?.dealValue ? (
          <p className="mt-3 text-2xl font-bold text-primary">{formatCurrency(lead.dealValue)}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={handleCreateProject}
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-colors"
          >
            <FolderPlus className="h-4 w-4" /> Create Project
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-gray-50 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </motion.div>
    </>
  );
}
