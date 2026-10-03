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

import { loginHref } from './next-path';
import { announceTaskWrite } from './task-sync';
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
      /**
       * Forget who we thought was signed in, BEFORE navigating.
       *
       * The session lives in an httpOnly cookie, but the app decides whether to
       * render a signed-in shell by reading `flowzen-user` out of localStorage.
       * Nothing cleared it here, so an expired cookie left the two disagreeing:
       * the layout kept rendering as signed in, `me()` failed into an empty
       * catch, and every request 401'd — which is what put a wall of 401s in
       * the console and made the app look signed in when it was not.
       *
       * The one client that did clear it was `lib/api.ts`, which nothing has
       * imported for a long time. This is the live one.
       */
      try {
        localStorage.removeItem('flowzen-user');
      } catch {
        // Private mode, or storage disabled. The redirect below still stands.
      }
      // With the page it came from, so signing in goes back there — an
      // approver's WhatsApp link survives an expired session.
      window.location.href = loginHref();
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

  // A task changed: every screen showing one is told (lib/task-sync).
  if ((options.method ?? 'GET') !== 'GET' && endpoint.startsWith('/tasks')) announceTaskWrite();

  return (payload.data !== undefined ? payload.data : payload) as T;
}

/**
 * The requests a Zen card may send: task changes and approvals, proposal
 * flags, won and lost, and booking or moving an event. Nothing else — not a
 * delete, not a cost, not a document.
 */
const ZEN_ALLOWED: [ZenRequest['method'], RegExp][] = [
  ['PATCH', /^\/tasks\/[\w-]+$/],
  ['PATCH', /^\/tasks\/[\w-]+\/status$/],
  ['POST', /^\/tasks\/[\w-]+\/(approve|request-changes|submit-review)$/],
  ['PATCH', /^\/proposals\/[\w-]+\/stage$/],
  ['POST', /^\/proposals\/[\w-]+\/(win|lose)$/],
  ['POST', /^\/calendar\/events$/],
  ['PATCH', /^\/calendar\/events\/[\w-]+$/],
];
export const zenRequestAllowed = (req: ZenRequest | null | undefined): boolean =>
  Boolean(req && ZEN_ALLOWED.some(([method, path]) => req.method === method && path.test(req.path)));

const get = <T>(e: string) => request<T>(e);
const post = <T>(e: string, body?: unknown) => request<T>(e, { method: 'POST', body });
const patch = <T>(e: string, body?: unknown) => request<T>(e, { method: 'PATCH', body });
const put = <T>(e: string, body?: unknown) => request<T>(e, { method: 'PUT', body });
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
/**
 * A task Zen has filled in, waiting for somebody to press Create.
 *
 * Two halves on purpose. `shows` is what the person reads before confirming;
 * `body` is what gets posted to `POST /tasks`, unchanged, the same call the
 * task modal makes. Zen never writes a row itself — that click is the write,
 * which is also the one thing an instruction hidden in a task note cannot get
 * past.
 */
export type TaskDraft = {
  body: {
    title: string;
    dueDate: string;
    workType: 'MONTH_CARD' | 'PROJECT' | 'INTERNAL';
    workId?: string;
    monthCardId?: string;
    retainerProjectId?: string;
    internalProjectId?: string;
    projectId?: string;
    assigneeId: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
    notes?: string;
  };
  shows: {
    title: string;
    client: string | null;
    belongsTo: string;
    assignedTo: string;
    due: string;
    priority: string;
    notes: string | null;
  };
};

/**
 * A job Zen has prepared (Zen Plan 4) — the same shape the server's
 * `services/zenJobs.ts` builds. Every step holds the exact request for an
 * endpoint that already exists; the panel sends it, on your own session, only
 * when you press that step. Money documents are forms that open filled in.
 */
export type ZenRequest = { method: 'POST' | 'PATCH'; path: string; body?: Record<string, unknown> };
export type ZenItem = {
  label: string;
  detail?: string;
  request?: ZenRequest;
  options?: { label: string; request: ZenRequest | null }[];
  choice?: number;
};
export type ZenForm = {
  name: 'proposalProforma' | 'monthProforma' | 'monthInvoice' | 'retainer' | 'project';
  path: string;
  values: Record<string, unknown>;
};
export type ZenStep =
  | { kind: 'post'; label: string; detail?: string; items: ZenItem[]; after?: number[]; doneText?: string }
  | { kind: 'form'; label: string; detail?: string; form: ZenForm; after?: number[] }
  | { kind: 'link'; label: string; detail?: string; href: string }
  | { kind: 'note'; label: string; detail?: string };
export type ZenCard =
  | { type: 'plan'; title: string; summary?: string[]; warnings?: string[]; notes?: string[]; link?: string; steps: ZenStep[] }
  | {
      type: 'message';
      title: string;
      to: { name: string; role: string; phone: string | null; email: string | null } | null;
      subject: string;
      text: string;
      whatsapp: string;
      mailto: string;
      note?: string;
      link?: string;
    };
/** What was recorded for a step once it was carried out, keyed "card.step". */
export type ZenStepsDone = Record<string, { at?: string; result?: string | null }>;

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
    /** §14, and what the board's column headers print. WON is always 100. */
    stageProbabilities?: Record<string, number>;
    /**
     * Whether an AI key is on file — never the key itself.
     *
     * The Settings screen needs to know if one is set so it can say so and
     * offer to replace it. It does not need the key, and sending it would put
     * a live API key in every signed-in browser.
     *
     * The provider, model and address are not secrets and Settings has to show
     * them, so those do come back.
     */
    aiConfigured?: boolean;
    aiProvider?: string;
    aiModel?: string;
    aiBaseUrl?: string | null;
    /** §14's working calendar. setup.admin only. */
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: number[];
    holidays?: string[];
    /** Settings → Integrations (setup.admin): the server has Google keys, and the switch. */
    googleCalendarConfigured?: boolean;
    googleCalendarEnabled?: boolean;
    /** …and phone notifications: the server has VAPID keys, and the switch. */
    pushConfigured?: boolean;
    pushEnabled?: boolean;
    /**
     * The departments a person can belong to.
     *
     * Sent to everyone, because the member list groups by department and the
     * edit form offers them — any screen showing a team needs the list, not
     * just the one that edits it.
     */
    departments?: string[];
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
  me: {
    userId: string;
    preset?: string;
    permissions?: string[];
    /** The task types this person approves. Empty for almost everybody. */
    approverFor?: string[];
    /** The task types whose stuck approvals escalate to this person. */
    escalateFor?: string[];
  };
  documentSettings?: DocumentSettings;
}

// ── Task approvals ──────────────────────────────────────────────────────────

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED';

/** The last round of a task's approval, as task lists carry it. */
export interface LastReview {
  round: number;
  decision: ReviewDecision | null;
  feedback: string | null;
  decidedAt: string | null;
  submittedAt: string;
  /** The approvers were reminded — the reminder time passed with no answer. */
  remindedAt?: string | null;
  /** It escalated; `escalatedTo` names who to. */
  escalatedAt?: string | null;
  escalatedTo?: PersonRef[];
  /** Who decided it. */
  decidedBy?: PersonRef | null;
  /** Changes other approvers added after it was sent back. */
  notes?: ReviewNote[];
}

/** A change another approver added to a round somebody sent back. */
export interface ReviewNote {
  id?: string;
  feedback: string;
  createdAt: string;
  author: PersonRef;
}

export type PersonRef = { id: string; name: string };

/** One round: who sent it and what with, and how it was decided. */
export interface TaskReviewRound {
  id: string;
  round: number;
  submittedBy: PersonRef;
  submittedAt: string;
  link: string | null;
  note: string | null;
  decision: ReviewDecision | null;
  decidedBy: PersonRef | null;
  decidedAt: string | null;
  feedback: string | null;
  /** The other approvers' changes, when it was sent back. */
  notes?: ReviewNote[];
  remindedAt: string | null;
  escalatedAt: string | null;
}

/** GET /tasks/:id/reviews — a task's rounds, and what the viewer can do. */
export interface TaskReviewsResponse {
  success: boolean;
  task: {
    id: string;
    title: string;
    status: string;
    taskType: string | null;
    taskTypeLabel: string | null;
    needsApproval: boolean;
    priority: string;
    dueDate: string;
    dueTime?: string | null;
    clientName: string;
    projectName: string | null;
    assignees: PersonRef[];
    creator: PersonRef | null;
  };
  reviews: TaskReviewRound[];
  /** Who the waiting round escalated to — empty until it has. */
  escalatedTo: PersonRef[];
  viewer: {
    isApprover: boolean;
    /** An escalation person for this type — can decide once it has escalated. */
    isEscalation: boolean;
    canApprove: boolean;
    approveRefusal: string | null;
    canSubmit: boolean;
    /** Sent back, and this approver can add their own changes to it. */
    canAddChanges?: boolean;
  };
  waitingMinutes: number | null;
  waitingText: string | null;
}

/** One task waiting for the caller's approval. */
export interface ApprovalItem {
  id: string;
  title: string;
  taskType: string | null;
  taskTypeLabel: string | null;
  priority: string;
  dueDate: string;
  clientName: string;
  projectName: string | null;
  assignees: PersonRef[];
  creator: PersonRef | null;
  review: {
    id: string;
    round: number;
    link: string | null;
    note: string | null;
    submittedAt: string;
    submittedBy: PersonRef;
    remindedAt: string | null;
    escalatedAt: string | null;
  };
  /** In the queue because it escalated to them, not because they approve the type. */
  asEscalation: boolean;
  waitingMinutes: number;
  waitingText: string;
}

/** A task somebody sent back, still with the editor — where the other approvers add theirs. */
export interface SentBackItem {
  id: string;
  title: string;
  taskType: string | null;
  taskTypeLabel: string | null;
  clientName: string;
  projectName: string | null;
  assignees: PersonRef[];
  review: {
    id: string;
    round: number;
    link: string | null;
    decidedBy: PersonRef | null;
    decidedAt: string | null;
    feedback: string | null;
    notes: ReviewNote[];
  };
}

/** Settings → Approvals: who approves each task type. */
export type ApproversByType = Record<string, PersonRef[]>;

/** Team → Approvals: where approvals get stuck. Minutes are working minutes. */
export interface ApprovalsReport {
  success: boolean;
  period: { from: string; to: string; days: 7 | 30 };
  /** Decided within this is on time — the org's reminder time. */
  onTimeMinutes: number;
  byType: {
    /** The first of `taskTypes` — types sharing one approver list are one card. */
    taskType: string;
    taskTypes: string[];
    /** Every task type shares this list — the card is "All work". */
    allWork: boolean;
    approvers: PersonRef[];
    submitted: number;
    decided: number;
    approved: number;
    changesRequested: number;
    medianDecisionMinutes: number | null;
    onTime: number;
    escalated: number;
    waitingNow: number;
    oldestWaitingMinutes: number | null;
    anyEscalated: boolean;
  }[];
  byPerson: {
    user: PersonRef;
    taskTypes: string[];
    approved: number;
    changesRequested: number;
    medianDecisionMinutes: number | null;
    afterEscalation: number;
    /** Changes added to rounds somebody else sent back. */
    changesAdded?: number;
  }[];
  waitingNow: {
    taskId: string;
    title: string;
    clientName: string;
    taskType: string;
    round: number;
    /** Which video it is — context, never counted. */
    editorName: string;
    submittedAt: string;
    waitingMinutes: number;
    remindedAt: string | null;
    escalatedAt: string | null;
  }[];
}

/** Settings → Approvals, whole: the lists per type, and the org's two timings (working minutes). */
export interface ApprovalSettings {
  success: boolean;
  approvers: ApproversByType;
  escalation: ApproversByType;
  remindMinutes: number;
  escalateMinutes: number;
}

/** What a proforma or invoice PDF puts on itself — the letterhead a business actually has, not fixed values baked into a template. */
/** One thing the seller block still needs, and which Settings tab owns it. */
export interface SellerGap {
  key: string;
  label: string;
  where: string;
  /** `required` blocks a tax invoice from printing at all. */
  severity: 'required' | 'recommended';
}

export interface DocumentSettings {
  /** Worked out server-side by the same rule the PDF renderer applies. */
  gaps: SellerGap[];
  contactEmail: string | null;
  gstStateCode: string | null;
  /** CR-02 §2 — the seller block, entered once and printed on every document. */
  legalName: string | null;
  address: string | null;
  stateName: string | null;
  gstNumber: string | null;
  pan: string | null;
  declarationText: string | null;
  /** A data URI, or null. Large enough that no screen should render it in a list. */
  signatureImage: string | null;
  /** The HSN/SAC codes this business bills under, offered on every line item. */
  sacCodes: string[];
  /** Whether documents print "For <legal name> / Authorised Signatory" at the foot. */
  showSignatureBlock: boolean;
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
 * One row of a proforma or invoice items table (CR-02 §5).
 *
 * `serialNo` and `amount` are absent on the way OUT to the server: the
 * position in the array is the serial number, and the amount is units x unit
 * cost. Sending either would let a document disagree with its own columns.
 */
export interface DocumentLineItemInput {
  particulars: string;
  units: number;
  unitCost: number;
  hsnSac?: string | null;
}

/** The same row as it comes back, with what the server worked out. */
export interface DocumentLineItem extends DocumentLineItemInput {
  id: string;
  serialNo: number;
  amount: number;
  gstRate: number;
}

/** CR-02 §4 — an open label/value pair, as many as the document needs. */
export interface DocumentCustomField {
  label: string;
  value: string;
}

/**
 * CR-02 §4. Its own field, defaulted from the buyer and always editable —
 * this, not the buyer's GSTIN, is what decides CGST+SGST against IGST.
 */
export interface PlaceOfSupply {
  state?: string | null;
  code?: string | null;
}

/**
 * What the send form opens with (CR-02 §10).
 *
 * The subject and the note are drafts, not a message already on its way:
 * an email to a client gets read by a person before it is sent.
 */
/**
 * A named piece of work inside a retainer — a campaign, a film, an always-on
 * stream. Carries no money on purpose: the retainer is billed monthly through
 * its month cards, so a value here would be the same work counted twice.
 */
export interface RetainerProject {
  id: string;
  name: string;
  /** Both nullable. A null end date is what ongoing means. */
  startDate: string | null;
  endDate: string | null;
  status: 'ACTIVE' | 'DONE';
  description: string | null;
  owner: { id: string; name: string; designation: string | null } | null;
  /**
   * The one every retainer has, and where its monthly work lands.
   *
   * A retainer task must name a project, so something has to catch the
   * template tasks the roll spawns on the 1st. Created with the retainer, and
   * refused when somebody tries to delete it.
   */
  isDefault?: boolean;
  _count?: { tasks: number };
  /**
   * How the work inside it is going. The list of projects is the way into a
   * retainer now rather than a caption above it, so a row has to say more than
   * its name. Cancelled tasks are excluded from every figure but `cancelled`,
   * and `donePercent` is null when there is nothing to be a share of.
   */
  taskCounts?: {
    total: number;
    done: number;
    open: number;
    late: number;
    cancelled: number;
    donePercent: number | null;
  };
  /** The months this project's tasks actually land in, oldest first. */
  months?: string[];
}

export interface DocumentEmailDefaults {
  number: string;
  subject: string;
  message: string;
  /** Everyone on the company record with an email, payer first. */
  recipients: { name: string; email: string; role: string }[];
  to: string | null;
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

/**
 * A named piece of the studio's own work.
 *
 * It groups internal tasks and nothing else — no client, no value, no invoice.
 * Deliberately: there is no cost column pointing at one, so it cannot turn into
 * something that gets billed.
 */
export interface InternalProject {
  id: string;
  name: string;
  description: string | null;
  owner: { id: string; name: string } | null;
  status: 'ACTIVE' | 'DONE';
  taskCounts: { total: number; done: number; open: number; late: number };
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
  dueTime?: string | null;
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
  /** The team they sit in. Read-only here — an admin sets it. */
  dept: string | null;
  /** What the app lets them do — EMPLOYEE / HEAD / BD / ACCOUNTS / MANAGEMENT. */
  preset: string | null;
  phone: string | null;
  joiningDate: string;
  role: Role;
  organization: { id: string; name: string; allowPasswordLogin: boolean };
  signIn: SignIn;
}

/** When a retainer's months are billed. */
export type RetainerBilling = 'IN_ADVANCE' | 'IN_ARREARS';

/**
 * Where a retainer month's billing has got to, and so what comes next.
 *
 * PROFORMA nothing asked for yet · INVOICE proforma out, tax invoice next ·
 * PAYMENT invoiced, waiting for the money · DONE paid · NOT_YET billed after
 * the month and the month is still running.
 */
export type BillingStep = 'PROFORMA' | 'INVOICE' | 'PAYMENT' | 'DONE' | 'NOT_YET';

export interface BillingProforma {
  id: string;
  number: string;
  status: 'UNPAID' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  /** Before GST. */
  amount: number;
  /** With GST. */
  total: number;
  raisedAt: string;
  validTill: string;
}

export interface BillingInvoice {
  id: string;
  number: string;
  status: string;
  amount: number;
  /** The GST inside `amount`, when it was recorded. */
  gstAmount?: number | null;
  raisedAt?: string;
  dueAt: string;
  /** Received so far. */
  paid: number;
}

export interface RetainerBillingRow {
  monthCardId: string;
  month: string;
  /** Before the month asked for — still owed. */
  earlier: boolean;
  retainerId: string;
  retainerStopped: boolean;
  companyId: string;
  companyName: string;
  billing: RetainerBilling;
  fee: number;
  gstPercent: number | null;
  proforma: BillingProforma | null;
  invoice: BillingInvoice | null;
  step: BillingStep;
}

export interface RetainerBillingResponse {
  success: boolean;
  month: string;
  thisMonth: string;
  rows: RetainerBillingRow[];
  summary: {
    toRaise: number;
    awaitingInvoice: number;
    awaitingPayment: number;
    done: number;
    notYet: number;
    outstanding: number;
  };
}

/**
 * One line of the activity log, already put into words by the server
 * (services/activityLog.ts): "{actor} {action} {subject}", then what changed.
 */
export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  /** Who to name when no signed-in person did it. */
  nobody: 'Flowzen' | 'Someone';
  area: string;
  action: string;
  subject: { label: string; context: string | null; href: string | null; gone: boolean } | null;
  detail: string[];
  entityType: string;
  verb: string;
}

export interface AuditPage {
  success: boolean;
  entries: AuditEntry[];
  total: number;
  page: number;
  pages: number;
  people: { id: string; name: string; active: boolean }[];
  areas: { key: string; label: string }[];
}

export interface AuditFilters {
  page?: number;
  limit?: number;
  /** A person's id, or `system`. */
  actor?: string;
  area?: string;
  /** YYYY-MM-DD, in the organisation's own days. */
  from?: string;
  to?: string;
  q?: string;
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
  /** Shoots it is planned for, coming up. A plan, not a checkout. */
  reservations?: AssetReservationRow[];
}

export interface AssetReservationRow {
  id: string;
  eventId: string;
  title: string;
  kind: CalendarEventKind;
  startsAt: string;
  endsAt: string;
  /** "Fri 9 Oct 10:00–14:00" on the studio's clock. */
  when: string;
  people: { id: string; name: string }[];
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

  assistant: {
    /** What this organisation's key can actually call — so Settings offers a list, not a guess. */
    models: () => get<{ success: boolean; models: string[] }>('/assistant/models'),
    /**
     * Which providers exist, with each one's defaults.
     *
     * Fetched rather than written into the page so Settings and the server
     * cannot disagree about the list — adding an adapter should not mean
     * editing a dropdown here as well.
     */
    providers: () =>
      get<{
        success: boolean;
        providers: {
          id: string;
          label: string;
          defaultModel: string;
          defaultBaseUrl: string;
          needsBaseUrl: boolean;
        }[];
      }>('/assistant/providers'),
    /**
     * Every conversation this person has had with Zen, newest first.
     *
     * Per person on the server — a thread belongs to whoever had it, and an id
     * from somebody else reads as not found rather than as a refusal.
     */
    threads: () =>
      get<{ success: boolean; threads: { id: string; title: string | null; updatedAt: string; _count: { messages: number } }[] }>(
        '/assistant/threads',
      ),
    thread: (id: string) =>
      get<{ success: boolean; thread: { id: string; title: string | null; messages: any[] } }>(`/assistant/threads/${id}`),
    removeThread: (id: string) => del(`/assistant/threads/${id}`),
    /** Marks a draft as acted on, so reopening does not offer to create it twice. */
    markActed: (messageId: string, taskId?: string) =>
      post(`/assistant/messages/${messageId}/acted`, taskId ? { taskId } : {}),
    /** Records one step of a prepared job as carried out, with what came back. */
    markStep: (messageId: string, step: string, result: string) =>
      post(`/assistant/messages/${messageId}/acted`, { step, result }),
    /**
     * Sends one step's request — a card's change — on your own session.
     *
     * Only the endpoints a prepared job may use get through, so a stored card
     * can never be turned into a request to anything else.
     */
    sendStep: (req: ZenRequest) => {
      if (!zenRequestAllowed(req)) return Promise.reject(new ApiError('Zen cannot make that change.', 400));
      return req.method === 'PATCH' ? patch(req.path, req.body ?? {}) : post(req.path, req.body ?? {});
    },
    /** What Zen has learned about how you work — readable, and deletable. */
    memory: () =>
      get<{ success: boolean; memories: { id: string; text: string; createdAt: string }[] }>('/assistant/memory'),
    forget: (id: string) => del(`/assistant/memory/${id}`),

    /** Asks about the month's money. The key lives on the server; this never sees it. */
    ask: (question: string, month?: string) =>
      post<{ success: boolean; answer: string; model: string; month: string }>('/assistant/ask', {
        question,
        ...(month ? { month } : {}),
      }),
    /**
     * The same question, answered as it is written.
     *
     * Not `post`, because that reads the whole body before returning — which
     * is the thing streaming exists to avoid. `onPiece` is called with each
     * fragment as it lands; the promise settles when the answer is finished.
     */
    askStreaming: async (
      question: string,
      opts: {
        history?: { from: 'you' | 'assistant'; text: string }[];
        month?: string;
        signal?: AbortSignal;
        /** The thread to continue. Omitted starts a new one. */
        conversationId?: string;
        /**
         * Where the asker is standing — ids and a route, never the page's own
         * data. Zen resolves them with its own tools, so a screen cannot hand
         * it something the person was not allowed to read.
         */
        page?: Record<string, string | undefined>;
        /** The thread this landed in, sent before the first token. */
        onThread?: (conversationId: string) => void;
        /** The stored message id, once the exchange is saved. */
        onSaved?: (messageId: string) => void;
        onPiece: (text: string) => void;
        /** A muted line under the answer — it hit the length ceiling and was cut short. */
        onNote?: (text: string) => void;
        /** Everything said so far is replaced by this — Zen declined the question. */
        onReplace?: (text: string) => void;
        /** What Zen went to look at, so the wait has a reason on screen. */
        onTool?: (name: string) => void;
        /**
         * A task Zen has filled in for you to check.
         *
         * Nothing has been created at this point. The row appears when the
         * panel posts `draft.body` to `POST /tasks` — the same call the task
         * modal makes, under the same session — which is why Zen can never put
         * work on the board that you did not look at first.
         */
        onDraft?: (draft: TaskDraft) => void;
        /** A prepared job — a plan of steps, or a message to send yourself. Nothing has happened yet. */
        onCard?: (card: ZenCard) => void;
      },
    ): Promise<void> => {
      const res = await fetch(`${API_URL}/assistant/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
        body: JSON.stringify({
          question,
          ...(opts.history ? { history: opts.history } : {}),
          ...(opts.month ? { month: opts.month } : {}),
          ...(opts.conversationId ? { conversationId: opts.conversationId } : {}),
          ...(opts.page ? { page: opts.page } : {}),
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Zen could not answer (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let failure: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Events are separated by a blank line; a chunk can split one in half,
        // so whatever is left after the last separator waits for more.
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const block of events) {
          const nameLine = block.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          const name = nameLine?.slice(6).trim();
          const data = JSON.parse(dataLine.slice(5).trim()) as {
            text?: string;
            error?: string;
            name?: string;
            draft?: TaskDraft;
            card?: ZenCard;
            conversationId?: string;
            messageId?: string;
          };
          if (name === 'piece' && data.text) opts.onPiece(data.text);
          if (name === 'note' && data.text) opts.onNote?.(data.text);
          if (name === 'replace' && data.text) opts.onReplace?.(data.text);
          if (name === 'tool' && data.name) opts.onTool?.(data.name);
          if (name === 'draft' && data.draft) opts.onDraft?.(data.draft);
          if (name === 'card' && data.card) opts.onCard?.(data.card);
          // Sent before the first token, so the panel holds the thread even if
          // the answer then fails — the next question continues it rather than
          // opening another.
          if (name === 'thread' && data.conversationId) opts.onThread?.(data.conversationId);
          if (name === 'done' && data.messageId) opts.onSaved?.(data.messageId);
          if (name === 'error' && data.error) failure = data.error;
        }
      }
      if (failure) throw new Error(failure);
    },
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
    /** Who approves each task type. Every signed-in person can read it. */
    approvers: () => get<ApprovalSettings>('/config/approvers'),
    /** Replace one type's approvers. Admins only. */
    /** One type's lists — the approvers, and who it escalates to when that is given too. */
    saveApprovers: (taskType: string, userIds: string[], escalationUserIds?: string[]) =>
      put<{ success: boolean; taskType: string; approvers: PersonRef[]; escalation?: PersonRef[] }>(
        '/config/approvers',
        { taskType, userIds, ...(escalationUserIds ? { escalationUserIds } : {}) },
      ),
    /** One list for all work: the same approvers and escalation people on every task type. */
    saveAllApprovers: (userIds: string[], escalationUserIds: string[]) =>
      put<{ success: boolean }>('/config/approvers', { allTypes: true, userIds, escalationUserIds }),
    saveApprovalTimings: (remindMinutes: number, escalateMinutes: number) =>
      put<{ success: boolean; remindMinutes: number; escalateMinutes: number }>('/config/approvers', {
        remindMinutes,
        escalateMinutes,
      }),
    auditLog: (filters: AuditFilters = {}) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') params.set(k, String(v));
      return get<AuditPage>(`/config/audit-log?${params}`);
    },
  },

  companies: {
    /** GET /companies returns `{success, companies, meta}` — no `.data` key, so this does NOT auto-unwrap. Read `.companies` off the result, not the result itself. */
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; companies: Company[]; meta: unknown }>(`/companies?${new URLSearchParams(params)}`),
    get: (id: string) => get<Record<string, unknown>>(`/companies/${id}`),
    /** What is on a company — read before offering to remove it, so the dialog can say what each way out costs. */
    holdings: (id: string) =>
      get<{
        success: boolean;
        company: { id: string; name: string; status: string };
        holdings: {
          people: number;
          proposals: number;
          quoted: number;
          proformas: number;
          retainers: number;
          projects: number;
          invoices: number;
          paidInvoices: number;
          tasks: number;
          costs: number;
        };
      }>(`/companies/${id}/holdings`),
    /**
     * Destroy a company and everything on it. `setup.admin`, and the name has to
     * be typed — checked on the server, so this is a gate rather than a prompt.
     */
    deletePermanently: (id: string, confirmName: string) =>
      post<{ success: boolean; deleted: { name: string } & Record<string, number> }>(
        `/companies/${id}/delete-permanently`,
        { confirmName },
      ),
    /** Ask before creating, so the warning arrives while somebody is still typing. */
    checkDuplicate: (body: { name: string; email?: string; phone?: string }) =>
      post<DuplicateVerdict>('/companies/check-duplicate', body),
    /*
     * There is no `create` here.
     *
     * A company is an outreach lead that was promoted — `POST /outreach/:id/promote`
     * is what makes one, and it carries the lead's history with it. The form that
     * made a company out of nothing is gone, along with the Quick Create entry
     * that opened it: the same client could arrive two ways, one of them with no
     * record of who found them or what was said.
     *
     * The importer (`import`, below) is the exception, for a list that predates
     * Flowzen. `POST /companies` still exists on the server for it and for the
     * promote path to build on.
     */
    /**
     * A spreadsheet of companies (§4.4).
     *
     * `dryRun` runs every rule — duplicates included — and writes nothing, so the
     * preview shows exactly what the real import will do.
     */
    import: (body: { csv?: string; rows?: Record<string, unknown>[]; dryRun?: boolean; force?: boolean; ownerId?: string }) =>
      post<ImportResult>('/companies/import', body),
    /**
     * What the importer reads, from the importer itself.
     *
     * Fetched rather than written into the modal, because the modal's own
     * hand-written list had already drifted from the parser — it promised
     * columns that were never read and omitted one that was.
     */
    importRules: () =>
      get<{
        success: boolean;
        rules: { column: string; also: string[]; required: boolean; note: string }[];
      }>('/companies/import/rules'),
    /**
     * A starting file, with the rules as comment lines above the header.
     *
     * A plain URL rather than a fetch: the browser should save it, and the
     * session cookie goes with the request the same way it does for every other
     * call. `parseCsv` skips the leading `#` block, so this file imports its own
     * two example rows unchanged.
     */
    importTemplateUrl: () => `${API_URL}/companies/import/template`,
    update: (id: string, data: Partial<Company>) => patch<Company>(`/companies/${id}`, data),
    /**
     * Take a company off the books.
     *
     * Archives rather than deletes — §16, the row and its history stay and it
     * leaves the lists. Refused with `code: 'HAS_WORK'` when there is a
     * retainer, project, invoice, proforma or quoted proposal on it; the answer
     * then is to mark them a past client, which keeps all of it.
     */
    remove: (id: string) => del<{ success: boolean; archived: boolean }>(`/companies/${id}`),
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
        counts: { ALL: number; NOT_CONTACTED: number; FOLLOW_UP: number; MEETING: number; INTERESTED: number; DEAD: number };
        /** Follows no filter — how many cold names exist at all. */
        summary: { cold: number };
        meta: { total: number };
      }>(`/outreach?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; entry: any }>('/outreach', body),
    /**
     * Take a lead off the list.
     *
     * Not the same as marking it Dead: Dead is the end of a conversation, this
     * is a row that should not have been there — typed twice, a typo, a bad
     * import line. Soft, so Settings → Trash puts it back. Refused once the
     * lead has been promoted, because it is that company's history.
     */
    remove: (id: string) => del<{ success: boolean }>(`/outreach/${id}`),
    /** What can be put back — the other half of `remove`. */
    trash: () => get<{ success: boolean; entries: any[] }>('/outreach/trash'),
    restore: (id: string) => post<{ success: boolean; entry: any }>(`/outreach/${id}/restore`, {}),
    /** Name, vertical, source, owner, and the contact details — any subset. Refused once the name has been promoted. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; entry: any }>(`/outreach/${id}`, body),
    /**
     * Move a lead along, and write down what was said.
     *
     * FOLLOW_UP needs both a date and a note; MEETING needs the date and takes
     * the note as optional logistics. The server refuses the rest, so the form
     * asks for them rather than letting a callback exist with no date on it.
     *
     * This never creates a Company — that is `promote` below, a separate
     * deliberate step, and only from INTERESTED.
     */
    updateStatus: (id: string, body: { status: string; remarks?: string | null; nextActionDate?: string | null }) =>
      patch<{ success: boolean; entry: any }>(`/outreach/${id}/status`, body),
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
    /**
     * Everything about a proposal. The figures (value, scope, link, sent date)
     * correct the winning version, or the latest, in place — a re-quote is
     * still a new version. Kind and company are refused once the deal is
     * closed, and the company once a proforma has gone out against it.
     */
    update: (
      id: string,
      body: {
        ownerId?: string;
        kind?: 'RETAINER' | 'PROJECT';
        companyId?: string;
        value?: number;
        scopeSummary?: string;
        fileUrl?: string | null;
        sentAt?: string;
      },
    ) =>
      patch<{ success: boolean; proposal: any }>(`/proposals/${id}`, body),
    /**
     * Soft delete — §16. Only one nothing has happened to yet: the server
     * refuses a won or lost proposal, and one with a proforma against it.
     */
    remove: (id: string) => del<{ success: boolean }>(`/proposals/${id}`),
    restore: (id: string) => post<{ success: boolean }>(`/proposals/${id}/restore`),
    trash: () => get<{ success: boolean; proposals: any[] }>('/proposals/trash'),
  },

  proformas: {
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; proformas: any[] }>(`/proformas?${new URLSearchParams(params)}`),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; proforma: any }>('/proformas', body),
    updateStatus: (id: string, status: string) =>
      patch<{ success: boolean; proforma: any }>(`/proformas/${id}/status`, { status }),
    /**
     * One proforma per retainer month, raised together — filled from the
     * client's billing details, the month's fee and the retainer's GST rate.
     * A month that cannot be raised is skipped and says why; the rest go out.
     */
    raiseForRetainerMonths: (monthCardIds: string[]) =>
      post<{
        success: boolean;
        created: { monthCardId: string; proformaId: string; number: string; companyName: string }[];
        skipped: { monthCardId: string; companyName: string; reason: string }[];
      }>('/proformas/retainer-months', { monthCardIds }),
    /** Only while the proforma is still UNPAID — the server refuses it otherwise. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; proforma: any }>(`/proformas/${id}`, body),
    /** A link, not a fetch — the browser downloads it with the session cookie. */
    /** The whole document, line items included — what the list deliberately omits. */
    get: (id: string) => get<{ success: boolean; proforma: any }>(`/proformas/${id}`),
    pdfUrl: (id: string) => fileUrl(`/proformas/${id}/pdf`),
    /** CR-02 §10 — the send form's defaults, and the send itself. */
    emailDefaults: (id: string) => get<DocumentEmailDefaults>(`/proformas/${id}/email`),
    email: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; sent: boolean; to: string }>(`/proformas/${id}/email`, body),
  },

  /**
   * The studio own work, in named pieces.
   *
   * A bucket that groups internal tasks and holds no money -- no client, no
   * value, no invoice. See routes/internalProjects.ts on why that is a schema
   * guarantee rather than a convention.
   */
  internalProjects: {
    list: (status?: string) =>
      get<{ success: boolean; projects: InternalProject[] }>(
        `/internal-projects${status ? `?status=${status}` : ''}`,
      ),
    /** One bucket and the tasks under it — what the project page reads. */
    get: (id: string) =>
      get<{ success: boolean; project: any }>(`/internal-projects/${id}`),
    create: (body: { name: string; description?: string | null; ownerId?: string | null }) =>
      post<{ success: boolean; project: InternalProject }>('/internal-projects', body),
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; project: InternalProject }>(`/internal-projects/${id}`, body),
    /** Only an empty one -- a bucket with work under it is marked done instead. */
    remove: (id: string) => del(`/internal-projects/${id}`),
  },

  tasks: {
    my: () =>
      get<{ success: boolean; counts: any; tasks: { today: any[]; overdue: any[]; thisWeek: any[]; later: any[]; completed: any[] } }>('/tasks/my'),
    list: (params: Record<string, string> = {}) =>
      get<{ success: boolean; tasks: any[] }>(`/tasks?${new URLSearchParams(params)}`),
    /**
     * Every task in the agency, for `work.all` — Head and Management.
     *
     * Separate from `list` because it answers a different question: `list` is
     * "the tasks on this job", narrowed to the caller unless they run the work,
     * and this is "what is everybody carrying", with the client and the job
     * attached to each row.
     */
    all: (params: Record<string, string> = {}) =>
      get<{
        success: boolean;
        tasks: any[];
        /** The clients that have work, for the filter — from every task, not the filtered ones. */
        clients: { id: string; name: string }[];
        /** Whether anything has no client at all, so "Internal" is worth offering. */
        hasInternal: boolean;
        /**
         * Every project with work in it — one-off (`P:`), inside a retainer
         * (`RP:`) or internal (`IP:`) — with the client it is for.
         */
        projects: { value: string; name: string; client: string; companyId: string | null }[];
        counts: { total: number; open: number; waiting: number; overdue: number; unassigned: number };
      }>(`/tasks/all?${new URLSearchParams(params)}`),
    /**
     * Everything a task form can offer, in one call.
     *
     * Names and ids only — nothing with a value on it — which is why it needs
     * only `work.own`. The pickers used to be built from /companies and
     * /internal-projects, whose permissions nobody but Management holds
     * together, so everyone else met empty dropdowns.
     */
    targets: () =>
      get<{
        success: boolean;
        companies: { id: string; name: string; jobs: any[] }[];
        internalProjects: { id: string; name: string }[];
      }>('/tasks/targets'),
    create: (body: Record<string, unknown>) =>
      post<{ success: boolean; task: any }>('/tasks', body),
    /**
     * The order of one group on the caller's own My Work, top to bottom.
     * Only ever the caller's own desk — see PUT /tasks/my/order.
     */
    saveMyOrder: (taskIds: string[]) => put<{ success: boolean }>('/tasks/my/order', { taskIds }),
    /** Title, assignee, due date, priority, notes — any subset. Status has its own route. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; task: any }>(`/tasks/${id}`, body),
    /**
     * Delete — final, there is no restore for a task. Refused with a 400 once
     * a task is finished, because its timing is already counted towards how
     * long this kind of work takes.
     */
    remove: (id: string) => del<{ success: boolean }>(`/tasks/${id}`),
    updateStatus: (id: string, status: string) =>
      patch<{ success: boolean; task: any }>(`/tasks/${id}/status`, { status }),
    wait: (id: string, waitingOn: string) =>
      post<{ success: boolean; task: any }>(`/tasks/${id}/wait`, { waitingOn }),
    resume: (id: string) =>
      post<{ success: boolean; task: any }>(`/tasks/${id}/resume`),
    /** Send a task for approval: opens the next round and moves it to In review. */
    submitReview: (id: string, body: { link?: string; note?: string }) =>
      post<{ success: boolean; status: string; review: TaskReviewRound }>(`/tasks/${id}/submit-review`, body),
    /** Approve the open round — the task is done. */
    approve: (id: string) =>
      post<{ success: boolean; decision: ReviewDecision; round: number; status: string }>(`/tasks/${id}/approve`, {}),
    /** Send it back with feedback — the task returns to In progress. */
    requestChanges: (id: string, feedback: string) =>
      post<{ success: boolean; decision: ReviewDecision; round: number; status: string }>(
        `/tasks/${id}/request-changes`,
        { feedback },
      ),
    /** Everything waiting for the caller's approval, oldest first. Empty for non-approvers. */
    approvals: () => get<{ success: boolean; items: ApprovalItem[]; sentBack?: SentBackItem[] }>('/tasks/approvals'),
    /** Another approver's changes, on a round somebody already sent back. */
    addChanges: (id: string, feedback: string) =>
      post<{ success: boolean; note: ReviewNote }>(`/tasks/${id}/add-changes`, { feedback }),
    /** One task's approval rounds, and what the caller can do about it. */
    reviews: (id: string) => get<TaskReviewsResponse>(`/tasks/${id}/reviews`),
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
     * Correct the arrangement itself. `renewalDate` is not a field here — the
     * server derives it from start + term, so sending one would be ignored.
     *
     * `repriceOpenMonth` decides what a new rate does to the month you are part
     * way through: a month card snapshots its revenue when it opens, so
     * without this the change is invisible until the next roll and the current
     * month bills at the old figure. `repricedCards` in the reply says how many
     * actually moved — never a closed or already-invoiced one.
     */
    update: (
      id: string,
      body: {
        monthlyValue?: number;
        startDate?: string;
        termMonths?: number | null;
        ownerId?: string;
        repriceOpenMonth?: boolean;
      },
    ) => patch<{ success: boolean; retainer: any; repricedCards: number }>(`/retainers/${id}`, body),
    /** The named pieces of work inside a retainer. No money on any of them. */
    projects: (id: string) =>
      get<{ success: boolean; projects: RetainerProject[] }>(`/retainers/${id}/projects`),
    createProject: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; project: RetainerProject }>(`/retainers/${id}/projects`, body),
    updateProject: (id: string, projectId: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; project: RetainerProject }>(`/retainers/${id}/projects/${projectId}`, body),
    /** The tasks done under it are kept — they stay on their month card. */
    /**
     * One project inside a retainer, opened — its tasks across every month it
     * touches, grouped by the month that bills them. `projectId` may be the
     * literal `none` for the work that belongs to no project.
     */
    projectTasks: (id: string, projectId: string) =>
      get<{
        success: boolean;
        project: any | null;
        months: { month: string; status: string; tasks: any[] }[];
        total: number;
      }>(`/retainers/${id}/projects/${projectId}/tasks`),
    deleteProject: (id: string, projectId: string) =>
      del<{ success: boolean; tasksKept: number }>(`/retainers/${id}/projects/${projectId}`),
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
    /**
     * Putting a closed month back into play. setup.admin only, and the reason
     * goes on the record — a closed month is a reported month, so reopening it
     * is the exception rather than a step on the way to entering a cost.
     */
    reopenMonth: (id: string, month: string, reason: string) =>
      post<{ success: boolean; month: string }>(`/retainers/${id}/month-cards/${month}/reopen`, { reason }),
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
    /** Correcting one. A mistyped amount used to be uncorrectable. */
    update: (id: string, body: Record<string, unknown>) =>
      patch<{ success: boolean; cost: any }>(`/costs/${id}`, body),
    delete: (id: string) => del(`/costs/${id}`),
    /** Same call, named the way the screens read it. */
    remove: (id: string) => del(`/costs/${id}`),
    trash: () => get<{ success: boolean; costs: any[] }>('/costs/trash'),
    restore: (id: string) => post<{ success: boolean }>(`/costs/${id}/restore`),
  },

  team: {
    /** The Approvals tab: the last 7 or 30 days, and what is waiting right now. */
    approvalsReport: (days: 7 | 30) => get<ApprovalsReport>(`/team/approvals-report?days=${days}`),
    capacity: (params: Record<string, string> = {}) =>
      get<{ success: boolean; departments: Department[]; members: any[] }>(`/team/capacity?${new URLSearchParams(params)}`),
    /**
     * Name + id only, for an owner picker — gated on nothing but being logged in, unlike capacity.
     * Everybody, so a Head can assign across departments; `scoped` narrows it to a Head's own
     * people, for filters over work they manage.
     */
    members: (opts: { scoped?: boolean } = {}) =>
      get<{
        success: boolean;
        members: { id: string; name: string; designation: string | null; dept: string; departmentId: string | null }[];
      }>(`/team/members${opts.scoped ? '?scoped=1' : ''}`),
    /** Whose people the caller manages: everybody, or the departments they lead. */
    scope: () => get<{ success: boolean; scope: TeamScope }>('/team/scope'),
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
    invite: (body: { name: string; email: string; departmentId: string; preset: string }) =>
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
        departmentId?: string;
        active?: boolean;
        force?: boolean;
      },
    ) =>
      patchFull<{
        data: { id: string; name: string; dept: string; preset: string; permissions: string[]; monthlyCost: unknown };
      }>(`/users/${id}`, body),
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
     * Every retainer's month and where its billing has got to — the month
     * asked for (this one by default) plus any earlier month still unpaid.
     */
    retainerBilling: (month?: string, retainerId?: string) => {
      const q = new URLSearchParams();
      if (month) q.set('month', month);
      // Every month of one retainer, for its own page.
      if (retainerId) q.set('retainerId', retainerId);
      const qs = q.toString();
      return get<RetainerBillingResponse>(`/invoices/retainer-billing${qs ? `?${qs}` : ''}`);
    },
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
    /**
     * One invoice, with its document and line items.
     *
     * Typed as the invoice itself, not `{ invoice }` — this endpoint answers
     * under `data`, and `request` above unwraps that. Declaring the wrapper
     * compiles perfectly well and hands the caller `undefined` at runtime,
     * which is exactly how the document form silently failed to prefill.
     */
    get: (id: string) => get<Record<string, any>>(`/invoices/${id}`),
    /**
     * The printable tax invoice (CR-02). Replaces the document wholesale —
     * the server recomputes every figure from the lines, and sets the
     * invoice's amount to the document total.
     */
    saveDocument: (id: string, body: Record<string, unknown>) =>
      put<Record<string, any>>(`/invoices/${id}/document`, body),
    /** A link, not a fetch — 400s until the document above exists. */
    pdfUrl: (id: string) => fileUrl(`/invoices/${id}/pdf`),
    emailDefaults: (id: string) => get<DocumentEmailDefaults>(`/invoices/${id}/email`),
    email: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; sent: boolean; to: string }>(`/invoices/${id}/email`, body),
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
    /** `warnings`: somebody else's shoot the due-back date runs into. Never a refusal. */
    checkout: (id: string, body: Record<string, unknown>) =>
      post<{ success: boolean; warnings?: string[] }>(`/assets/${id}/checkout`, body),
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

  /**
   * Departments, as records (Departments Plan 1). Anybody can read the list;
   * only `setup.admin` changes it. Never deleted — merged or archived.
   */
  departments: {
    list: (opts: { includeArchived?: boolean; withPeople?: boolean } = {}) => {
      const q = new URLSearchParams();
      if (opts.includeArchived) q.set('includeArchived', '1');
      if (opts.withPeople) q.set('withPeople', '1');
      return get<{
        success: boolean;
        departments: Department[];
        unplaced?: DepartmentPerson[];
        /** Department head access, but no department to lead — they still see everybody. */
        headsLeadingNothing?: { id: string; name: string }[];
      }>(
        `/departments${q.size ? `?${q}` : ''}`,
      );
    },
    create: (name: string) => post<{ success: boolean; department: { id: string; name: string } }>('/departments', { name }),
    update: (id: string, body: { name?: string; headId?: string | null; sortOrder?: number }) =>
      patch(`/departments/${id}`, body),
    merge: (id: string, intoId: string) => post<{ success: boolean; moved: number }>(`/departments/${id}/merge`, { intoId }),
    archive: (id: string) => post<{ success: boolean }>(`/departments/${id}/archive`),
    restore: (id: string) => post<{ success: boolean }>(`/departments/${id}/restore`),
    movePeople: (userIds: string[], departmentId: string) =>
      post<{ success: boolean; moved: number }>('/departments/move-people', { userIds, departmentId }),
  },

  /** The Monday brief: last week, what needs action, what is coming, the risks, the team. */
  brief: {
    /** The current brief, or — with a Monday — that past week's scoreboard and summary. */
    monday: (week?: string) => get<MondayBrief>(`/brief/monday${week ? `?week=${week}` : ''}`),
    /** What is behind one number on the scoreboard, for that number's week. */
    details: (metric: BriefMetric, week: string) =>
      get<BriefDetails>(`/brief/monday/details?metric=${metric}&week=${week}`),
    /** Write this week's summary again. Refused (429) within ten minutes of the last one. */
    writeSummary: () => post<{ success: boolean; summary: NonNullable<MondayBrief['summary']> }>('/brief/monday/summary'),
  },

  /** Who is using Flowzen. */
  usage: {
    /** "I am looking at this screen" — fire and forget; the server keeps only the screen's name. */
    view: (path: string) => post<void>('/usage/view', { path }),
    /** Management only. */
    summary: (days: 7 | 30) => get<UsageSummary>(`/usage/summary?days=${days}`),
  },

  /** Your own Google Calendar connection — optional, and only ever yours. */
  google: {
    status: () =>
      get<{
        success: boolean;
        /** The server has keys and an admin switched it on. */
        enabled: boolean;
        connected: boolean;
        googleEmail: string | null;
        status: 'ACTIVE' | 'NEEDS_RECONNECT' | null;
        lastSyncedAt: string | null;
      }>('/google/status'),
    /** Google's consent is a page, so this is where the browser goes — not a fetch. */
    connectUrl: () => `${API_URL}/google/connect`,
    disconnect: () => post<{ success: boolean }>('/google/disconnect'),
  },

  /** Profile → Phone notifications: this person's devices and switches. */
  push: {
    /** On for this organisation, and the key a browser subscribes with. */
    config: () => get<{ success: boolean; enabled: boolean; publicKey: string | null }>('/push/config'),
    subscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      post<{ success: boolean; device: PushDevice }>('/push/subscribe', sub),
    devices: () => get<{ success: boolean; devices: PushDevice[] }>('/push/subscriptions'),
    removeDevice: (id: string) => del<{ success: boolean }>(`/push/subscriptions/${id}`),
    preferences: () => get<{ success: boolean; preferences: PushPreferences }>('/push/preferences'),
    setPreferences: (prefs: Partial<PushPreferences>) =>
      put<{ success: boolean; preferences: PushPreferences }>('/push/preferences', prefs),
    test: () => post<{ success: boolean; devices: number }>('/push/test'),
  },

  calendar: {
    /** At most 62 days at a time; layers this person cannot see come back empty. */
    get: (params: { from: string; to: string; layers: string[]; person?: string; departmentId?: string }) => {
      const q = new URLSearchParams({ from: params.from, to: params.to, layers: params.layers.join(',') });
      if (params.person) q.set('person', params.person);
      if (params.departmentId) q.set('departmentId', params.departmentId);
      return get<CalendarResponse>(`/calendar?${q}`);
    },
    /** What the event form offers: clients (projects, retainers, contacts) and pickable gear. */
    eventOptions: () => get<CalendarEventOptions>('/calendar/event-options'),
    /** Warnings for a window, saving nothing — the live box in the form. */
    clashes: (body: {
      startsAt: string;
      endsAt: string;
      allDay: boolean;
      assetIds: string[];
      attendeeIds: string[];
      excludeEventId?: string | null;
    }) => post<{ success: boolean; clashes: CalendarClash[] }>('/calendar/clashes', body),
    event: (id: string) => get<CalendarEventResponse>(`/calendar/events/${id}`),
    createEvent: (body: CalendarEventInput) =>
      post<{ success: boolean; event: { id: string }; clashes: CalendarClash[] }>('/calendar/events', body),
    updateEvent: (id: string, body: Partial<CalendarEventInput>) =>
      patch<{ success: boolean; event: { id: string }; clashes: CalendarClash[] }>(`/calendar/events/${id}`, body),
    deleteEvent: (id: string) => del<{ success: boolean }>(`/calendar/events/${id}`),
  },

};

/** GET /usage/summary — see services/usageSummary on the API. */
/** One open alert, as a row on the brief: client, what, amount, who to ask. */
export type BriefAlertRow = {
  alertId: string;
  rule: string;
  title: string;
  clientName: string | null;
  amount?: number;
  ownerName?: string;
  flaggedDaysAgo: number;
  severity: 'HIGH' | 'MED' | 'LOW';
  /** Null when the reader cannot open the screen it would lead to. */
  link: string | null;
};

type WeekPair<T> = { last: T; before: T };

export type TrendPoint = { weekStart: string; value: number | null };

export type BriefTeamRow = {
  /** Null for people not yet placed in a department. */
  departmentId: string | null;
  dept: string;
  active: number;
  overdue: number;
  dueThisWeek: number;
  doneLastWeek: number;
  waitingOnClient: number;
  inReview: number;
  overAllocatedPeople: number;
  /** The same open work split so no task is counted twice — what the stacked bar draws. */
  segments: { overdue: number; onTrack: number; inReview: number; waitingOnClient: number };
};

export type BriefComingUp = {
  events: {
    id: string;
    kind: 'SHOOT' | 'MEETING';
    title: string;
    when: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    clientName: string | null;
    people: string[];
    link: string | null;
  }[];
  invoicesDue: { id: string; clientName: string; number: string; balance: number; dueAt: string; link: string | null }[];
  projectsEnding: { id: string; name: string; clientName: string; ownerName: string; endDate: string; link: string | null }[];
  renewals: {
    alertId: string;
    clientName: string;
    renewalDate: string | null;
    monthlyValue: number;
    ownerName?: string;
    link: string | null;
  }[];
};

/**
 * The Monday brief. On a past week only the scoreboard, its trends and that
 * week's summary are given — the rest describes now, and comes back null.
 */
export type MondayBrief = {
  success: boolean;
  generatedAt: string;
  timezone: string;
  currency: string;
  weeks: {
    last: { from: string; to: string };
    before: { from: string; to: string };
    weekStart: string;
    today?: string;
    comingUntil?: string;
    /** This week, Monday to Sunday, for the timeline. */
    days?: { day: string; working: boolean }[];
  };
  /** Which week is shown, and how far the switcher may go. */
  week: { shown: string; current: boolean; latest: string; earliest: string };
  scoreboard: {
    cashCollected: WeekPair<number>;
    invoiced: WeekPair<{ amount: number; count: number }>;
    dealsWon: WeekPair<{ count: number; value: number }>;
    proposalsSent: WeekPair<number>;
    tasksDone: WeekPair<{ count: number; onTime: number }>;
    approvals: {
      group: string;
      last: { decided: number; medianDecisionMinutes: number | null; onTime: number; escalated: number };
      before: { decided: number; medianDecisionMinutes: number | null; onTime: number; escalated: number } | null;
    }[];
  };
  /** Each figure for the 8 weeks ending at the shown one. */
  trends: {
    cashCollected: TrendPoint[];
    invoiced: TrendPoint[];
    dealsWon: TrendPoint[];
    proposalsSent: TrendPoint[];
    tasksDone: TrendPoint[];
    approvals: { group: string; points: TrendPoint[] }[];
  };
  needsAction: { group: string; items: BriefAlertRow[] }[] | null;
  risks: { group: string; items: BriefAlertRow[] }[] | null;
  comingUp: BriefComingUp | null;
  team: BriefTeamRow[] | null;
  summary: { text: string; generatedAt: string; model: string | null } | null;
  aiConfigured: boolean;
  /** Management only, current week only. */
  notUsingFlowzen: {
    title: string;
    from: string;
    to: string;
    people: { id: string; name: string; lastActiveAt: string | null; lastActive: string | null }[];
    line: string;
  } | null;
};

export type BriefMetric = 'cash' | 'invoiced' | 'deals' | 'proposals' | 'tasks';

export type BriefDetails = {
  success: boolean;
  metric: BriefMetric;
  week: { from: string; to: string };
  more: boolean;
  rows: (
    | { id: string; date: string; clientName: string; number: string; amount: number; link: string | null }
    | { id: string; date: string | null; clientName: string; value: number; ownerName?: string; version?: number; link: string | null }
    | { departmentId: string | null; dept: string; done: number; onTime: number }
  )[];
  /** Tasks only: the tile's own number, each task counted once. */
  total?: { done: number; onTime: number };
};

/** A department: what every person points at, by id. */
export type Department = {
  id: string;
  name: string;
  headId: string | null;
  headName: string | null;
  sortOrder: number;
  archived: boolean;
  /** Active people in it. */
  peopleCount: number;
  /** With `withPeople`: who is in it. */
  people?: DepartmentPerson[];
};
export type DepartmentPerson = { id: string; name: string; designation: string | null; preset: string };

/**
 * Whose people the caller manages (Departments Plan 3). `all` for Management,
 * for anybody without Team work, and for a Head who leads no department yet.
 */
export type TeamScope =
  | { all: true }
  | { all: false; departments: { id: string; name: string; peopleCount: number }[] };

export type UsageSummary = {
  success: boolean;
  days: number;
  period: { from: string; to: string; workingDays: number };
  today: string;
  activeToday: number;
  activeInPeriod: number;
  totalPeople: number;
  perDay: { day: string; activePeople: number }[];
  people: {
    user: { id: string; name: string; dept: string; departmentId: string | null };
    lastActiveAt: string | null;
    daysActive: number;
    changes: number;
    topScreens: string[];
    inactiveWorkingDays: number | null;
  }[];
};

export type CalendarLayer = 'mine' | 'team' | 'events' | 'google' | 'money' | 'sales' | 'work' | 'equipment' | 'holidays';

/** One dated thing on the calendar — see routes/calendar.ts on the API. */
export type CalendarItem = {
  id: string;
  layer: CalendarLayer;
  kind: string;
  title: string;
  /** The organisation's calendar day, YYYY-MM-DD. */
  date: string;
  /** HH:MM, only when the record has one. */
  time?: string;
  allDay: boolean;
  link: string | null;
  draggable: boolean;
  overdue?: boolean;
  done?: boolean;
  taskId?: string;
  dueTime?: string | null;
  /** Meetings and shoots: where it ends (all-day: the day after, exclusive). */
  endDate?: string;
  endTime?: string;
  eventId?: string;
  eventKind?: CalendarEventKind;
  /** The viewer is one of its people. */
  isMine?: boolean;
  bookedBy?: string;
  location?: string | null;
};

export type CalendarEventKind = 'MEETING' | 'SHOOT' | 'OTHER';

/** What the event form sends. Times are the studio's wall clock; all day, the end is the last day. */
export type CalendarEventInput = {
  kind: CalendarEventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  attendeeIds: string[];
  companyId?: string | null;
  projectId?: string | null;
  retainerId?: string | null;
  contactIds: string[];
  assetIds: string[];
};

/** Something in the way. A warning — never a refusal. */
export type CalendarClash = {
  kind: 'reserved' | 'out' | 'assigned' | 'repair' | 'person';
  subject: string;
  message: string;
  assetId?: string;
  userId?: string;
};

export type CalendarEventOptions = {
  success: boolean;
  companies: {
    id: string;
    name: string;
    /** PROSPECT, CLIENT or PAST — a meeting can be with any of them. */
    status: string;
    projects: { id: string; name: string }[];
    retainers: { id: string; name: string }[];
    contacts: { id: string; name: string }[];
  }[];
  assets: { id: string; tag: string; name: string; status: string }[];
};

export type CalendarEventDetail = {
  id: string;
  kind: CalendarEventKind;
  title: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
  when: string;
  location: string | null;
  notes: string | null;
  company: { id: string; name: string; status: string } | null;
  project: { id: string; name: string } | null;
  retainer: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  attendees: { id: string; name: string }[];
  /** Phone and email only for people who can open the client book. */
  contacts: { id: string; name: string; phone?: string | null; email?: string | null }[];
  gear: { assetId: string; tag: string; name: string; status: string; statusLine: string; checkoutHref: string | null }[];
  isPast: boolean;
};

export type CalendarEventResponse = {
  success: boolean;
  event: CalendarEventDetail;
  clashes: CalendarClash[];
  history: { at: string; text: string }[];
  canEdit: boolean;
};

export type CalendarResponse = {
  success: boolean;
  items: CalendarItem[];
  /** The layers this person may see at all. */
  available: CalendarLayer[];
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  timezone: string;
  today: string;
  /** The caller's own Google connection has stopped working. */
  googleNeedsReconnect?: boolean;
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

/** One device that turned phone notifications on. */
export interface PushDevice {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** So the Profile card can tell which row is the browser it is in. */
  endpoint: string;
}

/** The four kinds of phone notification, each its own switch. */
export interface PushPreferences {
  pushApprovals: boolean;
  pushCalendar: boolean;
  pushTasks: boolean;
  pushBell: boolean;
}
