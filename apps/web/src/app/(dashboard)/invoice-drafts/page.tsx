'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FileText, Download, Loader2, Edit2, Send } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import toast from 'react-hot-toast';
import { fileUrl } from '@/lib/files';
import { EditInvoiceDraftModal } from './components/EditInvoiceDraftModal';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Icon } from '@/components/ui/icon';

export default function InvoiceDraftsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useEffect(() => {
    fetchDrafts();
  }, []);

  const fetchDrafts = () => {
    setLoading(true);
    api.get('/revenue/invoice-drafts')
      .then((data: any) => {
        setData(data);
        setError(null);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load invoice drafts'))
      .finally(() => setLoading(false));
  };

  const generatePDF = async (id: string) => {
    setGenerating(id);
    try {
      const res = await api.post<any>(`/revenue/invoice-drafts/${id}/generate-pdf`, {});
      if (res.pdfUrl) {
        toast.success('PDF generated');
        window.open(fileUrl(res.pdfUrl), '_blank');
        fetchDrafts(); // stays DRAFT — still editable/regenerable until explicitly marked Sent
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate PDF');
    } finally {
      setGenerating(null);
    }
  };

  // Explicit send action: once SENT the draft locks (FZ-037 — never back to DRAFT).
  const markSent = async (id: string) => {
    try {
      await api.put(`/revenue/invoice-drafts/${id}/status`, { status: 'SENT' });
      toast.success('Marked as sent — the draft is now locked');
      fetchDrafts();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={fetchDrafts} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Invoice Drafts</h1>
          <p className="mt-1 text-sm text-secondary">Drafts generated from accepted CRM Quotations.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Draft #</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Company</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Quote Ref</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Grand Total</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-secondary">No invoice drafts found.</td>
                </tr>
              ) : (
                data.map((draft: any) => (
                  <tr key={draft.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-6 py-4 font-medium text-primary flex items-center gap-2">
                      <Icon as={FileText} size="md" className="text-blue-500" />
                      {draft.draftNumber}
                    </td>
                    <td className="px-6 py-4 text-secondary">{draft.clientName}</td>
                    <td className="px-6 py-4 text-secondary">{draft.quote?.documentNumber}</td>
                    <td className="px-6 py-4 text-right font-medium text-primary">{formatCurrency(draft.grandTotal)}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={draft.status} size="sm" />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {draft.pdfUrl && (
                          <a href={fileUrl(draft.pdfUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                            <Icon as={Download} size="md" /> Download
                          </a>
                        )}
                        {/* While DRAFT the invoice stays workable — generating a PDF doesn't lock it.
                            A typo caught after generating is fixed with Edit + Regenerate; the PDF
                            file is overwritten so Download always serves the latest version. */}
                        {draft.status === 'DRAFT' && (
                          <>
                            <button
                              onClick={() => setEditingDraftId(draft.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-secondary hover:bg-gray-50 hover:text-primary transition-colors"
                            >
                              <Icon as={Edit2} size="md" /> Edit
                            </button>
                            <button
                              onClick={() => generatePDF(draft.id)}
                              disabled={generating === draft.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                            >
                              {generating === draft.id ? <Icon as={Loader2} size="md" className="animate-spin" /> : <Icon as={FileText} size="md" />}
                              {draft.pdfUrl ? 'Regenerate' : 'Generate PDF'}
                            </button>
                            {draft.pdfUrl && (
                              <button
                                onClick={() => markSent(draft.id)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                                title="Locks the draft — it can no longer be edited"
                              >
                                <Icon as={Send} size="md" /> Mark Sent
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingDraftId && (
        <EditInvoiceDraftModal
          draftId={editingDraftId}
          onClose={() => setEditingDraftId(null)}
          onSaved={() => {
            setEditingDraftId(null);
            fetchDrafts();
          }}
        />
      )}
    </div>
  );
}
