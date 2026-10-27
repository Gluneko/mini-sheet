import { describe, it, expect } from 'vitest';
import { Sheet, parseFormula, printAst, tokenize } from '../index';

const A = 0, B = 1, C = 2;

describe('tokenizer & parser', () => {
  it('tokenizes refs, numbers, strings, ops', () => {
    const t = tokenize('SUM($A$1:B2, 3.5, "x""y") * -2%');
    expect(t.map(x => x.t)).toEqual(['ident', 'lparen', 'ident', 'colon', 'ident', 'comma', 'num', 'comma', 'str', 'rparen', 'op', 'op', 'num', 'op', 'eof']);
  });
  it('respects precedence and associativity', () => {
    expect(printAst(parseFormula('1+2*3'))).toBe('1+(2*3)');
    expect(printAst(parseFormula('2^3^2'))).toBe('2^(3^2)');       // 右结合
    expect(printAst(parseFormula('-2^2'))).toBe('-(2^2)');          // 一元负号低于乘方(Excel 语义见 evaluator)
    expect(printAst(parseFormula('(1+2)*3'))).toBe('(1+2)*3');
    expect(printAst(parseFormula('A1&"-"&B1'))).toBe('(A1&"-")&B1');
  });
  it('rejects garbage', () => {
    expect(() => parseFormula('1+')).toThrow();
    expect(() => parseFormula('FOO(')).toThrow();
    expect(() => parseFormula('1 2')).toThrow();
  });
});

describe('Sheet: values and formulas', () => {
  it('evaluates literals and arithmetic', () => {
    const s = new Sheet();
    s.setCell(0, A, '2'); s.setCell(0, B, '3'); s.setCell(0, C, '=A1*B1+1');
    expect(s.getValue(0, C)).toBe(7);
    s.setCell(0, A, '10');
    expect(s.getValue(0, C)).toBe(31);
  });
  it('SUM / AVERAGE over ranges, ignores text, errors propagate', () => {
    const s = new Sheet();
    [1, 2, 3, 'x'].forEach((v, i) => s.setCell(i, A, String(v)));
    s.setCell(5, A, '=SUM(A1:A4)'); s.setCell(6, A, '=AVERAGE(A1:A3)'); s.setCell(7, A, '=A1/0'); s.setCell(8, A, '=SUM(A1:A8)');
    expect(s.getValue(5, A)).toBe(6);
    expect(s.getValue(6, A)).toBe(2);
    expect(s.getValue(7, A)).toEqual({ error: '#DIV/0!' });
    expect(s.getValue(8, A)).toEqual({ error: '#DIV/0!' });   // 范围里有错误 → 传播
  });
  it('IF is lazy and comparisons work', () => {
    const s = new Sheet();
    s.setCell(0, A, '5'); s.setCell(0, B, '=IF(A1>3,"big",1/0)'); s.setCell(0, C, '=IF(A1<3,"small",A1*2)');
    expect(s.getValue(0, B)).toBe('big');
    expect(s.getValue(0, C)).toBe(10);
  });
  it('unknown function → #NAME?, bad formula → #NAME?', () => {
    const s = new Sheet();
    s.setCell(0, A, '=NOPE(1)'); s.setCell(1, A, '=1+');
    expect(s.getValue(0, A)).toEqual({ error: '#NAME?' });
    expect(s.getValue(1, A)).toEqual({ error: '#NAME?' });
  });
});

describe('Sheet: dependency graph', () => {
  it('recalculates only downstream cells (incremental)', () => {
    const s = new Sheet();
    s.setCell(0, A, '1');
    for (let r = 1; r < 50; r++) s.setCell(r, A, `=A${r}+1`);      // 链:A2=A1+1 … A50=A49+1
    s.setCell(0, B, '=A1*100');                                      // 旁支
    s.setCell(0, C, '=1');                                           // 无关格
    s.setCell(25, A, '=A25+100');                                    // 改链中间
    expect(s.lastRecalc.evaluated).toBe(25);                         // 只算 A26..A50(含自己)
    expect(s.getValue(49, A)).toBe(1 + 24 + 100 + 24);
  });
  it('detects direct, indirect and self cycles and recovers', () => {
    const s = new Sheet();
    s.setCell(0, A, '=B1+1'); s.setCell(0, B, '=C1+1'); s.setCell(0, C, '=A1+1');
    expect(s.getValue(0, A)).toEqual({ error: '#CYCLE!' });
    expect(s.getValue(0, C)).toEqual({ error: '#CYCLE!' });
    s.setCell(0, C, '7');                                            // 打断环
    expect(s.getValue(0, B)).toBe(8); expect(s.getValue(0, A)).toBe(9);
    s.setCell(1, A, '=A2'); expect(s.getValue(1, A)).toEqual({ error: '#CYCLE!' });
    s.setCell(2, A, '=SUM(A1:A3)'); expect(s.getValue(2, A)).toEqual({ error: '#CYCLE!' }); // 范围含自身
  });
  it('large ranges use range index, not per-cell edges', () => {
    const s = new Sheet();
    s.setCell(0, B, '=SUM(A1:A100000)');
    s.setCell(99999, A, '5'); expect(s.getValue(0, B)).toBe(5);
    s.setCell(500, A, '7'); expect(s.getValue(0, B)).toBe(12);
  });
});

describe('Sheet: copy, undo/redo, csv', () => {
  it('shifts relative refs and keeps absolute refs when copying', () => {
    const s = new Sheet();
    s.setCell(0, C, '=A1+$B$1');
    expect(s.copyFormula(0, C, 2, C)).toBe('=A3+$B$1');
    expect(s.copyFormula(0, C, 0, 3)).toBe('=B1+$B$1');
    s.setCell(5, A, '=A2'); expect(s.copyFormula(5, A, 0, A)).toBe('=#REF!');
  });
  it('undo/redo as commands', () => {
    const s = new Sheet();
    s.setCell(0, A, '1'); s.setCell(0, B, '=A1*2'); s.setCell(0, A, '5');
    expect(s.getValue(0, B)).toBe(10);
    s.undo(); expect(s.getValue(0, B)).toBe(2);
    s.redo(); expect(s.getValue(0, B)).toBe(10);
    s.setCells([{ r: 1, c: A, raw: '1' }, { r: 1, c: B, raw: '2' }]); s.undo();
    expect(s.getRaw(1, A)).toBe(''); expect(s.getRaw(1, B)).toBe('');
  });
  it('csv round trip', () => {
    const s = new Sheet();
    s.setCell(0, A, 'a,b'); s.setCell(0, B, '=A1&"!"'); s.setCell(1, A, '3');
    const csv = s.toCSV();
    const t = new Sheet(); t.loadCSV(csv);
    expect(t.getRaw(0, A)).toBe('a,b'); expect(t.getValue(0, B)).toBe('a,b!'); expect(t.getValue(1, A)).toBe(3);
  });
});

describe('Sheet: validateFormula and remote apply', () => {
  it('rejects unparsable, out-of-bounds and self-referencing formulas without side effects', () => {
    const s = new Sheet();
    s.setCell(0, A, '1'); s.setCell(1, A, '2');
    const b = { rows: 100, cols: 10 };
    expect(s.validateFormula(5, A, '=SUM(A1:A2)', b)).toEqual({ ok: true });
    expect(s.validateFormula(5, A, '=SUM(A1:A6)', b).ok).toBe(false);        // 含自身 → #CYCLE!
    expect(s.validateFormula(5, A, '=A1+', b).ok).toBe(false);               // 解析失败
    expect(s.validateFormula(5, A, '=SUM(A1:A500)', b).ok).toBe(false);      // 越界
    expect(s.getRaw(5, A)).toBe('');                                          // 试写已还原
    expect(s.canUndo()).toBe(true); const n = (s as any).undoStack.length;
    s.validateFormula(5, A, '=SUM(A1:A2)', b); expect((s as any).undoStack.length).toBe(n);   // 不进撤销栈
  });
  it('applyRemote does not record undo and does not re-broadcast', () => {
    const s = new Sheet(); const seen: string[] = [];
    s.onEdit(edits => seen.push(...edits.map(e => e.key)));
    s.setCell(0, A, '1');
    s.applyRemote([{ r: 0, c: B, raw: '=A1*2' }]);
    expect(s.getValue(0, B)).toBe(2);
    expect(seen).toEqual(['0,0']);                                            // 远端写入不触发 onEdit
    s.undo(); expect(s.getRaw(0, A)).toBe(''); expect(s.getRaw(0, B)).toBe('=A1*2');  // 撤销只撤本地
  });
});
