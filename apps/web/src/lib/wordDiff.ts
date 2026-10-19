/**
 * What changed between two versions of a piece of text, word by word — for
 * Compare on a proposal's Versions tab.
 *
 * A plain longest-common-subsequence over words and the spaces between them.
 * A proposal section is a few hundred words, so the table stays small; above
 * a limit it gives up on the detail and shows the whole text as replaced,
 * which is honest and never slow.
 */

export type DiffPart = { kind: 'same' | 'added' | 'removed'; text: string };

const tokens = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];

/** Cells in the table above which the detail is not worth the work. */
const LIMIT = 1_500_000;

export function diffWords(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > LIMIT) {
    return [
      ...(before ? [{ kind: 'removed' as const, text: before }] : []),
      ...(after ? [{ kind: 'added' as const, text: after }] : []),
    ];
  }
  // lcs[i][j]: the longest common run of a[i..] and b[j..].
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('removed', a[i++]);
    } else {
      push('added', b[j++]);
    }
  }
  while (i < a.length) push('removed', a[i++]);
  while (j < b.length) push('added', b[j++]);
  return out;
}

/**
 * The word diff when the two share enough to read it that way; otherwise the
 * whole text as replaced. A rewritten paragraph diffed word by word is
 * confetti ("AMore yearbooked of…") — old above new is what a person reads.
 */
export function readableDiff(before: string, after: string, minShared = 0.4): { replaced: boolean; parts: DiffPart[] } {
  const parts = diffWords(before, after);
  if (!before || !after) return { replaced: false, parts };
  const shared = parts.filter((p) => p.kind === 'same').reduce((n, p) => n + p.text.replace(/\s+/g, '').length, 0);
  const longest = Math.max(before.replace(/\s+/g, '').length, after.replace(/\s+/g, '').length);
  if (longest && shared / longest < minShared) {
    return { replaced: true, parts: [{ kind: 'removed', text: before }, { kind: 'added', text: after }] };
  }
  return { replaced: false, parts };
}
