// Escape user-controlled text before interpolating it into HTML (emails, PDFs).
// Prevents stored-HTML / script injection reaching recipient inboxes or the
// Puppeteer renderer.
export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
