/**
 * The visual rules, enforced.
 *
 * ─── Why a test and not a document ──────────────────────────────────────────
 *
 * Every rule below was already written down. The type scale existed and 82
 * arbitrary sizes sat outside it. `--shadow-raised: none` said the app is flat
 * and 26 raw Tailwind shadows said otherwise. The token file says in capitals
 * *"never reintroduce a bare hex"* and 22 had come back — one of them the exact
 * placeholder grey the same comment records as FAILING contrast at 2.54:1.
 *
 * A visual pass that is only a document gets undone one hurried afternoon at a
 * time, and nobody notices, because none of it fails to compile. So the rules
 * live here, where breaking one is a red test rather than a slow drift.
 *
 * Each rule names the file to change INSTEAD, because a rule that only says no
 * is a rule people work around.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

const sources = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx$/.test(entry) && !/\.test\./.test(entry)) out.push(path);
  }
  return out;
};

const FILES = sources(SRC).map((p) => [relative(SRC, p).replace(/\\/g, '/'), readFileSync(p, 'utf8')] as const);

/**
 * Every match of `pattern`, as "path:line  text", for a readable failure.
 *
 * EVERY match, including several on one line. This used `line.match`, which
 * returns only the first, so a line reading
 * `border-[#22C55E]/40 text-[#16A34A] bg-[#F0FDF4]` counted once and the rule
 * under-reported itself by two thirds.
 */
const findAll = (pattern: RegExp, skip: (path: string) => boolean = () => false) => {
  const every = new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g');
  const hits: string[] = [];
  for (const [path, source] of FILES) {
    if (skip(path)) continue;
    source.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(every)) hits.push(`${path}:${i + 1}  ${m[0]}`);
    });
  }
  return hits;
};

describe('the type scale', () => {
  it('has no size outside it', () => {
    /*
     * micro(11) · xs(12) · sm(14) · base(16) · lg(18) · xl(20) · 2xl(24) · 3xl.
     *
     * 11px is the floor and `text-micro` is the name for it. Anything that will
     * not fit at 11px is too dense rather than too large — that is a layout to
     * change, not a size to shrink, and text-[9px] was the proof.
     *
     * Decimals count. This matched `\d+` only, so text-[9.5px] × 152 and
     * text-[11.5px] × 47 sat outside the scale AND outside the rule written to
     * hold it — six named sizes with nineteen in use behind them.
     */
    expect(findAll(/text-\[[\d.]+px\]/)).toEqual([]);
  });

  it('keeps headings at one weight', () => {
    /*
     * Semibold, which is what both primitives already say — `PageHeader` and
     * `CardTitle`. 39 headings were bold and 20 semibold, so a section title
     * looked different depending on which screen it was on.
     *
     * Bold is not banned; it belongs on figures and on emphasis inside a
     * sentence. It is banned on the heading TAGS.
     */
    expect(findAll(/<h[1-4]\b[^>]*font-bold/)).toEqual([]);
  });
});

describe('elevation', () => {
  it('uses the four tokens and no raw shadow utility', () => {
    /*
     * raised · control · overlay · modal, defined in `globals.css` with the rule
     * written beside them: flat in the page flow, lifted only when floating.
     *
     * A raw `shadow-lg` is not a smaller version of that decision — it is a
     * second decision, made in one file, that the first one cannot see.
     */
    expect(findAll(/\bshadow-(?:xs|sm|md|lg|xl|2xl|black\/\d+)\b/)).toEqual([]);
  });
});

describe('money', () => {
  it('is formatted in one place, not re-implemented per screen', () => {
    /*
     * There were NINE copies of this, each a slightly different one-liner:
     *
     *   const fmtINR = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
     *
     * All nine typed the argument as `number`. The API masks a figure to NULL
     * for a caller without `money.figures` — so on /companies, where one
     * variant had no `Math.round`, `null.toLocaleString()` threw and the whole
     * page rendered blank for Business Development, whose entire job is that
     * list. The other eight would have quietly printed ₹0 instead, which is
     * the same bug wearing a costume.
     *
     * `formatMoney` in lib/api-v2.ts is null-safe and returns an em dash.
     * Import it. If a screen needs a different shape, widen that function.
     */
    const localFormatter = /const\s+(?:fmt|format)[A-Za-z]*\s*=\s*\([^)]*\)\s*=>.*toLocaleString/;
    expect(findAll(localFormatter, (path) => path === 'lib/utils.ts')).toEqual([]);
  });
});

describe('reaching it with a keyboard', () => {
  /**
   * The end of a JSX tag, tracking brace and quote depth.
   *
   * `<input[^>]*>` looks like it does this and does not: `onChange={(e) => …}`
   * contains a `>`, so the match stops at the arrow and everything after it —
   * including the `aria-label` — is invisible to the rule. The first version of
   * this audit reported twenty-one unlabelled controls that way, of which
   * several were labelled perfectly well.
   */
  const tagEnd = (s: string, i: number) => {
    let depth = 0;
    let quote: string | null = null;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) return j + 1;
    }
    return s.length;
  };

  it('gives every form control a name', () => {
    /*
     * `components/ui/field.tsx` does this properly — useId, htmlFor,
     * aria-invalid, an aria-live error region — and 226 call sites use it.
     * Thirty were hand-rolled around it with a visible label carrying no
     * htmlFor, including every field in the login, register, reset-password
     * and accept-invite forms. A screen reader announces those as unlabelled,
     * and clicking the label does not focus the box.
     *
     * Use `<Field>`, or pair `htmlFor`/`id`, or give the control an
     * `aria-label` when it has no visible label of its own.
     */
    const named = ['aria-label', 'aria-labelledby', 'aria-hidden', 'id=', 'type="hidden"', 'type="checkbox"'];
    const hits: string[] = [];

    for (const [path, source] of FILES) {
      for (const kw of ['<input', '<textarea', '<select']) {
        let i = source.indexOf(kw);
        while (i !== -1) {
          const tag = source.slice(i, tagEnd(source, i));
          if (!named.some((n) => tag.includes(n))) {
            hits.push(`${path}:${source.slice(0, i).split('\n').length}  ${tag.slice(0, 60)}`);
          }
          i = source.indexOf(kw, i + kw.length);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe('the figure block', () => {
  it('builds the figure block once, not per screen', () => {
    /*
     * The uppercase-label / 20px-tabular-figure / quiet-note block sat written
     * out by hand fifty-one times across thirteen screens — and three of those
     * screens had already extracted it into three separate local components,
     * all called some variant of `Kpi`, each a copy of the last.
     *
     * Copies drift. The label was `mb-2` on one screen and `mb-1.5` on
     * another; My Work set its note in `text-xs` where every other screen used
     * `text-micro`; one page reached for the gold on a figure where its
     * neighbour reached for red on the same condition. None of that is visible
     * on one page. It is visible walking between two.
     *
     * Use `<StatTile>` from `components/ui/stat-tile.tsx` — `frame="inset"`
     * inside a `gap-px` grid, `frame="none"` inside an existing Card.
     */
    const figureBlock =
      /(?:tracking-\[-0\.6px\][^\n]*tabular-nums|tabular-nums[^\n]*tracking-\[-0\.6px\])/;
    expect(findAll(figureBlock, (path) => path === 'components/ui/stat-tile.tsx')).toEqual([]);
  });
});

describe('colour', () => {
  it('reaches for a token rather than spelling out a hex', () => {
    /*
     * ONE file is allowed one, and it says why in place:
     *
     *   app/layout.tsx        the browser chrome colour is an HTML meta value
     *                         and cannot read a custom property.
     *
     * `swipeable-card.tsx` used to hold the second exemption, for Framer Motion
     * interpolating colours frame by frame. Nothing ever imported that
     * component, so the exemption was protecting dead code — the file is gone
     * and so is its licence.
     *
     * Anything else has a token. If the colour you want does not, add it to
     * `globals.css` first — that is the whole point of the ramp, and it is
     * where --color-success-tint / -warning-tint / -danger-tint came from:
     * twelve status pills wanted a fill, no token offered one, and they each
     * reached for Tailwind's own green-50 / amber-50 / red-50 — cool, bluish
     * tints that put a "won" chip in a different colour family from the
     * `text-success` sitting inside it.
     */
    const allowed = (path: string) => path === 'app/layout.tsx';
    expect(findAll(/#[0-9A-Fa-f]{6}\b/, allowed)).toEqual([]);
  });

  it('uses the token ramp rather than Tailwind’s own palette', () => {
    /*
     * 296 of these were in use across 48 files: bg-red-50, text-blue-700,
     * border-emerald-200 and so on. Tailwind's palette is TUNED FOR A
     * DIFFERENT PRODUCT — its greens are cool and bluish, and this identity is
     * a warm green with a gold accent, so a "won" chip in green-50 sat visibly
     * outside the palette it was meant to belong to.
     *
     * Two tokens were added to finish the ramp, because two things genuinely
     * had no home:
     *
     *   --color-info       "settled, nothing to do" — a delivered project, an
     *                      assigned laptop. It was blue-50/blue-700, a family
     *                      that appears nowhere else here.
     *   --color-warning-ink  the brand gold measures 2.78:1 as text on its own
     *                      tint, under the 4.5:1 AA needs. The shapes keep
     *                      --color-warning; the WORDS get this.
     */
    const palette =
      /\b(?:bg|text|border|ring|from|to|via|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    expect(findAll(palette)).toEqual([]);
  });

  it('sets warning WORDS in the ink, not the shape colour', () => {
    /*
     * --color-warning (#c08a1e) is the brand gold. It measures 3.05:1 on white
     * and 2.78:1 on its own tint — fine for a dot, a border or a bar, under the
     * 4.5:1 WCAG AA asks of normal text.
     *
     * Twenty-one places set amber TEXT in it anyway: the PROSPECT and PENDING
     * badges, the "waiting on" counts, the days-in-stage numbers, the pipeline
     * and quotation KPIs. The token comment in `globals.css` had already
     * written the rule down — "use it wherever warning is a WORD; keep
     * --color-warning for the shapes" — and nothing enforced it, so the same
     * failure the placeholder grey below is remembered for was live in colour.
     *
     * Change to `text-warning-ink` (#8a6117, 5.5:1 on white, 5.0:1 on the
     * tint). `border-warning`, `bg-warning` and `bg-warning-tint` are shapes
     * and stay exactly as they are.
     */
    expect(findAll(/\btext-warning(?!-ink)(?![\w-])/)).toEqual([]);
  });

  it('never brings back the placeholder grey that fails contrast', () => {
    // #9CA3AF measures 2.54:1 on white — below the 4.5:1 WCAG AA needs for
    // normal text. It is why --color-muted exists. It had come back in the
    // rich-text editor's own stylesheet, where no class name could reach it.
    expect(findAll(/#9CA3AF/i)).toEqual([]);
  });
});

describe('table density', () => {
  it('lives in the tokens, not on the cells', () => {
    /*
     * A row was 54px against the prototype's 33px, and the reason was that
     * every cell set its own padding — 277 of them across 15 tables, and they
     * had already drifted: py-2, py-2.5, py-3, py-3.5 and py-4 all in use, so
     * no two tables in the product were the same height.
     *
     * `--table-py` / `--table-px` and the `.data-table` rules in globals.css
     * are the whole of it now. A cell still says what it likes about
     * alignment, colour, weight and width; it says nothing about spacing,
     * because spacing is the one thing that has to agree across every table
     * at once.
     */
    const hits: string[] = [];
    for (const [path, source] of FILES) {
      source.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/<t[hd]\s([^>]*?)className=(?:"|\{`)([^"`]*)/g)) {
          /*
           * A cell that spans the table is exempt, and deliberately so. "No
           * companies found" and the loading row are not data rows — they are
           * a message panel that happens to be inside a <td>, and giving them
           * a data row's 10px would put the empty state in a slot the width of
           * one line of text. They are the only cells that still choose their
           * own spacing, and `colSpan` is the thing that makes them different.
           */
          if (/colSpan/.test(m[1])) continue;
          const bad = m[2].split(/\s+/).filter((c) => /^(?:p|px|py|pt|pb|pl|pr|ps|pe)-[\d.]+$/.test(c));
          if (bad.length) hits.push(`${path}:${i + 1}  ${bad.join(' ')}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('the small-caps label', () => {
  it('is one class, not a cluster spelled per screen', () => {
    /*
     * A column header, a form label and a section eyebrow are the same device:
     * 11px, uppercase, letter-spaced, muted. The app spelled it NINETEEN ways
     * across 163 places — four letter-spacings (0.09em, 0.13em, 0.19em and
     * tracking-wider's 0.05em), three weights and two sizes — so no two
     * screens quite matched.
     *
     * `.eyebrow` in globals.css is the device now, and `--tracking-label` is
     * its width. A label still says its own colour when it needs one; it says
     * nothing about size, weight, case or spacing.
     */
    const hits: string[] = [];
    for (const [path, source] of FILES) {
      if (path === 'app/globals.css') continue;
      source.split('\n').forEach((line, i) => {
        for (const m of line.matchAll(/className=(?:"|\{`)([^"`]*)/g)) {
          const t = m[1].split(/\s+/);
          if (!t.includes('uppercase')) continue;
          if (!t.some((c) => c === 'text-micro' || c === 'text-xs')) continue;
          const spelled = t.filter((c) => /^tracking-/.test(c) || /^font-(bold|semibold|medium)$/.test(c));
          if (spelled.length) hits.push(`${path}:${i + 1}  ${spelled.join(' ')}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('every screen the same measure', () => {
  it('sets a page width in one place', () => {
    /*
     * Ten pages said max-w-[1400px], the client record said max-w-7xl (1280px)
     * and the asset record max-w-[1100px] — three measures in one app, so
     * moving between two screens moved the content under you.
     *
     * `.page-shell` and `--page-max` are the measure now.
     */
    const hits = findAll(/max-w-\[\d+px\]|max-w-7xl|max-w-350/, (p) => p.startsWith('app/login') || p.startsWith('app/register'));
    expect(hits).toEqual([]);
  });
});

describe('a record title', () => {
  it('is the same heading on every record screen', () => {
    /*
     * A company, a project, a retainer and an asset each name one record at
     * the top of its own screen. They were written four ways — two trackings
     * spelled by hand, and the asset two steps smaller than the other three.
     */
    const titles: string[] = [];
    for (const [path, source] of FILES) {
      if (!/\/\[id\]\/page\.tsx$/.test(path)) continue;
      for (const m of source.matchAll(/<h1 className="([^"]*)"/g)) {
        titles.push(
          m[1]
            .split(/\s+/)
            // `text-pretty` and `text-balance` are wrapping hints, not type
            // choices — a title is free to ask for a better line break.
            .filter((c) => /^(text-|font-|tracking-)/.test(c) && !/^text-(pretty|balance)$/.test(c))
            .sort()
            .join(' '),
        );
      }
    }
    expect(new Set(titles).size, `record titles differ:\n${[...new Set(titles)].join('\n')}`).toBeLessThanOrEqual(1);
  });
});
