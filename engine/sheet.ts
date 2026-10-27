/**
 * Sheet:把 CellStore、公式解析、依赖图、求值串起来。
 *  - setCell(r, c, raw):解析 → 重建依赖 → 环检测 → 增量重算下游
 *  - 只重算受影响的格(拓扑序),改一格不全表重算
 *  - 环上的格全部标 #CYCLE!,不进入求值,解除后自动恢复
 *  - 命令式撤销重做:每次编辑记录 {key, before, after},批量操作是一个复合命令
 */
import type { Ast, Cell, Key, Ref, Value } from './types';
import { err, isError, key, parseKey } from './types';
import { parseFormula, printAst } from './parser';
import { evaluate, type EvalContext } from './evaluator';
import { DepGraph, refsOf } from './dep-graph';
import { shiftRef, formatRef } from './refs';

export type Edit = { key: Key; before: string; after: string };
type Command = { edits: Edit[] };

export type ChangeListener = (changed: Set<Key>) => void;
export type EditListener = (edits: Edit[]) => void;   // 本地编辑(含撤销重做),给协同适配器广播用

export class Sheet {
  private cells = new Map<Key, Cell>();
  private graph = new DepGraph();
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<ChangeListener>();
  private editListeners = new Set<EditListener>();
  /** 上次重算的统计,给基准和面板看 */
  lastRecalc = { evaluated: 0, cycle: 0, ms: 0 };

  // ---------- 读 ----------
  getCell(r: number, c: number): Cell | undefined { return this.cells.get(key(r, c)); }
  getRaw(r: number, c: number): string { return this.cells.get(key(r, c))?.raw ?? ''; }
  getValue(r: number, c: number): Value { return this.cells.get(key(r, c))?.value ?? null; }
  /** 显示文本:错误显示错误码,数字按本地化,布尔大写 */
  display(r: number, c: number): string {
    const v = this.getValue(r, c);
    if (v === null) return '';
    if (isError(v)) return v.error;
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(10)));
    return String(v);
  }
  size() { return this.cells.size; }
  keys() { return [...this.cells.keys()]; }
  onChange(fn: ChangeListener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onEdit(fn: EditListener): () => void { this.editListeners.add(fn); return () => { this.editListeners.delete(fn); }; }

  /** 远端(协同)写入:不进撤销栈、不再广播,避免回环 */
  applyRemote(entries: { r: number; c: number; raw: string }[]) {
    const edits = entries.map(e => ({ key: key(e.r, e.c), before: this.getRaw(e.r, e.c), after: e.raw })).filter(e => e.before !== e.after);
    if (edits.length) this.apply({ edits }, false, 'remote');
  }

  /**
   * 公式校验(写入前):解析 → 引用在表格范围内 → 试写一次看会不会成环 → 还原。
   * 给“自然语言生成公式”用:模型输出永远先校验,失败把错误原因回塞给模型。
   */
  validateFormula(r: number, c: number, raw: string, bounds: { rows: number; cols: number }): { ok: true } | { ok: false; error: string } {
    if (!raw.startsWith('=')) return { ok: true };
    let ast: Ast;
    try { ast = parseFormula(raw.slice(1)); } catch (e: any) { return { ok: false, error: `#NAME? 无法解析:${e.message}` }; }
    for (const ref of refsOf(ast)) {
      if (ref.row >= bounds.rows || ref.col >= bounds.cols) return { ok: false, error: `#REF! 引用超出范围:${formatRef(ref)}` };
    }
    const before = this.getRaw(r, c);
    this.apply({ edits: [{ key: key(r, c), before, after: raw }] }, false, 'probe');
    const v = this.getValue(r, c);
    const bad = isError(v) && v.error === '#CYCLE!' ? '#CYCLE! 公式引用了自身所在的格' : isError(v) && v.error === '#NAME?' ? '#NAME? 未知函数' : null;
    this.apply({ edits: [{ key: key(r, c), before: raw, after: before }] }, false, 'probe');
    return bad ? { ok: false, error: bad } : { ok: true };
  }

  // ---------- 写 ----------
  setCell(r: number, c: number, raw: string) { this.apply({ edits: [{ key: key(r, c), before: this.getRaw(r, c), after: raw }] }, true); }
  /** 批量写(粘贴 / 填充),作为一个撤销单元 */
  setCells(entries: { r: number; c: number; raw: string }[]) {
    this.apply({ edits: entries.map(e => ({ key: key(e.r, e.c), before: this.getRaw(e.r, e.c), after: e.raw })) }, true);
  }
  /** 把 (r,c) 的公式复制到 (tr,tc):相对引用平移,绝对引用不动 */
  copyFormula(r: number, c: number, tr: number, tc: number): string {
    const cell = this.getCell(r, c);
    if (!cell?.ast) return cell?.raw ?? '';
    const dr = tr - r, dc = tc - c;
    const shifted = shiftAst(cell.ast, dr, dc);
    return shifted ? '=' + printAst(shifted) : '=#REF!';
  }
  undo() { const cmd = this.undoStack.pop(); if (!cmd) return false; this.apply({ edits: cmd.edits.map(e => ({ key: e.key, before: e.after, after: e.before })) }, false); this.redoStack.push(cmd); return true; }
  redo() { const cmd = this.redoStack.pop(); if (!cmd) return false; this.apply(cmd, false); this.undoStack.push(cmd); return true; }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  private apply(cmd: Command, record: boolean, source: 'local' | 'remote' | 'probe' = 'local') {
    const t0 = performance.now();
    const changed = new Set<Key>();
    for (const e of cmd.edits) { this.write(e.key, e.after); changed.add(e.key); }
    if (record) { this.undoStack.push(cmd); this.redoStack.length = 0; }
    // 合并所有被改格的下游,一次拓扑重算
    const stats = this.recalcFrom(changed);
    if (source === 'probe') return;                       // 校验试写:不通知、不广播
    this.lastRecalc = { ...stats, ms: performance.now() - t0 };
    for (const fn of this.listeners) fn(stats.touched);
    if (source === 'local') for (const fn of this.editListeners) fn(cmd.edits);
  }

  /** 写入原文:解析公式、重建依赖;不求值(求值统一在 recalc) */
  private write(k: Key, raw: string) {
    if (raw === '') { this.graph.clear(k); this.cells.delete(k); return; }
    const cell: Cell = { raw, value: null };
    if (raw.startsWith('=')) {
      try { cell.ast = parseFormula(raw.slice(1)); cell.formula = printAst(cell.ast); }
      catch { cell.value = err('#NAME?'); }
    } else {
      cell.value = literal(raw);
    }
    this.cells.set(k, cell);
    this.graph.setDeps(k, cell.ast);
  }

  /** 从一组起点出发做增量重算 */
  private recalcFrom(starts: Set<Key>) {
    // 所有起点一次性求受影响子图与拓扑序(批量粘贴 1 万格也只遍历一遍图)
    const { order, cycle } = this.graph.affected(starts);
    // 自引用 / 范围含自身也算环(只检查公式格)
    for (const k of order) { const cell = this.cells.get(k); if (cell?.ast && (this.graph.rangeContains(k, k) || this.graph.directDeps(k).has(k))) cycle.add(k); }
    for (const k of cycle) { const cell = this.cells.get(k); if (cell) cell.value = err('#CYCLE!'); }
    let evaluated = 0;
    for (const k of order) {
      if (cycle.has(k)) continue;
      const cell = this.cells.get(k); if (!cell) continue;
      if (cell.ast) { cell.value = evaluate(cell.ast, this.ctx); evaluated++; }
    }
    return { evaluated, cycle: cycle.size, touched: new Set([...order, ...cycle]) };
  }

  private ctx: EvalContext = {
    get: (ref: Ref) => {
      const v = this.cells.get(key(ref.row, ref.col))?.value ?? null;
      return v;
    },
    range: (a: Ref, b: Ref) => {
      const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row), c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
      const out: Value[] = [];
      // 稀疏存储:范围很大时遍历已存在的格比遍历整个矩形快
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > this.cells.size) {
        for (const [k, cell] of this.cells) { const [r, c] = parseKey(k); if (r >= r1 && r <= r2 && c >= c1 && c <= c2) out.push(cell.value); }
      } else {
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = this.cells.get(key(r, c))?.value; if (v !== undefined) out.push(v); }
      }
      return out;
    },
  };

  // ---------- CSV ----------
  toCSV(): string {
    let maxR = 0, maxC = 0; for (const k of this.cells.keys()) { const [r, c] = parseKey(k); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
    const lines: string[] = [];
    for (let r = 0; r <= maxR; r++) { const row: string[] = []; for (let c = 0; c <= maxC; c++) row.push(csvEscape(this.getRaw(r, c))); lines.push(row.join(',')); }
    return lines.join('\n');
  }
  loadCSV(text: string) {
    const entries: { r: number; c: number; raw: string }[] = [];
    text.split(/\r?\n/).forEach((line, r) => { if (line === '') return; parseCsvLine(line).forEach((raw, c) => { if (raw !== '') entries.push({ r, c, raw }); }); });
    this.setCells(entries);
  }
}

function literal(raw: string): Value {
  const t = raw.trim();
  if (t === '') return null;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  if (/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?%?$/.test(t)) return t.endsWith('%') ? Number(t.slice(0, -1)) / 100 : Number(t);
  return raw;
}
function shiftAst(a: Ast, dr: number, dc: number): Ast | null {
  switch (a.type) {
    case 'ref': { const r = shiftRef(a.ref, dr, dc); return r ? { type: 'ref', ref: r } : null; }
    case 'range': { const f = shiftRef(a.from, dr, dc), t = shiftRef(a.to, dr, dc); return f && t ? { type: 'range', from: f, to: t } : null; }
    case 'unary': { const x = shiftAst(a.arg, dr, dc); return x ? { ...a, arg: x } : null; }
    case 'postfix': { const x = shiftAst(a.arg, dr, dc); return x ? { ...a, arg: x } : null; }
    case 'binary': { const l = shiftAst(a.left, dr, dc), r = shiftAst(a.right, dr, dc); return l && r ? { ...a, left: l, right: r } : null; }
    case 'call': { const args = a.args.map(x => shiftAst(x, dr, dc)); return args.every(Boolean) ? { ...a, args: args as Ast[] } : null; }
    default: return a;
  }
}
const csvEscape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
