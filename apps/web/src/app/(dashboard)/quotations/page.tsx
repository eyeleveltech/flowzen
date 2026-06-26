'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, Download, Copy, Ban, Search, Eye, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import toast from 'react-hot-toast';
import { useConfirmStore } from '@/stores';
import { QuoteFormModal } from './components/QuoteFormModal';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  EXPIRED: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api').replace(/\/api$/, '');

export default function QuotationsPage() {
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', search, typeFilter, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (search) p.set('search', search);
      if (typeFilter) p.set('type', typeFilter);
      if (statusFilter) p.set('status', statusFilter);
      return api.get<{ quotes: any[] }>(`/crm/quotes?${p}`);
    },
  });
  const quotes = data?.quotes || [];

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/crm/quotes/${id}/status`, { status }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['quotes'] }); toast.success('Status updated'); },
    onError: (e: any) => toast.error(e.message || 'Failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/crm/quotes/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['quotes'] }); toast.success('Deleted successfully'); },
    onError: (e: any) => toast.error(e.message || 'Failed to delete'),
  });

  async function generatePdf(id: string) {
    const t = toast.loading('Generating PDF…');
    try {
      const res = await api.post<{ pdfUrl: string }>(`/crm/quotes/${id}/generate-pdf`, {});
      toast.dismiss(t);
      toast.success('PDF ready');
      window.open(`${API_BASE}${res.pdfUrl}`, '_blank');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e.message || 'PDF failed');
    }
  }

  function openNew() { setEditId(null); setDuplicateOf(null); setShowForm(true); }
  function openEdit(id: string) { setEditId(id); setDuplicateOf(null); setShowForm(true); }
  async function duplicate(id: string) {
    const q = await api.get<any>(`/crm/quotes/${id}`);
    setDuplicateOf(q); setEditId(null); setShowForm(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Quotations</h1>
          <p className="text-sm text-secondary mt-1">{quotes.length} document{quotes.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={openNew} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-all">
          <Plus className="h-4 w-4" /> New Quotation
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client..." className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-all" />
        </div>
        <div className="w-full sm:w-48">
          <Select value={typeFilter} onChange={setTypeFilter} options={[{ label: 'All Types', value: '' }, { label: 'Quotation', value: 'QUOTATION' }, { label: 'Proforma Invoice', value: 'PROFORMA_INVOICE' }]} />
        </div>
        <div className="w-full sm:w-44">
          <Select value={statusFilter} onChange={setStatusFilter} options={[{ label: 'All Status', value: '' }, ...['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map(s => ({ label: s[0] + s.slice(1).toLowerCase(), value: s }))]} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                <th className="px-6 py-3">Document</th>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-secondary">Loading…</td></tr>
              ) : quotes.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-secondary">No documents yet. Create your first quotation.</td></tr>
              ) : quotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#9CA3AF] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-primary font-mono">{q.documentNumber}</p>
                        <p className="text-[11px] text-secondary">{q.documentType === 'QUOTATION' ? 'Quotation' : 'Proforma Invoice'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-primary">{q.clientName}</td>
                  <td className="px-6 py-4 text-sm text-secondary">{formatDate(q.documentDate)}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary text-right">{formatCurrency(Number(q.grandTotal))}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${STATUS_STYLES[q.status]}`}>{q.status[0] + q.status.slice(1).toLowerCase()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1.5 text-secondary">
                      <button title="View / Edit" onClick={() => openEdit(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Eye className="h-4 w-4" /></button>
                      <button title="Generate / Download PDF" onClick={() => q.pdfUrl ? window.open(`${API_BASE}${q.pdfUrl}`, '_blank') : generatePdf(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Download className="h-4 w-4" /></button>
                      <button title="Duplicate" onClick={() => duplicate(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Copy className="h-4 w-4" /></button>
                      {q.status !== 'CANCELLED' && (
                        <button title="Cancel" onClick={async () => { if (await confirm({ title: 'Cancel Document', message: 'Are you sure you want to cancel this document?', confirmText: 'Cancel Document', cancelText: 'Keep', variant: 'warning' })) statusMutation.mutate({ id: q.id, status: 'CANCELLED' }); }} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"><Ban className="h-4 w-4" /></button>
                      )}
                      <button title="Delete" onClick={async () => { if (await confirm({ title: 'Delete Document', message: 'Are you sure you want to delete this document? This cannot be undone.', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' })) deleteMutation.mutate(q.id); }} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <QuoteFormModal
          editId={editId}
          duplicateOf={duplicateOf}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); queryClient.invalidateQueries({ queryKey: ['quotes'] }); }}
        />
      )}
    </div>
  );
}
