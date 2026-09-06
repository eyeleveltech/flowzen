import '@testing-library/jest-dom';

/**
 * A working `localStorage`.
 *
 * jsdom does not provide one in this configuration — `window.localStorage` is
 * `undefined`, not merely empty — so anything that remembers something for the
 * reader (saved views, the active module, the signed-in user) could not be tested
 * at all. Every such module already wraps its access in try/catch, because a
 * private window or blocked site data has to degrade rather than crash; without a
 * store here those tests would pass by taking the failure path, which proves the
 * fallback and nothing else.
 *
 * A plain Map is enough: real quota and eviction behaviour is not what any of
 * these tests are about, and a test that wants a FAILING store stubs the
 * prototype method itself.
 */
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();

  const shim: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };

  // Defined on the prototype as well, so `vi.spyOn(Storage.prototype, …)` — the
  // usual way to simulate a browser that refuses to store anything — still works.
  Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  Object.defineProperty(globalThis, 'Storage', {
    value: class Storage {},
    configurable: true,
  });
  Object.assign((globalThis as { Storage: { prototype: Storage } }).Storage.prototype, shim);
  Object.setPrototypeOf(shim, (globalThis as { Storage: { prototype: Storage } }).Storage.prototype);
}
