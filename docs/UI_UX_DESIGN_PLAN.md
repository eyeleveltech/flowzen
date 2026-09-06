# Flowzen · Modern SaaS UI/UX Design System & Strict Guidelines

**Document Version:** 3.0  
**Date:** 29 August 2026  
**Status:** Design System & UI/UX Specification  
**Design Paradigm:** Modern Minimalist B2B SaaS (Linear / Stripe / Vercel Web Interface Guidelines compliant)

---

## 1. Visual Philosophy & Design Standards

Flowzen is engineered as a **fast, high-density, minimalist B2B SaaS platform**. It eliminates decorative bloat, saturated gradients, and blurry drop-shadows. Depth and visual hierarchy are established purely through **crisp 1px hairline borders**, **subtle surface layering**, and **strict typography**.

```
┌────────────────────────────────────────────────────────────────────────────┐
│                    THE 10 STRICT LAWS OF FLOWZEN DESIGN                    │
├────────────────────────────────────────────────────────────────────────────┤
│ 1. ZERO Fancy Drop Shadows: Cards, rows, panels, and tables sit flat with   │
│    crisp 1px hairline borders (`border border-border`).                    │
│ 2. Subtle Surface Layering: Background `#FAFAFA`, Cards `#FFFFFF`, and      │
│    Hover/Dividers `#F3F4F6`. High contrast, zero visual noise.             │
│ 3. 11px Micro Floor: `text-micro` (11px) is the absolute minimum font size.│
│    No unreadable 8px, 9px, or 10px text.                                   │
│ 4. Strict Typography Hierarchy: Inter with `tabular-nums` for all numbers, │
│    proper ellipsis `…`, and `text-pretty` on headings.                     │
│ 5. Custom Shadcn/Radix Dropdowns: Portaled, keyboard-navigable             │
│    comboboxes with instant search, avatars, and status dots.               │
│ 6. Unified 12px Radius: All cards, buttons, dialogs, and inputs share 12px │
│    (`rounded-xl`) for a sleek, cohesive feel.                             │
│ 7. Semantic-Only Status Colors: Emerald (Good/Paid), Amber (Warn/Waiting),  │
│    Rose (Bad/Overdue), Blue (Info/Sent). Zero arbitrary colors.            │
│ 8. Vercel Accessibility Standard: All icon buttons have `aria-label`,      │
│    `focus-visible:ring-2`, and decorative icons use `aria-hidden="true"`.  │
│ 9. Mobile Drawer Transformation: Modals become slide-up bottom sheets with │
│    swipe-to-dismiss on mobile viewports.                                   │
│ 10. Server-Enforced Field Masking: Users without `money.figures` receive   │
│     no rupee numbers in API payloads (never masked purely in CSS).         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Strict Design Tokens & Palette

### 2.1 Color Ramp (Tailwind CSS v4 Tokens)
Every color maps to an official design token. Raw hex values in components are strictly prohibited.

```css
@theme {
  /* ── Typography Font ── */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;

  /* ── Background & Surface Layers ── */
  --color-surface: #FAFAFA;       /* App background & table zebra striping */
  --color-white: #FFFFFF;         /* Card background, dialog background, input fill */
  --color-subtle: #F3F4F6;        /* Hover states, active segment background, tag fills */
  
  /* ── Borders & Hairlines ── */
  --color-border: #E5E7EB;        /* Standard 1px card and table hairline border */
  --color-line: #D1D5DB;          /* Stronger dividers, disabled borders */

  /* ── Text & Typography ── */
  --color-primary: #111827;       /* Headings, metrics, strong emphasis (Dark Slate) */
  --color-body: #374151;          /* Form labels, table cells, primary copy */
  --color-body-soft: #4B5563;     /* Descriptions, secondary details */
  --color-secondary: #6B7280;     /* Supporting meta, timestamps, icons */
  --color-muted: #9CA3AF;         /* Placeholders, disabled text */

  /* ── Semantic Status Tones ── */
  --color-success: #22C55E;       /* Paid, Won, Active, Good health (Emerald) */
  --color-warning: #F59E0B;       /* In Negotiation, Waiting, Overdue soon (Amber) */
  --color-danger: #EF4444;        /* Overdue, Lost, Cancelled, Overrun (Rose) */
  --color-info: #3B82F6;          /* Proforma issued, Proposal sent (Blue) */

  /* ── Radii ── */
  --radius-card: 12px;            /* standard rounded-xl */
  --radius-button: 12px;
  --radius-input: 12px;

  /* ── Elevation: Strict Flat Flow + Floating Overlays ── */
  --shadow-flat: none;            /* Cards in page flow use 1px border only */
  --shadow-dropdown: 0 4px 16px -2px rgba(17, 24, 39, 0.08), 0 2px 4px -2px rgba(17, 24, 39, 0.04);
  --shadow-modal: 0 20px 48px -12px rgba(17, 24, 39, 0.16), 0 4px 12px -4px rgba(17, 24, 39, 0.08);
}
```

---

### 2.2 Strict Typography Rules (Vercel Web Interface Guidelines Compliant)

| Level | Size | Line Height | Weight | Tracking | Usage & Compliance Rules |
|---|---|---|---|---|---|
| **Display / Metric** | `24px` (`text-2xl`) | `32px` | `600` (Semi-bold) | `-0.02em` | Financial metrics, revenue totals (`font-mono tabular-nums`) |
| **Page Title (H1)** | `20px` (`text-xl`) | `28px` | `600` (Semi-bold) | `-0.015em` | Screen headers (`text-pretty` to prevent orphan words) |
| **Card Header (H2)** | `16px` (`text-base`) | `24px` | `600` (Semi-bold) | `-0.01em` | Card titles, drawer headers, section subtitles |
| **Body / Labels** | `14px` (`text-sm`) | `20px` | `500` (Medium) | `0em` | Form labels, table cells, primary button copy |
| **Supporting / Meta** | `12px` (`text-xs`) | `16px` | `400` (Regular) | `0em` | Subtitles, timestamps, breadcrumbs, helper notes |
| **Micro Floor** | `11px` (`text-micro`)| `16px` | `500` (Medium) | `+0.02em` | Badges, counter pills, uppercase column headers |

> **Formatting Micro-Rules**:
> * Always use proper ellipsis `…` (e.g. `"Loading…"`, `"Search clients…"`) instead of three periods `...`.
> * Monetary amounts (`₹2,20,000`), hours (`14h 20m`), dates (`29 Aug 2026`), and IDs use `tabular-nums` for vertical alignment.
> * Text containers use `truncate` or `line-clamp-*` with `min-w-0` on flex children to prevent horizontal blowout.

---

## 3. Component System & Accessibility Standards

### 3.1 Clean Border Cards (`<Card>`)
No heavy shadows. Cards sit flat with a crisp 1px hairline border.

```tsx
<div className="bg-white border border-border rounded-xl p-5 transition-colors">
  <div className="flex items-center justify-between pb-3 mb-4 border-b border-border/60">
    <h3 className="text-base font-semibold text-primary text-pretty">{title}</h3>
    {action}
  </div>
  <div className="min-w-0">{children}</div>
</div>
```

---

### 3.2 Custom Modern Dropdown & Combobox (Shadcn / Radix Style)
Replaces native browser `<select>` with a portal-rendered, keyboard-navigable combobox.

* **Trigger**: `border border-border bg-white rounded-xl px-3.5 py-2.5 text-sm text-primary flex items-center justify-between hover:bg-subtle/60 transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none`
* **Floating Popover**: `bg-white border border-border rounded-xl shadow-dropdown p-1.5 z-50 animate-in fade-in-80 zoom-in-95`
* **Search Input**: `px-3 py-2 text-sm border-b border-border text-primary placeholder:text-muted focus:outline-none w-full bg-transparent`
* **Item**: `px-3 py-2 text-sm text-body rounded-lg hover:bg-subtle hover:text-primary cursor-pointer flex items-center justify-between transition-colors focus-visible:bg-subtle`
* **Accessibility**: Full keyboard navigation (`↑`/`↓`/`Enter`/`Escape`), `aria-expanded`, `aria-controls`, and `role="combobox"`.

---

### 3.3 Buttons & Focus States
* **Primary Button**: `bg-primary text-white hover:bg-primary-hover rounded-xl px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-offset-1`
* **Secondary / Outline**: `border border-border bg-white text-body hover:bg-subtle hover:text-primary rounded-xl px-4 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/20`
* **Ghost Button**: `text-secondary hover:text-primary hover:bg-subtle rounded-xl px-3 py-1.5 text-sm transition-colors`
* **Icon-Only Buttons**: Must include `aria-label="Description of action"` and `p-2.5` (minimum 44px hit target on touch devices).
* **Loading Button**: Disables and shows inline spinner with `"Saving…"` or `"Creating…"`.

---

### 3.4 High-Density Scannable Tables (`<Table>`)
* **Header**: `bg-subtle/80 text-secondary text-micro uppercase tracking-wider font-semibold px-4 py-3 border-b border-border text-left`
* **Row**: `border-b border-border/60 hover:bg-subtle/60 transition-colors px-4 py-3 text-sm text-body`
* **Numeric Cell**: `font-mono text-right tabular-nums text-primary font-medium`
* **Empty State**: Contextual icon + clear headline + direct action button (e.g. `"+ Add Client"`).

---

### 3.5 Semantic Badges & Chips

```tsx
const BADGE_STYLES = {
  good:    'bg-emerald-50 text-emerald-700 border border-emerald-200/80',
  warn:    'bg-amber-50 text-amber-700 border border-amber-200/80',
  bad:     'bg-rose-50 text-rose-700 border border-rose-200/80',
  info:    'bg-blue-50 text-blue-700 border border-blue-200/80',
  neutral: 'bg-subtle text-secondary border border-border'
};
```

---

## 4. Master Screen Walkthrough (The 12 Core SaaS Screens)

```
FLOWZEN APPLICATION SHELL
┌────────────────────────────────────────────────────────────────────────────┐
│ TOP NAVIGATION: Logo · Active Module Switcher · Global Search (⌘K) · Avatar│
├──────────────┬─────────────────────────────────────────────────────────────┤
│ SIDEBAR      │ MAIN CONTENT AREA (Flat Clean Border Cards & Dense Tables) │
│ • My Work    │                                                             │
│ • Team       │ ┌─────────────────────────────────────────────────────────┐ │
│ • Companies  │ │ Clean Border Card (p-5 bg-white border border-border)   │ │
│ • Outreach   │ │                                                         │ │
│ • Pipeline   │ └─────────────────────────────────────────────────────────┘ │
│ • Proposals  │                                                             │
│ • Live Work  │ ┌─────────────────────────────────────────────────────────┐ │
│ • Money      │ │ High-Density Data Table (Header / Hover Rows / Currency)│ │
│ • Forecast   │ └─────────────────────────────────────────────────────────┘ │
│ • Setup      │                                                             │
└──────────────┴─────────────────────────────────────────────────────────────┘
```

### 4.1 Screen 1: My Work (`/my-tasks` · `work.own`)
*The personal daily cockpit for all 25 team members.*
* **Tabs**: `Today (N)` | `Overdue (N)` | `This Week (N)` | `Completed (N)`.
* **Task Item Card**:
  * Circular checkbox $\rightarrow$ instant done animation.
  * Task Title + Client Chip (`bg-subtle border border-border text-secondary text-micro`).
  * **Working Hours Clock**: Live badge showing elapsed time (`14h 20m`) calculated in Mon–Sat 10:00–19:00 IST.
  * **Waiting Button**: 1-click switch to pause clock (`Waiting on Client` / `Waiting on Person`).

---

### 4.2 Screen 2: Team (`/team` · `work.team`)
*Department capacity radar for Leads and Heads.*
* **Department Filter**: Custom combobox dropdown for Marketing, Design, Video, Dev, BD, Accounts.
* **Capacity Card**: Member Avatar + Name + Load progress bar (`openTasks / trailing 8-week median`).
* **Radar Pills**: Overdue Count (Rose pill), Waiting Count (Amber pill), Average turnaround time.

---

### 4.3 Screen 3: Companies (`/clients` · `company.read`)
*Master relationship directory.*
* **Tabs**: `Prospects (N)` | `Active Clients (N)` | `Past Clients (N)`.
* **Table**: Company Name, Vertical, Primary Contact Person, Owner, Active Retainer/Project chip, Attention Sentence.

---

### 4.4 Screen 4: Outreach Staging (`/outreach` · `company.read`)
*Cold scraped contact list separated from company database.*
* **Table**: Name, Vertical, Source, Status (`Not Contacted`, `Contacted`, `Replied`, `Dead`).
* **Promote Action**: "Replied" button opens the **Promote to Prospect** dialog creating a `Company` record.

---

### 4.5 Screen 5: Pipeline Board (`/pipeline` · `pipeline.read`)
*6-Stage visual sales progression board.*
* **Stages**: `Talking` $\rightarrow$ `Proposal Sent` $\rightarrow$ `In Negotiation` $\rightarrow$ `Proforma Issued` $\rightarrow$ `Verbal Yes` $\rightarrow$ `Won / Lost`.
* **Card**: Company Name, Version Badge (`v2`), Quoted Amount (`₹2,20,000/mo`), Owner, Days in Stage indicator, Move Menu for touch/keyboard.

---

### 4.6 Screen 6: Proposals & Proformas (`/quotations` · `pipeline.read`)
* **Proposals Tab**: Proposal register with version badges, discount given, and PDF download action.
* **Proformas Tab**: Sequential registry (`EL/PI/26-27/012`), client name, amount, raise date, validity date, payment status.

---

### 4.7 Screen 7: Live Work (`/live-work` · `work.all`)
* **Retainers Tab**: Active retainers, current Month Card link (`October 2026`), renewal warnings ($< 45\text{ days}$), contract risk badge if no fixed term.
* **Projects Tab**: Fixed projects, Quoted vs Estimated cost, milestone delivery timeline.

---

### 4.8 Screen 8: Monday Brief (`/brief` · `reports.read`)
*Weekly management intelligence cockpit.*
* **AI Summary**: 3-paragraph executive narrative on cashflow, milestones, and bottlenecks.
* **Ask the Business**: Natural language input to query data (scoped to user permissions with record citations).
* **Alert Center**: Grouped high/medium/low alerts from the 12 business rules.

---

### 4.9 Screen 9: Money & Profitability (`/money` · `money.figures`)
*Commercial financial engine.*
* **Profit by Client**: Client Name | Revenue | Direct Costs | People Cost | **Job Profit (₹)** | **Gross Margin (%)**.
* **Company Monthly P&L**: Total Revenue - Direct Costs - Company Overheads - Salaries = **Net Company Profit**.
* **Collections Ledger**: Overdue Tally invoices ranked by payment aging.

---

### 4.10 Screen 10: 3-Month Forecast (`/forecast` · `reports.read`)
*Cashflow radar.*
* Separate curves for **Committed Retainers**, **Weighted Pipeline Proposals**, and **Project Milestones**.

---

### 4.11 Screen 11: Setup (`/settings` · `setup.admin`)
*System configuration.*
* **Tabs**: Team & Salaries, Permission Preset Matrix, Task Templates for Month Cards, Numbering Series.

---

### 4.12 Screen 12: Build Spec (`/docs` · `setup.admin`)
*In-app living developer specification.*

---

## 5. Master Detail Cockpits

1. **Company Record Detail (`/clients/[id]`)**: 4 Tabs — Overview, Proposals (version tree), Money (invoices/costs), and Audit History.
2. **Month Card Detail (`/retainers/[id]/[month]`)**: Task checklist, direct costs ledger, confirmed people allocations %, and gross margin calculation.
3. **Project Detail (`/projects/[id]`)**: Quoted vs Estimated vs Actual cost card, milestone billing schedule, and task board.

---

## 6. The 9 Standard Modal Forms

1. `TaskModal` · 2. `CompanyModal` · 3. `PersonModal` · 4. `ProposalModal` · 5. `ProposalVersionModal` · 6. `ProjectModal` · 7. `CostModal` · 8. `ProformaModal` · 9. `InvoiceModal`
* All modals use `useModalSafety` (Escape key, dirty confirmation, mobile bottom sheet transformation).
