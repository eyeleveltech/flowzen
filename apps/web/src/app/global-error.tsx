'use client';

/**
 * The last line: a crash in the root layout itself, where there is no app
 * shell left to draw inside. It replaces the whole document, so it brings its
 * own <html> and the styles. Screen crashes are caught well before this, by
 * app/(dashboard)/error.tsx.
 */

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ScreenMessage } from '@/components/ui/screen-message';
import './globals.css';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(`Flowzen crashed at ${typeof window !== 'undefined' ? window.location.pathname : ''}:`, error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <main className="min-h-screen bg-surface px-4">
          <ScreenMessage
            icon={TriangleAlert}
            title="Something went wrong"
            message="Try again, or reload the page."
            actions={[
              { label: 'Try again', onClick: () => reset(), primary: true },
              { label: 'Go to My Work', href: '/my-work' },
            ]}
          />
        </main>
      </body>
    </html>
  );
}
