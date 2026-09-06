import type { RolePreset } from '@prisma/client';

/**
 * The two role vocabularies, and the bridge between them.
 *
 * The database stores a `RolePreset` — EMPLOYEE / BD / HEAD / ACCOUNTS /
 * MANAGEMENT — which is how this agency actually describes its people. The web
 * app was built against an earlier, generic ladder (MEMBER → SUPER_ADMIN) and
 * still gates on it in several places: `lib/modules.ts`'s RANK, the mobile tab
 * bar, the quick-create menu, the admin-only items in the top bar, and the
 * profile screen's own role label.
 *
 * Rather than rewrite every one of those against the new vocabulary — and risk
 * missing one, which is exactly how the whole mobile navigation came to be
 * gated on `undefined` — the API sends BOTH. `preset` is the truth; `role` is
 * the same fact spelled the way the client still reads it.
 */
const PRESET_TO_ROLE: Record<RolePreset, string> = {
  EMPLOYEE: 'MEMBER',
  BD: 'SALES',
  HEAD: 'MANAGER',
  ACCOUNTS: 'ADMIN',
  MANAGEMENT: 'SUPER_ADMIN',
};

export function roleForPreset(preset: RolePreset | string): string {
  return PRESET_TO_ROLE[preset as RolePreset] ?? 'MEMBER';
}
