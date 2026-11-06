'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api-v2';
import { Card } from '@/components/ui/card';
import { plural } from '@/lib/utils';

/**
 * "Logins (5)" on a client's page — for Management only (Credentials plan,
 * decision 7). The caller decides whether to render it; the count route
 * refuses anybody else, so nothing is sent to them either way.
 */
export function LoginsCard({ companyId }: { companyId: string }) {
  const { data } = useQuery({ queryKey: ['credentials', 'count', companyId], queryFn: () => api.credentials.countFor(companyId), staleTime: 60_000 });
  const count = data?.count ?? 0;
  return (
    <Card className="p-4">
      <Link href={`/logins?client=${companyId}`} className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-subtle text-secondary">
          <KeyRound className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-primary">Logins ({count})</span>
          <span className="block text-xs text-secondary">{count ? `${plural(count, 'saved login')} for this client` : 'No logins saved for this client'} · Management only</span>
        </span>
        <ChevronRight className="h-4 w-4 text-secondary" />
      </Link>
    </Card>
  );
}
