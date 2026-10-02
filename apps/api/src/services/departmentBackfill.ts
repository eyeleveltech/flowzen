/**
 * The department backfill, as code — what the add_departments migration's SQL
 * does, written out so it can be tested and so the report can check the
 * database against it.
 *
 * One department per name in use: the organisation's old list plus every
 * non-blank `User.dept`, trimmed. Names that differ only by case are one
 * department, spelled as the old list spells it, otherwise as most people do
 * (ties: alphabetical). Nothing else is guessed: "Video / Production" and
 * "Video & Production" stay two, for management to merge.
 */

export type BackfillPlan = {
  /** In order: the old list's order, then alphabetical. */
  departments: { name: string; sortOrder: number }[];
  /** Person id → the department name they land in. */
  placed: Map<string, string>;
  /** People with a blank department, who show under "No department". */
  unplaced: string[];
};

export function planDepartments(orgList: string[], people: { id: string; dept: string | null }[]): BackfillPlan {
  type Candidate = { name: string; fromList: boolean; pos: number | null; uses: number };
  const candidates: Candidate[] = [];
  orgList.forEach((raw, i) => {
    const name = raw.trim();
    if (name) candidates.push({ name, fromList: true, pos: i + 1, uses: 0 });
  });
  const uses = new Map<string, number>();
  for (const p of people) {
    const name = (p.dept ?? '').trim();
    if (name) uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  for (const [name, n] of uses) candidates.push({ name, fromList: false, pos: null, uses: n });

  // One per name ignoring case: the old list's spelling first, then the most used, then alphabetical.
  const byKey = new Map<string, Candidate[]>();
  for (const c of candidates) byKey.set(c.name.toLowerCase(), [...(byKey.get(c.name.toLowerCase()) ?? []), c]);
  const chosen = [...byKey.entries()].map(([key, list]) => {
    const best = [...list].sort(
      (a, b) => Number(b.fromList) - Number(a.fromList) || b.uses - a.uses || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    )[0];
    const listPos = list.filter((c) => c.fromList).reduce<number | null>((m, c) => (m === null || c.pos! < m ? c.pos! : m), null);
    return { key, name: best.name, listPos };
  });
  chosen.sort(
    (a, b) =>
      (a.listPos ?? Infinity) - (b.listPos ?? Infinity) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );

  const nameOf = new Map(chosen.map((c) => [c.key, c.name]));
  const placed = new Map<string, string>();
  const unplaced: string[] = [];
  for (const p of people) {
    const key = (p.dept ?? '').trim().toLowerCase();
    if (key && nameOf.has(key)) placed.set(p.id, nameOf.get(key)!);
    else unplaced.push(p.id);
  }
  return { departments: chosen.map((c, i) => ({ name: c.name, sortOrder: i })), placed, unplaced };
}

/**
 * Names that are probably the same department spelled two ways — "Video /
 * Production" and "Video & Production". Not merged: listed, so management can
 * decide in Settings → Departments.
 */
export function lookAlikes(names: string[]): string[][] {
  const squash = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/and/g, '');
  const groups = new Map<string, string[]>();
  for (const n of names) groups.set(squash(n), [...(groups.get(squash(n)) ?? []), n]);
  // And one name that starts another, word for word: "Accounts" and "Accounts / Finance".
  const out = [...groups.values()].filter((g) => g.length > 1);
  const words = (n: string) => n.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const wa = words(a);
      const wb = words(b);
      if (wa.length < wb.length && wa.every((w, i) => wb[i] === w) && !out.some((g) => g.includes(a) && g.includes(b))) {
        out.push([a, b]);
      }
    }
  }
  return out;
}
