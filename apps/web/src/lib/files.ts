// Build an absolute URL for a file the API serves (e.g. generated quote / invoice PDFs).
//
// The API returns relative paths like "/uploads/quotes/EL-QT-2026-001_Acme.pdf".
// In production the app is same-origin behind a proxy that routes ONLY /api/* to the
// API service, so a bare "/uploads/..." would hit the Next.js frontend and 404.
// NEXT_PUBLIC_API_URL already ends in "/api", so prefixing with it routes uploads
// through the API correctly in both dev and prod.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

export function fileUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  const base = API_URL.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}
