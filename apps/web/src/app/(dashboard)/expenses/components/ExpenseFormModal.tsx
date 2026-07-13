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

export function ExpenseFormModal({ onClose, onSaved }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    clientId: '',
    projectId: '',
    vendor: '',
    description: '',
    amount: '',
    date: '',
    category: 'SOFTWARE',
  });

  const queryClient = useQueryClient();
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<any[]>('/clients'),
  });
  
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<any[]>('/projects'),
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => api.post('/revenue/expenses', data),
    onSuccess: () => {
      toast.success('Expense recorded successfully');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      onSaved();
    },
    onError: (e: any) => {
      toast.error(e.message || 'Failed to record expense');
      setSubmitting(false);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    saveMutation.mutate({
      ...formData,
      amount: Number(formData.amount),
      clientId: formData.clientId || null,
      projectId: formData.projectId || null,
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F3F4F6]">
          <h2 className="text-lg font-semibold text-primary">Log Expense</h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-[#F3F4F6]">
            <X className="h-4 w-4 text-secondary" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Vendor *</label>
            <input
              required
              type="text"
              value={formData.vendor}
              onChange={(e) => setFormData(f => ({ ...f, vendor: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              placeholder="e.g. AWS, Adobe, Freelancer Name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Amount *</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData(f => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#374151] mb-1.5">Date *</label>
              <input
                required
                type="date"
                value={formData.date}
                onChange={(e) => setFormData(f => ({ ...f, date: e.target.value }))}
                className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Category *</label>
            <select
              required
              value={formData.category}
              onChange={(e) => setFormData(f => ({ ...f, category: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
            >
              <option value="SOFTWARE">Software / Tools</option>
              <option value="SUBCONTRACTOR">Subcontractor</option>
              <option value="ADVERTISING">Advertising</option>
              <option value="TRAVEL">Travel</option>
              <option value="OFFICE">Office Supplies</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Related Project (Optional)</label>
            <select
              value={formData.projectId}
              onChange={(e) => setFormData(f => ({ ...f, projectId: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
            >
              <option value="">None</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Related Client (Optional)</label>
            <select
              value={formData.clientId}
              onChange={(e) => setFormData(f => ({ ...f, clientId: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all"
            >
              <option value="">None</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.company || c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#374151] mb-1.5">Description / Notes</label>
            <textarea
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData(f => ({ ...f, description: e.target.value }))}
              className="w-full rounded-xl border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-primary transition-all resize-none"
              placeholder="Internal notes about this expense..."
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
            {submitting ? 'Saving...' : 'Log Expense'}
          </button>
        </div>
      </div>
    </>
  );
}
