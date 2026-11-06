'use client';

import { Suspense } from 'react';
import { SubscriptionsTab } from '@/components/money/SubscriptionsTab';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';
import { usePageHeader } from '@/hooks/usePageHeader';

/**
 * Subscriptions — its own screen, Management only (the layout refuses
 * everybody else before this mounts, as it does for Logins).
 *
 * It began as a tab on Money, which put the platform spend behind the invoice
 * list and the tab strip. What the studio pays Adobe, Canva and the rest is a
 * question Management asks on its own, so it gets its own address: the four
 * figures on top, the platforms underneath.
 */
function SubscriptionsPage() {
  usePageHeader('Subscriptions', 'What the studio spends on which platform, from the platforms’ own invoices. Management only.');
  return (
    <div className="page-shell">
      <SubscriptionsTab />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SubscriptionsPage />
    </Suspense>
  );
}
