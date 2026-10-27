/** xlsx 导入导出(SheetJS):导出带公式(f)和当前值(v),导入时公式还原为 "=…" */
import type { Sheet } from '../engine/sheet';
import { a1, parseRef } from '../engine/refs';
import { parseKey, isError } from '../engine/types';

export async function exportXlsx(sheet: Sheet, name = 'sheet.xlsx') {
  const XLSX = await import('xlsx');
  const ws: Record<string, any> = {};
  let maxR = 0, maxC = 0;
  for (const k of sheet.keys()) {
    const [r, c] = parseKey(k); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
    const cell = sheet.getCell(r, c)!; const v = cell.value;
    const out: any = isError(v) ? { t: 'e', v: v.error } : typeof v === 'number' ? { t: 'n', v } : typeof v === 'boolean' ? { t: 'b', v } : { t: 's', v: v ?? '' };
    if (cell.formula) out.f = cell.formula;
    ws[a1(r, c)] = out;
  }
  ws['!ref'] = `A1:${a1(maxR, maxC)}`;
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.writeFile(wb, name);
}

export async function importXlsx(sheet: Sheet, file: File) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const entries: { r: number; c: number; raw: string }[] = [];
  for (const addr of Object.keys(ws)) {
    if (addr.startsWith('!')) continue;
    const ref = parseRef(addr); if (!ref) continue;
    const cell = ws[addr];
    entries.push({ r: ref.row, c: ref.col, raw: cell.f ? '=' + cell.f : String(cell.v ?? '') });
  }
  sheet.setCells(entries);
}
