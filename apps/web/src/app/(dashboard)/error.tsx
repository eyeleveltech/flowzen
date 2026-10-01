'use client';

/**
 * A screen that crashed while drawing, caught inside the app.
 *
 * Without this, one exception anywhere replaced everything with Next.js's white
 * "Application error" until a reload. Here only the screen is replaced: the
 * sidebar, the top bar and Zen keep working, and Try again draws it afresh.
 *
 * The error goes to the console, with where it happened, for whoever is
 * debugging. Never to the screen — a stack trace means nothing to the person
 * looking at it, and can say more than it should.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { ScreenMessage } from '@/components/ui/screen-message';
import { usePageHeader } from '@/hooks/usePageHeader';
import { screenNameForPath } from '@/config/navigation';

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  // The crashed screen never got to name itself, so the top bar would still
  // show the one before it.
  usePageHeader(screenNameForPath(pathname) ?? 'Something went wrong');

  useEffect(() => {
    console.error(`Screen crashed at ${pathname}:`, error);
  }, [error, pathname]);

  return (
    <ScreenMessage
      icon={TriangleAlert}
      title="Something went wrong on this screen"
      message="Try again, or carry on from My Work."
      actions={[
        { label: 'Try again', onClick: () => reset(), primary: true },
        { label: 'Go to My Work', href: '/my-work' },
      ]}
    />
  );
}
