/**
 * What a link in a Zen answer really points at (security fixes plan, H7/M6).
 *
 * A Zen answer is a model's writing built partly from what people typed, so a
 * link in it is untrusted. "Starts with a slash" is not enough to call it ours:
 * a browser reads `/\evil.com` as `//evil.com` — another site — and drops tabs
 * and newlines from the middle of a URL. So the href is normalised the way the
 * browser will read it, and only then classified.
 *
 *   - internal: a path on this app, opened in the app.
 *   - external: http(s) somewhere else, shown with its domain and opened in a
 *     new tab only on a click.
 *   - none: anything else (`javascript:`, `data:`, control characters) is not a
 *     link at all; its text is shown and nothing more.
 */
export type LinkKind =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string; host: string }
  | { kind: 'none' };

export function classifyLink(raw: string | null | undefined): LinkKind {
  if (!raw) return { kind: 'none' };
  // What the browser does before it resolves a URL: tabs and newlines go, the
  // ends are trimmed, and a backslash counts as a slash.
  const href = raw.replace(/[\t\n\r]/g, '').trim().replace(/\\/g, '/');
  if (!href || /[\u0000-\u001F\u007F]/.test(href)) return { kind: 'none' };
  // The Markdown renderer percent-encodes a backslash, so `/\evil.com` arrives
  // as `/%5Cevil.com`. No path of this app starts with an encoded slash or
  // backslash, so such a link is not a link at all.
  if (/^\/(%5c|%2f)/i.test(href)) return { kind: 'none' };

  if (href.startsWith('/') && !href.startsWith('//')) return { kind: 'internal', href };

  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'external', href: url.toString(), host: url.hostname.replace(/^www\./, '') };
    }
  } catch {
    // Not a URL: a relative path without a slash, or nonsense.
  }
  return { kind: 'none' };
}
