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

const postFull = <T>(e: string, body?: unknown) => full<T>('POST', e, body);
const patchFull = <T>(e: string, body?: unknown) => full<T>('PATCH', e, body);

// ── Types ────────────────────────────────────────────────────────────────────

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'SALES' | 'MEMBER';

/** The ladder. Each rung contains everything below it (§3.10). */
const RANK: Record<Role, number> = {
  MEMBER: 0,
  SALES: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
};

/**
 * Whether a role reaches a rung.
 *
 * Used ONLY to decide what to show. Hiding a button is not security — the server
 * enforces every rule regardless of what this returns (§5).
 */
export const atLeast = (role: Role | undefined, minimum: Role): boolean =>
  role ? RANK[role] >= RANK[minimum] : false;

export type CompanyStatus =
  | 'PROSPECT'
  | 'ACTIVE'
  | 'ONHOLD'
  | 'PROJECT_COMPLETED'
  | 'CHURNED';

export type StageKind = 'OPEN' | 'WON' | 'LOST';
export type ContractType = 'RETAINER' | 'PROJECT';
export type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';

export interface OrgConfig {
  organization: {
    id: string;
    name: string;
    currency: string;
    timezone: string;
    locale: string;
    dateFormat: string;
    fiscalYearStart: number;
    documentPrefix: string;
    state: string | null;
    gstNumber: string | null;
    website: string | null;
    phone: string | null;
    address: string | null;
    mailFromName: string | null;
    mailFromEmail: string | null;
    mailReplyTo: string | null;
    allowPasswordLogin: boolean;
  };
  /**
   * Whether this organisation can send email at all.
   *
   * A boolean rather than the settings themselves, because this payload goes to
   * every signed-in person and a Member has no reason to learn the mail server.
   * It is all a screen needs to choose between "emailed" and "copy this link".
   */
  mailConfigured: boolean;
  modules: Record<string, boolean>;
  stages: Stage[];
  lostReasons: { id: string; name: string }[];
  sources: { id: string; name: string }[];
  services: { id: string; name: string; defaultRate: string | null; unit: string | null }[];
  me: { userId: string; role: Role; roles: Role[] };
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

export interface BoardDeal {
  id: string;
  title: string | null;
  value: string | null;
  expectedCloseDate: string | null;
  company: { id: string; name: string; status: CompanyStatus; gstNumber?: string | null; billingAddress?: string | null; companySize?: string | null; };
  owner: { id: string; name: string; avatar: string | null } | null;
  priority: string;
  isOnHold: boolean;
  holdReason: string | null;
  blockedOn: string | null;
  daysInStage: number;
  isRotting: boolean;
}

export interface BoardColumn extends Stage {
  deals: BoardDeal[];
  total: string;
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
  owner: { id: string; name: string; avatar: string | null } | null;
  source: { id: string; name: string } | null;
  _count?: { deals: number; engagements: number; projects: number };
}

export interface Dashboard {
  work: {
    overdue: number;
    dueToday: number;
    awaitingMyReview: number;
    tasks: { id: string; title: string; dueDate: string | null; project: { id: string; name: string } | null }[];
  };
  clients: Partial<Record<CompanyStatus, number>>;
  pipeline?: {
    followUpsDue: { id: string; title: string | null; company: { id: string; name: string } }[];
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

export interface Member {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  designation: string | null;
  phone: string | null;
  status: UserStatus;
  role: Role;
  joiningDate: string;
  department?: { id: string; name: string } | null;
  projects?: MemberProject[];
  activeProjectsCount?: number;
  tasks?: MemberTask[];
  taskStats?: MemberTaskStats;
  signIn: SignIn;
  /** A PENDING account whose link has lapsed needs resending, not chasing. */
  inviteExpired: boolean;
}

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

export interface PmSummaryData {
  summary: {
    totalProjects: number;
    activeProjects: number;
    totalTasks: number;
    completedTasks: number;
    openTasks: number;
    overdueTasks: number;
    onTimeDeliveryRate: number;
    avgTurnaroundDays: number;
    velocityDeltaPercent: number;
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
  avgDaysToComplete: number;
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
  taskTypes: PmTaskTypeItem[];
  departments: PmDepartmentItem[];
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

export interface WinTerms {
  contractType: ContractType;
  startDate: string;
  endDate?: string | null;
  amount: string | number;
  billingFrequency: BillingFrequency;
  paymentTerms?: string | null;
}

// ── The API ──────────────────────────────────────────────────────────────────

export const api = {
  auth: {
    login: (email: string, password: string) =>
      post<{ user: unknown }>('/auth/login', { email, password }),
    loginWithGoogle: (idToken: string) =>
      post<{ user: unknown }>('/auth/google', { idToken }),
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
    post: <T = unknown>(endpoint: string, body?: unknown) => post<T>(`/config/${endpoint}`, body),
    patch: <T = unknown>(endpoint: string, body?: unknown) => patch<T>(`/config/${endpoint}`, body),
    delete: <T = unknown>(endpoint: string) => request<T>(`/config/${endpoint}`, { method: 'DELETE' }),
    nextNumber: (scope: 'QT' | 'INV') => get<{ number: string }>(`/config/next-number/${scope}`),
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
    setModule: (key: string, enabled: boolean) =>
      patch<{ key: string; enabled: boolean }>(`/config/modules/${key}`, { enabled }),
    auditLog: () => get<AuditEntry[]>('/config/audit-log'),
  },

  dashboard: {
    get: () => get<Dashboard>('/dashboard'),
  },

  companies: {
    list: (params: Record<string, string> = {}) =>
      get<Company[]>(`/companies?${new URLSearchParams(params)}`),
    get: (id: string) => get<Record<string, unknown>>(`/companies/${id}`),
    /** Ask before creating, so the warning arrives while somebody is still typing. */
    checkDuplicate: (body: { name: string; email?: string; phone?: string }) =>
      post<{ action: 'CREATE' | 'BLOCK' | 'WARN'; matches?: { id: string; name: string; reason: string }[] }>(
        '/companies/check-duplicate',
        body,
      ),
    create: (body: Record<string, unknown>) => post<Company>('/companies', body),
    update: (id: string, data: Partial<Company>) => patch<Company>(`/companies/${id}`, data),
    retire: (id: string) => request<{ archived: true }>(`/companies/${id}`, { method: 'DELETE' }),
    addContact: (companyId: string, data: any) => post(`/companies/${companyId}/contacts`, data),
    updateContact: (companyId: string, contactId: string, data: any) =>
      patch(`/companies/${companyId}/contacts/${contactId}`, data),
    deleteContact: (companyId: string, contactId: string) =>
      del(`/companies/${companyId}/contacts/${contactId}`),
    reviseEngagement: (id: string, data: { amount: string; reason?: string | null }) =>
      post(`/revenue/engagements/${id}/terms`, data),
  },

  deals: {
    board: () => get<{ pipelineId: string; columns: BoardColumn[] }>('/deals/board'),
    get: (id: string) => get<Record<string, unknown>>(`/deals/${id}`),
    create: (body: Record<string, unknown>) => post<{ id: string }>('/deals', body),
    update: (id: string, body: Record<string, unknown>) => patch(`/deals/${id}`, body),
    /** Deliberately cannot win — winning needs terms and goes through `win`. */
    moveStage: (id: string, stageId: string, customFields?: Record<string, unknown>) =>
      post(`/deals/${id}/stage`, { stageId, customFields }),
    win: (id: string, terms: WinTerms) =>
      post<{ engagementId: string; companyStatus: CompanyStatus }>(`/deals/${id}/win`, terms),
    lose: (id: string, lostReasonId: string, note?: string) =>
      post(`/deals/${id}/lose`, { lostReasonId, note }),
    hold: (id: string, reason?: string) => post(`/deals/${id}/hold`, { reason }),
    unhold: (id: string) => post(`/deals/${id}/unhold`),
  },

  quotes: {
    list: (params: Record<string, string> = {}) =>
      get<Record<string, unknown>[]>(`/quotes?${new URLSearchParams(params)}`),
    get: (id: string) => get<Record<string, unknown>>(`/quotes/${id}`),
    /** The running total the form shows is the SERVER's arithmetic, not the browser's. */
    preview: (body: Record<string, unknown>) =>
      post<{ subtotal: string; cgst: string; sgst: string; igst: string; total: string; lines: unknown[] }>(
        '/quotes/preview',
        body,
      ),
    create: (body: Record<string, unknown>) => post<{ id: string; number: string }>('/quotes', body),
    /**
     * `via` separates a send Flowzen witnessed from one a person is asserting.
     *
     * `FLOWZEN_EMAIL` actually sends, and the quotation moves to SENT only if the
     * message left — a 422 comes back otherwise and nothing changes. Every other
     * value records what somebody says they did.
     */
    send: (
      id: string,
      body: { via?: string; sentAt?: string; to?: string | null; note?: string | null } = {},
    ) => postFull<{ data: { emailed: boolean; to?: string }; message?: string }>(`/quotes/${id}/send`, body),
    /** `acceptedAt` is when the CLIENT said yes, not when this was typed (§3.12). */
    accept: (id: string, body: { via: string; acceptedAt?: string; note?: string }) =>
      post<{ promptWin: boolean; winDefaults: Partial<WinTerms> }>(`/quotes/${id}/accept`, body),
    decline: (id: string, reason: string, declinedAt?: string) =>
      post(`/quotes/${id}/decline`, { reason, declinedAt }),
    awaitingReply: () => get<Record<string, unknown>[]>('/quotes/awaiting-reply'),
  },

  revenue: {
    engagements: () => get<Record<string, unknown>[]>('/revenue/engagements'),
    attention: () => get<{ expiring: unknown[]; dueForReview: unknown[] }>('/revenue/engagements/attention'),
    changeTerms: (id: string, body: Record<string, unknown>) =>
      post(`/revenue/engagements/${id}/terms`, body),
    pause: (id: string, reason: string) => post(`/revenue/engagements/${id}/pause`, { reason }),
    resume: (id: string, reason: string) => post(`/revenue/engagements/${id}/resume`, { reason }),
    end: (id: string, reason: string, on?: string) => post(`/revenue/engagements/${id}/end`, { reason, on }),
    dueForBilling: () => get<Record<string, unknown>[]>('/revenue/billing/due'),
    raiseInvoice: (engagementId: string, body: Record<string, unknown> = {}) =>
      post(`/revenue/engagements/${engagementId}/invoice`, body),
    invoices: (params: Record<string, string> = {}) =>
      get<Record<string, unknown>[]>(`/revenue/invoices?${new URLSearchParams(params)}`),
    sendInvoice: (id: string) => post(`/revenue/invoices/${id}/send`),
    recordPayment: (body: Record<string, unknown>) => post('/revenue/payments', body),
    summary: (params: Record<string, string> = {}) =>
      get<Record<string, string>>(`/revenue/summary?${new URLSearchParams(params)}`),
  },

  projects: {
    list: (params: Record<string, string> = {}) =>
      get<Record<string, unknown>[]>(`/projects?${new URLSearchParams(params)}`),
    get: (id: string) => get<Record<string, unknown>>(`/projects/${id}`),
    create: (body: Record<string, unknown>) => post('/projects', body),
    update: (id: string, body: Record<string, unknown>) => patch(`/projects/${id}`, body),
    allTasks: (params: Record<string, string> = {}) =>
      get<Record<string, unknown>[]>(`/projects/tasks/all?${new URLSearchParams(params)}`),
    myTasks: () => get<Record<string, unknown>[]>('/projects/tasks/mine'),
    createTask: (body: Record<string, unknown>) => post('/projects/tasks', body),
    updateTask: (id: string, body: Record<string, unknown>) => patch(`/projects/tasks/${id}`, body),
    deleteTask: (id: string) => del(`/projects/tasks/${id}`),
    addMember: (projectId: string, userId: string) => post(`/projects/${projectId}/members`, { userId }),
    removeMember: (projectId: string, userId: string) => del(`/projects/${projectId}/members/${userId}`),
  },

  departments: {
    list: () => get<Record<string, unknown>[]>('/departments'),
    create: (body: Record<string, unknown>) => post('/departments', body),
    update: (id: string, body: Record<string, unknown>) => patch(`/departments/${id}`, body),
    delete: (id: string) => del(`/departments/${id}`),
    addMember: (departmentId: string, userId: string) => post(`/departments/${departmentId}/members`, { userId }),
    removeMember: (departmentId: string, userId: string) => del(`/departments/${departmentId}/members/${userId}`),
  },

  activities: {
    list: (params: Record<string, string>) =>
      get<Record<string, unknown>[]>(`/activities?${new URLSearchParams(params)}`),
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
    invite: (body: { email: string; name: string; role: Role; designation?: string | null }) =>
      postFull<{ data: { user: Member; inviteToken: string } & Delivery; message?: string }>(
        '/users/invite',
        body,
      ),
    resendInvite: (id: string) =>
      post<{ inviteToken: string } & Delivery>(`/users/${id}/resend-invite`),
    /** An hour, not seven days — this is a way into a live account. */
    resetLink: (id: string) =>
      post<{ resetToken: string; expiresInMinutes: number } & Delivery>(`/users/${id}/reset-link`),
    /** Super Admin is TRANSFERRED — the outgoing holder becomes an Admin (§3.10). */
    setRole: (id: string, role: Role) =>
      patchFull<{ data: { role: Role }; message?: string }>(`/users/${id}/role`, { role }),
    update: (id: string, body: Record<string, unknown>) => patch<Member>(`/users/${id}`, body),
    deactivate: (id: string) => post(`/users/${id}/deactivate`),
    activate: (id: string) => post(`/users/${id}/activate`),
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
      deals: { id: string; title: string | null; company: { name: string }; stage: { name: string } }[];
      projects: { id: string; name: string; company: { name: string } }[];
      tasks: { id: string; title: string; context: string; href: string }[];
      quotes: { id: string; number: string; company: { name: string } }[];
      invoices: { id: string; number: string; company: { name: string } }[];
    }>(`/search?q=${encodeURIComponent(q)}`),

  notifications: {
    list: () => get<{ notifications: AppNotification[]; unreadCount: number }>('/notifications'),
    markRead: (id: string) => patch(`/notifications/${id}/read`),
    markAllRead: () => patch('/notifications/read-all'),
  },

  reports: {
    revenue: () => get<Record<string, unknown>>('/reports/revenue'),
    pipeline: () => get<Record<string, unknown>>('/reports/pipeline'),
    clients: () => get<Record<string, unknown>>('/reports/clients'),
    team: () => get<Record<string, unknown>[]>('/reports/team'),
    pmSummary: (params: Record<string, string> = {}) =>
      get<PmSummaryData>(`/reports/pm/summary?${new URLSearchParams(params)}`),
    pmProjects: (params: Record<string, string> = {}) =>
      get<PmProjectReport[]>(`/reports/pm/projects?${new URLSearchParams(params)}`),
    pmTeamWorkload: (params: Record<string, string> = {}) =>
      get<PmTeamWorkloadReport[]>(`/reports/pm/team-workload?${new URLSearchParams(params)}`),
    pmTaskTypes: (params: Record<string, string> = {}) =>
      get<PmTaskTypesData>(`/reports/pm/task-types?${new URLSearchParams(params)}`),
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
  ACTIVE: { label: 'Active client', tone: 'bg-green-50 text-green-700 border-green-200' },
  ONHOLD: { label: 'On hold', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  // A delivered project is a GOOD ending, so it is not styled as a loss (§3.2).
  PROJECT_COMPLETED: { label: 'Project completed', tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  CHURNED: { label: 'Churned', tone: 'bg-red-50 text-red-700 border-red-200' },
};
