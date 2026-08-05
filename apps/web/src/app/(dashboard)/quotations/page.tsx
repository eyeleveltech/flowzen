'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, Download, Copy, Ban, Search, Eye, Trash2, MoreHorizontal, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/select';
import toast from 'react-hot-toast';
import { useConfirmStore } from '@/stores';
import { fileUrl } from '@/lib/files';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { QuoteFormModal } from './components/QuoteFormModal';
import { StatusBadge } from '@/components/ui/status-badge';
import { Icon } from '@/components/ui/icon';

function QuotationsContent() {
  usePageTitle('Quotations');
  const queryClient = useQueryClient();
  const confirm = useConfirmStore((s) => s.confirm);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<any>(null);
  const [prefillLeadId, setPrefillLeadId] = useState<string | null>(null);
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Deep link from a lead's "Raise Quotation" button: /quotations?create=true&leadId=…
  useEffect(() => {
    if (searchParams.get('create') !== 'true') return;
    setEditId(null);
    setDuplicateOf(null);
    setPrefillLeadId(searchParams.get('leadId'));
    setShowForm(true);
  }, [searchParams]);

  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['quotes', debouncedSearch, typeFilter, statusFilter],
    queryFn: () => {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set('search', debouncedSearch);
      if (typeFilter) p.set('type', typeFilter);
      if (statusFilter) p.set('status', statusFilter);
      return api.get<{ quotes: any[] }>(`/crm/quotes?${p}`);
    },
    placeholderData: (previousData) => previousData,
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
      window.open(fileUrl(res.pdfUrl), '_blank');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e.message || 'PDF failed');
    }
  }

  /**
   * Email the document to the client. The server generates the PDF if one is missing, attaches
   * it, and only flips the status to SENT once the mail actually went — so a failure leaves the
   * quote honestly marked DRAFT rather than claiming it was sent.
   */
  async function sendToClient(q: any) {
    const to = window.prompt(
      `Send ${q.documentNumber} to which email address?`,
      q.clientEmail || ''
    );
    if (to === null) return;                 // cancelled
    if (!to.trim()) { toast.error('Enter an email address'); return; }

    const t = toast.loading('Sending…');
    try {
      const res = await api.post<{ to: string }>(`/crm/quotes/${q.id}/send`, { to: to.trim() });
      toast.dismiss(t);
      toast.success(`Sent to ${res.to}`);
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e.message || 'Could not send the email');
    }
  }

  function openNew() { setEditId(null); setDuplicateOf(null); setShowForm(true); }
  function openEdit(id: string) { setEditId(id); setDuplicateOf(null); setShowForm(true); }
  async function duplicate(id: string) {
    const q = await api.get<any>(`/crm/quotes/${id}`);
    setDuplicateOf(q); setEditId(null); setShowForm(true);
  }

  async function createInvoiceDraft(q: any) {
    const t = toast.loading('Creating invoice draft...');
    try {
      const payload = {
        quoteId: q.id,
        clientId: q.clientId,
        clientName: q.clientName,
        lineItems: q.lineItems,
        grandTotal: q.grandTotal,
        notes: 'Created from Quote ' + q.documentNumber,
      };
      await api.post('/revenue/invoice-drafts', payload);
      toast.dismiss(t);
      toast.success('Invoice draft created successfully');
      router.push('/invoice-drafts'); // the editable invoice screen (the /invoices twin now redirects here)
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(e.message || 'Failed to create invoice draft');
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Quotations</h1>
          <p className="text-sm text-secondary mt-1">{quotes.length} document{quotes.length === 1 ? '' : 's'}</p>
        </div>
        <button onClick={openNew} className="w-full sm:w-auto justify-center flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-[#1F2937] transition-colors duration-150 motion-reduce:transition-none">
          <Icon as={Plus} size="md" /> New Quotation
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:max-w-xs">
          <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or client..." className="w-full rounded-xl border border-border bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-1 transition-colors duration-150 motion-reduce:transition-none" />
        </div>
        <div className="w-full sm:w-48">
          <Select value={typeFilter} onChange={setTypeFilter} options={[{ label: 'Types', value: '' }, { label: 'Quotation', value: 'QUOTATION' }, { label: 'Proforma Invoice', value: 'PROFORMA_INVOICE' }]} />
        </div>
        <div className="w-full sm:w-44">
          <Select value={statusFilter} onChange={setStatusFilter} options={[{ label: 'Status', value: '' }, ...['DRAFT', 'SENT', 'ACCEPTED', 'EXPIRED', 'CANCELLED'].map(s => ({ label: s[0] + s.slice(1).toLowerCase(), value: s }))]} />
        </div>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-2xl border border-border overflow-hidden">
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
                <tr key={q.id} onClick={() => openEdit(q.id)} className="hover:bg-surface transition-colors cursor-pointer">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Icon as={FileText} size="md" className="text-secondary shrink-0" />
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
                    <StatusBadge status={q.status} />
                  </td>
                  <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                    {/* Desktop Viewport — icon row */}
                    <div className="hidden md:flex items-center justify-end gap-1.5 text-secondary">
                      <button title="View / Edit" onClick={() => openEdit(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Eye className="h-4 w-4" /></button>
                      <button title="Generate / Download PDF" onClick={() => q.pdfUrl ? window.open(fileUrl(q.pdfUrl), '_blank') : generatePdf(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Download className="h-4 w-4" /></button>
                      {q.status !== 'CANCELLED' && (
                        <button title="Email to client" onClick={() => sendToClient(q)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Send className="h-4 w-4" /></button>
                      )}
                      <button title="Duplicate" onClick={() => duplicate(q.id)} className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"><Copy className="h-4 w-4" /></button>
                      {q.status === 'ACCEPTED' && (
                        <button title="Move to Invoice Draft" onClick={async () => { if (await confirm({ title: 'Create Invoice', message: 'Move this quote to an Invoice Draft?', confirmText: 'Create Invoice', cancelText: 'Cancel' })) createInvoiceDraft(q); }} className="p-1.5 rounded-lg hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                          <Icon as={FileText} size="md" />
                        </button>
                      )}
                      {q.status !== 'CANCELLED' && (
                        <button title="Cancel" onClick={async () => { if (await confirm({ title: 'Cancel Document', message: 'Are you sure you want to cancel this document?', confirmText: 'Cancel Document', cancelText: 'Keep', variant: 'warning' })) statusMutation.mutate({ id: q.id, status: 'CANCELLED' }); }} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"><Icon as={Ban} size="md" /></button>
                      )}
                      <button title="Delete" onClick={async () => { if (await confirm({ title: 'Delete Document', message: 'Are you sure you want to delete this document? This cannot be undone.', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' })) deleteMutation.mutate(q.id); }} className="p-1.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors"><Icon as={Trash2} size="md" /></button>
                    </div>

                    {/* Mobile Viewport — ⋯ menu with text labels */}
                    <div className="relative md:hidden flex justify-end">
                      <button
                        className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-secondary hover:text-primary transition-colors"
                        onClick={() => setActiveDropdownId(activeDropdownId === q.id ? null : q.id)}
                      >
                        <Icon as={MoreHorizontal} size="md" />
                      </button>
                      {activeDropdownId === q.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setActiveDropdownId(null)} />
                          <div className="absolute right-0 top-8 z-50 w-52 rounded-xl bg-white shadow-modal border border-border py-1 flex flex-col text-left">
                            <button
                              onClick={() => { setActiveDropdownId(null); openEdit(q.id); }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                            >
                              <Icon as={Eye} size="md" /> View / Edit
                            </button>
                            <button
                              onClick={() => { setActiveDropdownId(null); q.pdfUrl ? window.open(fileUrl(q.pdfUrl), '_blank') : generatePdf(q.id); }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                            >
                              <Icon as={Download} size="md" /> Download PDF
                            </button>
                            <button
                              onClick={() => { setActiveDropdownId(null); duplicate(q.id); }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                            >
                              <Icon as={Copy} size="md" /> Duplicate
                            </button>
                            {q.status === 'ACCEPTED' && (
                              <button
                                onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Create Invoice', message: 'Move this quote to an Invoice Draft?', confirmText: 'Create Invoice', cancelText: 'Cancel' })) createInvoiceDraft(q); }}
                                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors text-left"
                              >
                                <Icon as={FileText} size="md" /> Move to Invoice Draft
                              </button>
                            )}
                            {q.status !== 'CANCELLED' && (
                              <button
                                onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Cancel Document', message: 'Are you sure you want to cancel this document?', confirmText: 'Cancel Document', cancelText: 'Keep', variant: 'warning' })) statusMutation.mutate({ id: q.id, status: 'CANCELLED' }); }}
                                className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-amber-600 hover:bg-amber-50 transition-colors text-left"
                              >
                                <Icon as={Ban} size="md" /> Cancel
                              </button>
                            )}
                            <button
                              onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Delete Document', message: 'Are you sure you want to delete this document? This cannot be undone.', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' })) deleteMutation.mutate(q.id); }}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                            >
                              <Icon as={Trash2} size="md" /> Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card View */}
      <div className="md:hidden flex flex-col gap-3 pb-4">
        {isLoading ? (
          <div className="p-6 text-center text-sm text-secondary bg-white rounded-xl border border-border">Loading…</div>
        ) : quotes.length === 0 ? (
          <div className="p-8 text-center text-sm text-secondary bg-white rounded-xl border border-border">No documents yet.</div>
        ) : quotes.map((q) => (
          <div key={q.id} className="p-4 rounded-xl border border-border bg-white hover:shadow-sm cursor-pointer transition-colors duration-150 motion-reduce:transition-none" onClick={() => openEdit(q.id)}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                  <Icon as={FileText} size="lg" />
                </div>
                <div>
                  <p className="text-sm font-medium text-primary leading-tight font-mono">{q.documentNumber}</p>
                  <p className="text-[11px] text-secondary mt-0.5">{q.documentType === 'QUOTATION' ? 'Quotation' : 'Proforma Invoice'}</p>
                </div>
              </div>
              <StatusBadge status={q.status} size="xs" />
            </div>

            <div className="mb-3">
              <p className="text-sm font-medium text-primary">{q.clientName}</p>
              <p className="text-xs text-secondary mt-0.5">Date: {formatDate(q.documentDate)}</p>
            </div>

            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-50">
              <p className="text-sm font-bold text-primary">{formatCurrency(Number(q.grandTotal))}</p>

              <div className="relative" onClick={e => e.stopPropagation()}>
                <button
                  className="p-1.5 rounded-lg hover:bg-[#F3F4F6] text-secondary hover:text-primary transition-colors"
                  onClick={() => setActiveDropdownId(activeDropdownId === q.id ? null : q.id)}
                >
                  <Icon as={MoreHorizontal} size="md" />
                </button>
                {activeDropdownId === q.id && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setActiveDropdownId(null)} />
                    <div className="absolute right-0 bottom-8 z-50 w-52 rounded-xl bg-white shadow-modal border border-border py-1 flex flex-col text-left">
                      <button
                        onClick={() => { setActiveDropdownId(null); openEdit(q.id); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                      >
                        <Icon as={Eye} size="md" /> View / Edit
                      </button>
                      <button
                        onClick={() => { setActiveDropdownId(null); q.pdfUrl ? window.open(fileUrl(q.pdfUrl), '_blank') : generatePdf(q.id); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                      >
                        <Icon as={Download} size="md" /> Download PDF
                      </button>
                      <button
                        onClick={() => { setActiveDropdownId(null); duplicate(q.id); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-secondary hover:bg-gray-50 hover:text-primary transition-colors text-left"
                      >
                        <Icon as={Copy} size="md" /> Duplicate
                      </button>
                      {q.status === 'ACCEPTED' && (
                        <button
                          onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Create Invoice', message: 'Move this quote to an Invoice Draft?', confirmText: 'Create Invoice', cancelText: 'Cancel' })) createInvoiceDraft(q); }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-emerald-600 hover:bg-emerald-50 transition-colors text-left"
                        >
                          <Icon as={FileText} size="md" /> Move to Invoice Draft
                        </button>
                      )}
                      {q.status !== 'CANCELLED' && (
                        <button
                          onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Cancel Document', message: 'Are you sure you want to cancel this document?', confirmText: 'Cancel Document', cancelText: 'Keep', variant: 'warning' })) statusMutation.mutate({ id: q.id, status: 'CANCELLED' }); }}
                          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-amber-600 hover:bg-amber-50 transition-colors text-left"
                        >
                          <Icon as={Ban} size="md" /> Cancel
                        </button>
                      )}
                      <button
                        onClick={async () => { setActiveDropdownId(null); if (await confirm({ title: 'Delete Document', message: 'Are you sure you want to delete this document? This cannot be undone.', confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger' })) deleteMutation.mutate(q.id); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                      >
                        <Icon as={Trash2} size="md" /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <QuoteFormModal
          editId={editId}
          duplicateOf={duplicateOf}
          prefillLeadId={prefillLeadId}
          onClose={() => { setShowForm(false); setPrefillLeadId(null); }}
          onSaved={() => { setShowForm(false); setPrefillLeadId(null); queryClient.invalidateQueries({ queryKey: ['quotes'] }); }}
        />
      )}
    </div>
  );
}

// useSearchParams needs a Suspense boundary or the production build fails
// (missing-suspense-with-csr-bailout). Dev renders on demand and won't warn.
export default function QuotationsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-100">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <QuotationsContent />
    </Suspense>
  );
}
