import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Sheet } from '../engine/sheet';
import { indexToCol, a1 } from '../engine/refs';
import { isError } from '../engine/types';

/**
 * 虚拟网格:只渲染可视窗口 + 缓冲区的行列。
 * 列宽可变:列宽数组 → 前缀和;可视列用二分查找定位,O(log n);拖动表头右缘改宽。
 * 行高固定(可变行高同理:前缀和 + 二分)。
 */
const ROW_H = 24, DEFAULT_W = 96, HEAD_H = 24, HEAD_W = 48, BUFFER = 4, MIN_W = 40;

type Props = {
  sheet: Sheet; rows: number; cols: number; version: number;
  highlight?: Set<string>;                       // 远端刚改过的格(协同高亮)
  onSelect(r: number, c: number): void;
};
type Pos = { r: number; c: number };

export default function VirtualGrid({ sheet, rows, cols, version, highlight, onSelect }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0, w: 800, h: 600 });
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ pos: Pos; text: string } | null>(null);
  const [widths, setWidths] = useState<number[]>(() => Array(cols).fill(DEFAULT_W));
  // 前缀和:prefix[i] = 第 i 列左边缘的 x(不含表头列)
  const prefix = useMemo(() => { const p = new Array(cols + 1); p[0] = 0; for (let i = 0; i < cols; i++) p[i + 1] = p[i] + widths[i]; return p as number[]; }, [widths, cols]);
  const colAt = useCallback((x: number) => { let lo = 0, hi = cols - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (prefix[mid] <= x) lo = mid; else hi = mid - 1; } return lo; }, [prefix, cols]);
  const totalW = prefix[cols];

  useEffect(() => {
    const el = ref.current!; const ro = new ResizeObserver(() => setScroll(s => ({ ...s, w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el); setScroll(s => ({ ...s, w: el.clientWidth, h: el.clientHeight }));
    return () => ro.disconnect();
  }, []);
  useEffect(() => { onSelect(focus.r, focus.c); }, [focus, onSelect]);

  const onScroll = () => { const el = ref.current!; setScroll(s => ({ ...s, top: el.scrollTop, left: el.scrollLeft })); };

  // 可视范围(行:除法;列:二分)
  const r0 = Math.max(0, Math.floor((scroll.top - HEAD_H) / ROW_H) - BUFFER);
  const r1 = Math.min(rows - 1, Math.ceil((scroll.top + scroll.h) / ROW_H) + BUFFER);
  const c0 = Math.max(0, colAt(Math.max(0, scroll.left - HEAD_W)) - BUFFER);
  const c1 = Math.min(cols - 1, colAt(Math.min(totalW - 1, scroll.left + scroll.w)) + BUFFER);

  const select = useCallback((p: Pos, extend = false) => {
    const np = { r: clamp(p.r, 0, rows - 1), c: clamp(p.c, 0, cols - 1) };
    setFocus(np); if (!extend) setAnchor(np);
    const el = ref.current!;
    const top = HEAD_H + np.r * ROW_H, left = HEAD_W + prefix[np.c], w = widths[np.c];
    if (top < el.scrollTop + HEAD_H) el.scrollTop = top - HEAD_H;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
    if (left < el.scrollLeft + HEAD_W) el.scrollLeft = left - HEAD_W;
    else if (left + w > el.scrollLeft + el.clientWidth) el.scrollLeft = left + w - el.clientWidth;
  }, [rows, cols, prefix, widths]);

  const startEdit = (pos: Pos, initial?: string) => setEditing({ pos, text: initial ?? sheet.getRaw(pos.r, pos.c) });
  const commitEdit = (move?: Pos) => {
    if (editing) { sheet.setCell(editing.pos.r, editing.pos.c, editing.text); setEditing(null); }
    if (move) select(move);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing) {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit({ r: editing.pos.r + 1, c: editing.pos.c }); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit({ r: editing.pos.r, c: editing.pos.c + 1 }); }
      else if (e.key === 'Escape') setEditing(null);
      return;
    }
    const f = focus; const ext = e.shiftKey;
    const nav: Record<string, Pos> = { ArrowUp: { r: f.r - 1, c: f.c }, ArrowDown: { r: f.r + 1, c: f.c }, ArrowLeft: { r: f.r, c: f.c - 1 }, ArrowRight: { r: f.r, c: f.c + 1 } };
    if (nav[e.key]) { e.preventDefault(); select(nav[e.key], ext); return; }
    if (e.key === 'Tab') { e.preventDefault(); select({ r: f.r, c: f.c + (e.shiftKey ? -1 : 1) }); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(f); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const [ra, rb] = [Math.min(anchor.r, f.r), Math.max(anchor.r, f.r)], [ca, cb] = [Math.min(anchor.c, f.c), Math.max(anchor.c, f.c)];
      const entries = []; for (let r = ra; r <= rb; r++) for (let c = ca; c <= cb; c++) entries.push({ r, c, raw: '' });
      sheet.setCells(entries); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? sheet.redo() : sheet.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); navigator.clipboard?.writeText(sheet.getRaw(f.r, f.c)); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {                 // ⌘D:把 anchor 的公式向下填充到选区(引用平移)
      e.preventDefault();
      const [ra, rb] = [Math.min(anchor.r, f.r), Math.max(anchor.r, f.r)];
      const entries = []; for (let r = ra + 1; r <= rb; r++) entries.push({ r, c: anchor.c, raw: sheet.copyFormula(ra, anchor.c, r, anchor.c) });
      sheet.setCells(entries); return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { startEdit(f, e.key); e.preventDefault(); }
  };

  // 列宽拖拽
  const startResize = (c: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = widths[c];
    const move = (ev: MouseEvent) => setWidths(ws => { const n = ws.slice(); n[c] = Math.max(MIN_W, w0 + ev.clientX - x0); return n; });
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const inRange = (r: number, c: number) => r >= Math.min(anchor.r, focus.r) && r <= Math.max(anchor.r, focus.r) && c >= Math.min(anchor.c, focus.c) && c <= Math.max(anchor.c, focus.c);

  const cells = [];
  for (let r = r0; r <= r1; r++) {
    cells.push(<div key={`r${r}`} className="rcell" style={{ left: scroll.left, top: HEAD_H + r * ROW_H, width: HEAD_W, zIndex: 2 }}>{r + 1}</div>);
    for (let c = c0; c <= c1; c++) {
      const v = sheet.getValue(r, c); const isEd = editing && editing.pos.r === r && editing.pos.c === c; const k = `${r},${c}`;
      const cls = ['cell', typeof v === 'number' ? 'num' : '', isError(v) ? 'err' : '', focus.r === r && focus.c === c ? 'sel' : '', inRange(r, c) && !(focus.r === r && focus.c === c) ? 'range' : '', highlight?.has(k) ? 'remote' : ''].join(' ');
      cells.push(
        <div key={k} className={cls} style={{ left: HEAD_W + prefix[c], top: HEAD_H + r * ROW_H, width: widths[c] }}
          onMouseDown={e => { select({ r, c }, e.shiftKey); if (editing) commitEdit(); }}
          onDoubleClick={() => startEdit({ r, c })}>
          {isEd ? <input autoFocus value={editing!.text} onChange={e => setEditing({ pos: editing!.pos, text: e.target.value })} onBlur={() => commitEdit()} />
                : sheet.display(r, c)}
        </div>,
      );
    }
  }
  const heads = []; for (let c = c0; c <= c1; c++) heads.push(
    <div key={c} className="hcell" style={{ left: HEAD_W + prefix[c], width: widths[c] }}>{indexToCol(c)}<span className="resizer" onMouseDown={e => startResize(c, e)} /></div>,
  );

  return (
    <div ref={ref} className="grid" tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown} data-version={version}>
      <div className="grid-inner" style={{ width: HEAD_W + totalW, height: HEAD_H + rows * ROW_H }}>
        <div className="corner" style={{ width: HEAD_W, height: HEAD_H, position: 'absolute', left: scroll.left, top: scroll.top }}>{a1(focus.r, focus.c)}</div>
        <div style={{ position: 'absolute', top: scroll.top, left: 0, right: 0, height: HEAD_H, zIndex: 2 }}>{heads}</div>
        {cells}
      </div>
    </div>
  );
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
