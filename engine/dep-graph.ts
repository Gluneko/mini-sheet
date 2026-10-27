/**
 * 依赖图:谁依赖谁(deps)、谁被谁依赖(dependents)。
 * 两类依赖:
 *  - 单格依赖:A1 → 直接建边
 *  - 范围依赖:SUM(A1:A100000) 不建 10 万条边,存一条范围记录;某格变化时按行列区间匹配找到依赖它的公式
 * 这就是“改一格只重算下游”的基础。
 */
import type { Ast, Key, Ref } from './types';
import { key } from './types';

export type RangeDep = { r1: number; c1: number; r2: number; c2: number; dependent: Key };
const EXPAND_LIMIT = 256;   // 小范围直接展开成单格边(匹配快),大范围走区间记录(建图快)

export class DepGraph {
  private deps = new Map<Key, Set<Key>>();          // k 依赖的单格
  private dependents = new Map<Key, Set<Key>>();    // 依赖 k 的公式格
  private rangeDeps = new Map<Key, RangeDep[]>();   // k(公式格)声明的范围依赖
  private ranges: RangeDep[] = [];                  // 全部范围记录(线性扫描;量大可换区间树)

  /** 用公式 AST 重建 k 的依赖 */
  setDeps(k: Key, ast: Ast | undefined) {
    this.clear(k);
    if (!ast) return;
    const single = new Set<Key>(); const rs: RangeDep[] = [];
    walk(ast, single, rs, k);
    this.deps.set(k, single);
    for (const d of single) { if (!this.dependents.has(d)) this.dependents.set(d, new Set()); this.dependents.get(d)!.add(k); }
    if (rs.length) { this.rangeDeps.set(k, rs); this.ranges.push(...rs); }
  }
  clear(k: Key) {
    for (const d of this.deps.get(k) ?? []) this.dependents.get(d)?.delete(k);
    this.deps.delete(k);
    const rs = this.rangeDeps.get(k);
    if (rs) { this.ranges = this.ranges.filter(r => r.dependent !== k); this.rangeDeps.delete(k); }
  }

  /** 直接依赖 k 的公式格(单格边 + 范围命中) */
  dependentsOf(k: Key): Set<Key> {
    const out = new Set(this.dependents.get(k) ?? []);
    if (this.ranges.length) {
      const i = k.indexOf(','); const r = Number(k.slice(0, i)), c = Number(k.slice(i + 1));
      for (const rd of this.ranges) if (r >= rd.r1 && r <= rd.r2 && c >= rd.c1 && c <= rd.c2) out.add(rd.dependent);
    }
    return out;
  }
  /** k 的单格依赖(不展开范围;自引用检查用,O(1)) */
  directDeps(k: Key): Set<Key> { return this.deps.get(k) ?? new Set(); }
  /** k 直接依赖的格(单格 + 范围展开,用于环检测) */
  depsOf(k: Key): Set<Key> {
    const out = new Set(this.deps.get(k) ?? []);
    for (const rd of this.rangeDeps.get(k) ?? []) {
      const n = (rd.r2 - rd.r1 + 1) * (rd.c2 - rd.c1 + 1);
      if (n > 20000) continue; // 超大范围不展开参与环检测(实践中用“范围内含自身”快速判定)
      for (let r = rd.r1; r <= rd.r2; r++) for (let c = rd.c1; c <= rd.c2; c++) out.add(key(r, c));
    }
    return out;
  }
  /** k 是否(直接)通过范围引用了自己 */
  rangeContains(k: Key, target: Key): boolean {
    const [r, c] = target.split(',').map(Number);
    return (this.rangeDeps.get(k) ?? []).some(rd => r >= rd.r1 && r <= rd.r2 && c >= rd.c1 && c <= rd.c2);
  }

  /**
   * 从一组起点出发的全部传递下游(含起点),返回拓扑序;检测到环时把环上节点放进 cycle。
   * 一次收集整个子图(多个起点合并),Kahn 排序用索引指针而不是 shift,整体 O(V + E)。
   */
  affected(starts: Iterable<Key>): { order: Key[]; cycle: Set<Key> } {
    // 1) 收集子图(每个节点的 dependentsOf 只算一次,缓存给第 2 步用)
    const nodes = new Set<Key>(); const stack: Key[] = [];
    for (const s of starts) if (!nodes.has(s)) { nodes.add(s); stack.push(s); }
    const out = new Map<Key, Set<Key>>();
    while (stack.length) {
      const k = stack.pop()!; const ds = this.dependentsOf(k); out.set(k, ds);
      for (const d of ds) if (!nodes.has(d)) { nodes.add(d); stack.push(d); }
    }
    // 2) 子图内 Kahn 拓扑排序:入度 = 子图内上游数
    const indeg = new Map<Key, number>(); for (const n of nodes) indeg.set(n, 0);
    for (const n of nodes) for (const d of out.get(n)!) indeg.set(d, indeg.get(d)! + 1);
    const queue: Key[] = []; for (const n of nodes) if (indeg.get(n) === 0) queue.push(n);
    const order: Key[] = []; const ordered = new Set<Key>();
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]; order.push(n); ordered.add(n);
      for (const d of out.get(n)!) { const v = indeg.get(d)! - 1; indeg.set(d, v); if (v === 0) queue.push(d); }
    }
    const cycle = new Set<Key>(); for (const n of nodes) if (!ordered.has(n)) cycle.add(n);
    return { order, cycle };
  }
}

function walk(a: Ast, single: Set<Key>, ranges: RangeDep[], dependent: Key) {
  switch (a.type) {
    case 'ref': single.add(key(a.ref.row, a.ref.col)); break;
    case 'range': {
      const r1 = Math.min(a.from.row, a.to.row), r2 = Math.max(a.from.row, a.to.row);
      const c1 = Math.min(a.from.col, a.to.col), c2 = Math.max(a.from.col, a.to.col);
      if ((r2 - r1 + 1) * (c2 - c1 + 1) <= EXPAND_LIMIT) { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) single.add(key(r, c)); }
      else ranges.push({ r1, c1, r2, c2, dependent });
      break;
    }
    case 'unary': case 'postfix': walk(a.arg, single, ranges, dependent); break;
    case 'binary': walk(a.left, single, ranges, dependent); walk(a.right, single, ranges, dependent); break;
    case 'call': a.args.forEach(x => walk(x, single, ranges, dependent)); break;
  }
}
export const refsOf = (a: Ast): Ref[] => { const out: Ref[] = []; (function go(n: Ast) { if (n.type === 'ref') out.push(n.ref); else if (n.type === 'range') out.push(n.from, n.to); else if (n.type === 'unary' || n.type === 'postfix') go(n.arg); else if (n.type === 'binary') { go(n.left); go(n.right); } else if (n.type === 'call') n.args.forEach(go); })(a); return out; };
