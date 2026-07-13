'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function ContractFormModal({ onClose, onSaved }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    clientId: '',
    title: '',
    value: '',
    billingFrequency: 'MONTHLY',
    startDate: '',
    endDate: '',
    notes: '',
  });

  const queryClient = useQueryClient();
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<any[]>('/clients'),
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.post('/revenue/contracts', data),
    onSuccess: () => {
      toast.success('Contract created successfully');
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      onSaved();
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to create contract');
      setSubmitting(false);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    saveMutation.mutate({
      ...formData,
      value: Number(formData.value)
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
          <h2 className="text-lg font-semibold text-primary">New Contract</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6]">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Client *</label>
            <select
              required
              value={formData.clientId}
              onChange={(e) => setFormData(f => ({ ...f, clientId: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
            >
              <option value="">Select Client</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company || c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Contract Title *</label>
            <input
              required
              type="text"
              value={formData.title}
              onChange={(e) => setFormData(f => ({ ...f, title: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              placeholder="e.g. Social Media Retainer Q3"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Contract Value *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={formData.value}
                onChange={(e) => setFormData(f => ({ ...f, value: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Billing Frequency *</label>
              <select
                required
                value={formData.billingFrequency}
                onChange={(e) => setFormData(f => ({ ...f, billingFrequency: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              >
                <option value="ONCE">Once</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Start Date *</label>
              <input
                required
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData(f => ({ ...f, startDate: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">End Date</label>
              <input
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData(f => ({ ...f, endDate: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Notes</label>
            <textarea
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData(f => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all resize-none"
              placeholder="Internal notes..."
            />
          </div>
        </form>

        <div className="p-6 border-t border-[#F3F4F6] bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-[#374151] hover:bg-border rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2.5 text-sm font-medium text-white bg-primary hover:bg-[#1F2937] rounded-xl transition-colors disabled:opacity-50"
          >
            {submitting ? 'Saving...' : 'Save Contract'}
          </button>
        </div>
      </div>
    </>
  );
}
