import type { Metadata, Viewport } from 'next';
import { Suspense } from 'react';
import './globals.css';
import { Providers } from '@/components/providers';

/*
 * No `dynamic = 'force-dynamic'` here any more (Perf Plan 1, decision 2).
 *
 * It made every screen render on the server on every request and switched
 * off the prefetch the sidebar's links would otherwise do — for an app whose
 * screens are all client components that get their session from localStorage
 * and their data from the API. Nothing here reads a cookie or a header on the
 * server, so every route can be built once and served as a static shell, and
 * a sidebar link prefetches the next screen while the mouse is still on its
 * way.
 *
 * The one thing a static build insists on: `useSearchParams` under a Suspense
 * boundary, which the one below gives every screen at once.
 */

export const metadata: Metadata = {
  title: { default: 'Flowzen', template: '%s — Flowzen' },
  description: 'Premium agency project management platform for digital teams',
  icons: { icon: '/icon.png', apple: '/icons/apple-touch-icon.png' },
  manifest: '/manifest.json',
  // An iPhone only shows phone notifications for a site added to the Home
  // Screen and opened from there, so it has to install as a proper app: its
  // own icon and name, full screen rather than a Safari tab.
  appleWebApp: { capable: true, title: 'Flowzen', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  // The browser chrome colour, which is an HTML meta value and cannot read a CSS
  // custom property. It is --color-primary; the two have to be changed together.
  themeColor: '#163027',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
          <Suspense fallback={null}>{children}</Suspense>
        </Providers>
      </body>
    </html>
  );
}
