/**
 * The v2 API client.
 *
 * Typed against the endpoints rebuilt on the v2 schema. The shapes here mirror
 * docs/FLOWZEN-MASTER-PLAN.md §3, so a field's meaning is the same on both sides
 * of the wire.
 *
 * Money arrives as a STRING and stays one. Parsing a rupee figure into a
 * JavaScript number to display it is how an invoice ends up a paisa out, and an
 * invoice off by a paisa is a dispute.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * An absolute URL for something the BROWSER fetches directly — a PDF the person
 * downloads, rather than JSON this module parses.
 *
 * Exported so no screen writes its own base URL. One did, with a different
 * fallback port, which meant its download link worked only when the environment
 * variable happened to be set.
 */
export const fileUrl = (path: string): string => `${API_URL}${path}`;

export type FieldError = { field: string; message: string };

/** A rule was broken. Carries every field at once so a form can show them all. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fieldErrors: FieldError[] = [],
    readonly data?: unknown,
    readonly code?: string,
    /**
     * The underlying system's own words, when there are any — an SMTP server's
     * "535 authentication failed", say. Kept apart from `message`, which is ours:
     * paraphrasing it would throw away the only clue somebody can act on, and
     * showing it alone would put a protocol error in front of a person.
     */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The message for one field, if the server named it. */
  forField(field: string): string | undefined {
    return this.fieldErrors.find((e) => e.field === field)?.message;
  }
}

async function request<T>(
  endpoint: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401 && typeof window !== 'undefined') {
    const onAuthPage = ['/login', '/register', '/accept-invite'].some((p) =>
      window.location.pathname.startsWith(p),
    );
    if (!onAuthPage) {
      window.location.href = '/login';
      // Never settle. The page is navigating away, so resolving would render a
      // half-loaded screen and rejecting would surface "Authentication required"
      // as an unhandled rejection during a redirect that is working correctly.
      return new Promise<T>(() => {});
    }
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(
      payload.error ?? 'Something went wrong',
      response.status,
      payload.fieldErrors ?? [],
      payload.data,
      payload.code,
      payload.detail,
    );
  }

  return (payload.data !== undefined ? payload.data : payload) as T;
}

const get = <T>(e: string) => request<T>(e);
const post = <T>(e: string, body?: unknown) => request<T>(e, { method: 'POST', body });
const patch = <T>(e: string, body?: unknown) => request<T>(e, { method: 'PATCH', body });
const del = <T>(e: string) => request<T>(e, { method: 'DELETE' });

/**
 * Raw HTTP helpers — exported for pages calling endpoints not yet in the
 * typed `api` namespace (e.g. /brief/monday, /forecast/3-month, /allocations).
 */
export const apiGet = get;
export const apiPost = post;
export const apiPatch = patch;
/**
 * The whole envelope, not just `data`.
 *
 * A few endpoints answer with a `message` alongside the payload — "Invitation
 * emailed to …", or "the account is created, send them the link yourself".
 * Unwrapping to `data` throws that away.
 */
const full = async <T>(method: string, e: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_URL}${e}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? 'Something went wrong',
      response.status,
      payload.fieldErrors ?? [],
      payload.data,
      payload.code,
      payload.detail,
    );
  }
  return payload as T;
};

const getFull = <T>(e: string) => full<T>('GET', e);
const postFull = <T>(e: string, body?: unknown) => full<T>('POST', e, body);
/**
 * A GET that keeps the envelope.
 *
 * The asset screens need `access` alongside `data`, and the default unwrap to
 * `payload.data` throws it away.
 */
const apiFull = <T>(method: string, e: string, body?: unknown) => full<T>(method, e, body);
const patchFull = <T>(e: string, body?: unknown) => full<T>('PATCH', e, body);

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A LABEL, not a gate.
 *
 * The database stores a `RolePreset` — EMPLOYEE / BD / HEAD / ACCOUNTS /
 * MANAGEMENT — and the API sends this alongside it (api/utils/roles.ts) purely
 * so a screen can print "Admin" where the agency's own word would mean nothing
 * to the person reading it.
 *
 * It used to be a ladder, with a RANK table and an `atLeast()` that decided
 * what to show. Nothing scores people any more: the navigation, the quick-
 * create menu, the command palette and Settings' own edit rights all ask the
 * permission the API enforces. A rank could never express a sideways set —
 * BD sells and cannot see the work, HEAD runs the work and cannot see the
 * pipeline — so it kept offering people doors that were locked.
 */
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'SALES' | 'MEMBER';

export type CompanyStatus =
  | 'PROSPECT'
  | 'ACTIVE'
  | 'ONHOLD'
  | 'PROJECT_COMPLETED'
  | 'CHURNED';

export type StageKind = 'OPEN' | 'WON' | 'LOST';

export interface OrgConfig {
  organization: {
    // Everybody: enough to render a date and an amount.
    id: string;
    name: string;
    currency: string;
    timezone: string;
    locale: string;
    dateFormat: string;
    fiscalYearStart: number;
    // setup.admin only — absent for everyone else. The organisation's own
    // paperwork is not everybody's to read; see the route for the whole story.
    documentPrefix?: string;
    state?: string | null;
    gstNumber?: string | null;
    website?: string | null;
    phone?: string | null;
    address?: string | null;
    mailFromName?: string | null;
    mailFromEmail?: string | null;
    mailReplyTo?: string | null;
    allowPasswordLogin?: boolean;
    /** The first part of every asset tag — EL in EL/CAM/001. */
    assetTagPrefix?: string;
  };
  /**
   * Whether this organisation can send email at all.
   *
   * A boolean rather than the settings themselves, because this payload goes to
   * every signed-in person and a Member has no reason to learn the mail server.
   * It is all a screen needs to choose between "emailed" and "copy this link".
   */
  /** setup.admin only. */
  mailConfigured?: boolean;
  modules: Record<string, boolean>;
  stages: Stage[];
  lostReasons: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  services: { id: string; name: string; defaultRate: string | null; unit: string | null }[];
  /** `permissions` is the real, granular gate (work.own/company.write/etc). `role` is a coarser mapping onto the legacy Role ladder for screens that only need a threshold check. */
  me: { userId: string; preset?: string; permissions?: string[] };
  documentSettings?: DocumentSettings;
}

/** What a proforma PDF puts on itself — the letterhead a business actually has, not fixed values baked into a template. */
export interface DocumentSettings {
  contactEmail: string | null;
  gstStateCode: string | null;
  defaultPaymentTerms: string;
  defaultProformaValidityDays: number;
  defaultTermsAndConditions: string[];
  bankAccountHolderName: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountNumber: string | null;
  bankIfscCode: string | null;
}

/**
 * Whether a message left the building.
 *
 * Attached to every response that tries to send one. `emailed: false` is not an
 * error — the account was still created, the token is still valid — so screens
 * show the link instead of an alarm.
 */
export interface Delivery {
  emailed: boolean;
  emailFailure?: 'NOT_CONFIGURED' | 'NO_RECIPIENT' | 'SEND_FAILED';
}

/** Admin only. The password is never sent — `hasPassword` is all a form needs. */
export interface MailSettings {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  mailFromName: string | null;
  mailFromEmail: string | null;
  mailReplyTo: string | null;
  hasPassword: boolean;
  configured: boolean;
  /**
   * Whose mailbox it is going out from. `ENV_SMTP` means the deployment's own
   * account is being used because this organisation has not set one up — which
   * is fine, and is exactly the thing an admin cannot otherwise discover from an
   * empty form marked "On".
   */
  via: 'ORG_SMTP' | 'ENV_SMTP' | null;
  /** The full `Name <address>` it sends as. */
  from: string | null;
}

export interface StageFieldDef {
  id?: string;
  required?: boolean;
  isRequired?: boolean;
  position?: number;
  field: { id: string; key: string; label: string; type: string; options?: unknown };
}

export interface Stage {
  id: string;
  name: string;
  kind: StageKind;
  position: number;
  probability: string;
  rottingDays: number | null;
  requiresForecast: boolean;
  fields?: StageFieldDef[];
}

export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  statusMeaning: { label: string; nextAction: string };
  email: string | null;
  phone: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  instagramUrl?: string | null;
  state: string | null;
  industry?: string | null;
  website?: string | null;
  companySize?: string | null;
  gstNumber?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  ownerId?: string | null;
  billingAddress?: string | null;
  /** Only fires while the company has no OPEN deal — the deal's own date wins. */
  followUpDate?: string | null;
  owner: { id: string; name: string; avatar: string | null } | null;
  source: { id: string; name: string } | null;
  _count?: { deals: number; engagements: number; projects: number };
}

/**
 * What the client record already knows, in sentences.
 *
 * Not a score: a ten-minute task and a two-day task count the same, so the
 * output has to read as directional. `proxy` marks the sentences resting on a
 * stand-in rather than a measurement, and the interface says so out loud (§7.2).
 */
export interface Observation {
  kind: 'NEVER_SPOKEN' | 'SILENCE' | 'THEY_ARE_WAITING' | 'PAYS_LATE' | 'WORK_GREW';
  text: string;
  proxy?: boolean;
  tone: 'note' | 'warn';
}

/** What an import did, row by row. A file is never all-or-nothing (§4.4). */
export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  wouldCreate: number;
  skipped: number;
  invalid: number;
  results: {
    /** The number the person sees in their spreadsheet — the header is row 1. */
    row: number;
    name: string;
    action: 'CREATED' | 'SKIPPED' | 'WOULD_CREATE' | 'INVALID';
    reason?: string;
    companyId?: string;
    matches?: { id: string; name: string; reason: string }[];
  }[];
}

/**
 * What a salesperson has to do today, and what the pipeline is worth.
 *
 * `mine` is addressed to one person; `pipeline` and `month` are the whole
 * organisation's. Every figure is computed on the server — a page that adds up
 * its own totals is a second opinion about money.
 */
export interface CrmDashboard {
  mine: {
    followUpsDue: {
      id: string;
      title: string | null;
      company: { id: string; name: string };
      followUpDate: string;
    }[];
    companyFollowUpsDue: {
      id: string;
      name: string;
      followUpDate: string;
      status: CompanyStatus;
    }[];
    rotting: {
      id: string;
      title: string | null;
      company: { id: string; name: string };
      stage: string;
      daysInStage: number;
      blockedOn: string | null;
    }[];
    quotesAwaitingReply: {
      id: string;
      number: string;
      company: { id: string; name: string };
      total: string;
      daysWaiting: number | null;
    }[];
    quotesExpired: {
      id: string;
      number: string;
      validUntil: string | null;
      company: { id: string; name: string };
    }[];
    /** Sentences the record can say about their own clients, without being asked. */
    worthKnowing: { company: { id: string; name: string }; observations: Observation[] }[];
    openDeals: number;
  };
  pipeline: {
    byStage: { id: string; name: string; count: number; total: string; weighted: string }[];
    openCount: number;
    openValue: string;
    /** Each stage's total times its own probability — not money about to arrive. */
    weightedValue: string;
  };
  month: { won: number; wonValue: string; lost: number };
  clients: Partial<Record<CompanyStatus, number>>;
}

export interface Dashboard {
  work: {
    overdue: number;
    dueToday: number;
    awaitingMyReview: number;
    tasks: { id: string; title: string; dueDate: string | null; project: { id: string; name: string } | null }[];
  };
  /**
   * What we are delivering, counted on the SERVER.
   *
   * The delivery dashboard counted these in the browser from a capped list, so
   * "active projects" quietly meant "active projects on the first page".
   */
  delivery: { active: number; offTrack: number };
  clients: Partial<Record<CompanyStatus, number>>;
  pipeline?: {
    followUpsDue: {
      id: string;
      title: string | null;
      company: { id: string; name: string };
      followUpDate: string | null;
    }[];
    /** Companies you own with a date set and nothing open against them (§4.4). */
    companyFollowUpsDue: {
      id: string;
      name: string;
      followUpDate: string;
      status: CompanyStatus;
    }[];
    quotesExpired: {
      id: string;
      number: string;
      validUntil: string | null;
      company: { id: string; name: string };
    }[];
    rotting: {
      id: string;
      title: string | null;
      company: { id: string; name: string };
      stage: string;
      daysInStage: number;
      blockedOn: string | null;
    }[];
    quotesAwaitingReply: {
      id: string;
      number: string;
      company: { id: string; name: string };
      total: string;
      daysWaiting: number | null;
    }[];
  };
  money?: {
    mrr: string;
    billedThisMonth: string;
    collectedThisMonth: string;
    outstanding: string;
    overdue: string;
    invoicesDueToRaise: number;
    /** Drafts waiting for a human to check and send — the daily job, since B2. */
    invoicesToSend: number;
    overdueInvoices: number;
    pricesDueForReview: number;
  };
}

export type UserStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';

/** How an account can be signed into. An ACTIVE one must always have at least one. */
export interface SignIn {
  password: boolean;
  google: boolean;
  provider: string;
}

export interface MemberProject {
  id: string;
  name: string;
  status: string;
  dueDate: string | null;
  company: { id?: string; name: string } | null;
  isLead?: boolean;
}

export interface MemberTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  taskType?: string | null;
  project: { id: string; name: string; company: { id?: string; name: string } | null } | null;
}

export interface MemberTaskStats {
  total: number;
  open: number;
  inProgress: number;
  inReview: number;
  completed: number;
  overdue: number;
}

/**
 * A person, as `GET /users` describes them.
 *
 * The shape depends on WHO IS ASKING. Manager and above get the full record;
 * below that this is a picker — name, face, job title, whether the account is
 * live — and everything marked optional here simply does not arrive.
 *
 * Optional rather than a second type, because one endpoint answers both and a
 * type that promises `email` to a Member would be describing a field that is not
 * on the wire. If you read one of these on a screen that is not gated to Manager,
 * expect `undefined`.
 */
export interface TaskTemplateItem {
  title: string;
  /** Day of the month the spawned task is due; the roll job clamps anything past 28. */
  dayOfMonth?: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  items: TaskTemplateItem[];
  _count?: { retainers: number };
}

export interface Member {
  id: string;
  name: string;
  avatar: string | null;
  designation: string | null;
  status: UserStatus;
  department?: { id: string; name: string } | null;

  // ── Manager and above only ────────────────────────────────────────────────
  email?: string;
  phone?: string | null;
  role?: Role;
  joiningDate?: string;
  projects?: MemberProject[];
  activeProjectsCount?: number;
  tasks?: MemberTask[];
  taskStats?: MemberTaskStats;
  signIn?: SignIn;
  /** A PENDING account whose link has lapsed needs resending, not chasing. */
  inviteExpired?: boolean;
}

/**
 * A Member seen from a screen that is gated to Manager and above.
 *
 * Same endpoint, fuller answer. Naming it says WHY the optional fields can be
 * relied on here — the page cannot be reached without the rank that makes the
 * server send them — instead of scattering non-null assertions and hoping the
 * gate never moves.
 */
export type FullMember = Member &
  Required<Pick<Member, 'email' | 'role' | 'joiningDate' | 'signIn' | 'inviteExpired'>>;

export interface Profile {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  designation: string | null;
  phone: string | null;
  joiningDate: string;
  role: Role;
  organization: { id: string; name: string; allowPasswordLogin: boolean };
  signIn: SignIn;
}

/** Who changed what. Read-only — an audit log something can edit is not one. */
export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; name: string } | null;
}

/**
 * What a PM report covers.
 *
 * The page's 7D/30D/90D/YTD/All selector sends `?range=`, and the server echoes
 * back what it resolved to. Only THROUGHPUT moves with it — what was finished,
 * how fast, and whether that is speeding up. Current state (overdue, open,
 * health) is "right now" whatever the selector says, which is why the page has
 * to label the two differently instead of implying everything is windowed.
 */
export interface ReportWindow {
  range: '7d' | '30d' | '90d' | 'ytd' | 'all';
  label: string;
  since: string | null;
}

export interface PmSummaryData {
  window: ReportWindow;
  summary: {
    totalProjects: number;
    activeProjects: number;
    totalTasks: number;
    completedTasks: number;
    /** Finished INSIDE the window. `completedTasks` is all time. */
    completedInRange: number;
    openTasks: number;
    overdueTasks: number;
    /**
    * `null` when there is nothing to measure it from.
    *
    * The API used to answer 95 and 2.5 in that case — invented numbers, printed
    * as headline KPIs, indistinguishable from real ones. The sample sizes beside
    * them say how many completions each figure rests on.
    */
    onTimeDeliveryRate: number | null;
    avgTurnaroundDays: number | null;
    onTimeSampleSize: number;
    turnaroundSampleSize: number;
    /** `null` for "All time" — there is no previous period to compare against. */
    velocityDeltaPercent: number | null;
    overduePressureRate: number;
    activeTeamMembers: number;
  };
  projectHealth: {
    onTrack: number;
    atRisk: number;
    delayed: number;
    onHold: number;
    completed: number;
  };
  statusFunnel: {
    todo: number;
    inProgress: number;
    inReview: number;
    blocked: number;
    onHold: number;
    done: number;
  };
  blockerRadar: {
    inReviewCount: number;
    blockedCount: number;
  };
}

export interface PmProjectReport {
  id: string;
  name: string;
  status: string;
  health: 'ON_TRACK' | 'AT_RISK' | 'DELAYED' | 'ON_HOLD' | 'COMPLETED';
  priority: string;
  type: string | null;
  company: { id: string; name: string };
  lead: { id: string; name: string; avatar: string | null } | null;
  startDate: string | null;
  dueDate: string | null;
  isOverdue: boolean;
  progressPercent: number;
  taskStats: {
    total: number;
    completed: number;
    inProgress: number;
    inReview: number;
    open: number;
    overdue: number;
  };
}

export interface PmTeamWorkloadReport {
  id: string;
  name: string;
  avatar: string | null;
  designation: string | null;
  department: { id: string; name: string } | null;
  activeProjectsCount: number;
  loadStatus: 'AVAILABLE' | 'BALANCED' | 'HIGH' | 'OVERLOADED';
  completionRate: number;
  taskStats: {
    total: number;
    open: number;
    inProgress: number;
    inReview: number;
    completed: number;
    overdue: number;
  };
}

export interface PmTaskTypeItem {
  type: string;
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  completionRate: number;
  avgDaysToComplete: number | null;
  completedSampleSize: number;
}

export interface PmDepartmentItem {
  id: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
  openTasks: number;
  overdueTasks: number;
  completionRate: number;
}

export interface PmTaskTypesData {
  window?: ReportWindow;
  taskTypes: PmTaskTypeItem[];
  departments: PmDepartmentItem[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  /** The rule's own severity (HIGH/MED/LOW) — the backend has always sent this, nothing read it. */
  severity: 'HIGH' | 'MED' | 'LOW';
  /**
   * What corner of the business this is about — "Money", "Tasks", "Pipeline".
   * Derived from the same entity type that decides `link`, so the label and
   * the destination cannot drift apart.
   */
  source: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

// ── The API ──────────────────────────────────────────────────────────────────

/**
 * What the duplicate rule decided (§3.12).
 *
 * `BLOCK` is an exact email or phone — the same company, typed twice, and there
 * is no arguing with it. `WARN` is a similar NAME, which really can be two
 * customers ("Sharma Traders" and "Sharma Trading"), so the server sets
 * `canForce` and expects the interface to offer a way through. A screen that
 * only shows the sentence and no way past it is a screen people route around by
 * misspelling the name on purpose.
 */
export type DuplicateMatch = {
  id: string;
  name: string;
  reason: 'email' | 'phone' | 'name';
  matchedOn: string;
};

export type DuplicateVerdict = {
  action: 'CREATE' | 'BLOCK' | 'WARN';
  matches?: DuplicateMatch[];
  canForce?: boolean;
};


// ── The equipment register ───────────────────────────────────────────────────

/**
 * What the caller may do, as the SERVER sees it.
 *
 * `canSeeFigures` is not a styling hint — it is the reason a price is or is not
 * in the payload at all. A screen that reads it is describing what it received,
 * not deciding what to hide.
 */
export type AssetAccess = { canManage: boolean; canSeeFigures: boolean };

export interface AssetListItem {
  id: string;
  tag: string;
  name: string;
  category: string;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  status: string;
  condition: string;
  bookable: boolean;
  purchasedAt: string;
  vendor: string | null;
  invoiceNumber: string | null;
  usefulLifeMonths: number;
  warrantyUntil: string | null;
  insuredUntil: string | null;
  billUrl: string | null;
  photoUrl: string | null;
  notes: string | null;
  disposedAt: string | null;
  disposalNote: string | null;
  currentHolderId: string | null;
  currentHolder: { id: string; name: string; active: boolean } | null;
  fullyDepreciated: boolean;
  /** Only for a caller with money.figures — otherwise the key is absent. */
  costId?: string | null;
  purchasePrice?: number;
  salvageValue?: number;
  disposalValue?: number | null;
  bookValue?: number;
  monthlyDepreciation?: number;
  /** Present on rows that are out — carried from the open movement. */
  dueAt?: string | null;
  purpose?: string | null;
  overdue?: boolean;
}

export interface AssetMovementRow {
  id: string;
  kind: 'CUSTODY' | 'BOOKING';
  outAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  conditionOut: string;
  conditionIn: string | null;
  purpose: string | null;
  notes: string | null;
  asset: { id: string; tag: string; name: string; category: string };
  user: { id: string; name: string; active?: boolean };
  issuedBy: { id: string; name: string };
  receivedBy?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  overdue?: boolean;
  daysOverdue?: number;
}

export interface AssetMaintenanceRow {
  id: string;
  kind: 'SERVICE' | 'REPAIR' | 'AMC';
  vendor: string | null;
  amount?: number | null;
  sentAt: string;
  returnedAt: string | null;
  notes: string | null;
  createdBy: { id: string; name: string };
}

export interface AssetDetail extends AssetListItem {
  openMovement: (AssetMovementRow & { daysOverdue: number }) | null;
  movements: AssetMovementRow[];
  maintenance: AssetMaintenanceRow[];
}

export interface AssetSummary {
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  outNow: number;
  overdue: number;
  inRepair: number;
  dueForReplacement: number;
  totalPurchaseValue?: number;
  totalBookValue?: number;
}

export interface AssetRegister {
  fy: string;
  from: string;
  to: string;
  rows: {
    id: string;
    tag: string;
    name: string;
    category: string;
    purchasedAt: string;
    purchasePrice: number;
    status: string;
    openingWdv: number;
    depreciationForYear: number;
    closingWdv: number;
  }[];
  totals: {
    purchasePrice: number;
    openingWdv: number;
    depreciationForYear: number;
    closingWdv: number;
  };
}

/** One line of "what I'm holding". */
export interface HeldAsset {
  id: string;
  tag: string;
  name: string;
  category: string;
  status: string;
  condition: string;
  heldSince: string | null;
  kind: 'CUSTODY' | 'BOOKING' | null;
  dueAt: string | null;
  purpose: string | null;
  overdue: boolean;
  purchasePrice?: number;
  bookValue?: number;
}

export interface ProjectProfitRow {
  id: string;
  name: string;
  status: string;
  company: { id: string; name: string };
  owner: { id: string; name: string } | null;
  endDate: string;
  percentComplete: number;
  percentCompleteBasis: 'milestones' | 'calendar';
  revenue: number;
  directCost: number;
  peopleCost: number;
  actualCost: number;
  profit: number;
  marginPercent: number | null;
  estimatedCost: number | null;
  costVariance: number | null;
  costVariancePercent: number | null;
  costRisk: {
    projectedCost: number | null;
    projectedProfit: number | null;
    level: 'OK' | 'WATCH' | 'OVER' | 'LOSS';
    reason: string | null;
  };
}

export interface ProjectProfitTotals {
  count: number;
  revenue: number;
  directCost: number;
  peopleCost: number;
  profit: number;
  marginPercent: number | null;
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ user: unknown }>('/auth/login', { email, password }),
    register: (body: { name: string; email: string; password: string; organizationName: string }) =>
      post<{ user: unknown }>('/auth/register', body),
    /** Accepting only ACTIVATES the account — the invitation created it (§3.12). */
    acceptInvite: (body: { token: string; password?: string; googleId?: string; googleEmail?: string }) =>
      post<{ user: unknown }>('/auth/accept-invite', body),
    resetPassword: (token: string, password: string) =>
      post<{ user: unknown }>('/auth/reset-password', { token, password }),
    logout: () => post('/auth/logout'),
    me: () => get<{ user: unknown }>('/auth/me'),
  },

  config: {
    get: () => get<OrgConfig>('/config'),
    update: (data: Record<string, unknown>) => patch('/config', data),
    /** What a proforma PDF puts on itself — Terms & Conditions, bank details. */
    updateDocumentSettings: (data: Record<string, unknown>) =>
      patch<{ success: boolean; documentSettings: DocumentSettings }>('/config/document-settings', data),
    /**
     * Admin only, and separate from `get` on purpose — the mail server is
     * infrastructure, not a display setting, so it is not in the payload every
     * signed-in person receives.
     */
    mail: () => get<MailSettings>('/config/mail'),
    /**
     * Authenticates first, then sends a real message to you. "It says it worked"
     * and "something arrived" become the same claim.
     */
    testMail: (to?: string) => postFull<{ data: { to: string }; message?: string }>('/config/mail/test', { to }),
    /** Turning a module off hides its screens AND refuses its endpoints (§7.5). */
    auditLog: () => get<AuditEntry[]>('/config/audit-log'),
  },

  dashboard: {
    get: () => get<Dashboard>('/dashboard'),
  },

  companies: {
    /** GET /companies returns `{success, companies, meta}` — no `.data` key, so this does NOT auto-unwrap. Read `.companies` off the result, not the result itself. */
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; companies: Company[]; meta: unknown }>(`/companies?${new URLSearchParams(params)}`),
    get: (id: string) => get<Record<string, unknown>>(`/companies/${id}`),
    /** Ask before creating, so the warning arrives while somebody is still typing. */
    checkDuplicate: (body: { name: string; email?: string; phone?: string }) =>
      post<DuplicateVerdict>('/companies/check-duplicate', body),
    /**
     * Create a company — and, unless told otherwise, its first card on the board.
     *
     * `contact` and `startDeal` are handled server-side in ONE transaction. They
     * used to be two more calls made after this one returned, each wrapped in its
     * own try/catch that logged and carried on — so a company could be saved with
     * its contact silently missing.
     */
    create: (body: Record<string, unknown>) =>
      post<Company & { dealId: string | null }>('/companies', body),
    /**
     * A spreadsheet of companies (§4.4).
     *
     * `dryRun` runs every rule — duplicates included — and writes nothing, so the
     * preview shows exactly what the real import will do.
     */
    import: (body: { csv?: string; rows?: Record<string, unknown>[]; dryRun?: boolean; force?: boolean; ownerId?: string }) =>
      post<ImportResult>('/companies/import', body),
    update: (id: string, data: Partial<Company>) => patch<Company>(`/companies/${id}`, data),
    addContact: (companyId: string, data: any) => post(`/companies/${companyId}/people`, data),
    updateContact: (companyId: string, personId: string, data: any) =>
      patch(`/companies/${companyId}/people/${personId}`, data),
  },

  outreach: {
    list: (params: Record<string, string> = {}) =>
      get<{
        success: boolean;
        entries: any[];
        /** Per status, following the search but NOT the status filter, so a chip says how many you would get by clicking it. */
        counts: { ALL: number; NOT_CONTACTED: number; CONTACTED: number; REPLIED: number; DEAD: number };
        /** Follows no filter — how many cold names exist at all. */
        summary: { cold: number };
        meta: { total: number };
      }>(`/outreach?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; entry: any }>('/outreach', body),
    /** Name, vertical, source, owner — any subset. Refused once the name has been promoted. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; entry: any }>(`/outreach/${id}`, body),
    /** A plain status change — Replied included. It never creates a Company; that's `promote` below, a separate deliberate step. */
    updateStatus: (id: string, status: string) =>
      patch<{ success: boolean; entry: any }>(`/outreach/${id}/status`, { status }),
    promote: (id: string, body: Record<string, unknown> = {}) =>
      post<{ success: boolean; company: any; entry: any }>(`/outreach/${id}/promote`, body),
    import: (body: { csv?: string; dryRun?: boolean; force?: boolean }) =>
      post<ImportResult>('/outreach/import', body),
  },

  pipeline: {
    getBoard: () =>
      get<{ success: boolean; stages: string[]; columns: Record<string, any[]> }>('/proposals/pipeline'),
    funnel: () =>
      get<{
        success: boolean;
        months: number;
        steps: { step: string; in: number; movedOn: number; rate: number; read: string }[];
      }>('/proposals/funnel'),
  },

  proposals: {
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; proposals: any[] }>(`/proposals?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; proposal: any; version: any }>('/proposals', body),
    addVersion: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; version: any }>(`/proposals/${id}/versions`, body),
    updateStage: (id: string, stage: string) =>
      patch<{ success: boolean; proposal: any }>(`/proposals/${id}/stage`, { stage }),
    /** null clears the override, reverting to the stage-derived default. */
    setProbability: (id: string, probabilityOverride: number | null) =>
      patch<{ success: boolean; proposal: any }>(`/proposals/${id}/probability`, { probabilityOverride }),
    win: (id: string, versionId: string) =>
      post<{ success: boolean; proposal: any }>(`/proposals/${id}/win`, { versionId }),
    lose: (id: string, lostReason: string) =>
      post<{ success: boolean; proposal: any }>(`/proposals/${id}/lose`, { lostReason }),
  },

  proformas: {
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; proformas: any[] }>(`/proformas?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; proforma: any }>('/proformas', body),
    updateStatus: (id: string, status: string) =>
      patch<{ success: boolean; proforma: any }>(`/proformas/${id}/status`, { status }),
    /** Only while the proforma is still UNPAID — the server refuses it otherwise. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; proforma: any }>(`/proformas/${id}`, body),
    /** A link, not a fetch — the browser downloads it with the session cookie. */
    pdfUrl: (id: string) => fileUrl(`/proformas/${id}/pdf`),
  },

  tasks: {
    my: () =>
      get<{ success: boolean; counts: any; tasks: { today: any[]; overdue: any[]; thisWeek: any[]; later: any[]; completed: any[] } }>('/tasks/my'),
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; tasks: any[] }>(`/tasks?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; task: any }>('/tasks', body),
    /** Title, assignee, due date, priority, notes — any subset. Status has its own route. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; task: any }>(`/tasks/${id}`, body),
    /**
     * Soft delete — §16, nothing is hard deleted by a user. Refused with a 400
     * once a task is finished, because its timing is already counted towards
     * how long this kind of work takes.
     */
    remove: (id: string) => del<{ success: boolean }>(`/tasks/${id}`),
    /** What makes the delete above a delete rather than a disappearance. */
    restore: (id: string) => post<{ success: boolean; task: any }>(`/tasks/${id}/restore`),
    updateStatus: (id: string, status: string) =>
      patch<{ success: boolean; task: any }>(`/tasks/${id}/status`, { status }),
    wait: (id: string, waitingOn: string) =>
      post<{ success: boolean; task: any }>(`/tasks/${id}/wait`, { waitingOn }),
    resume: (id: string) =>
      post<{ success: boolean; task: any }>(`/tasks/${id}/resume`),
  },

  retainers: {
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; retainers: any[] }>(`/retainers?${new URLSearchParams(params)}`),
    get: (id: string) => get<{ success: boolean; retainer: any }>(`/retainers/${id}`),
    /** Profit by client for one month, retainers only — see the route's own comment for why projects aren't mixed in. */
    profitability: (month?: string) =>
      get<{
        success: boolean;
        month: string;
        rows: { companyId: string; companyName: string; revenue: number; externalCost: number; peopleCost: number; profit: number; marginPercent: number }[];
        totals: { revenue: number; externalCost: number; peopleCost: number; profit: number; marginPercent: number };
      }>(`/retainers/profitability${month ? `?month=${month}` : ''}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; retainer: any }>('/retainers', body),
    /**
     * End it. Until this existed a retainer, once started, ran for ever — the
     * monthly roll kept opening cards and spawning tasks for a client who had
     * gone, and MRR kept counting them.
     */
    stop: (id: string, reason: string) =>
      post<{ success: boolean; retainer: any; closedMonths: string[]; removedMonths: string[] }>(
        `/retainers/${id}/stop`,
        { reason },
      ),
    getMonthCard: (id: string, month: string) =>
      get<{ success: boolean; monthCard: any }>(`/retainers/${id}/month-cards/${month}`),
    rollMonth: (month?: string) =>
      post<{ success: boolean; createdCards: number; createdTasks: number }>('/retainers/roll-month', { month }),
  },

  projects: {
    list: (params: Record<string, string> = {}) =>
      get<any>(`/projects?${new URLSearchParams(params)}`),
    get: (id: string) =>
      get<{ success: boolean; project: any }>(`/projects/${id}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; project: any; id?: string }>('/projects', body),
    update: (id: string, body: Record<string, unknown>) => patch(`/projects/${id}`, body),
    delete: (id: string) => del(`/projects/${id}`),
    /**
     * "Did we make money on that job", for the one-off work.
     *
     * Kept apart from `retainers.profitability` and never summed with it —
     * brief §8: retainer and one-time money are "reported split by Retainer and
     * One time, never summed into a single figure". A month of retainer
     * revenue and a project's whole contract value are different kinds of
     * number.
     */
    profitability: (params: Record<string, string> = {}) =>
      getFull<{
        rows: ProjectProfitRow[];
        totals: { delivered: ProjectProfitTotals; live: ProjectProfitTotals };
        atRisk: number;
      }>(`/projects/profitability?${new URLSearchParams(params)}`),
    trash: () => get<{ success: boolean; projects: any[] }>('/projects/trash'),
    restore: (id: string) => post<{ success: boolean }>(`/projects/${id}/restore`),
    updateMilestone: (id: string, milestoneId: string, status: string) =>
      patch<{ success: boolean; milestone: any }>(`/projects/${id}/milestones/${milestoneId}`, { status }),
    addMilestone: (id: string, body: { label: string; percent: number; amount: number }) =>
      post<{ success: boolean; milestone: any }>(`/projects/${id}/milestones`, body),
    editMilestone: (id: string, milestoneId: string, body: { label?: string; percent?: number; amount?: number }) =>
      patch<{ success: boolean; milestone: any }>(`/projects/${id}/milestones/${milestoneId}`, body),
    deleteMilestone: (id: string, milestoneId: string) =>
      del<{ success: boolean }>(`/projects/${id}/milestones/${milestoneId}`),
    createTask: (body: Record<string, unknown>) => post('/tasks', body),
    /** Only ever called with `{status: 'DONE'}` from the command palette's "Mark done" action. */
    updateTask: (id: string, body: Record<string, unknown>) => patchFull(`/tasks/${id}/status`, body),
  },

  allocations: {
    list: (month: string) =>
      get<{
        success: boolean;
        month: string;
        /** Whether the caller may see salary figures. Masked values come back
         *  as null, which is indistinguishable from a genuine zero. */
        canSeeFigures: boolean;
        members: {
          id: string; name: string; email: string; dept: string; preset: string;
          monthlyCost: number | null; totalPercent: number;
          capacityStatus: 'OVERALLOCATED' | 'FULL' | 'AVAILABLE'; isConfirmed: boolean;
          allocations: {
            id: string; workType: string; workId: string; monthCardId: string | null; projectId: string | null;
            percent: number; proposedPercent: number; salaryCost: number | null;
            confirmedAt: string | null; confirmedBy: { id: string; name: string } | null; jobTitle: string;
          }[];
        }[];
        summary: { totalMembers: number; fullyAllocated: number; availableCapacity: number; overallocated: number };
      }>(`/allocations?month=${month}`),
    bulkSave: (body: { userId: string; month: string; allocations: { workType: string; workId: string; monthCardId?: string | null; projectId?: string | null; percent: number; proposedPercent?: number }[] }) =>
      post<{ success: boolean; message: string }>('/allocations/bulk', body),
    confirm: (month: string, userIds?: string[]) =>
      post<{ success: boolean; confirmedCount: number }>('/allocations/confirm', { month, userIds }),
  },

  costs: {
    /** GET /costs returns `{success, data, costs, meta}` with `data`/`costs` the same array — the auto-unwrap resolves straight to that array, same as activities.list(). */
    list: (params: Record<string, string> = {}) =>
      get<any[]>(`/costs?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; cost: any }>('/costs', body),
    /** Confirms an auto-rolled recurring cost draft — see workers/recurringCost.cron.ts. */
    confirm: (id: string) => patch<{ success: boolean; cost: any }>(`/costs/${id}/confirm`),
    delete: (id: string) => del(`/costs/${id}`),
    trash: () => get<{ success: boolean; costs: any[] }>('/costs/trash'),
    restore: (id: string) => post<{ success: boolean }>(`/costs/${id}/restore`),
  },

  team: {
    capacity: (params: Record<string, string> = {}) =>
      get<{ success: boolean; departments: string[]; members: any[] }>(`/team/capacity?${new URLSearchParams(params)}`),
    /** Name + id only, for an owner picker — gated on nothing but being logged in, unlike capacity. */
    members: () =>
      get<{
        success: boolean;
        members: { id: string; name: string; designation: string | null; dept: string }[];
      }>('/team/members'),
    /**
     * One person with the work actually on them — every task, and the project
     * or retainer month it belongs to. The capacity list counts tasks and
     * never names one, which is why it could say somebody was at 333% and
     * nothing about what of.
     */
    get: (id: string) => get<{ success: boolean; member: any; tasks: any[] }>(`/team/${id}`),
  },



  activities: {
    /**
     * The backend's envelope carries the same array as both `data` and
     * `activities` — and `request()` unwraps to `payload.data` whenever it's
     * present, so this resolves to the bare array, not `{activities: [...]}`.
     */
    list: (params: Record<string, string>) => get<any[]>(`/activities?${new URLSearchParams(params)}`),
    /** `occurredAt` defaults to now but is editable — that is the point (§3.9). */
    log: (body: Record<string, unknown>) => post('/activities', body),
  },

  users: {
    list: () => get<Member[]>('/users'),
    /**
     * Emails the invitation, and returns the link either way.
     *
     * `emailed` says which happened. The link is always present because a screen
     * that hid it on the assumption delivery worked would leave an admin unable
     * to invite anybody the first time a mail server refused a connection.
     */
    invite: (body: { name: string; email: string; dept: string; preset: string }) =>
      postFull<{
        data: {
          user: { id: string; name: string; email: string; dept: string; preset: string; active: boolean };
          inviteToken: string;
          inviteLink: string;
          emailed: boolean;
        };
        message?: string;
      }>('/users/invite', body),
    /** An hour, not seven days — this is a way into a live account. */
    resetLink: (id: string) =>
      post<{ resetToken: string; link: string; expiresInMinutes: number } & Delivery>(
        `/users/${id}/reset-link`,
      ),
    /** Edits access (preset + extra permission switches) and monthly cost — setup.admin only. */
    /**
     * `active: false` is refused with a 409 while the person is still holding
     * company equipment. `force` is the second press — see DeactivateModal.
     */
    update: (
      id: string,
      body: {
        preset?: string;
        permissions?: string[];
        monthlyCost?: number;
        dept?: string;
        active?: boolean;
        force?: boolean;
      },
    ) =>
      patchFull<{
        data: { id: string; name: string; dept: string; preset: string; permissions: string[]; monthlyCost: unknown };
      }>(`/users/${id}`, body),
  },

  taskTemplates: {
    list: () =>
      get<{ success: boolean; templates: TaskTemplate[] }>('/task-templates'),
    create: (body: { name: string; items: TaskTemplateItem[] }) =>
      post<{ success: boolean; template: TaskTemplate }>('/task-templates', body),
    update: (id: string, body: { name: string; items: TaskTemplateItem[] }) =>
      patch<{ success: boolean; template: TaskTemplate }>(`/task-templates/${id}`, body),
    remove: (id: string) =>
      del<{ success: boolean }>(`/task-templates/${id}`),
    trash: () =>
      get<{ success: boolean; templates: TaskTemplate[] }>('/task-templates/trash'),
    restore: (id: string) =>
      post<{ success: boolean }>(`/task-templates/${id}/restore`),
  },

  profile: {
    get: () => get<Profile>('/profile'),
    update: (body: Record<string, unknown>) => patch<Partial<Profile>>('/profile', body),
    /** Every other session dies with the change, this one included. */
    setPassword: (body: { currentPassword?: string; newPassword: string }) =>
      post<{ signedOutEverywhere: boolean }>('/profile/password', body),
  },

  /**
   * One box over everything. What comes back is already filtered by role on the
   * server — quotations and invoices are absent for anyone below Admin.
   */
  search: (q: string) =>
    get<{
      companies: { id: string; name: string; status: string }[];
      deals: { id: string; title: string | null; company: { id: string; name: string }; stage: { name: string } }[];
      projects: { id: string; name: string; company: { name: string } }[];
      tasks: { id: string; title: string; context: string | null; href: string }[];
      quotes: { id: string; number: string; company: { name: string } }[];
      invoices: { id: string; number: string; company: { name: string } }[];
    }>(`/search?q=${encodeURIComponent(q)}`),

  invoices: {
    /**
     * Retainer months carrying no invoice — the billing work list.
     *
     * Distinct from `isAwaiting` in lib/invoice-state, which is about an
     * invoice awaiting PAYMENT. This is the step before: work finished and
     * never billed at all.
     */
    awaiting: () =>
      get<{
        success: boolean;
        rows: {
          id: string;
          month: string;
          companyId: string;
          companyName: string;
          revenue: number;
          status: string;
          closedAt: string | null;
          due: boolean;
          retainerStopped: boolean;
        }[];
        dueCount: number;
        dueTotal: number;
        upcomingCount: number;
      }>('/invoices/awaiting'),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; invoice: any }>('/invoices', body),
    recordPayment: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; payment: any; invoice: any; isFullySettled: boolean }>(`/invoices/${id}/payments`, body),
  },

  /**
   * The equipment register.
   *
   * `access` rides on the list and detail responses rather than being derived
   * on the client from `user.permissions`. The server is the one that decides,
   * and a second copy of that decision in the browser is a second thing to
   * keep in step — the exact failure the sidebar rewrite was about.
   */
  assets: {
    list: (params: Record<string, string> = {}) =>
      get<AssetListItem[]>(`/assets?${new URLSearchParams(params)}`),
    listFull: (params: Record<string, string> = {}) =>
      apiFull<{
        data: AssetListItem[];
        access: AssetAccess;
        /** Tab counts from the register, NOT from the rows returned. */
        counts: { all: number; out: number; repair: number; retired: number };
        meta: { total: number };
      }>('GET', `/assets?${new URLSearchParams(params)}`),
    summary: () => apiFull<{ data: AssetSummary; access: AssetAccess }>('GET', '/assets/summary'),
    outNow: () => get<AssetMovementRow[]>('/assets/out-now'),
    availability: (from: string, to: string) =>
      get<
        (AssetListItem & {
          available: boolean;
          busyUntil: string | null;
          busyWith: { id: string; name: string } | null;
          dueBackBeforeWindow: boolean;
        })[]
      >(
        `/assets/availability?from=${from}&to=${to}`,
      ),
    register: (fy?: string) =>
      get<AssetRegister>(`/assets/register${fy ? `?fy=${fy}` : ''}`),
    nextTag: (category: string) => get<{ tag: string }>(`/assets/next-tag?category=${category}`),
    get: (id: string) => apiFull<{ data: AssetDetail; access: AssetAccess }>('GET', `/assets/${id}`),
    create: (body: Record<string, unknown>) =>
      postFull<{ data: AssetListItem; warnings: string[] }>('/assets', body),
    /** `commit: false` reports what WOULD happen and writes nothing. */
    import: (body: { csv: string; commit: boolean }) =>
      post<{
        dryRun: boolean;
        willCreate?: number;
        created?: number;
        problems: { row: number; reason: string }[];
        preview?: { row: number; name: string; category: string; purchasePrice: number }[];
      }>('/assets/import', body),
    update: (id: string, body: Record<string, unknown>) => patch<AssetListItem>(`/assets/${id}`, body),
    remove: (id: string) => del<{ success: boolean }>(`/assets/${id}`),
    retire: (id: string, body: Record<string, unknown>) => post<AssetListItem>(`/assets/${id}/retire`, body),
    assign: (id: string, body: Record<string, unknown>) => post(`/assets/${id}/assign`, body),
    checkout: (id: string, body: Record<string, unknown>) => post(`/assets/${id}/checkout`, body),
    checkin: (id: string, body: Record<string, unknown>) => post(`/assets/${id}/return`, body),
    transfer: (id: string, body: Record<string, unknown>) => post(`/assets/${id}/transfer`, body),
    maintenance: (id: string, body: Record<string, unknown>) => post(`/assets/${id}/maintenance`, body),
    closeMaintenance: (id: string, mid: string, body: Record<string, unknown>) =>
      patch(`/assets/${id}/maintenance/${mid}`, body),
    heldBy: (userId: string) =>
      get<HeldAsset[]>(`/users/${userId}/assets`),
    trash: () => get<{ success: boolean; assets: AssetListItem[] }>('/assets/trash'),
    restore: (id: string) => post<{ success: boolean }>(`/assets/${id}/restore`),
  },

  notifications: {
    /** `total` is every alert this person may see; the feed itself is capped. */
    list: () =>
      get<{ notifications: AppNotification[]; unreadCount: number; total: number }>('/notifications'),
    markRead: (id: string) => patch(`/notifications/${id}/read`),
    markAllRead: () => patch('/notifications/read-all'),
  },

};

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format money for display.
 *
 * Takes the string the server sent. The conversion to a number happens only at
 * the very last moment, for `Intl`, and never round-trips back into a stored
 * value.
 */
export const formatMoney = (
  amount: string | number | null | undefined,
  currency = 'INR',
  locale = 'en-IN',
): string => {
  if (amount === null || amount === undefined || amount === '') return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount));
};

/** Dates are rendered in the ORGANISATION's timezone, never the browser's (§3.11). */
export const formatDate = (
  value: string | Date | null | undefined,
  timezone = 'Asia/Kolkata',
  locale = 'en-IN',
  includeYear = false,
): string => {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' } : {}),
  }).format(new Date(value));
};

/** What a company's status means, and what to do about it. */
export const COMPANY_STATUS: Record<CompanyStatus, { label: string; tone: string }> = {
  PROSPECT: { label: 'Prospect', tone: 'bg-subtle text-secondary border-border' },
  ACTIVE: { label: 'Active client', tone: 'bg-success-tint text-success border-success/30' },
  ONHOLD: { label: 'On hold', tone: 'bg-warning-tint text-warning-ink border-warning/30' },
  // A delivered project is a GOOD ending, so it is not styled as a loss (§3.2).
  PROJECT_COMPLETED: { label: 'Project completed', tone: 'bg-info-tint text-info border-info/30' },
  CHURNED: { label: 'Churned', tone: 'bg-danger-tint text-danger border-danger/30' },
};
