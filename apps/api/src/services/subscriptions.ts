import { AlertSeverity } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asStoredDay, dayKey, financialYearBounds, moneyClock, monthBounds, orgMonth, orgToday } from '../utils/moneyDates.js';

/**
 * Subscriptions: what the studio spends on which platform, worked out from
 * the invoices alone (Subscriptions plan, decisions 4, 5 and 8).
 *
 * Nothing extra is typed. The billing cycle comes from the invoice periods,
 * the next renewal from the last period's end, the monthly run-rate from the
 * last invoice divided by its cycle, and the reminders from all three. An
 * invoice's rupee figure is what the bank charged once that is entered, and
 * an estimate from the USD→INR rate in Settings until then — every total
 * says which.
 */

export type Cycle = 'MONTHLY' | 'YEARLY' | 'UNKNOWN';

const DAY = 86_400_000;
const AVG_MONTH_DAYS = 365.25 / 12;

/** Whole days from one stored day to another, inclusive of both. */
const daysInclusive = (start: Date, end: Date): number => Math.round((end.getTime() - start.getTime()) / DAY) + 1;

/**
 * How often a platform bills, from its last invoice's period — or, with no
 * period printed, from the gaps between its invoices. A quarter or anything
 * else reads as UNKNOWN; its monthly figure is still worked out from the days.
 */
export function cycleOf(latest: { periodStart: Date | null; periodEnd: Date | null }, invoiceDates: Date[]): Cycle {
  const days = periodDays(latest) ?? medianGap(invoiceDates);
  if (days === null) return 'UNKNOWN';
  if (days >= 300) return 'YEARLY';
  if (days >= 25 && days <= 35) return 'MONTHLY';
  return 'UNKNOWN';
}

/** The length of a billing period in days, when one is printed. */
export const periodDays = (inv: { periodStart: Date | null; periodEnd: Date | null }): number | null =>
  inv.periodStart && inv.periodEnd && inv.periodEnd >= inv.periodStart ? daysInclusive(inv.periodStart, inv.periodEnd) : null;

function medianGap(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => Math.round((d.getTime() - sorted[i].getTime()) / DAY)).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * What one invoice costs per month: a yearly plan ÷ 12, a monthly one as is,
 * and anything else by its days. With no period and no cycle, the amount
 * itself — the honest guess for a platform seen once.
 */
export function monthlyEquivalent(amount: number, cycle: Cycle, days: number | null): number {
  if (cycle === 'YEARLY') return amount / 12;
  if (cycle === 'MONTHLY') return amount;
  if (days && days > 0) return (amount * AVG_MONTH_DAYS) / days;
  return amount;
}

/**
 * The rupee figure for an invoice: what the bank charged, else the invoice's
 * own rupees, else dollars at the Settings rate — marked estimated — else
 * nothing, because a euro invoice has no rate to go by.
 */
export function inrOf(
  inv: { currency: string; total: number; inrCharged: number | null },
  usdInrRate: number | null,
): { inr: number | null; estimated: boolean } {
  if (inv.inrCharged !== null && inv.inrCharged !== undefined) return { inr: inv.inrCharged, estimated: false };
  if (inv.currency === 'INR') return { inr: inv.total, estimated: false };
  if (inv.currency === 'USD' && usdInrRate) return { inr: Math.round(inv.total * usdInrRate * 100) / 100, estimated: true };
  return { inr: null, estimated: false };
}

/**
 * When the platform renews next: the day after the last period ends, or a
 * cycle on from the last invoice when no period was printed.
 */
export function nextRenewal(latest: { invoiceDate: Date; periodEnd: Date | null }, cycle: Cycle): Date | null {
  if (latest.periodEnd) return new Date(latest.periodEnd.getTime() + DAY);
  if (cycle === 'UNKNOWN') return null;
  const d = new Date(latest.invoiceDate);
  if (cycle === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

/** "$54.99", "₹1,200.00", "€9.00" — the invoice's own currency, as people read it. */
export function amountText(currency: string, amount: number): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

const dayText = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthText = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

// ── The rows the view and the reminders both read ────────────────────────────

export type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  planName: string | null;
  currency: string;
  subtotal: number | null;
  taxAmount: number | null;
  taxType: string | null;
  total: number;
  inrCharged: number | null;
  vendorGstin: string | null;
  fileId: string;
  costId: string | null;
};

export type PlatformRow = {
  id: string;
  name: string;
  status: string;
  notes: string | null;
  /** Oldest first. */
  invoices: InvoiceRow[];
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Every platform with its live invoices, oldest first. */
export async function loadPlatforms(organizationId: string): Promise<PlatformRow[]> {
  const rows = await prisma.subscriptionPlatform.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
    include: { invoices: { where: { deletedAt: null }, orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }] } },
  });
  return (rows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    notes: p.notes,
    invoices: p.invoices.map((i) => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      planName: i.planName,
      currency: i.currency,
      subtotal: num(i.subtotal),
      taxAmount: num(i.taxAmount),
      taxType: i.taxType,
      total: Number(i.total),
      inrCharged: num(i.inrCharged),
      vendorGstin: i.vendorGstin,
      fileId: i.fileId,
      costId: i.costId,
    })),
  }));
}

/** One platform, worked out: its cycle, what it costs a month, when it renews. */
export function describePlatform(p: PlatformRow, usdInrRate: number | null, fyStart: Date, fyEnd: Date) {
  const latest = p.invoices[p.invoices.length - 1] ?? null;
  const cycle: Cycle = latest ? cycleOf(latest, p.invoices.map((i) => i.invoiceDate)) : 'UNKNOWN';
  const last = latest ? inrOf(latest, usdInrRate) : { inr: null, estimated: false };
  const monthly = latest && last.inr !== null ? monthlyEquivalent(last.inr, cycle, periodDays(latest)) : null;
  const yearInvoices = p.invoices.filter((i) => i.invoiceDate >= fyStart && i.invoiceDate < fyEnd);
  let spentThisYear = 0;
  let yearEstimated = false;
  let yearUnknown = 0;
  for (const i of yearInvoices) {
    const r = inrOf(i, usdInrRate);
    if (r.inr === null) yearUnknown++;
    else {
      spentThisYear += r.inr;
      if (r.estimated) yearEstimated = true;
    }
  }
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    notes: p.notes,
    plan: latest?.planName ?? null,
    cycle,
    lastInvoice: latest
      ? { id: latest.id, date: dayKey(latest.invoiceDate), currency: latest.currency, total: latest.total, inr: last.inr, estimated: last.estimated }
      : null,
    monthlyInr: monthly === null ? null : Math.round(monthly * 100) / 100,
    monthlyEstimated: last.estimated,
    nextRenewal: latest ? (nextRenewal(latest, cycle)?.toISOString().slice(0, 10) ?? null) : null,
    spentThisYear: Math.round(spentThisYear * 100) / 100,
    yearEstimated,
    yearUnknown,
    invoiceCount: p.invoices.length,
  };
}

export type PlatformSummary = ReturnType<typeof describePlatform>;

/** Money → Subscriptions, the whole screen in one answer (decision 5). */
export async function subscriptionsView(organizationId: string, now = new Date()) {
  const [{ timezone, fyStartMonth }, org, platforms] = await Promise.all([
    moneyClock(organizationId),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { usdInrRate: true } }),
    loadPlatforms(organizationId),
  ]);
  const rate = org?.usdInrRate ? Number(org.usdInrRate) : null;
  const today = orgToday(timezone, now);
  const month = monthBounds(orgMonth(timezone, now));
  const fy = financialYearBounds(today, fyStartMonth);
  const todayDate = asStoredDay(today);
  const in30 = new Date(todayDate.getTime() + 30 * DAY);

  const rows = platforms.map((p) => describePlatform(p, rate, fy.start, fy.end));

  let spentThisMonth = 0;
  let spentThisYear = 0;
  let monthEstimated = false;
  let yearEstimated = false;
  let unknown = 0;
  for (const p of platforms) {
    for (const i of p.invoices) {
      const r = inrOf(i, rate);
      if (r.inr === null) {
        if (i.invoiceDate >= fy.start && i.invoiceDate < fy.end) unknown++;
        continue;
      }
      if (i.invoiceDate >= month.start && i.invoiceDate < month.end) {
        spentThisMonth += r.inr;
        if (r.estimated) monthEstimated = true;
      }
      if (i.invoiceDate >= fy.start && i.invoiceDate < fy.end) {
        spentThisYear += r.inr;
        if (r.estimated) yearEstimated = true;
      }
    }
  }
  const active = rows.filter((r) => r.status === 'ACTIVE');
  const runRate = active.reduce((s, r) => s + (r.monthlyInr ?? 0), 0);

  return {
    today,
    rate: { usdInrRate: rate, set: rate !== null },
    totals: {
      spentThisMonth: Math.round(spentThisMonth * 100) / 100,
      monthEstimated,
      spentThisYear: Math.round(spentThisYear * 100) / 100,
      yearEstimated,
      /** Invoices this year in a currency nothing can convert — not in the totals. */
      unknownThisYear: unknown,
      runRate: Math.round(runRate * 100) / 100,
      runRateEstimated: active.some((r) => r.monthlyEstimated),
      activePlatforms: active.length,
    },
    renewingSoon: active
      .filter((r) => r.nextRenewal && asStoredDay(r.nextRenewal) >= todayDate && asStoredDay(r.nextRenewal) <= in30)
      .sort((a, b) => (a.nextRenewal! < b.nextRenewal! ? -1 : 1))
      .map((r) => ({ id: r.id, name: r.name, nextRenewal: r.nextRenewal!, lastInvoice: r.lastInvoice })),
    platforms: rows,
  };
}

// ── Reminders (decision 8) ───────────────────────────────────────────────────

export const SUBSCRIPTION_RULES = {
  renewal: 'SUBSCRIPTION_RENEWAL_DUE',
  priceUp: 'SUBSCRIPTION_PRICE_UP',
  missing: 'SUBSCRIPTION_INVOICE_MISSING',
} as const;

export type SubscriptionAlert = { rule: string; severity: AlertSeverity; entityType: 'SubscriptionPlatform'; entityId: string; message: string };

/** How many days before a renewal the bell rings, and how long after one a missing invoice is asked for. */
export const RENEWAL_WARN_DAYS = 7;
export const MISSING_AFTER_DAYS = 7;

/**
 * The three reminders, from the invoices alone. Pure: the scanner hands in
 * the platforms and today, and compares what comes back with what is open.
 * A cancelled platform is skipped entirely.
 */
export function subscriptionAlerts(platforms: PlatformRow[], today: string): SubscriptionAlert[] {
  const out: SubscriptionAlert[] = [];
  const todayDate = asStoredDay(today);
  for (const p of platforms) {
    if (p.status !== 'ACTIVE' || p.invoices.length === 0) continue;
    const latest = p.invoices[p.invoices.length - 1];
    const cycle = cycleOf(latest, p.invoices.map((i) => i.invoiceDate));
    const renewal = nextRenewal(latest, cycle);
    if (renewal) {
      const daysTo = Math.round((renewal.getTime() - todayDate.getTime()) / DAY);
      if (daysTo >= 0 && daysTo <= RENEWAL_WARN_DAYS) {
        out.push({
          rule: SUBSCRIPTION_RULES.renewal,
          severity: AlertSeverity.MED,
          entityType: 'SubscriptionPlatform',
          entityId: p.id,
          message: `${p.name} renews around ${dayText(renewal)} (about ${amountText(latest.currency, latest.total)}).`,
        });
      } else if (daysTo <= -MISSING_AFTER_DAYS) {
        out.push({
          rule: SUBSCRIPTION_RULES.missing,
          severity: AlertSeverity.LOW,
          entityType: 'SubscriptionPlatform',
          entityId: p.id,
          message: `Upload the ${p.name} invoice for ${monthText(renewal)}?`,
        });
      }
    }
    const previous = p.invoices[p.invoices.length - 2];
    if (
      previous &&
      previous.currency === latest.currency &&
      (previous.planName ?? '').trim().toLowerCase() === (latest.planName ?? '').trim().toLowerCase() &&
      latest.total > previous.total
    ) {
      out.push({
        rule: SUBSCRIPTION_RULES.priceUp,
        severity: AlertSeverity.MED,
        entityType: 'SubscriptionPlatform',
        entityId: p.id,
        message: `${p.name} went up from ${amountText(previous.currency, previous.total)} to ${amountText(latest.currency, latest.total)}.`,
      });
    }
  }
  return out;
}

/** The reminders for one organisation, as the hourly scanner asks for them. */
export async function subscriptionAlertsFor(organizationId: string, now = new Date()): Promise<SubscriptionAlert[]> {
  const platforms = await loadPlatforms(organizationId);
  if (platforms.length === 0) return [];
  const { timezone } = await moneyClock(organizationId);
  return subscriptionAlerts(platforms, orgToday(timezone, now));
}
