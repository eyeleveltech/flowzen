'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PieChart, DollarSign, Receipt, Clock } from 'lucide-react';
import { NoAccess } from '@/components/ui/no-access';
import { ErrorPanel } from '@/components/ui/error-panel';

export default function PnLPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const loadPnL = () => {
    setLoading(true);
    api.get('/revenue/pnl')
      .then((data: any) => { setData(data); setErrorStatus(null); })
      .catch((err: any) => {
        setErrorStatus(err?.status || 500);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPnL();
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

  if (errorStatus !== null) {
    return <ErrorPanel message="Failed to load P&L data" onRetry={loadPnL} />;
  }

  const totalRev = data.reduce((acc, curr) => acc + curr.revenue, 0);
  const totalExp = data.reduce((acc, curr) => acc + curr.expenses, 0);
  const totalLabour = data.reduce((acc, curr) => acc + (curr.labourCost || 0), 0);
  const totalHours = data.reduce((acc, curr) => acc + (curr.labourHours || 0), 0);
  const totalNet = data.reduce((acc, curr) => acc + curr.net, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-primary tracking-tight">Per-Project P&L</h1>
          <p className="mt-1 text-sm text-secondary">Revenue versus what delivery actually cost — vendor bills and the team&apos;s own hours.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-subtle text-body">
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
        {/* Labour is shown NEXT TO vendor expenses rather than folded into them: a project
            bleeding on its own team's hours needs a different conversation from one bleeding on
            subcontractors. Until time entries existed this cost was simply absent, and every
            project therefore looked profitable. */}
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Clock className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-secondary">Total Labour Cost</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totalLabour)}</p>
            {totalHours > 0 && <p className="text-xs text-secondary mt-0.5">{totalHours}h logged</p>}
          </div>
        </div>
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600">
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
            <thead className="bg-surface text-secondary">
              <tr>
                <th className="px-6 py-4 font-medium">Project</th>
                <th className="px-6 py-4 font-medium">Client</th>
                <th className="px-6 py-4 font-medium text-right">Revenue</th>
                <th className="px-6 py-4 font-medium text-right">Expenses</th>
                <th className="px-6 py-4 font-medium text-right">Labour</th>
                <th className="px-6 py-4 font-medium text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-secondary">No projects found.</td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr key={row.projectId} className="hover:bg-surface transition-colors">
                    <td className="px-6 py-4 font-medium text-primary">{row.projectName}</td>
                    <td className="px-6 py-4 text-secondary">{row.clientName}</td>
                    <td className="px-6 py-4 text-right font-medium text-primary">{formatCurrency(row.revenue)}</td>
                    <td className="px-6 py-4 text-right font-medium text-red-600">{formatCurrency(row.expenses)}</td>
                    <td className="px-6 py-4 text-right font-medium text-amber-700">
                      {formatCurrency(row.labourCost || 0)}
                      {(row.labourHours || 0) > 0 && <span className="block text-[11px] font-normal text-secondary">{row.labourHours}h</span>}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-green-600">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${row.net >= 0 ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
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
