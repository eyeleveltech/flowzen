'use client';

/**
 * The same message for anything outside the dashboard — a print page, the
 * sign-in screens. Unknown addresses normally land on the in-app version
 * (app/(dashboard)/not-found.tsx); this is the floor beneath it.
 */

import { useRouter } from 'next/navigation';
import { Compass } from 'lucide-react';
import { ScreenMessage } from '@/components/ui/screen-message';

export default function NotFound() {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-surface px-4">
      <ScreenMessage
        icon={Compass}
        title="This page doesn't exist"
        message="The link may be old or mistyped."
        actions={[
          { label: 'Go back', onClick: () => router.back() },
          { label: 'Go to My Work', href: '/my-work', primary: true },
        ]}
      />
    </main>
  );
}
