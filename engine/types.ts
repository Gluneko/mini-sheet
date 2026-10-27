/** 单元格的值:数字 / 字符串 / 布尔 / 空 / 错误 */
export type CellError = { error: '#DIV/0!' | '#REF!' | '#NAME?' | '#VALUE!' | '#CYCLE!' | '#N/A' };
export type Value = number | string | boolean | null | CellError;
export const isError = (v: Value): v is CellError => typeof v === 'object' && v !== null && 'error' in v;
export const err = (e: CellError['error']): CellError => ({ error: e });

/** 单元格引用(0 基行列;abs* 表示 $ 绝对引用) */
export type Ref = { row: number; col: number; absRow: boolean; absCol: boolean };

/** 公式 AST */
export type Ast =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'ref'; ref: Ref }
  | { type: 'range'; from: Ref; to: Ref }
  | { type: 'unary'; op: '-' | '+'; arg: Ast }
  | { type: 'binary'; op: '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '>' | '<=' | '>='; left: Ast; right: Ast }
  | { type: 'postfix'; op: '%'; arg: Ast }
  | { type: 'call'; name: string; args: Ast[] };

/** 存储里的单元格 */
export type Cell = {
  raw: string;            // 用户输入的原文("=SUM(A1:A3)" 或 "42" 或 "hello")
  value: Value;           // 计算结果
  ast?: Ast;              // 是公式时的 AST
  formula?: string;       // 规范化后的公式文本(不含 '=')
};

export type Key = string;  // "r,c"
export const key = (r: number, c: number): Key => `${r},${c}`;
export const parseKey = (k: Key): [number, number] => { const i = k.indexOf(','); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };
