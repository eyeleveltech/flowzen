'use client';

/**
 * What a screen this person cannot open shows instead of itself.
 *
 * The layout used to bounce them to My Work without a word, so a link somebody
 * had been sent looked broken rather than locked. The address stays as it is,
 * and they are told why — and the screen itself still never mounts, so it fires
 * none of its own requests (see the decision in the dashboard layout).
 */

import { Lock } from 'lucide-react';
import { ScreenMessage } from '@/components/ui/screen-message';
import { usePageHeader } from '@/hooks/usePageHeader';
import { screenNameForPath } from '@/config/navigation';

export function NoAccess({ pathname }: { pathname: string }) {
  const name = screenNameForPath(pathname);
  usePageHeader(name ?? 'No access');
  return (
    <ScreenMessage
      icon={Lock}
      title={`You don't have access to ${name ?? 'this screen'}`}
      message="Ask management if you need it."
      actions={[{ label: 'Go to My Work', href: '/my-work', primary: true }]}
    />
  );
}
