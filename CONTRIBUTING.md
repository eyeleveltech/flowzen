# Contributing Guidelines & Terminology Standard

To maintain consistency across the Flowzen UI, please adhere to our domain terminology standard when writing user-facing strings, labels, table headers, and error messages.

## Lexicon & User-Facing Terminology

| Domain Concept | User-Facing Term | Forbidden / Deprecated Terms | Notes |
| :--- | :--- | :--- | :--- |
| **Organization / Client** | **Client** | Company, Organization, Account | In UI labels, column headers, and form fields, always use **Client** (e.g., "Client name", "Select client", "All clients"). |
| **Sales Opportunity** | **Lead** | Deal, Opportunity, Sale | In UI text, sales pipeline entries are called **Leads** (e.g., "Active leads", "Lost leads", "Add lead"). |
| **Pipeline Stages** | **New Lead**, **Outreach**, **Meeting**, **Proposal**, **Negotiation**, **Won & Closed**, **Churned** | Closed Won, Closed Lost, Deal Won | Canonical stage names defined in `@flowzen/shared`. |
| **Post-Sales Work** | **Project**, **Task** | Job, Engagement | Post-won delivery entities. |
| **Financial Instruments** | **Quotation**, **Contract**, **Invoice**, **Payment**, **Subscription** | Bill, Agreement | Revenue entities. |

### Technical Identifier Exception
To preserve database schemas, REST endpoint routes, and CSV import schemas, code identifiers and DB column names retain their established names:
- DB columns / API fields: `companyName`, `dealValue`, `companySize`, `lostReason`
- API routes: `/api/lost-deals`, `/api/crm`
- Form state keys: `companyName`, `dealValue`
