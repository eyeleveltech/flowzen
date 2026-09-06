# Flowzen · Company Asset Management — Build Plan

**Document Version:** 1.0
**Date:** 3 September 2026
**Status:** Build specification
**Reference:** [`docs/MASTER_ARCHITECTURE_PLAN.md`](MASTER_ARCHITECTURE_PLAN.md) · [`docs/SCHEMA_PLAN.md`](SCHEMA_PLAN.md) · [`MIGRATIONS.md`](../MIGRATIONS.md)

---

## 1. What this feature is

A live register of every piece of company-owned equipment, and — the part that
actually earns its keep — a record of **who is holding it right now**.

The register must answer four questions at any moment:

1. **What do we own, and what did it cost?**
2. **Where is it / who has it?**
3. **Is it healthy?** — under warranty, serviced, or broken
4. **What is it worth now?** — book value after depreciation, and when to replace it

Lifecycle: `Buy → Tag → Assign → Use → Service → Return → Retire`

### 1.1 The two tracking modes

The single most important design decision. Asset tracking is really **two
different problems**, and tools that merge them into one become useless at both:

| | **Custody** (long-term) | **Booking** (short-term) |
|---|---|---|
| Example | MacBook assigned to a designer indefinitely | A7IV + 24-70 + 2 lights out for a Friday shoot |
| Frequency of change | Once a year | Every week |
| Has a due date? | No | **Yes** — and goes overdue |
| Question answered | "Who is responsible for this?" | "Is the camera free Friday? Did it come back?" |
| Screen it needs | A person's asset list | An "Out now" board |

Both are in scope. Booking is the higher-value half: production gear that leaves
the office is where an agency actually loses money, and a plain custody register
cannot tell "on a shoot" from "sitting in the cupboard".

**They share one table.** `AssetMovement` carries a `kind` discriminator
(`CUSTODY` | `BOOKING`), exactly as `Cost` carries `CostType`. One table means
one chronological chain of custody per asset — which is the thing you actually
want when a lens goes missing.

---

## 2. Scope

### In scope
- **IT hardware** — laptops, desktops, monitors, phones, external drives, network kit
- **Production gear** — camera bodies, lenses, lighting, audio, gimbals/drones, tripods and support, accessories

### Explicitly out of scope (v1)
- **Furniture and fixtures.** Desks and ACs never move and nobody books them. If
  the CA wants them on the fixed-asset register later, they fit the same schema
  with zero changes — add the category and stop there.
- **Software subscriptions and licences.** Deliberately excluded: they have no
  physical custody, no condition, no serial number, and no depreciation. What
  they *do* have is a recurring monthly charge and a renewal date — which is
  `Cost` with `recurring: true`, machinery that already exists and already has a
  cron job rolling it forward ([`recurringCost.cron.ts`](../apps/api/src/workers/recurringCost.cron.ts)).
  Modelling a Canva seat as an "asset" would corrupt both the register and the
  depreciation report. If seat-level tracking is ever wanted, it is a separate
  `Subscription` model, not this one.

### Hard constraint: no file uploads

Attachments were built and then **withdrawn on 2026-08-05**
([`PRODUCT_GAPS.md`](../PRODUCT_GAPS.md)) — uploads had no per-org quota, and on
a single VPS a full disk also stops Postgres writing. Bills, warranty cards and
asset photos are therefore **URL strings pointing at Drive**, following the
existing `driveLink` / `receiptUrl` convention. This is a schema decision, not a
"phase 2 improvement".

---

## 3. Data model

Three new models, five new enums, one new permission key. Nothing existing is
altered except additive relation fields.

### 3.1 Enums

```prisma
enum AssetCategory {
  LAPTOP
  DESKTOP
  MONITOR
  PHONE
  STORAGE          // SSDs, HDDs, card readers
  NETWORK          // routers, switches, dongles
  CAMERA_BODY
  LENS
  LIGHTING
  AUDIO            // mics, recorders, boom poles
  GIMBAL_DRONE
  SUPPORT          // tripods, sliders, monopods
  ACCESSORY        // batteries, cards, bags
  OTHER
}

enum AssetStatus {
  IN_STOCK     // in the office, free to take
  ASSIGNED     // with a person, long-term custody
  BOOKED_OUT   // out on a shoot, expected back
  IN_REPAIR
  RETIRED      // written off, still on the books at salvage
  SOLD
  LOST
}

enum AssetCondition {
  NEW
  GOOD
  FAIR
  DAMAGED
}

enum AssetMovementKind {
  CUSTODY   // long-term assignment, no due date
  BOOKING   // short-term checkout, has dueAt
}

enum AssetMaintenanceKind {
  SERVICE
  REPAIR
  AMC
}
```

### 3.2 `Asset`

```prisma
model Asset {
  id             String         @id @default(cuid())
  organizationId String

  // Identity
  tag            String         // "EL/CAM/001" — printed on the sticker
  name           String         // "Sony A7 IV"
  category       AssetCategory
  make           String?
  model          String?
  serialNumber   String?

  status         AssetStatus    @default(IN_STOCK)
  condition      AssetCondition @default(GOOD)

  /// Does this item go out on shoots? Drives whether the booking actions and
  /// the "Out now" board offer it at all. A monitor is never bookable; a lens
  /// always is. Kept as a flag rather than inferred from category so an
  /// office-bound spare laptop can be excluded by hand.
  bookable       Boolean        @default(false)

  // ─── Money ───────────────────────────────────────────────────────────────
  /// The CAPITAL Cost row that bought this. The asset does NOT own the spend —
  /// it points at the single place the money was already recorded, so the
  /// register and the P&L can never disagree about what was paid.
  costId         String?
  purchasePrice  Decimal        @db.Decimal(12, 2)
  purchasedAt    DateTime       @db.Date
  vendor         String?
  invoiceNumber  String?
  /// Straight-line inputs. Defaulted per category from ASSET_USEFUL_LIFE in
  /// @flowzen/shared, overridable per asset because the CA occasionally
  /// disagrees with the default for one specific purchase.
  usefulLifeMonths Int
  salvageValue   Decimal        @default(0) @db.Decimal(12, 2)
  /// Set only when status becomes SOLD — what it actually fetched, which is
  /// rarely the book value and is what a gain/loss line needs.
  disposedAt     DateTime?      @db.Date
  disposalValue  Decimal?       @db.Decimal(12, 2)
  disposalNote   String?

  warrantyUntil  DateTime?      @db.Date
  insuredUntil   DateTime?      @db.Date

  // ─── Links, not uploads (see §2) ─────────────────────────────────────────
  billUrl        String?
  photoUrl       String?
  notes          String?        @db.Text

  /// Denormalised pointer to whoever holds it, so the register list can render
  /// 200 rows without an N+1 over movement history. The open AssetMovement row
  /// remains the source of truth; one writer keeps the two in step.
  currentHolderId String?

  deletedAt      DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  cost           Cost?          @relation(fields: [costId], references: [id], onDelete: SetNull)
  currentHolder  User?          @relation("AssetHolder", fields: [currentHolderId], references: [id], onDelete: SetNull)
  movements      AssetMovement[]
  maintenance    AssetMaintenance[]

  @@unique([organizationId, tag])
  @@index([organizationId, status])
  @@index([organizationId, category])
  @@index([currentHolderId])
  @@map("assets")
}
```

> **Serial numbers are not unique-constrained.** Plenty of genuine kit ships
> without one, and a partial unique index on a nullable column is a foot-gun.
> Duplicate serials are surfaced as a *warning* at create time instead, reusing
> the shape of [`services/duplicateCheck.ts`](../apps/api/src/services/duplicateCheck.ts).

### 3.3 `AssetMovement` — the chain of custody

```prisma
model AssetMovement {
  id             String            @id @default(cuid())
  assetId        String
  kind           AssetMovementKind
  userId         String            // who is holding it

  /// BOOKING only — what the gear went out for. Both nullable: plenty of
  /// shoots are internal or pre-sales and belong to no billable work item.
  projectId      String?
  monthCardId    String?
  purpose        String?

  outAt          DateTime          @default(now())
  /// Null for CUSTODY (open-ended). Required for BOOKING — it is what makes
  /// an overdue alert possible at all.
  dueAt          DateTime?
  returnedAt     DateTime?

  issuedById     String
  receivedById   String?
  conditionOut   AssetCondition
  conditionIn    AssetCondition?
  notes          String?           @db.Text

  createdAt      DateTime          @default(now())
  updatedAt      DateTime          @updatedAt

  asset          Asset             @relation(fields: [assetId], references: [id], onDelete: Cascade)
  user           User              @relation("AssetMovementHolder", fields: [userId], references: [id])
  issuedBy       User              @relation("AssetMovementIssuer", fields: [issuedById], references: [id])
  receivedBy     User?             @relation("AssetMovementReceiver", fields: [receivedById], references: [id], onDelete: SetNull)
  project        Project?          @relation(fields: [projectId], references: [id], onDelete: SetNull)
  monthCard      MonthCard?        @relation(fields: [monthCardId], references: [id], onDelete: SetNull)

  @@index([assetId, outAt])
  @@index([userId, returnedAt])
  @@index([returnedAt, dueAt])   // the overdue scan
  @@map("asset_movements")
}
```

**Invariant:** an asset has **at most one** `AssetMovement` with
`returnedAt: null`. Enforced in the service layer inside a transaction, not by a
constraint — Postgres cannot express "at most one null per group" without a
partial unique index, and the transaction is the honest place for it anyway
since `Asset.status` and `Asset.currentHolderId` must move in the same commit.

### 3.4 `AssetMaintenance`

```prisma
model AssetMaintenance {
  id          String               @id @default(cuid())
  assetId     String
  kind        AssetMaintenanceKind
  vendor      String?
  /// Repair spend. Optionally mirrored into a COMPANY Cost row — see §6.4.
  amount      Decimal?             @db.Decimal(12, 2)
  costId      String?
  sentAt      DateTime             @db.Date
  returnedAt  DateTime?            @db.Date
  notes       String?              @db.Text
  createdById String
  createdAt   DateTime             @default(now())
  updatedAt   DateTime             @updatedAt

  asset       Asset                @relation(fields: [assetId], references: [id], onDelete: Cascade)
  cost        Cost?                @relation(fields: [costId], references: [id], onDelete: SetNull)
  createdBy   User                 @relation("MaintenanceCreator", fields: [createdById], references: [id])

  @@index([assetId, sentAt])
  @@map("asset_maintenance")
}
```

### 3.5 Additive changes to existing models

```prisma
// Organization
assets             Asset[]
assetTagPrefix     String  @default("EL")   // "EL" → EL/CAM/001

// User
heldAssets         Asset[]            @relation("AssetHolder")
assetMovements     AssetMovement[]    @relation("AssetMovementHolder")
issuedMovements    AssetMovement[]    @relation("AssetMovementIssuer")
receivedMovements  AssetMovement[]    @relation("AssetMovementReceiver")
createdMaintenance AssetMaintenance[] @relation("MaintenanceCreator")

// Cost
assets             Asset[]            // a capital cost may back one asset
assetMaintenance   AssetMaintenance[]

// Project / MonthCard
assetMovements     AssetMovement[]
```

All additive. No column is dropped, renamed or retyped, so the migration carries
**zero data-loss risk** under the [`MIGRATIONS.md`](../MIGRATIONS.md) gate.

---

## 4. Depreciation and book value

Straight-line, computed on read, **never stored** — the same discipline the app
already applies to retainer profitability. A stored book value is wrong the day
after it is written.

```
monthlyDepreciation = (purchasePrice − salvageValue) ÷ usefulLifeMonths
monthsElapsed       = whole months between purchasedAt and asOf
bookValue(asOf)     = max(salvageValue, purchasePrice − monthlyDepreciation × monthsElapsed)
```

Once `monthsElapsed ≥ usefulLifeMonths` the asset is **fully depreciated** — it
sits at salvage value and is flagged *due for replacement*. It is not
auto-retired; a five-year-old lens that still works is still an asset.

### 4.1 Default useful life by category

Shipped as `ASSET_USEFUL_LIFE` in `@flowzen/shared/constants`, overridable per
asset:

| Category | Months | Category | Months |
|---|---|---|---|
| `LAPTOP` / `DESKTOP` | 36 | `CAMERA_BODY` | 60 |
| `MONITOR` | 60 | `LENS` | 84 |
| `PHONE` | 24 | `LIGHTING` / `AUDIO` / `SUPPORT` | 60 |
| `STORAGE` / `NETWORK` | 36 | `GIMBAL_DRONE` | 36 |
| `ACCESSORY` | 24 | `OTHER` | 60 |

These follow the Companies Act Schedule II shape (end-user computing devices at
3 years, office equipment at 5), with lenses stretched because they genuinely
outlive bodies. **They are defaults, not advice — worth one conversation with
the CA before the first FY report goes out**, since the Income Tax written-down-value
rates differ from Companies Act straight-line lives, and it is the CA's call
which basis the register should mirror.

### 4.2 Financial-year register

`GET /api/assets/register?fy=2026-27` produces the schedule an accountant
expects, one row per asset:

`Tag · Name · Category · Purchase date · Purchase price · Opening WDV · Depreciation for the year · Closing WDV · Status`

The FY window comes from `Organization.financialYearStart` (already there,
defaulting to April) — no new setting. CSV via the existing
[`utils/csvResponse.ts`](../apps/api/src/utils/csvResponse.ts) helper, exactly as
the cost register exports today.

---

## 5. Permissions

One new key: **`asset.manage`**.

| Action | Requires |
|---|---|
| See the catalogue, who holds what, availability | *any authenticated user* |
| See purchase price, book value, depreciation | `money.figures` |
| Add / edit / retire an asset | `asset.manage` |
| Assign custody, check out, check in | `asset.manage` |
| Log maintenance | `asset.manage` |
| FY register export | `money.figures` **and** `asset.manage` |

Preset changes in [`packages/shared/src/types/index.ts`](../packages/shared/src/types/index.ts):

```ts
EMPLOYEE:   unchanged                       // read-only catalogue
HEAD:       unchanged                       // read-only catalogue
BD:         unchanged                       // read-only catalogue
ACCOUNTS:   unchanged                       // read-only catalogue
MANAGEMENT: [...existing, 'asset.manage']   // the only preset that issues gear
```

**Management issues all gear.** No other preset gets the key. A head or a video
lead can see the whole catalogue, check availability and read the Out now board,
but the act of handing an asset over — assign, check out, check in, retire — is
management's alone.

Two mechanical notes on that:

- `preset: MANAGEMENT` already answers yes to every permission through the master
  bypass in `hasPermission()` ([`middleware/auth.ts:38`](../apps/api/src/middleware/auth.ts#L38)),
  and its preset list already carries `setup.admin`, which `canSee()` in
  [`config/navigation.ts`](../apps/web/src/config/navigation.ts) mirrors on the
  client. Listing `asset.manage` in the preset is therefore belt-and-braces — it
  changes no behaviour today, but it keeps the preset table honest about what the
  role can do, and it survives any future narrowing of the bypass.
- **The escape hatch is per-user, not per-role.** `User.permissions` is a free
  array that `resolvePermissions()` unions over the preset at **login time**
  ([`middleware/auth.ts:27`](../apps/api/src/middleware/auth.ts#L27)). If one
  specific person — a studio manager on the `HEAD` preset, say — should be able
  to issue gear, an admin adds `asset.manage` to that one account from the team
  screen. No preset change, no migration; they pick it up on their next token.

The practical consequence, worth being clear-eyed about: **every shoot checkout
needs a management person to perform it.** That is the intended control, but if
gear starts leaving the office without being checked out because nobody with the
key was around, the fix is the per-user override above rather than loosening the
preset.

**Price masking** follows the `User.monthlyCost` precedent: the API strips
`purchasePrice`, `salvageValue`, `bookValue` and `disposalValue` from the payload
for callers without `money.figures`, rather than sending them and hiding them in
the UI.

---

## 6. API surface

New router `apps/api/src/routes/assets.ts`, mounted at `/api/assets` in
[`src/index.ts`](../apps/api/src/index.ts) alongside the others.

### 6.1 Register

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/assets` | Filters: `category`, `status`, `holderId`, `bookable`, `q`, `dueForReplacement`. Paginated via `parsePagination`; `?format=csv` supported. |
| `GET` | `/api/assets/summary` | Counts by status and category, total purchase value, total book value, count out now, count overdue. |
| `POST` | `/api/assets` | `asset.manage`. Auto-suggests the next tag. Optional `costId` link, or `createCost: true` to raise the CAPITAL cost in the same transaction. |
| `GET` | `/api/assets/:id` | Full record plus movement history, maintenance log and computed book value. |
| `PATCH` | `/api/assets/:id` | `asset.manage`. |
| `DELETE` | `/api/assets/:id` | Soft delete to `deletedAt`, restorable from Setup ▸ Trash like costs. |
| `POST` | `/api/assets/:id/retire` | `{ outcome: RETIRED \| SOLD \| LOST, disposalValue?, note }`. Refuses while a movement is open. |

### 6.2 Custody and booking

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/assets/:id/assign` | Opens a `CUSTODY` movement. Refuses if one is already open. → `ASSIGNED` |
| `POST` | `/api/assets/:id/checkout` | Opens a `BOOKING` movement. **`dueAt` required.** Optional `projectId` / `monthCardId`. → `BOOKED_OUT` |
| `POST` | `/api/assets/:id/return` | Closes whichever movement is open, records `conditionIn`. → `IN_STOCK`, or `IN_REPAIR` if returned `DAMAGED` |
| `POST` | `/api/assets/:id/transfer` | Close and reopen against a new holder atomically, so a hand-over never leaves a gap in the chain. |
| `GET` | `/api/assets/out-now` | Every open `BOOKING`, with `overdue: true` where `dueAt < now`. |
| `GET` | `/api/assets/availability?from=&to=` | Bookable assets with no overlapping open booking in the window. |
| `GET` | `/api/users/:id/assets` | What one person is holding. Self-serve for `/profile`; needs `work.team` for anyone else. |

Every mutation writes an `Activity` row (`entityType: 'Asset'`, verbs
`asset.created` / `asset.assigned` / `asset.checked_out` / `asset.returned` /
`asset.retired`), so the audit trail comes free from existing machinery.

### 6.3 Maintenance

`POST /api/assets/:id/maintenance` (→ `IN_REPAIR`) and
`PATCH /api/assets/:id/maintenance/:mid` to close it out (→ `IN_STOCK`).

### 6.4 Where the money goes

- **Purchase** → the `CAPITAL` `Cost` row that already exists in the money
  module. The asset links to it; the amount is never typed twice. On the Money
  screen, a `CAPITAL` cost with no asset attached shows a *"Create asset from
  this"* action.
- **Repair** → optionally mirrored into a `COMPANY` cost. Off by default: small
  repairs are noise in the P&L, and the maintenance log holds the number either way.

---

## 7. Web UI

### 7.1 Navigation

One item added to the **DAILY** section of
[`config/navigation.ts`](../apps/web/src/config/navigation.ts), with **no
`needs` key** — the catalogue is open, per the access decision:

```ts
{ label: 'Assets', href: '/assets', icon: Package }
```

DAILY rather than ADMIN because "is the 24-70 free on Friday?" is a daily
question for the video team, not an administrative one.

### 7.2 Screens

**`/assets` — the register.** Summary strip (total assets · out now · overdue ·
in repair · book value, the last two gated). Tabs: **All · Out now · In repair ·
Retired**. Filters for category, status and holder. Table columns: tag, name,
category, status pill, holder, due back, condition — with price and book value
appearing only for `money.figures`. Row click opens the detail.

**`/assets/[id]` — the detail.** Header with tag, name, status pill and the
action buttons that apply to the current status. Sections: *Specs* (make, model,
serial, condition, warranty, insurance) · *Money* (gated: purchase, linked cost,
depreciation schedule, book value today) · *Chain of custody* (the movement
timeline, newest first, showing every hand-over with condition in and out) ·
*Maintenance log* · *Links* (bill, photo).

**Out now board.** A tab, not a separate route. One card per open booking: asset,
holder, what for, due date, days overdue in red. The screen the video team opens
on a Monday.

**Person's assets.** A block on the `/members` person drawer and on `/profile`
("What I'm holding") — the second matters more than it sounds, because people
return gear when they can see it listed against their own name.

**Setup ▸ Assets tab.** Tag prefix, per-category useful-life defaults, and the FY
register export. Follows the existing `settings/components/*Tab.tsx` shape.

### 7.3 Status colours

Extend `STATUS_COLORS` in [`packages/shared/src/constants/index.ts`](../packages/shared/src/constants/index.ts),
reusing tones already in the system rather than introducing a colour family:

`IN_STOCK` emerald · `ASSIGNED` blue · `BOOKED_OUT` amber · `IN_REPAIR` purple ·
`RETIRED` / `SOLD` slate · `LOST` red

---

## 8. Alerts and background jobs

Four rules added to `evaluateAgencyHealthRules()` in
[`workers/scanner.cron.ts`](../apps/api/src/workers/scanner.cron.ts), matching the
existing rule / severity / `entityType` shape:

| Rule | Fires when | Severity |
|---|---|---|
| `ASSET_OVERDUE` | Open booking past `dueAt` | `MED`, escalating to `HIGH` after 3 days |
| `ASSET_HELD_BY_INACTIVE_USER` | Holder has `active: false` | `HIGH` |
| `ASSET_REPAIR_STALE` | `IN_REPAIR` for more than 14 days | `MED` |
| `ASSET_WARRANTY_EXPIRING` | `warrantyUntil` within 30 days | `LOW` |

No new cron process — these ride the scanner that already runs. Overdue returns
and gear stuck with a departed employee also surface in the Monday brief through
the same alert feed.

### 8.1 Offboarding gate

`PATCH /api/users/:id` setting `active: false` returns **409** with the list of
held assets and their total book value, unless the caller passes `force: true`.
The web deactivate flow shows that list in the confirm modal ("This person is
still holding 3 items worth ₹2.4L") with a *Deactivate anyway* button. A soft
gate, not a hard block — people do leave with a laptop still logged out, and the
register should record reality rather than refuse it.

---

## 9. Build phases

Each phase ends shippable. Nothing here needs a production deploy — the target
is the local app.

**Phase 1 — The spine.** Prisma models and migration · `asset.manage` key and
preset updates · `/api/assets` CRUD and summary · `/assets` register list and
detail · nav item · Activity logging.
*Done when:* every existing piece of gear can be entered and found.

**Phase 2 — Custody and booking.** Assign / checkout / return / transfer ·
`AssetMovement` transaction with the one-open-movement invariant · Out now board
· availability check · person's-assets blocks on `/members` and `/profile` ·
`ASSET_OVERDUE` and `ASSET_HELD_BY_INACTIVE_USER` alerts · offboarding gate.
*Done when:* the video team can see what is out and what is late.

**Phase 3 — Money.** Cost linking in both directions · straight-line book value ·
`money.figures` masking · depreciation panel · FY register CSV · "due for
replacement" filter.
*Done when:* the CA can be handed a fixed-asset schedule without a spreadsheet.

**Phase 4 — Care.** Maintenance log · warranty and insurance tracking ·
`ASSET_REPAIR_STALE` and `ASSET_WARRANTY_EXPIRING` · Setup ▸ Assets tab.

---

## 10. Migration

Additive only — new tables plus new nullable columns and relation fields on
`Organization`, `User`, `Cost`, `Project` and `MonthCard`. No drops, renames or
type changes, so the data-loss gate in [`MIGRATIONS.md`](../MIGRATIONS.md) passes
on inspection.

```bash
# Local
npm run db:migrate -- --name add_asset_management
npm run db:generate
```

Review the generated SQL, confirm it contains only `CREATE TABLE`, `CREATE TYPE`,
`ALTER TABLE ... ADD COLUMN` and `CREATE INDEX`, then commit the migration files.
**Production cutover is deliberately out of scope** — deploys are paused and this
is being built against the local app.

**Seeding the register.** Existing gear gets entered by hand once, via a CSV
importer on `POST /api/assets/import` mirroring the client importer already in
the repo. Roughly a one-hour job for a 60-item inventory, and it is the only way
to get accurate serial numbers and purchase dates in.

---

## 11. Testing

Following the existing `phaseN.test.ts` vitest convention in
[`apps/api/src/routes/`](../apps/api/src/routes/):

- **Invariant** — assigning an already-assigned asset returns 409; the
  one-open-movement rule holds under a concurrent double check-out.
- **Transaction** — a failed movement write leaves `Asset.status` and
  `currentHolderId` untouched.
- **Permissions** — `EMPLOYEE`, `HEAD`, `BD` and `ACCOUNTS` can all list assets
  and read the Out now board, but every one of them 403s on checkout, assign and
  retire; only `MANAGEMENT` succeeds. `EMPLOYEE` and `HEAD` get no
  `purchasePrice` field at all, while `ACCOUNTS` does (it holds `money.figures`)
  and still cannot mutate — the two gates are independent and the test must prove
  it. A `HEAD` granted `asset.manage` as a per-user override can then check out.
- **Depreciation** — book value at purchase, mid-life, at end of life, and past
  end of life (must clamp to salvage, never go negative).
- **FY register** — an asset bought mid-year depreciates for part-months only,
  against an April FY start.
- **Overdue** — `ASSET_OVERDUE` fires on `dueAt` + 1 and escalates on + 3.
- **Playwright** — enter an asset, check it out, see it on Out now, check it back
  in, confirm the timeline.

---

## 12. Decisions recorded, and what is deliberately not being built

| Question | v1 answer |
|---|---|
| Kits — book "camera bag" as one unit? | **No.** Items are booked individually. Kits add a parent-child model and a partial-return problem, for a convenience that a multi-select checkout solves. Revisit if checkout genuinely becomes tedious. |
| Consumables — batteries, SD cards by quantity? | **No.** One row per physical item, or do not track it. A `quantity` column turns the register into a stores ledger and breaks custody, condition and depreciation all at once. |
| Barcode / QR scanning | **Not in v1.** The schema supports it — `tag` is the payload — but it needs a camera permission and a scanner component for a 60-item inventory that a dropdown handles fine. |
| Client-owned gear held by us | **Out of scope.** Different ownership, different liability. Would need an `ownerCompanyId`, which is a schema change, not a setting. |
| Employee-owned gear used for work | **Out of scope.** It is not a company asset and must never enter the depreciation register. |
| Booking approvals | **No.** Whoever has `asset.manage` books; there is no request-and-approve queue. Adding one before anyone has felt the need is process for its own sake. |
| Who issues gear? | **Management only.** `asset.manage` goes to the `MANAGEMENT` preset and nowhere else — see §5. Everyone else reads the catalogue; nobody else hands anything over. Individual exceptions are granted per-user, not by widening a preset. |

### Still worth deciding before Phase 1

1. **Tag format.** This plan assumes `EL/CAM/001` — prefix from
   `Organization.assetTagPrefix`, a three-letter category code, and a
   per-category sequence. Confirm it, because the stickers get printed once.
2. **Depreciation basis.** Companies Act straight-line (assumed here) versus
   Income Tax WDV — the CA's call, and it decides whether §4's arithmetic is what
   the register should show.
