'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FileText, Download, Loader2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fileUrl } from '@/lib/files';
import { EditInvoiceDraftModal } from './components/EditInvoiceDraftModal';

export default function InvoiceDraftsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);

  useEffect(() => {
    fetchDrafts();
  }, []);

  const fetchDrafts = () => {
    setLoading(true);
    api.get('/revenue/invoice-drafts')
      .then((data: any) => setData(data))
      .finally(() => setLoading(false));
  };

  const generatePDF = async (id: string) => {
    setGenerating(id);
    try {
      const res = await api.post<any>(`/revenue/invoice-drafts/${id}/generate-pdf`, {});
      if (res.pdfUrl) {
        toast.success('PDF Generated successfully!');
        window.open(fileUrl(res.pdfUrl), '_blank');
        fetchDrafts(); // Refresh to show SENT status
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to generate PDF');
    } finally {
      setGenerating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Invoice Drafts</h1>
          <p className="mt-1 text-sm text-secondary">Drafts generated from accepted CRM Quotations.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-4 font-medium">Draft #</th>
                <th className="px-6 py-4 font-medium">Client</th>
                <th className="px-6 py-4 font-medium">Quote Ref</th>
                <th className="px-6 py-4 font-medium text-right">Grand Total</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
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
                      <FileText className="h-4 w-4 text-blue-500" />
                      {draft.draftNumber}
                    </td>
                    <td className="px-6 py-4 text-secondary">{draft.clientName}</td>
                    <td className="px-6 py-4 text-secondary">{draft.quote?.documentNumber}</td>
                    <td className="px-6 py-4 text-right font-medium text-primary">{formatCurrency(draft.grandTotal)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${draft.status === 'SENT' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {draft.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {draft.pdfUrl ? (
                        <a href={fileUrl(draft.pdfUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50">
                          <Download className="h-4 w-4" /> Download
                        </a>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingDraftId(draft.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-secondary hover:bg-gray-50 hover:text-primary transition-colors"
                          >
                            <Edit2 className="h-4 w-4" /> Edit
                          </button>
                          <button
                            onClick={() => generatePDF(draft.id)}
                            disabled={generating === draft.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                          >
                            {generating === draft.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                            Generate PDF
                          </button>
                        </div>
                      )}
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
