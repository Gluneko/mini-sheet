/**
 * Pratt 解析器(自顶向下算符优先)。
 * 每个中缀运算符有一个“绑定力”(binding power),解析时只吞掉绑定力更高的右侧表达式,优先级和结合性靠数字表达,不用写一层层的递归函数。
 *
 *   比较 = <> < > <= >=   : 5
 *   文本连接 &              : 6
 *   + -                    : 10
 *   * /                    : 20
 *   ^(右结合)              : 30
 *   一元 - +               : 25(介于乘除和乘方之间,和 Excel 一致:-2^2 = 4)
 *   后缀 %                 : 40
 */
import { tokenize, type Token } from './tokenizer';
import { parseRef } from './refs';
import type { Ast } from './types';

const INFIX_BP: Record<string, [number, number]> = {       // [左绑定力, 右绑定力];右 < 左 → 右结合
  '=': [5, 6], '<>': [5, 6], '<': [5, 6], '>': [5, 6], '<=': [5, 6], '>=': [5, 6],
  '&': [6, 7],
  '+': [10, 11], '-': [10, 11],
  '*': [20, 21], '/': [20, 21],
  '^': [31, 30],
};
const PREFIX_BP = 25;
const POSTFIX_BP: Record<string, number> = { '%': 40 };

export function parseFormula(src: string): Ast {
  const p = new Parser(tokenize(src));
  const ast = p.expr(0);
  if (p.peek().t !== 'eof') throw new SyntaxError('unexpected token after expression');
  return ast;
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}
  peek() { return this.toks[this.i]; }
  next() { return this.toks[this.i++]; }
  expect<T extends Token['t']>(t: T) { const tok = this.next(); if (tok.t !== t) throw new SyntaxError(`expected ${t}`); return tok as Extract<Token, { t: T }>; }

  expr(minBp: number): Ast {
    let left = this.prefix();
    for (;;) {
      const tok = this.peek();
      if (tok.t !== 'op') break;
      const post = POSTFIX_BP[tok.v];
      if (post !== undefined) { if (post < minBp) break; this.next(); left = { type: 'postfix', op: '%', arg: left }; continue; }
      const bp = INFIX_BP[tok.v]; if (!bp) break;
      const [lbp, rbp] = bp; if (lbp < minBp) break;
      this.next();
      const right = this.expr(rbp);
      left = { type: 'binary', op: tok.v as any, left, right };
    }
    return left;
  }

  prefix(): Ast {
    const tok = this.next();
    switch (tok.t) {
      case 'num': return { type: 'num', value: tok.v };
      case 'str': return { type: 'str', value: tok.v };
      case 'lparen': { const e = this.expr(0); this.expect('rparen'); return e; }
      case 'op':
        if (tok.v === '-' || tok.v === '+') return { type: 'unary', op: tok.v, arg: this.expr(PREFIX_BP) };
        throw new SyntaxError(`unexpected operator ${tok.v}`);
      case 'ident': {
        const up = tok.v.toUpperCase();
        if (up === 'TRUE') return { type: 'bool', value: true };
        if (up === 'FALSE') return { type: 'bool', value: false };
        if (this.peek().t === 'lparen') {                        // 函数调用
          this.next();
          const args: Ast[] = [];
          if (this.peek().t !== 'rparen') { args.push(this.expr(0)); while (this.peek().t === 'comma') { this.next(); args.push(this.expr(0)); } }
          this.expect('rparen');
          return { type: 'call', name: up, args };
        }
        const ref = parseRef(tok.v);
        if (!ref) throw new SyntaxError(`unknown name ${tok.v}`);
        if (this.peek().t === 'colon') {                         // 范围 A1:B3
          this.next();
          const t2 = this.expect('ident'); const r2 = parseRef(t2.v);
          if (!r2) throw new SyntaxError(`bad range end ${t2.v}`);
          return { type: 'range', from: ref, to: r2 };
        }
        return { type: 'ref', ref };
      }
      default: throw new SyntaxError(`unexpected ${tok.t}`);
    }
  }
}

/** AST → 公式文本(复制平移、规范化显示都用它) */
import { formatRef } from './refs';
export function printAst(a: Ast): string {
  switch (a.type) {
    case 'num': return String(a.value);
    case 'str': return `"${a.value.replace(/"/g, '""')}"`;
    case 'bool': return a.value ? 'TRUE' : 'FALSE';
    case 'ref': return formatRef(a.ref);
    case 'range': return `${formatRef(a.from)}:${formatRef(a.to)}`;
    case 'unary': return `${a.op}${wrap(a.arg)}`;
    case 'postfix': return `${wrap(a.arg)}%`;
    case 'binary': return `${wrap(a.left)}${a.op}${wrap(a.right)}`;
    case 'call': return `${a.name}(${a.args.map(printAst).join(',')})`;
  }
}
const wrap = (a: Ast) => (a.type === 'binary' ? `(${printAst(a)})` : printAst(a));
