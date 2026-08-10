# Flowzen — How the Application Flows

Written from the code, not from a spec. Every rule below is enforced somewhere real; the file
reference is given so you can check any claim.

> **Viewing this:** the diagrams are Mermaid. In VS Code press `Ctrl+Shift+V` for the Markdown
> preview (install the *Markdown Preview Mermaid Support* extension if the blocks show as text).
> They also render natively on GitHub.

---

## 1. The application map

Three modules, each gated per organisation (`Organization.modules`). Your org has all three on.

```mermaid
flowchart TB
    subgraph CRM["CRM — winning the work"]
        direction TB
        P["Pipeline<br/>Board · List · Analytics"]
        Q["Quotations"]
        R["Renewals"]
        LD["Lost Deals"]
    end

    subgraph PM["PM — delivering the work"]
        direction TB
        C["Clients"]
        PR["Projects"]
        T["Tasks"]
        CAL["Calendar"]
        REP["Reports"]
    end

    subgraph REV["REVENUE — getting paid"]
        direction TB
        SUB["Subscriptions"]
        CON["Contracts"]
        INV["Invoices · Invoice Drafts"]
        PAY["Payments · Receivables"]
        EXP["Expenses"]
    end

    P -->|"deal won"| C
    P -->|"pricing"| Q
    Q -->|"accepted"| CON
    C --> PR --> T
    P -->|"Active Retainer"| SUB
    P -->|"Active Project"| CON
    SUB --> INV --> PAY
    CON --> INV
    R -.->|"reads leads at ACTIVE_RETAINER"| P
```

**The one seam that matters:** the CRM works on **Leads**, everything downstream works on
**Clients**. A Lead becomes a Client at exactly one moment — the win.

---

## 2. End to end: enquiry to cash

```mermaid
flowchart TD
    A["Enquiry arrives<br/><i>manual · CSV import · public API</i>"] --> B["Lead created<br/>stage = NEW_LEAD"]
    B --> C["Work the funnel<br/>Outreach → Meeting → Proposal → Negotiation"]
    C --> D{"Send pricing?"}
    D -->|yes| E["Quotation raised<br/><i>against the LEAD</i>"]
    D -->|no| F
    E --> F{"Won?"}
    F -->|no| G["Lost & Closed<br/>lostReason recorded"]
    F -->|yes| H["Won & Closed<br/>★ CLIENT ACCOUNT CREATED<br/>contacts + quotes carried across"]
    H --> I{"What kind of engagement?"}
    I -->|ongoing| J["Active — Retainer<br/>★ Subscription created"]
    I -->|one-off| K["Active — Project<br/>★ Contract created"]
    J --> L["Deliver: Projects + Tasks<br/><i>on the client</i>"]
    K --> L
    J --> M["Renewals watches<br/>contractEndDate"]
    L --> N["Invoices → Payments"]
    M --> O{"Renew?"}
    O -->|yes| J
    O -->|no| P["Churned"]
    L --> R["Project Completed"]

    style H fill:#111827,color:#fff
    style J fill:#166534,color:#fff
    style K fill:#166534,color:#fff
    style G fill:#7f1d1d,color:#fff
    style P fill:#7f1d1d,color:#fff
```

**The surprise worth knowing:** *"Won & Closed" creates no money record.* Winning marks the deal
won and creates the account. The Subscription or Contract appears at **Active**, because that is
the first moment retainer-vs-project is known — and the two bill completely differently.

---

## 3. The pipeline state machine

Eleven stages. Deliberately free-form — you can skip, jump, and move backwards. Only two moves are
guarded, and both are guarded because they would otherwise desync the board from live billing.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> NEW_LEAD
    NEW_LEAD --> OUTREACH
    OUTREACH --> MEETING
    MEETING --> PROPOSAL
    PROPOSAL --> NEGOTIATION
    NEGOTIATION --> CONTRACT

    state "CONTRACT — Won & Closed" as CONTRACT
    state "ACTIVE_RETAINER" as AR
    state "ACTIVE_PROJECT" as AP
    state "PROJECT_COMPLETED" as PC
    state "CHURNED — Lost & Closed" as CH

    CONTRACT --> AR
    CONTRACT --> AP
    AR --> PC
    AP --> PC
    AR --> CH
    AP --> CH
    NEGOTIATION --> CH
    AR --> ON_HOLD
    AP --> ON_HOLD
    ON_HOLD --> AR

    PC --> NEGOTIATION : needs reopen
    CH --> NEGOTIATION : needs reopen
    AR --> MEETING : needs reopen
```

### The two guards

| Move | Why it is blocked | Response |
|---|---|---|
| Leaving a **closed** deal (Churned / Project Completed) back into the funnel | The board would show it live again while its billing stays terminated | `409 DEAL_CLOSED` — needs `reopen: true` |
| Dragging a **won** deal back past the win line into pre-negotiation | The board would say "Negotiation" while the subscription keeps billing underneath | `409` — needs `reopen: true`, then parks the account |

Both live in `stageTransitionError()` —
[leadStage.service.ts:40](apps/api/src/services/leadStage.service.ts#L40).

---

## 4. What actually happens when you drag a card

Every stage change runs through **one** function, `applyLeadStageEffects()`, inside a single
database transaction. Before it existed, the drag endpoint and the detail-edit endpoint each had
their own copy and had drifted — winning the same deal two different ways produced different
financial records.

```mermaid
flowchart TD
    START["Stage change requested"] --> GUARD{"stageTransitionError?"}
    GUARD -->|blocked| E409["409 — ask for confirmation"]
    GUARD -->|allowed| TX["BEGIN TRANSACTION"]

    TX --> S1["1 · Write stage history<br/><i>from → to, who, when</i>"]
    S1 --> S2{"2 · Is this a<br/>conversion stage?"}
    S2 -->|"CONTRACT / ACTIVE_*<br/>and no client yet"| CONV["ensureClientForLead<br/><i>find-or-create</i>"]
    S2 -->|no| S3
    CONV --> S3["3 · Move client status<br/><i>forward only</i>"]

    S3 --> CASC{"Which status?"}
    CASC -->|CHURNED| CH["Projects → ON_HOLD<br/>Subscriptions → CANCELLED<br/>Contracts → TERMINATED"]
    CASC -->|ONHOLD| OH["Projects → ON_HOLD<br/>Subscriptions → PAUSED"]
    CASC -->|ACTIVE| AC["Subscriptions PAUSED → ACTIVE<br/><i>cancelled ones only if undoing our own churn</i>"]

    CH --> S4
    OH --> S4
    AC --> S4["4 · Revenue automation"]
    S4 --> REV{"Landing stage?"}
    REV -->|ACTIVE_RETAINER| SUB["Create Subscription<br/>renewalStatus = UPCOMING"]
    REV -->|ACTIVE_PROJECT| CON["Create Contract<br/>ONE_TIME"]
    REV -->|"anything else"| NONE["Nothing"]

    SUB --> IDEM{"sourceLeadId<br/>already used?"}
    CON --> IDEM
    IDEM -->|yes| SKIP["Skip — no duplicate"]
    IDEM -->|no| MAKE["Create it"]

    SKIP --> END["COMMIT"]
    MAKE --> END
    NONE --> END

    style TX fill:#111827,color:#fff
    style END fill:#111827,color:#fff
```

### Three rules encoded here

1. **Client status only moves forward.** Dragging a won deal backwards can pause an account
   (`ONHOLD`) but can never write a status saying a billed customer isn't one.
2. **Revenue is idempotent**, keyed on `sourceLeadId`. A deal that leaves and re-enters Active
   never mints a second subscription.
3. **The churn cascade checks for sibling deals first.** Projects hang off the *client*, not the
   deal — so parking one deal must not freeze delivery work belonging to another live deal on the
   same account.

---

## 5. Lead → Client conversion

The account is **found or created** — never blindly created. This is what stops a repeat customer
existing twice.

```mermaid
flowchart TD
    IN["ensureClientForLead(lead)"] --> Q1{"Lead already<br/>has a clientId?"}
    Q1 -->|yes| REACT["Reactivate if not ACTIVE<br/><i>a churned customer who buys again</i>"] --> RET1["return existing · created = false"]

    Q1 -->|no| LOAD["Load the lead's contacts<br/><i>primary first</i>"]
    LOAD --> MATCH{"findMatchingClient<br/><i>by email / phone / name</i>"}

    MATCH -->|found| LINK["Link lead → client<br/>Re-point the lead's quotes<br/>Reactivate if not ACTIVE"] --> RET2["return matched · created = false"]

    MATCH -->|none| NEW["CREATE the account<br/>· identity + billing details<br/>· ALL contacts, primary flag intact<br/>· contact intelligence carried over"] --> RET3["return new · created = true"]

    style NEW fill:#111827,color:#fff
```

**Never deletes, never unlinks.** And `Lead.clientId` is deliberately **not unique** — one account,
many deals.

Deleting a lead uses `onDelete: SetNull`: the sales record can go, the account it produced — with
its projects, payments and history — stays.

---

## 6. The two doors into Clients

```mermaid
flowchart LR
    A["Deal won in pipeline"] -->|"ensureClientForLead"| C["CLIENT<br/>status = ACTIVE"]
    B["CSV bulk import"] -->|"POST /clients/bulk"| C
    D["POST /clients<br/>by hand"] -.->|"403 — deliberately sealed"| X["✗"]

    C --> E["A pipeline card is generated<br/>for every imported client"]
    E --> F["stageForClient()<br/>ONHOLD → On Hold<br/>CHURNED → Churned<br/>else → Active Retainer/Project"]

    style C fill:#111827,color:#fff
    style X fill:#7f1d1d,color:#fff
```

Imported clients get a pipeline card so an existing retainer is visible to **Renewals** — which is
the single thing an imported retainer most needs.

---

## 7. Client lifecycle

Four states, all of which describe a **customer**. There is no "prospect" — a not-yet-customer is a
Lead on the board. The status is never hand-editable; it is driven entirely by the deal's stage.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> ACTIVE : deal won / imported
    ACTIVE --> ONHOLD : deal parked or unwound
    ONHOLD --> ACTIVE : deal resumed
    ACTIVE --> PROJECT_COMPLETED : delivery finished
    ACTIVE --> CHURNED : deal lost
    CHURNED --> ACTIVE : re-won
    PROJECT_COMPLETED --> ACTIVE : new deal won
```

---

## 8. Quotation flow

```mermaid
flowchart TD
    A["Raise a quote"] --> B{"Against what?"}
    B -->|"lead not yet won"| L["leadId set"]
    B -->|"existing customer"| C["clientId set"]
    L --> D["DRAFT"]
    C --> D
    D -->|"generate PDF"| E["SENT"]
    E --> F{"Customer decision"}
    F -->|accepted| G["ACCEPTED"]
    F -->|no reply| H["EXPIRED"]
    F -->|withdrawn| I["CANCELLED"]

    G --> J{"Was it on a lead?"}
    J -->|yes| K["ensureClientForLead<br/>★ account created<br/>quote re-pointed to it"]
    J -->|no| M
    K --> M["Contract created<br/>from the quote"]

    style G fill:#166534,color:#fff
    style K fill:#111827,color:#fff
```

A quote document must point at **exactly one** of client or lead — enforced by the database
constraint `quote_documents_one_party`. When a lead's quote is accepted, the quote is re-pointed to
the new account so the paperwork follows the customer.

---

## 9. Automatic background jobs

```mermaid
flowchart LR
    subgraph Hourly
        A["Task deadline approaching<br/><i>24h lookahead</i>"]
        B["Task overdue<br/><i>IST day boundary</i>"]
    end
    subgraph "Daily 08:00 IST"
        C["Follow-up due / overdue"]
        D["Stale lead scan"]
        E["Daily CRM digest email"]
    end
    A --> N["Notification → assignee"]
    B --> N
    C --> N
    D --> N
    E --> O["settings.crmNotificationEmail"]
```

⚠️ **Both CRM scanners require `assignedToId` to be set.** Today 8 of your 9 leads have no owner, so
follow-up and stale-lead alerts skip them entirely.

---

## 10. Who can do what

```mermaid
flowchart TD
    U["Logged-in user"] --> R{"Role"}
    R -->|SUPER_ADMIN| ALL["Everything"]
    R -->|ADMIN| ALL
    R -->|PROJECT_MANAGER| PM["PM module only<br/><b>no CRM access at all</b>"]
    R -->|TEAM_MEMBER| TM["Own tasks / projects<br/><b>no CRM access at all</b>"]

    style PM fill:#7f1d1d,color:#fff
    style TM fill:#7f1d1d,color:#fff
```

The whole `/api/crm` router is mounted behind `authorize('SUPER_ADMIN','ADMIN')` —
[index.ts:95](apps/api/src/index.ts#L95). This is the biggest structural constraint in the product:
leads can be *assigned* to anyone, and the scanners notify assignees, but a non-admin assignee gets
**403** opening the lead they were notified about.

---

## Quick reference

| Rule | Where |
|---|---|
| A Client is born only at a win or by import | `clientConversion.service.ts` · `POST /clients` returns 403 |
| Money records appear at **Active**, not at Won | `leadStage.service.ts:209` |
| Revenue is idempotent per lead | `sourceLeadId` unique |
| One account, many deals | `Lead.clientId` non-unique |
| Deleting a lead never deletes the account | `onDelete: SetNull` |
| Client status is never hand-set | driven by stage cascade only |
| Renewals reads **leads**, not clients | `GET /crm/renewals` |
