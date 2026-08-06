# Visual System Audit — apps/web

**Date:** 5 Aug 2026 · **Scope:** `apps/web/src`, 10 dimensions · **Method:** static analysis, every figure is a grep result · **Changes made:** none (read-only)

**Overall: 7.0 / 10** — averaged across the nine applicable dimensions. Spacing discipline is close to exemplary; colour is the weak axis; dark mode has not been started at all.

> **Status: items 1-4 fixed on 5 Aug 2026.** See the Correction below and the
> follow-ups at the end. This document is kept as the record of what was measured.

---

## The finding that explains most of the others

**This is not developers ignoring the tokens. They use them constantly.**

`text-secondary` appears 1,087 times, `text-primary` 752, `border-border` 729. Adoption is real and habitual.

Yet 744 raw hex values sit alongside them across 79 files — and **six values account for 697 of them**. Every one is a shade the token set never defined. `#374151`, the workhorse body-text grey used 272 times, has no token. Neither does `#F3F4F6` (227), the subtle surface behind every header rule and hover row.

**People reached for hex because there was nothing to reach for.** The fix is mostly to finish the palette, not to police the codebase — which also makes it a small, safe change rather than a 79-file sweep.

---

## Scores

| Dimension | Score |
|---|---|
| Colour consistency | 5.0 |
| Typography hierarchy | 6.0 |
| Spacing rhythm | **9.0** |
| Component consistency | 7.0 |
| Responsive behaviour | 8.0 |
| Dark mode | *n/a — not attempted* |
| Animation | 6.0 |
| Accessibility | 7.0 |
| Information density | 7.0 |
| Polish | 8.0 |

---

## 1. Colour consistency — 5.0

744 arbitrary hex values across 79 files. Six do nearly all the damage:

| Value | Role it is playing | Token? | Uses |
|---|---|---|---|
| `#374151` | Form-label / body text | none | 272 |
| `#F3F4F6` | Subtle surface, rules | none | 227 |
| `#F9FAFB` | Hover / zebra row | none | 102 |
| `#1F2937` | Primary button hover | none | 52 |
| `#D1D5DB` | Disabled / scrollbar | none | 24 |
| `#4B5563` | Mid-emphasis text | none | 20 |

Separately, the semantic tokens are defined but essentially dead: `text-success` and `text-warning` have **zero** usages, `text-danger` has 8 — while their raw equivalents appear as hex. A status colour is exactly the kind of thing that must be changeable in one place.

**Fix:** add the six greys to `@theme` in `apps/web/src/app/globals.css:4` as a proper neutral ramp, then migrate. The migration is mechanical and safe because each hex maps to exactly one new token. Do the semantic three at the same time — those are 10 replacements, not 700.

## 2. Typography hierarchy — 6.0

The hierarchy itself is sound and consistent. The problem is the bottom of the scale: **204 font sizes are set in raw pixels below Tailwind's floor** of `text-xs` (12px).

| Size | Typically | Uses |
|---|---|---|
| `text-[10px]` | Badges, counts, meta | 120 |
| `text-[11px]` | Table meta, timestamps | 65 |
| `text-[9px]` | Avatar initials | 14 |
| `text-[8px]` | Avatar initials | 4 |
| `text-[7px]` | Overflow "+N" badge | 1 |

Most sub-10px cases are initials inside 20px avatar circles, which is legitimate — initials are glyphs, not reading text. The **185 uses of 10px and 11px** are the real signal: two missing steps that the whole team independently invented.

**Fix:** define two steps below `text-xs` and convert. One genuine outlier to reconsider: `apps/web/src/app/(dashboard)/departments/page.tsx:372` sets 7px, below any reasonable legibility floor even for a badge.

## 3. Spacing rhythm — 9.0

In the entire web app there is **one** arbitrary pixel spacing value. Every other margin, padding and gap sits on Tailwind's 4px scale.

This is the strongest dimension by a wide margin, and worth stating plainly because it is the one most teams get wrong. It is also the proof that the colour drift is a tooling gap rather than a discipline problem — the same people were rigorous here, where the scale existed.

## 4. Component consistency — 7.0

Shared components are used properly and only one file defines its own local `inputClass`. Two structural issues hold the score down:

- **The radius tokens are entirely dead.** `--radius-card`, `--radius-button` and `--radius-input` are declared at `globals.css:18-20` and used **zero** times, while `rounded-xl` appears 560 times. They do not even agree: the card token is 16px, `rounded-xl` is 12px. Either adopt them or delete them — a token nobody uses is a lie about how the system works.
- **Two project-creation forms exist** — `components/projects/create-project-modal.tsx` and the inline form in `app/(dashboard)/projects/page.tsx` — kept in sync by hand. They have already drifted once: the modal's field grid had to be corrected this week after it diverged from its stated twin.

## 5. Responsive behaviour — 8.0

Genuinely mobile-first: 332 `sm:`, 107 `md:`, 66 `lg:`, 5 `xl:` — a healthy taper rather than desktop layouts patched for phones. The new `use-breakpoint` hook is in use across 8 files.

The one trap worth naming: **Tailwind breakpoints measure the viewport**, but slide-over panels are pinned at `max-w-lg` (512px), so a `md:` rule fires while only 512px is available. That produced a real bug this week — four dropdowns crushed into ~115px each.

I checked the other four files pairing a narrow panel with a 3–4 column grid; **all are false positives**, the grids sit in full-width page regions. No further instances.

## 6. Dark mode — n/a (not attempted)

Zero `dark:` classes. Zero `prefers-color-scheme` queries. No toggle, no partial implementation.

Scored *n/a* rather than 0 deliberately: a consistent absence is not a defect, and it is far healthier than the half-finished dark mode this dimension usually catches. It is a product decision not yet taken, not a bug.

Worth knowing for when you do: the work is almost entirely gated on the colour fix above. With a complete token ramp, dark mode is a second set of values on the same names. With 744 hardcoded hex values, it is unachievable.

## 7. Animation — 6.0

Motion is purposeful — entrances, drawer slides, skeletons — and not gratuitous. 54 files use Framer Motion.

But there are **zero `prefers-reduced-motion` queries** anywhere. Two animations are infinite loops that never stop: the 14-second marquee (`globals.css:94`) and the skeleton shimmer (`globals.css:103`). For a user with vestibular sensitivity, an unstoppable looping animation is the specific thing WCAG 2.3.3 exists to prevent.

**Fix:** one media query in `globals.css` covering the CSS keyframes, plus Framer Motion's `useReducedMotion` where components animate directly. Small change, disproportionate benefit.

## 8. Accessibility — 7.0

Better than most codebases at this stage, and clearly deliberate in places. `focus-visible` appears 543 times. The `--color-muted` token at `globals.css:13` carries a comment recording that the previous value measured 2.54:1 and failed AA, and why the replacement measures 4.84:1 — that is a team that has actually thought about contrast.

Gaps, in order of severity:

- **Two files kill the focus ring with nothing to replace it** — `app/(dashboard)/calendar/page.tsx` and `components/layout/command-palette.tsx` use `outline-none` with no focus style at all. A command palette is keyboard-first by definition, so fix this one first.
- **Icon-only buttons are under-labelled** — 17 `aria-label` attributes across the whole app is low for the number of icon buttons present.
- **17 buttons sit at `p-1` or `p-1.5`**, giving roughly 24–28px touch targets against the 44px guideline. Mostly row actions on mobile.

## 9. Information density — 7.0

This is the one dimension I can only partly evidence from source, and it is better to say so than dress up an impression as a measurement.

What the code shows: 185 uses of 10–11px text, and tables carrying avatars, badges, stage chips and dates per row. That is a deliberately dense, information-rich UI — appropriate for a CRM where people scan hundreds of rows, and consistent with the tight spacing scale.

The risk is that density was reached by shrinking type rather than by editing content. A proper read needs the running app at a few real data volumes.

## 10. Polish — 8.0

The details are mostly there: 748 hover states, 901 transitions, 47 skeleton or pulse loaders, and 17 written empty states with real copy rather than a bare "No data".

Loading and empty states present at this density is the reliable signal that a UI has been used by its authors and not just built.

---

## If you do nothing else, do these

Ordered by benefit per unit of risk.

1. **Add the six missing greys to `@theme`.** Half an hour, one file, breaks nothing. Converts 697 scattered hex values from "wrong" into "migratable", and is the prerequisite for dark mode ever being feasible.
2. **Restore the focus ring in the command palette.** A keyboard-first surface with no visible focus state. Two files, minutes of work, highest-severity accessibility gap found.
3. **Honour `prefers-reduced-motion`.** One media query stops two infinite loops for users who have asked the OS not to animate.
4. **Resolve the radius tokens.** Adopt them or delete them. Three declarations, zero uses, disagreeing with the 560 `rounded-xl` classes actually shipping.
5. **Then migrate the hex, once the tokens exist.** Large but mechanical. Worth its own PR with nothing else in it, timed so it does not collide with another wide UI change.

---

## Correction

**The command palette claim above was overstated.** I wrote that it had "no visible focus
state" and called it the highest-severity gap. It does use `outline-none` on its search input,
but the palette has full arrow-key navigation with a visible selected-item highlight
(`command-palette.tsx:312`), and the input is `autoFocus`ed as the sole input in a modal — so
keyboard position is never actually ambiguous. The real gap in that file was only its small
clear (X) button. The genuine miss was the calendar toolbar's "Hide Done Tasks" button, which
is a real tab stop with no focus indication at all.

Both are now fixed; the severity ranking in item 2 of the plan was wrong.

## What was fixed — 5 Aug 2026

**Colour (item 1 + 5, done together).** Splitting them would have created the very problem item 4
describes: tokens defined but unused. Added `body`, `body-soft`, `subtle`, `line`,
`primary-hover`, `danger-hover`, `warning-hover` to `@theme`, then migrated **713 usages across
81 files** with a script, so the transform is auditable rather than 700 hand edits. It rewrites
only the bracket expression (`text-[#374151]` -> `text-body`), leaving the utility prefix alone,
so every variant (`hover:`, `focus:`, `divide-`, `ring-`, `via-`) is covered by one rule. Bare
hex in JS — the recharts palette, the SVG data-URI — is not bracketed and was untouched.

`#F9FAFB` (102 uses) turned out to differ from the existing `--color-surface` by one step per
channel — invisible — so it collapsed into `surface` rather than earning a token.

**Accessibility (item 2).** House convention (`ring-2 / ring-primary/25 / ring-offset-1`) applied
to the calendar toolbar button and the palette's clear button.

**Reduced motion (item 3).** A `prefers-reduced-motion` block in `globals.css` stops the two
infinite loops, plus `<MotionConfig reducedMotion="user">` in `components/providers.tsx` — Framer
animates through inline styles, outside the cascade, so CSS alone could not reach those 54 files.

**Radius tokens (item 4): deleted, not adopted.** Four radii are in real use (`rounded-lg` 186,
`rounded-xl` 560, `rounded-2xl` 203, `rounded-full` 223) and nothing can mechanically tell a card
from a button, so adopting the tokens meant ~950 judgement calls. Tailwind's own scale is already
the working convention; the three unused tokens were the lie. Also removed while confirmed dead:
`--ease-out`, `.glass` (0 uses) and `.animate-in` (0 uses).

**Verified:** production build succeeds; every new utility confirmed present in the built CSS
(`.text-body`, `.bg-subtle`, `.hover\:bg-primary-hover`, `:where(.divide-subtle>...)` etc. all
resolve to `var(--color-*)`); `prefers-reduced-motion` ships; `.glass` / `animate-in` /
`radius-card` absent from the bundle. Typecheck clean, 25 web tests pass.

## Still open

- **35 arbitrary hex remain** — the blue/green/purple status-badge palettes (`#2563EB`, `#059669`,
  `#ECFDF5`...). These are Tailwind palette values used for badge fills and text. Converting them
  needs a decision, not a script: the badges use *emerald* greens while `--color-success` is
  *green-500*. Someone has to pick one.
- **`#9CA3AF`** at `dashboard/page.tsx:813` is the last stray neutral — an idle status dot. It
  sits between `line` and `secondary`, and either choice visibly changes the indicator, so it was
  left for a human. Note the AA comment in `globals.css` does **not** apply to it: that concerns
  text contrast, and this is a background dot.
- **Typography (item from dimension 2)** — the two missing scale steps below `text-xs` are not
  done. Same shape of fix as the colours, 185 usages.
- **Dark mode** is now feasible for the first time: with the ramp complete it is a second set of
  values on the same token names.
