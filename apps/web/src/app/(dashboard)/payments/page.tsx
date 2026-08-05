'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/status-badge';
import { DollarSign, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { ErrorPanel } from '@/components/ui/error-panel';
import { Icon } from '@/components/ui/icon';

export default function PaymentsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const fetchPayments = () => {
    setLoading(true);
    api.get('/revenue/payments')
      .then((data: any) => {
        setData(data);
        setError(null);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load payments'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPayments();
  }, []);

  // Auto-billed retainer instalments arrive as PENDING; confirming receipt makes them
  // real collected revenue (they only then count toward Paid This Month).
  const markPaid = async (id: string) => {
    setConfirming(id);
    try {
      await api.put(`/revenue/payments/${id}/status`, { status: 'PAID' });
      toast.success('Payment confirmed as received');
      await fetchPayments();
    } catch (err: any) {
      toast.error(err.message || 'Failed to confirm payment');
    } finally {
      setConfirming(null);
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
    return <ErrorPanel message={error} onRetry={fetchPayments} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Payments Log</h1>
          <p className="mt-1 text-sm text-secondary">All incoming payments logged against contracts, retainers and invoices.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Payment ID</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Against</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Method</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Amount</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-secondary">No payments logged yet.</td>
                </tr>
              ) : (
                data.map((p: any) => (
                  <tr key={p.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-6 py-4 font-medium text-primary flex items-center gap-2">
                      <Icon as={DollarSign} size="md" className="text-emerald-500" />
                      {p.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="px-6 py-4 text-secondary">{p.client?.company || p.client?.name}</td>
                    <td className="px-6 py-4 text-secondary">
                      {p.contract?.title
                        || (p.subscription ? <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-200">Retainer</span>
                        : '-')}
                    </td>
                    <td className="px-6 py-4 text-secondary">{formatDate(p.paidOn)}</td>
                    <td className="px-6 py-4 text-secondary">{p.method}</td>
                    <td className="px-6 py-4 text-right font-medium text-primary">{formatCurrency(p.amount, p.currency)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        {p.status === 'PENDING' && (
                          <button
                            type="button"
                            onClick={() => markPaid(p.id)}
                            disabled={confirming === p.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                            title="Confirm this payment was received"
                          >
                            <Check className="h-3 w-3" /> Mark Paid
                          </button>
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
    </div>
  );
}
