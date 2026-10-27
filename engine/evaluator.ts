/**
 * 求值器。模型输出(公式)永远当不可信输入:每一步都可能产生错误值,错误值向上传播。
 * 需要的外部能力只有两个回调:取单个格的值、取范围内的值(由 Sheet 提供)。
 */
import type { Ast, Ref, Value } from './types';
import { err, isError } from './types';

export type EvalContext = {
  get(ref: Ref): Value;
  range(from: Ref, to: Ref): Value[];
};

export function evaluate(ast: Ast, ctx: EvalContext): Value {
  switch (ast.type) {
    case 'num': return ast.value;
    case 'str': return ast.value;
    case 'bool': return ast.value;
    case 'ref': return ctx.get(ast.ref);
    case 'range': return err('#VALUE!');                   // 裸范围不能作为标量
    case 'unary': { const v = num(evaluate(ast.arg, ctx)); return isError(v) ? v : (ast.op === '-' ? -v : v); }
    case 'postfix': { const v = num(evaluate(ast.arg, ctx)); return isError(v) ? v : v / 100; }
    case 'binary': return binary(ast.op, evaluate(ast.left, ctx), evaluate(ast.right, ctx));
    case 'call': return call(ast, ctx);
  }
}

// ---- 类型强制 ----
function num(v: Value): number | ReturnType<typeof err> {
  if (isError(v)) return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  const n = Number(v); return Number.isFinite(n) ? n : err('#VALUE!');
}
const str = (v: Value) => (isError(v) ? v : v === null ? '' : String(v));

function binary(op: string, l: Value, r: Value): Value {
  if (isError(l)) return l; if (isError(r)) return r;
  if (op === '&') { const a = str(l), b = str(r); return `${a}${b}`; }
  if (op === '=' || op === '<>') { const eq = loose(l) === loose(r); return op === '=' ? eq : !eq; }
  if (op === '<' || op === '>' || op === '<=' || op === '>=') {
    const a = loose(l), b = loose(r);
    if (typeof a !== typeof b) return err('#VALUE!');
    return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  }
  const a = num(l), b = num(r); if (isError(a)) return a; if (isError(b)) return b;
  switch (op) {
    case '+': return a + b; case '-': return a - b; case '*': return a * b;
    case '/': return b === 0 ? err('#DIV/0!') : a / b;
    case '^': return Math.pow(a, b);
  }
  return err('#VALUE!');
}
const loose = (v: Value) => (v === null ? '' : typeof v === 'string' ? v.toLowerCase() : v);

// ---- 函数表:加函数 = 加一项 ----
type Fn = (args: Value[][], raw: Ast[], ctx: EvalContext) => Value;
const flat = (args: Value[][]) => args.flat();
const nums = (vs: Value[]) => vs.filter(v => typeof v === 'number') as number[];
const firstErr = (vs: Value[]) => vs.find(isError);

const FUNCS: Record<string, Fn> = {
  SUM: a => firstErr(flat(a)) ?? nums(flat(a)).reduce((s, x) => s + x, 0),
  AVERAGE: a => { const e = firstErr(flat(a)); if (e) return e; const n = nums(flat(a)); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : err('#DIV/0!'); },
  MIN: a => firstErr(flat(a)) ?? (nums(flat(a)).length ? Math.min(...nums(flat(a))) : 0),
  MAX: a => firstErr(flat(a)) ?? (nums(flat(a)).length ? Math.max(...nums(flat(a))) : 0),
  COUNT: a => nums(flat(a)).length,
  COUNTA: a => flat(a).filter(v => v !== null && v !== '').length,
  ABS: a => { const v = num(a[0]?.[0] ?? null); return isError(v) ? v : Math.abs(v); },
  ROUND: a => { const v = num(a[0]?.[0] ?? null), d = num(a[1]?.[0] ?? 0); if (isError(v)) return v; if (isError(d)) return d; const f = 10 ** d; return Math.round(v * f) / f; },
  LEN: a => { const s = str(a[0]?.[0] ?? null); return isError(s) ? s : s.length; },
  CONCAT: a => { const e = firstErr(flat(a)); return e ?? flat(a).map(v => str(v) as string).join(''); },
  AND: a => firstErr(flat(a)) ?? flat(a).every(v => !!v),
  OR: a => firstErr(flat(a)) ?? flat(a).some(v => !!v),
  NOT: a => { const v = a[0]?.[0]; return isError(v as Value) ? (v as Value) : !v; },
  // IF 需要惰性求值:只算命中的分支(否则另一分支的 #DIV/0! 会污染结果)
  IF: (_a, raw, ctx) => {
    const c = evaluate(raw[0], ctx); if (isError(c)) return c;
    const branch = c ? raw[1] : raw[2];
    return branch ? evaluate(branch, ctx) : (c ? true : false);
  },
};
const LAZY = new Set(['IF']);

function call(ast: Extract<Ast, { type: 'call' }>, ctx: EvalContext): Value {
  const fn = FUNCS[ast.name]; if (!fn) return err('#NAME?');
  if (LAZY.has(ast.name)) return fn([], ast.args, ctx);
  const args = ast.args.map(a => (a.type === 'range' ? ctx.range(a.from, a.to) : [evaluate(a, ctx)]));
  return fn(args, ast.args, ctx);
}

export const FUNCTION_NAMES = Object.keys(FUNCS);
