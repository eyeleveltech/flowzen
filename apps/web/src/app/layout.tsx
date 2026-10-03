import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
