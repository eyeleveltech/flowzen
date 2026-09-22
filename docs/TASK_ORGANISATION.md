# Organising tasks by team — parked plan

Decided 22 September 2026. Not built. Parked in favour of going live.

## The problem

A client buys a **scope** — TNPA buys *Social Media Management*. Several teams
work inside that one scope: social media runs it, design makes the artwork,
video cuts the reel. Today every task in a scope is a flat list, so you cannot
see whose work is whose, and when social asks design for a post there is
nothing linking the ask to the work.

## What already exists

Most of it, which is why this is small:

| | |
|---|---|
| The scope | `RetainerProject` — a named piece of work inside a retainer, no money on it |
| Who asked | `Task.assignedById` — already recorded, already on the form |
| The team | `Task.taskType` — a 7-value enum, **already on the task form** as "Type of work", but optional, so 31 of 83 tasks have it blank |
| The heads | `preset = HEAD` + team resolves who an ask routes to, with no new data |

## The simple version — do this first

Three changes, about half a day:

1. **Add `SOCIAL_MEDIA`** to the `TaskType` enum. One value, one migration line.
2. **Rename the field "Team" and make it required.** Default it from the
   assignee's department so nobody has to think about it.
3. **Group the task list by team.** The grouping code exists — the month card
   already groups by retainer project. Point it at team instead.

Result, inside a scope:

```
Social Media Management                    TNPA · October

▸ SOCIAL MEDIA                                   3 tasks · 1 late
▸ DESIGN                                         2 tasks
▸ VIDEO & PRODUCTION                             1 task
```

The hand-off already works without any of the below: social creates the design
task, assigns a designer, and `assignedBy` records who asked.

## What to add only if the simple version annoys you

Ordered by how likely each is to be the thing that actually bites.

**1 · The link between an ask and its work.** `Task.parentTaskId`, one nullable
column. Social's post shows what it is waiting on:

```
Diwali carousel — 5 posts                    Social Media · Tanuja · 20 Oct
  ↳ Design: carousel artwork                 Design · Janani · 15 Oct
       ↳ Carousel slides 1–3                 Design · Sneha  · 13 Oct
  ↳ Video: 15s reel cut                      Video  · Charles · 17 Oct
```

The ask and the work are **separate tasks with separate names** — social writes
the ask, the design head writes the work in Design's own words. Rules: a parent
cannot close while a child is open; children inherit the month card and scope
immovably; depth capped at three; an ask with nobody on it is flagged, not
hidden. The middle level is optional to expand — a head doing a ten-minute job
themselves should not have to create a child for it.

**2 · The head's inbox.** `GET /teams/:id/asked` — everything asked of Design
across every client, which is how a head allocates. Probably the most valuable
single screen here, and it falls out of the same column.

**3 · Team cards instead of a grouped list.** The same three components the
retainer screen already uses (`ProjectsPanel` / `ProjectCard` / `ProjectDrillIn`),
renamed. Worth it once a scope has more than ~40 tasks.

**4 · A `Team` table** replacing the enum and `User.dept`, so teams are editable
in Settings rather than a migration. Needed once the list changes often; not
before.

## Teams, as agreed

| Team | Head | People |
|---|---|---|
| Social Media | Tanuja | Dharshini, Varsha |
| Digital Marketing | Dilshad | Shyam, Shakila |
| Design | Janani | Sneha, Ramya |
| Video & Production | Charles | — |
| Development | — | Naif |
| Accounts | — | Priya |
| Management | — | Harish, Akmal |

Business Development disappears as a *team* and stays as a *permission preset*
on Tanuja and Varsha — in this app `dept` (who gets asked for work) and `preset`
(what you may open) are separate axes, and always have been. Dharshini is not
in the system yet.

## Why it was parked

The simple version is half a day and the full version is three, but none of it
is what stops the studio using this today. Going live does.
