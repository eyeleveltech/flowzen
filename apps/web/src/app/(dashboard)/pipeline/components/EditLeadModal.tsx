'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { X, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { useMembers } from '@/hooks/useQueries';

export function EditLeadModal({ lead, onClose, onSuccess }: { lead: any; onClose: () => void; onSuccess: () => void; }) {
  const { data: members = [] } = useMembers();
  
  const [form, setForm] = useState({
    source: lead.source || 'MANUAL',
    assignedToId: lead.assignedToId || '',
    dealValue: lead.dealValue ? String(lead.dealValue) : '',
    expectedCloseDate: lead.expectedCloseDate ? new Date(lead.expectedCloseDate).toISOString().split('T')[0] : '',
  });
  
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        dealValue: form.dealValue ? parseFloat(form.dealValue) : undefined,
        expectedCloseDate: form.expectedCloseDate || undefined,
        assignedToId: form.assignedToId || undefined,
      };

      await api.patch(`/crm/leads/${lead.id}`, payload);
      toast.success('Lead updated successfully');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col border-l border-[#E5E7EB]"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E5E7EB]">
          <div>
            <h2 className="text-lg font-semibold text-[#111827]">Edit Lead Details</h2>
            <p className="text-sm text-[#6B7280]">Update information for {lead.client.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-[#9CA3AF] hover:text-[#111827] rounded-lg hover:bg-[#F3F4F6] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <form id="editLeadForm" onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Source</label>
                <Select
                  value={form.source}
                  onChange={(v) => setForm({ ...form, source: v })}
                  options={[
                    { label: 'Manual Entry', value: 'MANUAL' },
                    { label: 'Referral', value: 'REFERRAL' },
                    { label: 'Inbound', value: 'INBOUND' },
                    { label: 'LinkedIn', value: 'LINKEDIN' },
                    { label: 'Instagram', value: 'INSTAGRAM' },
                    { label: 'WhatsApp', value: 'WHATSAPP' },
                    { label: 'Other', value: 'OTHER' },
                  ]}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Assigned To</label>
                <Select
                  value={form.assignedToId}
                  onChange={(v) => setForm({ ...form, assignedToId: v })}
                  options={[
                    { label: 'Unassigned', value: '' },
                    ...members.map((m: any) => ({ label: m.name, value: m.id }))
                  ]}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Deal Value (₹)</label>
                <input
                  type="number"
                  value={form.dealValue}
                  onChange={(e) => setForm({ ...form, dealValue: e.target.value })}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
                  placeholder="e.g. 50000"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[#374151] mb-1.5">Expected Close Date</label>
                <input
                  type="date"
                  value={form.expectedCloseDate}
                  onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
                  className="w-full rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#111827] transition-all"
                />
              </div>
            </div>
          </form>
        </div>

        <div className="p-6 border-t border-[#E5E7EB] bg-[#F9FAFB] shrink-0 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#374151] hover:bg-[#E5E7EB] rounded-xl transition-all">
            Cancel
          </button>
          <button
            type="submit"
            form="editLeadForm"
            disabled={submitting}
            className="flex items-center gap-2 px-6 py-2 bg-[#111827] text-white text-sm font-medium rounded-xl hover:bg-[#1F2937] transition-all disabled:opacity-50"
          >
            {submitting ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save Changes
          </button>
        </div>
      </motion.div>
    </>
  );
}
