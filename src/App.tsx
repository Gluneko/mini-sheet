import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from '../engine/sheet';
import { a1 } from '../engine/refs';
import VirtualGrid from './VirtualGrid';
import { SheetCollab } from './collab';
import { generateFormula, type Attempt } from './nl-formula';
import { exportXlsx, importXlsx } from './xlsx';

const ROWS = 100_000, COLS = 50;
const WS_URL = (import.meta as any).env?.VITE_SYNC_WS ?? 'ws://localhost:1234';

export default function App() {
  const sheet = useMemo(() => seed(new Sheet()), []);
  const [version, setVersion] = useState(0);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [fx, setFx] = useState('');
  const [nl, setNl] = useState('这一列求和');
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [collab, setCollab] = useState<{ status: string; peers: number } | null>(null);
  const [remote, setRemote] = useState<Set<string>>(new Set());
  const collabRef = useRef<SheetCollab | null>(null);

  useEffect(() => sheet.onChange(() => setVersion(v => v + 1)), [sheet]);
  useEffect(() => { setFx(sheet.getRaw(sel.r, sel.c)); }, [sel, version, sheet]);
  const onSelect = useCallback((r: number, c: number) => setSel({ r, c }), []);

  const toggleCollab = () => {
    if (collabRef.current) { collabRef.current.destroy(); collabRef.current = null; setCollab(null); return; }
    const who = window.prompt('身份(w-alice / w-bob / r-guest)', 'w-alice') || 'w-alice';
    const c = new SheetCollab(sheet, WS_URL, 'sheet-demo', who);
    c.onStatus = (status, peers) => setCollab({ status, peers });
    c.onRemote = keys => { setRemote(s => new Set([...s, ...keys])); setTimeout(() => setRemote(s => { const n = new Set(s); keys.forEach(k => n.delete(k)); return n; }), 2000); };
    collabRef.current = c; setCollab({ status: 'connecting', peers: 0 });
  };

  const runNl = () => {
    const res = generateFormula(sheet, nl, sel, { rows: ROWS, cols: COLS });
    setAttempts(res.attempts);
    if (res.formula) sheet.setCell(sel.r, sel.c, res.formula);
  };

  const stats = sheet.lastRecalc;
  return (
    <div className="app">
      <div className="toolbar">
        <strong style={{ color: '#1c1c1e' }}>Mini Sheet</strong>
        <span>{ROWS.toLocaleString()} 行 × {COLS} 列 · 已用 {sheet.size()} 格</span>
        <button onClick={() => sheet.undo()} disabled={!sheet.canUndo()}>撤销 ⌘Z</button>
        <button onClick={() => sheet.redo()} disabled={!sheet.canRedo()}>重做</button>
        <button onClick={() => download('sheet.csv', sheet.toCSV())}>导出 CSV</button>
        <button onClick={() => upload('.csv', f => f.text().then(t => sheet.loadCSV(t)))}>导入 CSV</button>
        <button onClick={() => exportXlsx(sheet)}>导出 xlsx</button>
        <button onClick={() => upload('.xlsx', f => importXlsx(sheet, f))}>导入 xlsx</button>
        <button onClick={() => fillChain(sheet)}>压测:1 万格链式公式</button>
        <button onClick={toggleCollab}>{collab ? `协同中 · ${collab.status} · 在线 ${collab.peers} · 断开` : '开启协同(Yjs)'}</button>
        <span style={{ marginLeft: 'auto' }}>Enter 编辑 · Tab/方向键 · ⌘D 向下填充 · 拖表头改列宽</span>
      </div>
      <div className="fx">
        <span className="addr">{a1(sel.r, sel.c)}</span>
        <input value={fx} onChange={e => setFx(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sheet.setCell(sel.r, sel.c, fx); }} placeholder="输入值或 =公式,回车提交" />
        <input value={nl} onChange={e => setNl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') runNl(); }} placeholder="自然语言生成公式,如:B 列平均值" style={{ flex: '0 0 260px' }} />
        <button onClick={runNl}>生成公式</button>
      </div>
      <VirtualGrid sheet={sheet} rows={ROWS} cols={COLS} version={version} highlight={remote} onSelect={onSelect} />
      <div className="status">
        上次重算:{stats.evaluated} 格求值,{stats.cycle} 格循环引用,{stats.ms.toFixed(2)} ms
        {attempts.length > 0 && <span> ｜ 生成公式:{attempts.map((a, i) => <span key={i}> 第 {i + 1} 次 <code>{a.formula}</code> {a.ok ? '✓ 已写入' : `✗ ${a.error} → 回塞修正`}</span>)}</span>}
      </div>
    </div>
  );
}

function seed(s: Sheet) {
  s.setCells([
    { r: 0, c: 0, raw: '品类' }, { r: 0, c: 1, raw: '单价' }, { r: 0, c: 2, raw: '数量' }, { r: 0, c: 3, raw: '小计' }, { r: 0, c: 4, raw: '折后' },
    { r: 1, c: 0, raw: '钻头' }, { r: 1, c: 1, raw: '120' }, { r: 1, c: 2, raw: '3' }, { r: 1, c: 3, raw: '=B2*C2' }, { r: 1, c: 4, raw: '=D2*(1-$G$2)' },
    { r: 2, c: 0, raw: '轴承' }, { r: 2, c: 1, raw: '45.5' }, { r: 2, c: 2, raw: '10' }, { r: 2, c: 3, raw: '=B3*C3' }, { r: 2, c: 4, raw: '=D3*(1-$G$2)' },
    { r: 3, c: 0, raw: '法兰' }, { r: 3, c: 1, raw: '80' }, { r: 3, c: 2, raw: '0' }, { r: 3, c: 3, raw: '=B4*C4' }, { r: 3, c: 4, raw: '=D4*(1-$G$2)' },
    { r: 5, c: 2, raw: '合计' }, { r: 5, c: 3, raw: '=SUM(D2:D4)' }, { r: 5, c: 4, raw: '=SUM(E2:E4)' },
    { r: 6, c: 2, raw: '均价' }, { r: 6, c: 3, raw: '=ROUND(AVERAGE(B2:B4),1)' },
    { r: 7, c: 2, raw: '有货?' }, { r: 7, c: 3, raw: '=IF(C4>0,"有","缺货")' },
    { r: 0, c: 6, raw: '折扣' }, { r: 1, c: 6, raw: '0.1' },
    { r: 9, c: 0, raw: '循环' }, { r: 9, c: 1, raw: '=C10+1' }, { r: 9, c: 2, raw: '=B10+1' },
    { r: 10, c: 0, raw: '除零' }, { r: 10, c: 1, raw: '=1/C11' },
  ]);
  return s;
}
function fillChain(s: Sheet) {
  const entries = [{ r: 20, c: 0, raw: '1' }]; for (let r = 21; r < 10020; r++) entries.push({ r, c: 0, raw: `=A${r}+1` });
  entries.push({ r: 19, c: 0, raw: '=SUM(A21:A10020)' });
  s.setCells(entries);
}
function download(name: string, text: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); }
function upload(accept: string, cb: (f: File) => void) { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => { const f = i.files?.[0]; if (f) cb(f); }; i.click(); }
