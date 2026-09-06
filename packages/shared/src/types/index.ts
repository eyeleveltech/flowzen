// ──────────────────────────────────────────────
// Flowzen Shared Domain Types & Contracts
// ──────────────────────────────────────────────

export type RolePreset = 'EMPLOYEE' | 'HEAD' | 'BD' | 'ACCOUNTS' | 'MANAGEMENT';

export type PermissionKey =
  | 'work.own'
  | 'work.team'
  | 'work.all'
  | 'company.read'
  | 'company.write'
  | 'pipeline.read'
  | 'pipeline.write'
  | 'money.status'
  | 'money.figures'
  | 'cost.enter'
  | 'reports.read'
  | 'setup.admin'
  // Handing a piece of company equipment over — assign, check out, check in,
  // retire. Reading the catalogue needs nothing; only the ACT of moving an
  // asset is gated, which is why this is one key rather than a read/write pair.
  | 'asset.manage';

export const ROLE_PRESET_PERMISSIONS: Record<RolePreset, PermissionKey[]> = {
  EMPLOYEE: ['work.own'],
  /*
   * `asset.manage` is here because it was nowhere.
   *
   * It gates thirteen endpoints — assign, check out, check in, retire, repair —
   * and it sat in no preset at all, on the theory that a studio manager would
   * be granted it per person from the team screen. Nobody ever was: 0 of 14
   * people held it, so the only people who could move a piece of kit were the
   * two with `setup.admin` and its master bypass. Everybody else got the
   * ASSET_OVERDUE alert — deliberately ungated, because a designer needs to
   * know the lens is late back more than anyone — and no way to act on it.
   *
   * A Head runs a department and hands out its gear, so this is where it
   * belongs. Granting it per person still works for anybody else: effective
   * permissions are the union of the preset and the stored ones, resolved on
   * every request, so this needs no backfill.
   */
  HEAD: ['work.own', 'work.team', 'work.all', 'money.status', 'cost.enter', 'asset.manage'],
  BD: ['work.own', 'company.read', 'company.write', 'pipeline.read', 'pipeline.write', 'money.status'],
  ACCOUNTS: ['work.own', 'company.read', 'money.status', 'money.figures', 'cost.enter'],
  MANAGEMENT: [
    'work.own',
    'work.team',
    'work.all',
    'company.read',
    'company.write',
    'pipeline.read',
    'pipeline.write',
    'money.status',
    'money.figures',
    'cost.enter',
    'reports.read',
    'setup.admin',
    // Belt-and-braces: `setup.admin` already answers yes to everything through
    // the master bypass in hasPermission(). Listing it keeps the preset table
    // honest about what the role can do, and it survives any future narrowing
    // of that bypass.
    //
    // `asset.manage` is not listed because the bypass already covers it, and
    // because it now belongs to HEAD — see the note there. Anybody else who
    // needs to issue gear is still granted it per-user from the team screen.
  ],
};

export interface User {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  dept: string;
  monthlyCost?: number | string | null; // Masked if caller lacks setup.admin
  preset: RolePreset;
  permissions: PermissionKey[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  proformaPrefix: string;
  financialYearStart: number;
  timezone: string;
  currency: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: number[];
}

export type CompanyVertical =
  | 'HEALTHCARE'
  | 'REAL_ESTATE'
  | 'D2C'
  | 'SPORTS'
  | 'IT_AND_SAAS'
  | 'RETAIL'
  | 'B2B'
  | 'HOSPITALITY';

export type CompanySource = 'OUTREACH' | 'REFERRAL' | 'INBOUND' | 'PARTNER_AGENCY' | 'NETWORK';
export type CompanyStatus = 'PROSPECT' | 'CLIENT' | 'PAST';

export interface Company {
  id: string;
  organizationId: string;
  name: string;
  vertical: CompanyVertical;
  source: CompanySource;
  ownerId?: string | null;
  city: string;
  website?: string | null;
  gstin?: string | null;
  billingAddress?: string | null;
  lostReason?: string | null;
  status: CompanyStatus;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string } | null;
  people?: Person[];
  activeRetainer?: Retainer | null;
  liveProjects?: Project[];
  attentionSentence?: string | null;
}

export type PersonRole = 'APPROVER' | 'PAYER' | 'CONTACT';

export interface Person {
  id: string;
  companyId: string;
  name: string;
  role: PersonRole;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  active: boolean;
  createdAt: string;
}

export type OutreachStatus = 'NOT_CONTACTED' | 'CONTACTED' | 'REPLIED' | 'DEAD';

export interface OutreachEntry {
  id: string;
  organizationId: string;
  name: string;
  vertical: CompanyVertical;
  source: CompanySource;
  ownerId?: string | null;
  status: OutreachStatus;
  promotedCompanyId?: string | null;
  importedAt: string;
}

export type ProposalKind = 'RETAINER' | 'PROJECT';
export type ProposalStage =
  | 'TALKING'
  | 'PROPOSAL_SENT'
  | 'IN_NEGOTIATION'
  | 'PROFORMA_ISSUED'
  | 'VERBAL_YES'
  | 'WON'
  | 'LOST'
  | 'EXPIRED';
export type ProposalOutcome = 'WON' | 'LOST' | 'EXPIRED';

export interface Proposal {
  id: string;
  organizationId: string;
  companyId: string;
  kind: ProposalKind;
  ownerId: string;
  stage: ProposalStage;
  outcome?: ProposalOutcome | null;
  wonVersionId?: string | null;
  wonAt?: string | null;
  lostReason?: string | null;
  probabilityOverride?: number | null;
  verbalYesAt?: string | null;
  createdAt: string;
  updatedAt: string;
  company?: { id: string; name: string };
  owner?: { id: string; name: string };
  versions?: ProposalVersion[];
  currentVersion?: ProposalVersion;
}

export interface ProposalVersion {
  id: string;
  proposalId: string;
  n: number;
  value: number | string;
  scopeSummary: string;
  sentAt: string;
  fileUrl?: string | null;
  createdAt: string;
}

export type ProformaStatus = 'UNPAID' | 'PAID' | 'EXPIRED' | 'CANCELLED';
export type ProformaSourceType = 'PROPOSAL' | 'MONTH_CARD' | 'PROJECT';

export interface Proforma {
  id: string;
  organizationId: string;
  number: string;
  companyId: string;
  sourceType: ProformaSourceType;
  sourceId: string;
  amount: number | string;
  raisedAt: string;
  validTill: string;
  status: ProformaStatus;
  invoiceId?: string | null;
  billingName: string;
  gstin?: string | null;
  terms: string;
  company?: { id: string; name: string };
}

export type RetainerStatus = 'ACTIVE' | 'STOPPED';

export interface Retainer {
  id: string;
  organizationId: string;
  companyId: string;
  monthlyValue: number | string;
  startDate: string;
  termMonths?: number | null;
  renewalDate?: string | null;
  ownerId: string;
  status: RetainerStatus;
  stoppedAt?: string | null;
  stopReason?: string | null;
  templateId?: string | null;
  company?: { id: string; name: string };
  owner?: { id: string; name: string };
  monthCards?: MonthCard[];
}

export type MonthCardStatus = 'OPEN' | 'CLOSED';

export interface MonthCard {
  id: string;
  retainerId: string;
  month: string; // "YYYY-MM"
  revenue: number | string;
  status: MonthCardStatus;
  invoiceId?: string | null;
  closedAt?: string | null;
  retainer?: Retainer;
  tasks?: Task[];
  costs?: Cost[];
  allocations?: PeopleAllocation[];
  grossMarginPercent?: number | null;
  jobProfit?: number | string | null;
}

export type ProjectStatus = 'LIVE' | 'DELIVERED' | 'CANCELLED';
export type MilestoneStatus = 'PENDING' | 'PROFORMA_RAISED' | 'INVOICED' | 'PAID';

export interface Project {
  id: string;
  organizationId: string;
  companyId: string;
  name: string;
  quotedValue: number | string;
  estimatedCost?: number | string | null;
  actualCost?: number | string | null;
  startDate: string;
  endDate: string;
  ownerId: string;
  status: ProjectStatus;
  priority: Priority;
  description?: string | null;
  sourceProposalId?: string | null;
  company?: { id: string; name: string };
  owner?: { id: string; name: string };
  milestones?: Milestone[];
  tasks?: Task[];
  costs?: Cost[];
  allocations?: PeopleAllocation[];
  grossMarginPercent?: number | null;
  jobProfit?: number | string | null;
}

export interface Milestone {
  id: string;
  projectId: string;
  label: string;
  percent: number;
  amount: number | string;
  status: MilestoneStatus;
  order: number;
}

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type TaskWorkType = 'MONTH_CARD' | 'PROJECT' | 'INTERNAL';
/**
 * The five states a task is actually in.
 *
 * This said `'OPEN' | 'WAITING' | 'DONE'` — a vocabulary the database stopped
 * speaking. Prisma's enum is TODO / IN_PROGRESS / ON_HOLD / DONE / CANCELLED,
 * every screen in the web app types against those five, and this file — named
 * as the shared domain contract — described three that no longer existed.
 *
 * Nothing imported it, which is the only reason it was not a live bug. A wrong
 * contract nobody reads is still a wrong contract, and the first person to
 * trust it would have written code against a task state the API can never
 * return.
 */
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';
export type WaitingOn = 'CLIENT' | 'ANOTHER_PERSON';

export interface Task {
  id: string;
  organizationId: string;
  title: string;
  workType: TaskWorkType;
  workId?: string | null;
  monthCardId?: string | null;
  projectId?: string | null;
  assigneeId: string;
  createdById: string;
  dueDate: string;
  assignedAt: string;
  completedAt?: string | null;
  status: TaskStatus;
  waitingOn?: WaitingOn | null;
  waitingSince?: string | null;
  waitingTotalMinutes: number;
  reopenCount: number;
  templateItemId?: string | null;
  notes?: string | null;
  /** Shared with Project, so both compare on one "needs attention" scale. */
  priority: Priority;
  assignee?: { id: string; name: string; dept?: string };
  /** Who asked for the work — chosen on the form, defaulting to whoever typed it. */
  assignedBy?: { id: string; name: string };
  /** Who typed it in. Only the same person when nobody was writing up somebody else's ask. */
  creator?: { id: string; name: string };
  monthCard?: MonthCard;
  project?: Project;
  workingHoursElapsed?: number; // Computed
  isOverdue?: boolean;
}

export type CostType = 'DIRECT' | 'COMPANY' | 'CAPITAL';
export type CostPaidBy = 'COMPANY' | 'AKMAL' | 'JAMEEL_N_J_MACSON';
export type CostTreatment = 'COMPANY_EXPENSE' | 'AKMAL_LOAN' | 'N_J_MACSON_LOAN';

export interface Cost {
  id: string;
  organizationId: string;
  type: CostType;
  workType?: TaskWorkType | null;
  workId?: string | null;
  monthCardId?: string | null;
  projectId?: string | null;
  category: string;
  vendor: string;
  amount: number | string;
  incurredAt: string;
  committedNotPaid: boolean;
  paidBy: CostPaidBy;
  treatment: CostTreatment;
  enteredById: string;
  recurring: boolean;
  notes?: string | null;
  enteredBy?: { id: string; name: string };
}

export interface PeopleAllocation {
  id: string;
  userId: string;
  month: string;
  workType: TaskWorkType;
  workId: string;
  monthCardId?: string | null;
  projectId?: string | null;
  proposedPercent: number;
  percent: number;
  confirmedById?: string | null;
  confirmedAt?: string | null;
  user?: { id: string; name: string; dept?: string };
  confirmedBy?: { id: string; name: string };
}

export type InvoiceStatus = 'RAISED' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface Invoice {
  id: string;
  organizationId: string;
  number: string;
  companyId: string;
  workType?: TaskWorkType | null;
  workId?: string | null;
  amount: number | string;
  raisedAt: string;
  dueAt: string;
  status: InvoiceStatus;
  paidAt?: string | null;
  proformaId?: string | null;
  projectId?: string | null;
  company?: { id: string; name: string };
  payments?: Payment[];
  paidAmount?: number | string;
  balanceAmount?: number | string;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number | string;
  receivedAt: string;
  mode: string;
  reference?: string | null;
}

export type AlertSeverity = 'HIGH' | 'MED' | 'LOW';

export interface Alert {
  id: string;
  organizationId: string;
  rule: string;
  severity: AlertSeverity;
  entityType: string;
  entityId: string;
  message: string;
  raisedAt: string;
  resolvedAt?: string | null;
  acknowledgedById?: string | null;
}

export interface Activity {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  actorId?: string | null;
  verb: string;
  payload: Record<string, unknown>;
  at: string;
  actor?: { id: string; name: string } | null;
}

// ──────────────────────────────────────────────
// Company assets — the register, and who is holding what
// ──────────────────────────────────────────────

export type AssetCategory =
  | 'LAPTOP'
  | 'DESKTOP'
  | 'MONITOR'
  | 'PHONE'
  | 'STORAGE'
  | 'NETWORK'
  | 'CAMERA_BODY'
  | 'LENS'
  | 'LIGHTING'
  | 'AUDIO'
  | 'GIMBAL_DRONE'
  | 'SUPPORT'
  | 'ACCESSORY'
  | 'OTHER';

export type AssetStatus =
  | 'IN_STOCK'
  | 'ASSIGNED'
  | 'BOOKED_OUT'
  | 'IN_REPAIR'
  | 'RETIRED'
  | 'SOLD'
  | 'LOST';

export type AssetCondition = 'NEW' | 'GOOD' | 'FAIR' | 'DAMAGED';

/**
 * Custody and booking are two different problems sharing one table.
 *
 * CUSTODY is "who is responsible for this?" — a laptop with a designer,
 * open-ended, changing about once a year. BOOKING is "is the camera free
 * Friday, and did it come back?" — a due date, and therefore an overdue.
 * A register that cannot tell the two apart cannot answer either question.
 */
export type AssetMovementKind = 'CUSTODY' | 'BOOKING';

export type AssetMaintenanceKind = 'SERVICE' | 'REPAIR' | 'AMC';

/** What the caller may do with the asset screens, decided by the server. */
export interface AssetAccess {
  canManage: boolean;
  canSeeFigures: boolean;
}

export interface Asset {
  id: string;
  organizationId: string;
  tag: string;
  name: string;
  category: AssetCategory;
  make?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  status: AssetStatus;
  condition: AssetCondition;
  bookable: boolean;

  // Money — absent entirely, not nulled, for a caller without money.figures.
  costId?: string | null;
  purchasePrice?: number | string;
  purchasedAt: string;
  vendor?: string | null;
  invoiceNumber?: string | null;
  usefulLifeMonths: number;
  salvageValue?: number | string;
  disposedAt?: string | null;
  disposalValue?: number | string | null;
  disposalNote?: string | null;

  warrantyUntil?: string | null;
  insuredUntil?: string | null;

  billUrl?: string | null;
  photoUrl?: string | null;
  notes?: string | null;

  currentHolderId?: string | null;
  currentHolder?: { id: string; name: string } | null;
  /** The open movement, when there is one — what makes "due back" renderable. */
  openMovement?: AssetMovement | null;

  createdAt: string;
  updatedAt: string;

  /** Computed on read, never stored. Present only with money.figures. */
  bookValue?: number;
  monthlyDepreciation?: number;
  fullyDepreciated?: boolean;
}

export interface AssetMovement {
  id: string;
  assetId: string;
  kind: AssetMovementKind;
  userId: string;
  projectId?: string | null;
  monthCardId?: string | null;
  purpose?: string | null;
  outAt: string;
  dueAt?: string | null;
  returnedAt?: string | null;
  issuedById: string;
  receivedById?: string | null;
  conditionOut: AssetCondition;
  conditionIn?: AssetCondition | null;
  notes?: string | null;
  user?: { id: string; name: string };
  issuedBy?: { id: string; name: string };
  receivedBy?: { id: string; name: string } | null;
  project?: { id: string; name: string } | null;
  asset?: Pick<Asset, 'id' | 'tag' | 'name' | 'category'>;
  /** Set by /out-now: dueAt is in the past and nothing has come back. */
  overdue?: boolean;
  daysOverdue?: number;
}

export interface AssetMaintenance {
  id: string;
  assetId: string;
  kind: AssetMaintenanceKind;
  vendor?: string | null;
  amount?: number | string | null;
  costId?: string | null;
  sentAt: string;
  returnedAt?: string | null;
  notes?: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
}
