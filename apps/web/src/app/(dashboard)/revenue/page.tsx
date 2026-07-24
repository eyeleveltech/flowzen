'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { DollarSign, TrendingUp, Wallet, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';

import { NoAccess } from '@/components/ui/no-access';

export default function RevenueOverviewPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    api.get('/revenue/overview')
      .then((res) => { setData(res); setErrorStatus(null); })
      .catch((err: any) => {
        if (err?.status === 403) setErrorStatus(403);
        else setErrorStatus(404);
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

  if (errorStatus === 403) {
    return <NoAccess title="Access Restricted" message="You do not have permission or CRM module access to view revenue overview." backHref="/dashboard" backLabel="Back to Dashboard" />;
  }

  const kpis = [
    { label: 'Paid This Month', value: data?.paidThisMonth || 0, icon: DollarSign, trend: data?.paidTrend || '0%' },
    { label: 'MRR', value: data?.mrr || 0, icon: TrendingUp, trend: data?.mrrTrend || '0%' },
    { label: 'Total Receivables', value: data?.receivables || 0, icon: Wallet, trend: data?.receivablesTrend || '0%' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Revenue Overview</h1>
          <p className="mt-1 text-sm text-secondary">Monitor your monthly payments, MRR, and receivables.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {kpis.map((kpi, i) => {
          const trendStr = kpi.trend || '0%';
          const trendNum = parseFloat(trendStr);
          const isNegative = trendNum < 0;
          const isZero = trendNum === 0;

          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="flex flex-col rounded-2xl border border-border bg-white p-6 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                  <kpi.icon className="h-6 w-6" />
                </div>
                <span className={`flex items-center text-sm font-medium px-2 py-1 rounded-md ${
                  isNegative ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'
                }`}>
                  {kpi.trend}
                  {!isZero && (isNegative ? <ArrowDownRight className="ml-1 h-3 w-3" /> : <ArrowUpRight className="ml-1 h-3 w-3" />)}
                </span>
              </div>
              <div className="mt-4">
                <p className="text-sm font-medium text-secondary">{kpi.label}</p>
                <h3 className="mt-1 text-3xl font-bold text-primary">{formatCurrency(kpi.value)}</h3>
              </div>
            </motion.div>
          );
        })}
      </div>

      {(!data?.paidThisMonth && !data?.mrr && !data?.receivables) && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-sm">
          <p className="text-secondary">
            Revenue metrics will populate here once you have active clients with payments or contracts.
          </p>
          <Link
            href="/clients"
            className="text-xs font-semibold text-primary hover:text-black shrink-0 underline decoration-gray-300 underline-offset-4"
          >
            Add your first client →
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="border-b border-border px-6 py-5">
          <h3 className="text-lg font-semibold text-primary">Recent Payments</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium">Amount</th>
                <th className="px-6 py-4 font-medium">Date</th>
                <th className="px-6 py-4 font-medium">Method</th>
                <th className="px-6 py-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data?.recentPayments?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-secondary">No payments found this month.</td>
                </tr>
              ) : (
                data?.recentPayments?.map((payment: any) => (
                  <tr key={payment.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-6 py-4 font-medium text-primary">
                      {payment.client?.company || payment.client?.name}
                    </td>
                    <td className="px-6 py-4 font-medium text-primary">{formatCurrency(payment.amount)}</td>
                    <td className="px-6 py-4 text-secondary">{formatDate(payment.paidOn)}</td>
                    <td className="px-6 py-4 text-secondary">{payment.method || 'Transfer'}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                        {payment.status}
                      </span>
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
