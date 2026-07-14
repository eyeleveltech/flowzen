'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { FileText, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { fileUrl } from '@/lib/files';

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600 border-gray-200',
  SENT: 'bg-blue-50 text-blue-700 border-blue-200',
  PAID: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  OVERDUE: 'bg-amber-50 text-amber-700 border-amber-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
};

export default function InvoicesPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['invoice-drafts'],
    queryFn: () => api.get<any[]>('/revenue/invoice-drafts'),
  });
  const invoices = data || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Invoice Drafts</h1>
          <p className="text-sm text-secondary mt-1">Manage invoices generated from Quotations</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                <th className="px-6 py-3">Invoice Number</th>
                <th className="px-6 py-3">Client</th>
                <th className="px-6 py-3">Created</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-secondary">Loading…</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-secondary">No invoice drafts yet. Move an accepted quotation to an invoice draft to see it here.</td></tr>
              ) : invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-surface transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-[#9CA3AF] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-primary font-mono">{inv.draftNumber}</p>
                        <p className="text-[11px] text-secondary">Quote: {inv.quote.documentNumber}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-primary">{inv.clientName}</td>
                  <td className="px-6 py-4 text-sm text-secondary">{formatDate(inv.createdAt)}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary text-right">{formatCurrency(Number(inv.grandTotal))}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${STATUS_STYLES[inv.status] || STATUS_STYLES.DRAFT}`}>
                      {inv.status[0] + inv.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1.5 text-secondary">
                      {inv.pdfUrl ? (
                        <a href={fileUrl(inv.pdfUrl)} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors inline-block" title="Download PDF">
                          <Download className="h-4 w-4" />
                        </a>
                      ) : (
                        <button 
                          title="Generate PDF" 
                          onClick={async () => {
                            try {
                              toast.loading('Generating Invoice...', { id: 'pdf' });
                              const res = await api.post(`/revenue/invoice-drafts/${inv.id}/generate-pdf`);
                              toast.success('Invoice generated!', { id: 'pdf' });
                              queryClient.invalidateQueries({ queryKey: ['invoice-drafts'] });
                            } catch (e: any) {
                              toast.error(e.message || 'Failed to generate PDF', { id: 'pdf' });
                            }
                          }}
                          className="p-1.5 rounded-lg hover:bg-[#F3F4F6] hover:text-primary transition-colors"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
