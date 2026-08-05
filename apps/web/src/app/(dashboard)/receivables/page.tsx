'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ErrorPanel } from '@/components/ui/error-panel';

export default function ReceivablesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReceivables = () => {
    setLoading(true);
    api.get<{ items: any[]; total: number }>('/revenue/receivables')
      .then((res) => {
        setData(res.items || []);
        setError(null);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load receivables'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReceivables();
  }, []);

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <ErrorPanel message={error} onRetry={fetchReceivables} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Receivables</h1>
          <p className="mt-1 text-sm text-secondary">Track outstanding payments from active contracts.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Contract Title</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider">Client</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Total Value</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Paid</th>
                <th className="px-6 py-3 text-xs font-semibold text-secondary uppercase tracking-wider text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-secondary">No outstanding receivables found.</td>
                </tr>
              ) : (
                data.map((c: any) => {
                  const paid = Number(c.paid || 0);
                  const remaining = Number(c.remaining ?? Math.max(0, Number(c.value) - paid));
                  return (
                    <tr key={c.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4 font-medium text-primary">{c.title}</td>
                      <td className="px-6 py-4 text-secondary">{c.client?.company || c.client?.name}</td>
                      <td className="px-6 py-4 text-right text-secondary">{formatCurrency(c.value, c.currency)}</td>
                      <td className="px-6 py-4 text-right text-emerald-600">{formatCurrency(paid, c.currency)}</td>
                      <td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(remaining, c.currency)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
