import type { Ref } from './types';

/** 列字母 ↔ 0 基索引:A→0, Z→25, AA→26 */
export function colToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function indexToCol(i: number): string {
  let s = ''; i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
export function parseRef(text: string): Ref | null {
  const m = REF_RE.exec(text); if (!m) return null;
  return { absCol: m[1] === '$', col: colToIndex(m[2]), absRow: m[3] === '$', row: Number(m[4]) - 1 };
}
export const formatRef = (r: Ref) => `${r.absCol ? '$' : ''}${indexToCol(r.col)}${r.absRow ? '$' : ''}${r.row + 1}`;
export const a1 = (row: number, col: number) => `${indexToCol(col)}${row + 1}`;

/** 复制公式时的引用平移:相对引用随偏移走,绝对引用不动;越界 → null(调用方标 #REF!) */
export function shiftRef(r: Ref, dr: number, dc: number): Ref | null {
  const row = r.absRow ? r.row : r.row + dr;
  const col = r.absCol ? r.col : r.col + dc;
  if (row < 0 || col < 0) return null;
  return { ...r, row, col };
}
