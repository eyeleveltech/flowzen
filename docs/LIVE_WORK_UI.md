# Live work → retainer → project → task: making the screen usable

Written 23 September 2026. Not built.

## What the flow is

```
/live-work            every retainer and one-off project
  └─ retainer         one client, one month at a time
      └─ project      a named stream of work — no money on it
          └─ tasks    the actual work, for that month
```

The structure is right. The problem is that each level spends most of the
screen on chrome before showing any of the level below it, so by the time you
reach the work you are near the bottom of the page — and a month with twenty
tasks is unreadable.

## What is actually wrong

### 1 · The list page reports contracts, not work

`/live-work`'s retainer table has six columns:

```
Client | Owner | Monthly | Contract | Renewal | Projects
```

Every one of those is a fact about the **agreement**. None of them tells you
whether anything is late. The only work signal on the row is a progress bar
computed from `monthTasksDone / monthTasksTotal`, and a bar at 60% looks the
same whether the missing 40% is due next week or was due last Tuesday.

So the flow starts by making you click into every client to find out which one
needs you. That is the wrong way round: the list should tell you where to go.

The API does not send a late count today, but it already loads the month's
tasks to compute the two it does send — so the number is one filter away.

### 2 · Roughly half the retainer screen is gone before any work appears

Measured from the current page, top to bottom:

| | approx. |
|---|---|
| Page header — client, badges, five action buttons | 80px |
| Month navigator + "created automatically on the 1st · owner · no fixed term" | 40px |
| Four stat tiles — TASKS, FEE, COST SO FAR, PROFIT | 140px |
| Banner — "Month cards appear on their own" | 70px |
| Tabs — Projects / Costs / Allocations / Invoice | 50px |
| "Projects" heading + explainer + button | 60px |
| **before the first project card** | **~440px** |

Open a project and you keep all of that, then add the project's own header and
a month-group header before the first task row — about **580px**. On a laptop
that is the whole fold spent before a single task.

The banner is the clearest waste: it explains that month cards open by
themselves. True, useful the first time, and permanent.

### 3 · The stats describe the month, but you are looking at a project

Inside "Social media management", the TASKS tile still counts the whole month
across every project. So the number at the top of the screen and the list under
it are answering different questions, and the one in the bigger type is the one
you did not ask.

### 4 · Twenty tasks is one flat table

No grouping, no filter, no collapse. Done tasks take the same room as open
ones, and a late task looks like everything else until you read the date.

### 5 · There is no way to see the month's work as one list

Tabs are Projects / Costs / Allocations / Invoice. To answer "what is due this
week for this client" you open each project in turn and hold it in your head.

## The plan

Ordered by value per hour. Each step stands alone — stop after any of them.

### 1 · Put the work signal on the list — half a day

Add `monthTasksLate` to `GET /retainers` (the tasks are already loaded in that
handler; it is one `filter` beside the two counts already there). Then change
the **Projects** column to carry the state, not just the count:

```
Projects
3 projects · 2 late          ← red when late > 0
Performance marketing, Social media marketing
```

And sort retainers with late work to the top by default.

This is the highest-value change on the list, because it converts the page from
a directory into a triage screen — you look once and know where to go.

### 2 · Reclaim the fold — half a day

- **Delete the "Month cards appear on their own" banner.** It is onboarding
  text living in a permanent slot.
- **Compact the four tiles into one strip.** The numbers matter; 140px of them
  does not. One row of `label: value` pairs holds the same information in ~50px.

Together that is roughly 160px back, which is the difference between projects
being below the fold and above it.

### 3 · Make the task list survive twenty tasks — one day

- **Group by status**, with *Done* collapsed behind a count. Most of a busy
  month's rows are finished work nobody is reading.
- **Filter chips**: All · Open · Late · Mine. Default to Open.
- **Sticky project header** carrying the project name and the + Task button, so
  the way to add work does not scroll away from the work.

### 4 · One list for the whole month — half a day

A toggle at the top of the Projects tab:

```
[ By project ]  [ All tasks ]
```

*All tasks* shows the month's work as a single list with a project column,
sorted by due date. That is the view that answers "what is due this week", and
it is the same data already fetched, grouped differently.

### 5 · Consider inline expansion instead of drill-in — one day

Today, opening a project is a navigation: the list is replaced. An accordion
would keep projects first — which is how it was asked for — while putting the
tasks one click away instead of one screen away:

```
▾ Performance marketing                     6 tasks · 2 late
    Google Ads — September optimisation     Dilshad   28 Sep
    Landing page A/B test                   Shyam     30 Sep
▸ Social media marketing                    8 tasks
▸ Monthly Retainer Work                     0 tasks
```

You see every stream and their counts at once, and expanding one does not cost
you the other two. Worth doing only if steps 1–4 leave the drill-in still
feeling like too much work — it is the largest change here and the least
certain.

## What not to change

**Projects stay first.** That structure was asked for deliberately and it is
right: a client buys streams of work, not a flat list of tasks.

**Money stays on the month.** Retainer projects carry no value, which is what
makes them free to rename and reorganise. Nothing here touches that.
