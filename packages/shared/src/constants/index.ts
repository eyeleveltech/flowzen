// A customer lifecycle: running, paused, finished, gone. There is deliberately no "prospect" —
// a not-yet-customer is a Lead on the pipeline board, not a Client.
export const CLIENT_STATUSES = ['ACTIVE', 'ONHOLD', 'CHURNED', 'PROJECT_COMPLETED'] as const;

// One priority scale, shared by Task and Project (both carry a real `priority`
// column of this same Prisma enum) — not two disagreeing four-value lists
// (Task had URGENT as its fourth value, Project had CRITICAL) that only ever
// existed as dead constants nothing imported.
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'PROJECT_MANAGER', 'TEAM_MEMBER'] as const;

export const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  // Client statuses
  ACTIVE: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ONHOLD: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  CHURNED: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  PROJECT_COMPLETED: { bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' },
  COMPLETED: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },

  // Project statuses
  PLANNING: { bg: 'bg-slate-50', text: 'text-slate-700', dot: 'bg-slate-400' },
  IN_PROGRESS: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  REVIEW: { bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-500' },
  ON_HOLD: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  CANCELLED: { bg: 'bg-rose-50', text: 'text-rose-700', dot: 'bg-rose-500' },

  // Task statuses
  BACKLOG: { bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  TODO: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  APPROVED: { bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-500' },
  BLOCKED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

// Priority uses the SAME four tones as the status map in apps/web (lib/status.ts): quiet for
// "nothing to do", neutral for normal, amber for soon, red for now. It previously spent blue on
// MEDIUM and orange on HIGH, which added two colour families to a deliberately monochrome UI to
// describe a scale that only has one axis — urgency. Blue on "Medium" is the costly one: it draws
// the eye to the priority that by definition does not need it, and makes the red URGENT beside it
// harder to pick out.
//
// HIGH now shares amber with the WARN status tone, and URGENT shares red with DANGER, so one
// glance means the same thing everywhere in the product.
export const PRIORITY_CONFIG: Record<string, { dot: string; badge: string; color: string; label: string; icon: string }> = {
  LOW: { dot: 'bg-line', badge: 'bg-surface text-secondary border-border', color: 'text-secondary', label: 'Low', icon: '○' },
  MEDIUM: { dot: 'bg-secondary', badge: 'bg-subtle text-body border-border', color: 'text-body', label: 'Medium', icon: '◐' },
  /*
   * Low and Medium were already spending the palette's own tokens; High and
   * Urgent were the last two reaching for Tailwind's amber-500 / red-500 and
   * their -50/-700 tints — cool, bluish colours that sit visibly outside a
   * green-and-gold identity, on the one mark that appears on five screens.
   *
   * These are the same four classes `Badge`'s `warn` and `bad` tones use, so a
   * high-priority dot and an overdue chip are finally the same red.
   */
  HIGH: { dot: 'bg-warning', badge: 'bg-warning-tint text-warning-ink border-warning/30', color: 'text-warning-ink', label: 'High', icon: '●' },
  URGENT: { dot: 'bg-danger', badge: 'bg-danger-tint text-danger border-danger/30', color: 'text-danger', label: 'Urgent', icon: '⚡' },
};

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  PROJECT_MANAGER: 'Project Manager',
  TEAM_MEMBER: 'Team Member',
};

export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  ONHOLD: 'On Hold',
  CHURNED: 'Churned',
  PROJECT_COMPLETED: 'Project Completed',
  COMPLETED: 'Completed',
  PLANNING: 'Planning',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  APPROVED: 'Approved',
  ON_HOLD: 'On Hold',
  CANCELLED: 'Cancelled',
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  BLOCKED: 'Blocked',
};

// ──────────────────────────────────────────────
// Company assets
// ──────────────────────────────────────────────

/**
 * How long a category of kit is written off over, in months.
 *
 * The shape follows Companies Act Schedule II — end-user computing devices at
 * three years, office equipment at five — with lenses stretched to seven
 * because they genuinely outlive the bodies they sit on.
 *
 * These are DEFAULTS, not advice. Every asset carries its own
 * `usefulLifeMonths`, seeded from here and overridable, because the CA
 * occasionally disagrees about one specific purchase. Worth one conversation
 * with them before the first FY report goes out: the Income Tax
 * written-down-value rates differ from Companies Act straight-line lives, and
 * which basis the register mirrors is the CA's call, not this file's.
 */
export const ASSET_USEFUL_LIFE: Record<string, number> = {
  LAPTOP: 36,
  DESKTOP: 36,
  MONITOR: 60,
  PHONE: 24,
  STORAGE: 36,
  NETWORK: 36,
  CAMERA_BODY: 60,
  LENS: 84,
  LIGHTING: 60,
  AUDIO: 60,
  GIMBAL_DRONE: 36,
  SUPPORT: 60,
  ACCESSORY: 24,
  OTHER: 60,
};

/**
 * The three-letter code in the middle of a tag — `EL/CAM/001`.
 *
 * Short enough to read off a sticker at arm's length, and stable: these get
 * printed once and stay on the kit for its whole life, so a category's code
 * must never be re-pointed at something else.
 */
export const ASSET_CATEGORY_CODE: Record<string, string> = {
  LAPTOP: 'LAP',
  DESKTOP: 'DSK',
  MONITOR: 'MON',
  PHONE: 'PHN',
  STORAGE: 'STO',
  NETWORK: 'NET',
  CAMERA_BODY: 'CAM',
  LENS: 'LEN',
  LIGHTING: 'LGT',
  AUDIO: 'AUD',
  GIMBAL_DRONE: 'GMB',
  SUPPORT: 'SUP',
  ACCESSORY: 'ACC',
  OTHER: 'GEN',
};

export const ASSET_CATEGORY_LABEL: Record<string, string> = {
  LAPTOP: 'Laptop',
  DESKTOP: 'Desktop',
  MONITOR: 'Monitor',
  PHONE: 'Phone',
  STORAGE: 'Storage',
  NETWORK: 'Network',
  CAMERA_BODY: 'Camera body',
  LENS: 'Lens',
  LIGHTING: 'Lighting',
  AUDIO: 'Audio',
  GIMBAL_DRONE: 'Gimbal / drone',
  SUPPORT: 'Tripods & support',
  ACCESSORY: 'Accessory',
  OTHER: 'Other',
};

/** Categories that leave the office by default when a new asset is entered. */
export const ASSET_BOOKABLE_BY_DEFAULT: string[] = [
  'CAMERA_BODY',
  'LENS',
  'LIGHTING',
  'AUDIO',
  'GIMBAL_DRONE',
  'SUPPORT',
  'ACCESSORY',
];

export const ASSET_STATUS_LABEL: Record<string, string> = {
  IN_STOCK: 'In stock',
  ASSIGNED: 'Assigned',
  BOOKED_OUT: 'Out on a shoot',
  IN_REPAIR: 'In repair',
  RETIRED: 'Retired',
  SOLD: 'Sold',
  LOST: 'Lost',
};

export const ASSET_CONDITION_LABEL: Record<string, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  DAMAGED: 'Damaged',
};
