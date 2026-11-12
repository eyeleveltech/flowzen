/**
 * Coming back to where you were after signing in.
 *
 * Somebody taps a link to /my-work?task=…, is signed out, and was sent to
 * /login — which then always landed on /my-work, and the task they
 * came for was gone. So the trip to /login carries the address as `next`, and
 * the login page goes back to it.
 */

/** /login, remembering the page it was sent from. */
export function loginHref(): string {
  if (typeof window === 'undefined') return '/login';
  const here = window.location.pathname + window.location.search;
  return here && here !== '/' && !here.startsWith('/login') ? `/login?next=${encodeURIComponent(here)}` : '/login';
}

/**
 * Where to go after signing in: `next` when it is a path on this site, My Work
 * otherwise.
 *
 * Only a plain path — it must start with one slash, not two (`//evil.com` is
 * another site) and not a backslash some browsers treat the same way. Anything
 * else is ignored rather than followed, so the link cannot be used to send
 * somebody off-site after they sign in.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/my-work';
  // Browsers drop tabs and newlines from a URL, so "/\t/evil.example" is read
  // as "//evil.example" — another site. No control characters at all.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(raw)) return '/my-work';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/my-work';
  // And whatever it resolves to must still be this site.
  try {
    const base = 'https://flowzen.invalid';
    if (new URL(raw, base).origin !== base) return '/my-work';
  } catch {
    return '/my-work';
  }
  return raw;
}
