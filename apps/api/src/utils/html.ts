// Escape user-controlled text before interpolating it into HTML (emails, PDFs).
// Prevents stored-HTML / script injection reaching recipient inboxes or the
// Puppeteer renderer.
export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

import sanitizeHtml from 'sanitize-html';

// Rich-text fields (project/client scope, description, internal notes, task description) are
// authored in the TipTap editor and stored as HTML — so they can't simply be escaped like
// plain text; the formatting must survive. This strips everything that could execute or
// exfiltrate (scripts, event handlers, javascript:/data: URLs, iframes) while keeping the
// same formatting tags the editor produces. It runs on WRITE, so poison never reaches the DB;
// the frontend <SafeHtml> component enforces the identical allow-list on render as a second
// layer (and to clean rows written before this existed). Keep the two lists in sync.
const RICH_TEXT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'div',
    'strong', 'b', 'em', 'i', 's', 'strike', 'del', 'u', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre', 'hr',
    'a',
  ],
  allowedAttributes: { a: ['href', 'target', 'rel'], '*': ['class'] },
  // Only safe link schemes; blocks javascript:, data:, etc.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  disallowedTagsMode: 'discard',
};

/**
 * Sanitize a rich-text HTML field before storing it. Returns undefined for null/undefined
 * input so it can be spread into a Prisma update without overwriting an unset field.
 */
export function sanitizeRichText<T extends string | null | undefined>(html: T): T {
  if (html == null) return html;
  return sanitizeHtml(html, RICH_TEXT_OPTIONS) as T;
}
