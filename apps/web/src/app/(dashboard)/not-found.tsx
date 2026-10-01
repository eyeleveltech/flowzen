'use client';

/**
 * A wrong or old link, inside the app: the sidebar, the top bar and Zen stay
 * where they are, so the way on is one click away. See [...missing]/page.tsx
 * for how an unmatched address gets here.
 */

import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import { ScreenMessage } from '@/components/ui/screen-message';
import { usePageHeader } from '@/hooks/usePageHeader';

export default function DashboardNotFound() {
  const router = useRouter();
  usePageHeader('Page not found');
  return (
    <ScreenMessage
      icon={Compass}
      title="This page doesn't exist"
      message="The link may be old or mistyped."
      actions={[
        { label: 'Go back', onClick: () => router.back() },
        { label: 'Go to My Work', href: '/my-work', primary: true },
      ]}
    />
  );
}
