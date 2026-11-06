'use client';

/**
 * How Flowzen works — one screen, for everybody.
 *
 * The app grew a screen at a time, and a new person met twenty sidebar items
 * with no thread through them. This is the thread: the six stages a piece of
 * work passes through, one made-up client carried through all six, what each
 * role does on a normal day, and the handful of rules that explain most of
 * what the app refuses to do.
 *
 * It is written, not generated: the facts are the ones in Zen's guide
 * (api/services/zen/flowzen-guide.md). When a screen changes, change both.
 *
 * Open to everyone signed in, like Profile — and it reads differently for
 * each preset: the reader's own stages are marked in the flow, their day comes
 * first, the other roles follow. Links to screens the reader cannot open are
 * shown as plain text rather than a door that will not open when clicked.
 */

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import {
  Bell,
  BookOpen,
  Briefcase,
  CheckCircle2,
  FileText,
  Handshake,
  IndianRupee,
  ListChecks,
  Receipt,
  Search,
  type LucideProps,
} from 'lucide-react';
import { usePageHeader } from '@/hooks/usePageHeader';
import { Card } from '@/components/ui/card';
import { NAV_ITEMS, offered } from '@/config/navigation';
import { useAuthStore } from '@/stores';
import { cn } from '@/lib/utils';

type Icon = ComponentType<LucideProps>;

/**
 * What each preset is called on this page, and which of the six stages are
 * theirs. A Head's day is the department's tasks, so stage 4 is theirs as it
 * is an Employee's; Management is on every stage, because it signs off the
 * deal and reads the money at the end.
 */
const ROLES: Record<string, { name: string; stages: number[] }> = {
  EMPLOYEE: { name: 'Everybody', stages: [4] },
  HEAD: { name: 'Department head', stages: [4] },
  BD: { name: 'Business development', stages: [1, 2, 3] },
  ACCOUNTS: { name: 'Accounts', stages: [5, 6] },
  MANAGEMENT: { name: 'Management', stages: [1, 2, 3, 4, 5, 6] },
};

/** A link to a screen — or its name in plain text when this person cannot open it. */
function Go({ href, children }: { href: string; children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const path = href.split('?')[0];
  const item = NAV_ITEMS.find((i) => path === i.href || path.startsWith(i.href + '/'));
  const can = !item || (user != null && offered(item, user));
  if (!can) {
    return (
      <span className="font-medium text-secondary" title="Not on your sidebar — ask Management if you need it">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
      {children}
    </Link>
  );
}

/** The six stages, in the order work passes through them. */
const STAGES: {
  n: number;
  title: string;
  icon: Icon;
  what: ReactNode;
  example: ReactNode;
  who: string;
}[] = [
  {
    n: 1,
    title: 'A lead comes in',
    icon: Search,
    what: (
      <>
        Somebody who might become a client goes on the <Go href="/outreach">Outreach list</Go>: a name and a phone or email.
        Every call or message is logged there with “Log touch”, and a call-back date keeps it from going quiet.
      </>
    ),
    example: (
      <>
        Varsha meets the marketing head of <b>Carlton Hotels</b> at an event. She adds them as a lead, sets “Follow up” for
        Tuesday, and after the call presses “Mark interested”.
      </>
    ),
    who: 'Business development',
  },
  {
    n: 2,
    title: 'A proposal goes out',
    icon: FileText,
    what: (
      <>
        “Promote to company” turns the lead into a <b>Prospect</b> in <Go href="/companies">Companies</Go>. From the
        company’s Proposals tab, “New proposal” names the kind — a <b>Retainer</b> (monthly) or a <b>Project</b> (one
        time) — the value and the scope. The deal then sits on the <Go href="/pipeline">Pipeline</Go>: Proposal Sent, In
        Negotiation, Proforma Issued, Won or Lost.
      </>
    ),
    example: (
      <>
        Varsha proposes a <b>₹60,000/month social media retainer</b>. Carlton asks for a lower number; she adds version 2
        at ₹55,000. Version 1 is kept.
      </>
    ),
    who: 'Business development',
  },
  {
    n: 3,
    title: 'The deal is won — the Prospect becomes a Client',
    icon: Handshake,
    what: (
      <>
        “Mark won” on the agreed version locks the proposal and makes the company a <b>Client</b>. Nothing else happens
        by itself: somebody then presses “Create retainer from this” or “Create project from this” to set up the work.
      </>
    ),
    example: (
      <>
        Carlton signs at ₹55,000. Varsha marks it won and sets up the retainer: starts 1 Nov, 12-month term, billed in
        advance, and the work is called “Social Media Management”.
      </>
    ),
    who: 'Business development, Management',
  },
  {
    n: 4,
    title: 'The work is done as tasks',
    icon: ListChecks,
    what: (
      <>
        Every task belongs somewhere: a retainer’s month, a project, an internal project, or “No project” for a one-off
        studio job. Each person sees their own on <Go href="/my-work">My Work</Go>; a Head sees their department on{' '}
        <Go href="/my-department">My department</Go>; everything is on <Go href="/all-work">All tasks</Go> and{' '}
        <Go href="/live-work">Live work</Go>. A task has a due date, a type of work, a priority and a status: To do,
        In progress, On hold (waiting on the client — that time is not counted against you), Done.
      </>
    ),
    example: (
      <>
        On 1 Nov the retainer gets its <b>November month card</b>. Dharshini gets “Content calendar — November”,
        type Social Media, due 3 Nov. The client takes four days to approve it; she sets it On hold, and those four days
        are not held against her.
      </>
    ),
    who: 'Everybody',
  },
  {
    n: 5,
    title: 'It is billed: proforma → invoice → payment',
    icon: Receipt,
    what: (
      <>
        Money moves in three documents, always in this order. A <b>proforma</b> asks the client to pay. The{' '}
        <b>invoice</b> is the tax invoice raised in Tally and recorded here by number. A <b>payment</b> is recorded
        against the invoice, and when payments reach the amount it is Paid. All of it is on{' '}
        <Go href="/money?tab=billing">Money → Billing</Go>, which lists every month and milestone waiting for its next
        document. A project bills by milestones instead of months — Advance 40%, Phase 1 sign-off 30%, Final 30% by
        default.
      </>
    ),
    example: (
      <>
        On the 1st, Accounts presses “Raise proforma” for Carlton’s November (₹55,000 + 18% GST = ₹64,900). Carlton pays
        on the 9th; the Tally invoice number is entered and the payment recorded. The month shows <b>Paid</b>.
      </>
    ),
    who: 'Accounts',
  },
  {
    n: 6,
    title: 'Management sees the money',
    icon: IndianRupee,
    what: (
      <>
        <Go href="/money">Money</Go> shows what was billed, collected, outstanding and overdue, and “Profit &amp; Costs”
        works out each client’s profit: fee minus direct costs minus the share of salaries from the{' '}
        <Go href="/allocations">Time split</Go> (what % of each person’s month went to which client). The{' '}
        <Go href="/brief">Monday brief</Go> and the <Go href="/forecast">Forecast</Go> read all of this and say what
        needs attention. Platform spend is on <Go href="/subscriptions">Subscriptions</Go>.
      </>
    ),
    example: (
      <>
        November: Carlton’s fee ₹55,000, a ₹4,000 boosted-post cost, and Dharshini spent 40% of her month on them.
        Money shows Carlton’s profit for the month and its margin. In March the Forecast flags that the retainer renews
        in 45 days.
      </>
    ),
    who: 'Management, Accounts',
  },
];

/** What a normal day looks like, by role. */
const DAYS: { role: string; lines: ReactNode[] }[] = [
  {
    role: 'Everybody',
    lines: [
      <>
        Open <Go href="/my-work">My Work</Go>: Overdue, Due today, Later this week. Change a status or a date on the row.
      </>,
      <>“Task for myself” for anything nobody gave you. Keep it On hold while you wait on the client.</>,
      <>
        The bell: your overdue tasks, today’s events, equipment due back. <Go href="/calendar">Calendar</Go> for shoots and
        meetings.
      </>,
    ],
  },
  {
    role: 'Department head',
    lines: [
      <>
        <Go href="/my-department">My department</Go>: who is carrying what, what is late. “Assign a task” from{' '}
        <Go href="/members">Team</Go>.
      </>,
      <>
        <Go href="/all-work">All tasks</Go> to filter by client, type of work or person; <Go href="/live-work">Live work</Go>{' '}
        for every retainer and project in delivery.
      </>,
      <>Once a month, check your people’s time split so client profit is right.</>,
    ],
  },
  {
    role: 'Business development',
    lines: [
      <>
        <Go href="/outreach">Outreach list</Go>: today’s call-backs. “Log touch” after every contact, or the deal counts as
        going quiet.
      </>,
      <>
        <Go href="/pipeline">Pipeline</Go>: move deals along, add versions, raise the proforma, mark won or lost.
      </>,
      <>Follow-ups due show on your My Work too.</>,
    ],
  },
  {
    role: 'Accounts',
    lines: [
      <>
        <Go href="/money?tab=billing">Money → Billing</Go>: every retainer month and project milestone waiting for a proforma,
        an invoice or a payment. “Raise all proformas” on the 1st.
      </>,
      <>“+ Record a cost” for vendor bills — never salaries, those come from Team and the time split.</>,
      <>Chase what the Overdue tile says. Confirm the time split from the 25th.</>,
    ],
  },
  {
    role: 'Management',
    lines: [
      <>
        Monday: <Go href="/brief">Monday brief</Go>, then <Go href="/forecast">Forecast</Go>.
      </>,
      <>
        <Go href="/money">Money → Profit &amp; Costs</Go> for the month just closed. <Go href="/subscriptions">Subscriptions</Go>{' '}
        for what the studio pays Adobe, Canva and the rest.
      </>,
      <>
        <Go href="/logins">Logins</Go> for shared passwords; <Go href="/settings">Setup</Go> for people, departments and rules.
      </>,
    ],
  },
];

/** The rules that explain most of what the app refuses to do. */
const RULES: { title: string; body: ReactNode }[] = [
  {
    title: 'Nothing happens by itself',
    body: 'Winning a deal does not create the retainer or project. A retainer does not stop at its renewal date. A month closes on the 1st, but only its costs lock.',
  },
  {
    title: 'Every task belongs somewhere',
    body: 'A client task sits in a retainer month or a project, because billing and profit need to know whose work it was. Studio work goes under an internal project or “No project”.',
  },
  {
    title: 'Retainer money and project money are never added',
    body: 'A retainer is a fee per month; a project is one contract. Each is judged on its own, so a “total” of both would mean nothing.',
  },
  {
    title: 'Three documents, in order',
    body: 'Proforma, then invoice, then payment. A milestone or a month moves only when its document is recorded — there is no “mark paid” button.',
  },
  {
    title: 'Salaries are never a cost you type in',
    body: 'Each person’s monthly cost sits on Team (Setup access only) and reaches client profit through the time split. Typing a salary as a cost would count it twice, so Flowzen refuses it.',
  },
  {
    title: 'Figures you may not see read “Hidden”',
    body: 'Never ₹0. If a number is blank or “—”, it is not yours to see, or it has not been entered — it is not zero.',
  },
  {
    title: 'The bell clears itself',
    body: 'Alerts are checked hourly and disappear when the problem does: pay the invoice, finish the task, log the touch. Nobody has to dismiss them.',
  },
  {
    title: 'What you can open is what the API lets you do',
    body: 'Your preset (Employee, Head, BD, Accounts, Management) plus any extras ticked in Team → Access & permissions. A screen you cannot open is not on your sidebar.',
  },
];

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <span className="eyebrow block">{eyebrow}</span>
        <h2 className="mt-1 text-lg font-semibold text-primary">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export default function HowItWorksPage() {
  usePageHeader('How Flowzen works', 'The whole app in one page: the flow, one client carried through it, and what each role does.');
  const user = useAuthStore((s) => s.user);
  const me = ROLES[user?.preset ?? ''] ?? ROLES.EMPLOYEE;
  const mine = (n: number) => me.stages.includes(n);
  // The reader's own day first; the other roles after it.
  const days = [...DAYS].sort((a, b) => Number(b.role === me.name) - Number(a.role === me.name));

  return (
    <div className="page-shell space-y-10 pb-12">
      {/* The one line, and the flow in a row. */}
      <Card padding="lg" className="bg-primary text-white">
        <div className="flex items-start gap-4">
          <BookOpen className="mt-0.5 h-6 w-6 shrink-0 text-white/70" />
          <div className="min-w-0">
            <p className="text-lg font-semibold leading-snug">
              Find the client. Agree the work. Do it as tasks. Bill it. See the money.
            </p>
            <p className="mt-1 text-sm text-white/75">
              That is the whole of Flowzen. Everything on the sidebar is one of those five steps, or a report on them.
            </p>
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              You: {me.name} — your part is {me.stages.length === 6 ? 'every stage' : `stage ${me.stages.join(', ')}`}, marked below
            </p>
          </div>
        </div>
        <ol className="mt-6 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((s) => (
            <li
              key={s.n}
              className={cn(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5',
                mine(s.n) ? 'bg-white/25 ring-2 ring-accent/70' : 'bg-white/10 opacity-70',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-bold">
                {s.n}
              </span>
              <s.icon className="h-4 w-4 shrink-0 text-white/70" />
              <span className="truncate text-xs font-medium">{s.title.split(' — ')[0]}</span>
            </li>
          ))}
        </ol>
      </Card>

      <Section eyebrow="The flow" title="Six stages, and Carlton Hotels through all six">
        <ol className="space-y-3">
          {STAGES.map((s) => (
            <li key={s.n}>
              <Card padding="none" className={cn('overflow-hidden', mine(s.n) && 'border-l-4 border-l-accent')}>
                <div className="grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white',
                          mine(s.n) ? 'bg-accent' : 'bg-primary',
                        )}
                      >
                        {s.n}
                      </span>
                      <s.icon className="h-5 w-5 shrink-0 text-secondary" />
                      <h3 className="text-base font-semibold text-primary">{s.title}</h3>
                      {mine(s.n) && (
                        <span className="rounded-full bg-warning-tint px-2.5 py-0.5 text-micro font-bold uppercase tracking-wider text-warning-ink">
                          Your stage
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-body">{s.what}</p>
                    <p className="mt-3 text-micro text-secondary">
                      <span className="eyebrow">Who</span> · {s.who}
                    </p>
                  </div>
                  <div className="border-t border-border bg-subtle/60 p-5 lg:border-l lg:border-t-0">
                    <span className="eyebrow block text-accent">For example</span>
                    <p className="mt-2 text-sm leading-relaxed text-body">{s.example}</p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="A normal day" title={`Your day as ${me.name}, then everyone else’s`}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {days.map((d) => (
            <Card
              key={d.role}
              padding="md"
              className={cn(d.role === me.name && 'border-accent bg-warning-tint/40 md:col-span-2 xl:col-span-3')}
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold text-primary">
                {d.role}
                {d.role === me.name && (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-white">You</span>
                )}
              </h3>
              <ul className="mt-3 space-y-2.5">
                {d.lines.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-body">
                    <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-success" />
                    <span className="min-w-0">{line}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          <Card padding="md" className="bg-subtle/60">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-secondary" />
              <h3 className="text-sm font-semibold text-primary">The bell, for everybody</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-body">
              Flowzen checks every hour and tells the right person: a task overdue, a client quiet for 21 days, a
              proposal with no contact for 5 days, an invoice past due, a retainer renewing within 45 days, equipment not
              back. Each alert goes away on its own once the thing is fixed. Open alerts are emailed at 08:00.
            </p>
          </Card>
        </div>
      </Section>

      <Section eyebrow="The rules" title="Eight things the app will not do, and why">
        <div className="grid gap-3 md:grid-cols-2">
          {RULES.map((r) => (
            <Card key={r.title} padding="md" className={cn('border-l-4 border-l-accent')}>
              <h3 className="text-sm font-semibold text-primary">{r.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-body">{r.body}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section eyebrow="Where is…" title="The quick map">
        <Card padding="md">
          <dl className="grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2">
            {(
              [
                ['My own tasks', <Go href="/my-work">My Work</Go>],
                ['A client, and everything about them', <Go href="/companies">Companies</Go>],
                ['Leads not yet clients', <Go href="/outreach">Outreach list</Go>],
                ['Deals in progress', <Go href="/pipeline">Pipeline</Go>],
                ['Proposal documents', <Go href="/quotations">Proposals</Go>],
                ['Every retainer and project being delivered', <Go href="/live-work">Live work</Go>],
                ['Every task in the studio', <Go href="/all-work">All tasks</Go>],
                ['Who is on what, and assigning', <Go href="/members">Team</Go>],
                ['What to bill next', <Go href="/money?tab=billing">Money → Billing</Go>],
                ['Invoices, costs, profit', <Go href="/money">Money</Go>],
                ['What the studio pays for software', <Go href="/subscriptions">Subscriptions</Go>],
                ['Shared passwords', <Go href="/logins">Logins</Go>],
                ['Cameras, lights, laptops', <Go href="/assets">Assets</Go>],
                ['Who spent their month where', <Go href="/allocations">Time split</Go>],
                ['Shoots, meetings, leave', <Go href="/calendar">Calendar</Go>],
                ['People, departments, rules', <Go href="/settings">Setup</Go>],
              ] as [string, ReactNode][]
            ).map(([q, a]) => (
              <div key={q} className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
                <dt className="text-body">{q}</dt>
                <dd className="shrink-0 text-right">{a}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <p className="flex items-center gap-2 text-micro text-secondary">
          <Briefcase className="h-3.5 w-3.5" />
          Stuck on a screen? Ask your Head. Management can also ask Zen, the assistant, which knows every button on every
          page.
        </p>
      </Section>
    </div>
  );
}
