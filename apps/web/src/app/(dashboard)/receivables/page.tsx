'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Wallet } from 'lucide-react';

export default function ReceivablesPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Re-use contracts API for receivables, or create a specific endpoint
    api.get<any[]>('/revenue/contracts')
      .then((contracts: any[]) => {
        // Filter contracts with remaining receivables
        const filtered = contracts.filter((c: any) => {
          const paid = (c.payments || []).reduce((acc: number, p: any) => acc + (p.status === 'PAID' ? Number(p.amount) : 0), 0);
          return Number(c.value) > paid;
        });
        setData(filtered);
      })
      .finally(() => setLoading(false));
  }, []);

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
          <h1 className="text-2xl font-bold text-primary">Receivables</h1>
          <p className="mt-1 text-sm text-secondary">Track outstanding payments from active contracts.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-4 font-medium">Contract Title</th>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium text-right">Total Value</th>
                <th className="px-6 py-4 font-medium text-right">Paid</th>
                <th className="px-6 py-4 font-medium text-right">Remaining</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-secondary">No outstanding receivables found.</td>
                </tr>
              ) : (
                data.map((c: any) => {
                  const paid = (c.payments || []).reduce((acc: number, p: any) => acc + (p.status === 'PAID' ? Number(p.amount) : 0), 0);
                  const remaining = Math.max(0, Number(c.value) - paid);
                  return (
                    <tr key={c.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="px-6 py-4 font-medium text-primary">{c.title}</td>
                      <td className="px-6 py-4 text-secondary">{c.client?.company || c.client?.name}</td>
                      <td className="px-6 py-4 text-right text-secondary">{formatCurrency(c.value)}</td>
                      <td className="px-6 py-4 text-right text-emerald-600">{formatCurrency(paid)}</td>
                      <td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(remaining)}</td>
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
