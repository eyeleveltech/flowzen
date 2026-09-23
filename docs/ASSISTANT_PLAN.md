# Making the assistant answer better

Written 23 September 2026. Not built.

## What it does today

One question in, one answer out. On every ask the server builds a fresh
snapshot of the **current month** — retainer fees, costs and margins by client,
overdue invoices, live projects, the open pipeline, task counts per client and
per person — puts it in a system instruction, and sends the question to
`gemini-2.5-flash`. MANAGEMENT only. Every question is logged.

It works. What follows is what stops it working *well*, in the order I would
fix it.

## 1 · It has no memory — half a day

The whole conversation is this:

```ts
contents: [{ role: 'user', parts: [{ text: opts.question }] }],
```

Every question is the first question. Ask "which client is least profitable",
get a good answer, then ask "why?" — and the model has never seen the previous
turn. It has the figures, so it will say something plausible about a client it
picks fresh, which is worse than admitting it does not know.

This is the single biggest gap, because the UI is a chat and a chat implies
memory. Everything about the panel — bubbles, a thread, a scrollback — promises
something the server does not do.

**The fix.** The browser already holds the turns. Send the last ~8 with the
question, and have the server cap and validate them rather than trusting the
client. Gemini's `contents` takes the alternating `user`/`model` array directly,
so this is a shape change, not new machinery.

**The catch to decide.** More turns means more tokens per question, and the
history is re-sent every time. Eight is roughly where a follow-up chain stops
being useful anyway.

## 2 · It can only see this month — half a day

`buildMoneyContext(organizationId, month)` takes a month, the route accepts one
— and the panel never sends it. So the answer to "how does this compare to
August?" is built from September's figures alone, and the model will either say
it cannot tell or, worse, compare September to itself.

**The fix,** smallest first:

- Include the **previous month's** summary rows beside the current one. Most
  comparison questions are month-on-month, and this answers them for the cost of
  a few hundred tokens.
- Let the panel pass a month, so "ask about August" is possible at all.

## 3 · Answers arrive all at once — half a day

`generateContent` returns when the whole answer is ready: three to eight seconds
of three dots. Gemini has `streamGenerateContent`, which sends it as it is
written.

Nothing about the answer improves. It stops *feeling* slow, which for a chat is
most of the perceived quality — and it makes a long answer readable while it is
still being written.

## 4 · Every question is sent everything — half a day

A question about overdue invoices also carries the pipeline, the task counts and
the team roster. Two costs: tokens you pay for, and attention — a model given
six tables answers less precisely than one given the two that matter.

**The fix.** Pick the sections from the question before building the context. A
keyword pass gets most of the way (`overdue|invoice|paid` → money only) and is
worth doing before anything cleverer, because step 5 replaces it.

## 5 · Let it fetch, instead of being handed a dump — two days

The proper shape. Rather than assembling a snapshot and hoping it contains the
answer, give Gemini a few functions and let it call what it needs:

```
getMonthProfit(month)        getOverdueInvoices()
getPipeline(stage?)          getClientHistory(client, months)
getTeamLoad(month)
```

This supersedes 2 and 4 entirely, and makes questions possible that no fixed
snapshot can answer — "has Carlton's margin moved over six months", "what did we
quote TNPA in July". It also shrinks the default payload to almost nothing.

Gemini supports function calling on the same endpoint. The work is defining the
functions, handling the call-and-respond loop, and capping how many round trips
one question may make.

Worth doing **after** 1–3, because those are what people will notice first.

## 6 · The numbers are restated, not verified — half a day

The model reads figures out of JSON and writes them into a sentence. That is
mostly reliable and occasionally not, and in a money context a wrong total is
worse than no answer: it will be repeated in a meeting.

**The fix.** Compute the handful of totals that matter server-side — month
revenue, month cost, margin, total overdue — and put them in the prompt as
figures the model must use rather than derive. Cheap, and it removes the class
of error where it adds a column up wrong.

## 7 · The free tier will not carry this — a decision, not a build

Testing hit `429 rate limit` on an ordinary sequence of questions. With three or
four people using it on a Monday morning that is not an edge case.

Two things to decide:

- **Billing.** A paid key raises the limits. Somebody has to own that cost.
- **A per-organisation rate limit** in Flowzen itself, so the app says "wait a
  moment" in its own words rather than passing Google's refusal through.

## 8 · It cannot do anything — two days, and only if wanted

Read-only today. The natural next question after "Brigade is 40 days overdue" is
"chase them", and the assistant can only suggest that somebody else does it.

If this is wanted, the rule that matters is that it **proposes and you confirm**
— it drafts the email and you press send, it drafts the task and you approve it.
An assistant that acts on an inference about your business is a different risk
from one that talks about it.

## The order I would take it

**1, 3, 2** first — memory, streaming, last month. About a day and a half, and
between them they fix everything a person would notice in the first five
minutes.

**6** next, because it is half a day and it is about figures being right.

**7** whenever somebody is willing to decide about billing.

**5** when the questions being asked start outrunning the snapshot — you will
know, because the answers will start being "that is not in the figures I have".

**4** only if 5 is not happening, and **8** only if it is actually wanted.

## What I would not change

**The data going to Google.** That was decided knowingly and it is what makes
the thing useful. The limits around it — MANAGEMENT only, current month only,
no salaries, every question logged — are the part to keep rather than the part
to revisit.

**The model in Settings.** A dropdown of what the key reports is the only thing
that survives Google retiring names, which has already happened once here.
