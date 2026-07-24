'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  PAUSED: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function SubscriptionsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.get<any[]>('/revenue/subscriptions'),
  });
  const subscriptions = data || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Subscriptions</h1>
          <p className="text-sm text-secondary mt-1">Manage recurring billing and subscriptions</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-secondary uppercase tracking-wider">
                <th className="px-6 py-3">Company</th>
                <th className="px-6 py-3">Contract</th>
                <th className="px-6 py-3 text-right">Amount</th>
                <th className="px-6 py-3">Frequency</th>
                <th className="px-6 py-3">Next Billing</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-10 text-center text-sm text-secondary">Loading…</td></tr>
              ) : subscriptions.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-secondary">No subscriptions found.</td></tr>
              ) : subscriptions.map((s) => (
                <tr key={s.id} className="hover:bg-surface transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 text-muted shrink-0" />
                      <div>
                        <span className="text-sm font-medium text-primary block">{s.client?.company || s.client?.name || '-'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-secondary">{s.contract?.title || '-'}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary text-right">{formatCurrency(Number(s.amount))}</td>
                  <td className="px-6 py-4 text-sm text-secondary capitalize">{s.billingFrequency?.toLowerCase() || '-'}</td>
                  <td className="px-6 py-4 text-sm text-secondary">{s.nextBillingDate ? formatDate(s.nextBillingDate) : '-'}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-md border ${STATUS_STYLES[s.status] || STATUS_STYLES.ACTIVE}`}>
                      {s.status[0] + s.status.slice(1).toLowerCase()}
                    </span>
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
