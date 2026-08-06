'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Trophy, FolderPlus, X } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';

interface WonCelebrationModalProps {
  lead: any;
  onClose: () => void;
}

// Shown after a lead is moved to CONTRACT (deal signed). The client is already auto-activated
// server-side; here we offer to spin up a project pre-filled from the won lead.
export function WonCelebrationModal({ lead, onClose }: WonCelebrationModalProps) {
  const router = useRouter();
  const clientName = lead?.client?.company || lead?.client?.name || 'Client';

  // dealValue is the only figure — the `lead.fields.agreedFinalValue` fallback that used to sit
  // here could never fire anyway: the API returns `dealFields` as an array of
  // { fieldKey, fieldValue }, never a `fields` object keyed by name.
  const dealAmount = lead?.dealValue ?? null;

  const handleCreateProject = () => {
    const params = new URLSearchParams({ create: 'true' });
    params.set('prefillName', `${clientName} Project`);
    const clientId = lead?.clientId || lead?.client?.id;
    if (clientId) params.set('prefillClientId', clientId);
    if (dealAmount) params.set('prefillBudget', String(dealAmount));
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
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md bg-white rounded-2xl shadow-modal border border-border p-6 text-center"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl hover:bg-gray-100 transition-colors">
          <Icon as={X} size="md" className="text-secondary" />
        </button>

        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
          <Trophy className="h-7 w-7 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-primary">🎉 Deal Won!</h2>
        <p className="mt-1 text-sm text-secondary">What would you like to do next?</p>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 px-2.5 py-1 rounded-full">
          ✓ {clientName} marked as Active client
        </p>
        {dealAmount ? (
          <p className="mt-3 text-2xl font-bold text-primary">{formatCurrency(dealAmount)}</p>
        ) : null}

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={handleCreateProject}
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-hover transition-colors"
          >
            <Icon as={FolderPlus} size="md" /> Create Project
          </button>
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-body hover:bg-gray-50 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </motion.div>
    </>
  );
}
