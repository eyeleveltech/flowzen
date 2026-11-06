'use client';

import { Suspense } from 'react';
import { LoginsPage } from '@/components/logins/LoginsPage';
import { PageSkeleton } from '@/components/ui/skeleton-loaders';

/** Logins — Management only (Credentials plan). The layout refuses everybody else before this mounts. */
export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LoginsPage />
    </Suspense>
  );
}
