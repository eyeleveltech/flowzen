/**
 * What this browser can do about phone notifications, and the plumbing to
 * turn them on. Used by Profile → Phone notifications.
 *
 * An iPhone is the awkward one: Safari only allows them for a site added to
 * the Home Screen (iOS 16.4+) and opened from there. In a Safari tab the
 * browser does not even expose the push API, so "not supported" there really
 * means "install it first" — and the card says so instead of a dead button.
 */

export type PushSupport = 'supported' | 'ios-not-installed' | 'unsupported';

/** iPhone, iPad, or an iPad asking for the desktop site (it says "Mac", with a touch screen). */
export function isIos(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** Opened from the Home Screen rather than in a browser tab. */
export function isInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
  if (ios && !isInstalled()) return 'ios-not-installed';
  const can = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return can ? 'supported' : 'unsupported';
}

/** The VAPID public key, from the URL-safe base64 the server sends, as the bytes a browser wants. */
export function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Was this subscription made with this key? New server keys make old subscriptions useless. */
export function sameKey(existing: ArrayBuffer | null | undefined, base64Url: string): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  const b = keyBytes(base64Url);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** This browser's subscription, if it has one. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Subscribe this browser with the server's key — reusing a subscription made
 * with the same key, replacing one made with an old key. Permission must
 * already be granted: asking has to happen first thing in the tap, or iOS
 * refuses to show the prompt.
 */
export async function subscribeThisBrowser(publicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }> {
  const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options.applicationServerKey, publicKey)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('This browser gave an incomplete subscription.');
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}
