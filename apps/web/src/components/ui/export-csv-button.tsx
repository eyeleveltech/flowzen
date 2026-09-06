'use client';

import { Download } from 'lucide-react';

/**
 * §16: "CSV export on every list, for management screens at minimum." The
 * backend has supported `?format=csv` on every real list endpoint for a
 * while — nothing in the frontend ever asked for it. A plain `<a>` to the
 * API works the same way `api.proformas.pdfUrl` already does for PDFs:
 * cross-origin, cookie-authenticated, browser handles the download natively.
 */
export function ExportCsvButton({ href, label = 'Export CSV' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="flex items-center gap-1.5 border border-border text-secondary text-sm font-medium px-3.5 h-8 rounded-lg hover:bg-subtle hover:text-primary transition-colors whitespace-nowrap"
      title="Download this list as a CSV file"
    >
      <Download className="w-3.5 h-3.5" />
      {label}
    </a>
  );
}
