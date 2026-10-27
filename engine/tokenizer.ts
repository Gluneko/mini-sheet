/**
 * 公式词法分析。输入不含开头的 '='。
 * token 类型:num / str / ident(函数名、TRUE/FALSE、单元格引用都先当 ident,语法阶段再区分)/ op / lparen / rparen / comma / colon / eof
 */
export type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lparen' } | { t: 'rparen' } | { t: 'comma' } | { t: 'colon' } | { t: 'eof' };

const OPS = ['<=', '>=', '<>', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%'];

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '(') { out.push({ t: 'lparen' }); i++; continue; }
    if (ch === ')') { out.push({ t: 'rparen' }); i++; continue; }
    if (ch === ',') { out.push({ t: 'comma' }); i++; continue; }
    if (ch === ':') { out.push({ t: 'colon' }); i++; continue; }
    if (ch === '"') {                                  // 字符串,"" 转义为一个引号
      let j = i + 1, s = '';
      while (j < src.length) {
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      if (j >= src.length) throw new SyntaxError('unterminated string');
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (/[A-Za-z_$]/.test(ch)) {                       // 标识符 / 引用(允许 $A$1 形式)
      const m = /^\$?[A-Za-z_][A-Za-z0-9_.]*\$?\d*/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0] }); i += m[0].length; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }
    throw new SyntaxError(`unexpected character '${ch}' at ${i}`);
  }
  out.push({ t: 'eof' });
  return out;
}
