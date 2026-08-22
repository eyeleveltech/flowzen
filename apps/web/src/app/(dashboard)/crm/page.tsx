'use client';

import { useEffect, useState, useCallback } from 'react';
import { Building2, CheckCircle, TrendingUp, FolderOpen, Target } from 'lucide-react';
import { api, formatMoney, type OrgConfig } from '@/lib/api-v2';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';

function WidgetCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-secondary">{label}</h2>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-primary">{value}</p>
    </Card>
  );
}

export default function CRMDashboardPage() {
  const [config, setConfig] = useState<OrgConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState({
    activeDeals: 0,
    pipelineValue: 0,
    dealsWonThisMonth: 0,
    totalClients: 0,
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [cfg, deals, companies] = await Promise.all([
        api.config.get(),
        api.deals.board(),
        api.companies.list(),
      ]);

      setConfig(cfg);

      let active = 0;
      let val = 0;
      let won = 0;

      deals.columns.forEach(col => {
        if (col.kind === 'OPEN') {
          active += col.deals.length;
          col.deals.forEach(d => {
            if (d.value) val += parseFloat(d.value);
          });
        } else if (col.kind === 'WON') {
          won += col.deals.length; // Approximate, could filter by date if date was in payload
        }
      });

      setMetrics({
        activeDeals: active,
        pipelineValue: val,
        dealsWonThisMonth: won,
        totalClients: companies.length,
      });

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load CRM dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <PageSkeleton />;

  const currency = config?.organization.currency ?? 'INR';
  const locale = config?.organization.locale ?? 'en-IN';

  return (
    <div className="space-y-6">
      <PageHeader title="CRM Dashboard" subtitle="Overview of your sales pipeline and clients" />

      {error && <div className="text-red-500">{error}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <WidgetCard
          label="PIPELINE VALUE"
          value={formatMoney(metrics.pipelineValue, currency, locale)}
          icon={<TrendingUp className="h-4 w-4 text-secondary" />}
        />
        <WidgetCard
          label="ACTIVE DEALS"
          value={metrics.activeDeals}
          icon={<Target className="h-4 w-4 text-secondary" />}
        />
        <WidgetCard
          label="DEALS WON"
          value={metrics.dealsWonThisMonth}
          icon={<CheckCircle className="h-4 w-4 text-secondary" />}
        />
        <WidgetCard
          label="TOTAL CLIENTS"
          value={metrics.totalClients}
          icon={<Building2 className="h-4 w-4 text-secondary" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 flex flex-col items-center justify-center min-h-64">
          <FolderOpen className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-primary mb-1">Pipeline Health</h3>
          <p className="text-sm text-secondary text-center">Charts and extended reporting can be placed here to show deal velocity and conversion rates.</p>
        </Card>
        
        <Card className="p-6 flex flex-col items-center justify-center min-h-64">
          <Target className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium text-primary mb-1">Recent Activity</h3>
          <p className="text-sm text-secondary text-center">A timeline of recent calls, emails, and meetings with prospects.</p>
        </Card>
      </div>
    </div>
  );
}
