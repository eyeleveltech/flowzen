'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PieChart, DollarSign, Receipt, ArrowRightLeft } from 'lucide-react';
import { NoAccess } from '@/components/ui/no-access';

export default function PnLPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    api.get('/revenue/pnl')
      .then((data: any) => { setData(data); setErrorStatus(null); })
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
    return <NoAccess title="Access Restricted" message="You do not have permission or CRM module access to view P&L reports." backHref="/dashboard" backLabel="Back to Dashboard" />;
  }

  const totalRev = data.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalExp = data.reduce((acc, curr) => acc + curr.expenses, 0);
  const totalNet = data.reduce((acc, curr) => acc + curr.net, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Per-Project P&L</h1>
          <p className="mt-1 text-sm text-secondary">Track revenue versus expenses across all projects and events.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <DollarSign className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-secondary">Total Project Revenue</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalRev)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Receipt className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-secondary">Total Project Expenses</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalExp)}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <PieChart className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-secondary">Total Net Profit</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalNet)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#F9FAFB] text-secondary">
              <tr>
                <th className="px-6 py-4 font-medium">Project</th>
                <th className="px-6 py-4 font-medium">Company</th>
                <th className="px-6 py-4 font-medium text-right">Revenue</th>
                <th className="px-6 py-4 font-medium text-right">Expenses</th>
                <th className="px-6 py-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-secondary">No projects found.</td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr key={row.projectId} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-6 py-4 font-medium text-primary">{row.projectName}</td>
                    <td className="px-6 py-4 text-secondary">{row.clientName}</td>
                    <td className="px-6 py-4 text-right font-medium text-primary">{formatCurrency(row.revenue)}</td>
                    <td className="px-6 py-4 text-right font-medium text-red-600">{formatCurrency(row.expenses)}</td>
                    <td className="px-6 py-4 text-right font-bold text-emerald-600">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${row.net >= 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {formatCurrency(row.net)}
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
