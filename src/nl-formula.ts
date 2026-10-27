/**
 * 自然语言 → 公式:模型负责“理解意图、生成候选”,代码负责“校验与边界”。
 *  1. mockModel 按关键词出一个候选公式(真模型换成一次 API 调用即可,接口不变)
 *  2. sheet.validateFormula:解析 / 引用范围 / 试写看是否成环
 *  3. 失败把错误原因回塞给模型再试,最多 3 轮;全部失败就不写入
 * 这是 GeoGPT 里“结构化输出经 schema 校验失败回塞让模型修正”的表格版。
 */
import type { Sheet } from '../engine/sheet';
import { a1, indexToCol } from '../engine/refs';

export type Attempt = { formula: string; ok: boolean; error?: string };

type Ctx = { r: number; c: number; rows: number; cols: number; usedRows: number; feedback?: string };

export function mockModel(prompt: string, ctx: Ctx): string {
  const p = prompt.toLowerCase();
  // 目标列:显式“B 列”>“这一列 / 本列”>当前列
  const colM = /([a-z])\s*列/i.exec(prompt);
  const col = colM ? colM[1].toUpperCase() : indexToCol(ctx.c);
  const fn = /平均|均值/.test(p) ? 'AVERAGE' : /最大/.test(p) ? 'MAX' : /最小/.test(p) ? 'MIN' : /个数|计数|多少个/.test(p) ? 'COUNT' : /非空|有值/.test(p) ? 'COUNTA' : 'SUM';
  // 范围:默认整列已用区域;如果上一轮反馈成环,就把范围截到当前行之上
  let last = Math.max(1, ctx.usedRows);
  if (ctx.feedback?.includes('#CYCLE!')) last = Math.max(1, ctx.r);          // 排除自身所在行
  if (ctx.feedback?.includes('#REF!')) last = Math.min(last, ctx.rows);
  let formula = `=${fn}(${col}1:${col}${last})`;
  if (/单价.*数量|数量.*单价|乘/.test(p)) formula = `=B${ctx.r + 1}*C${ctx.r + 1}`;
  if (/折后|打折|折扣/.test(p)) formula = `=D${ctx.r + 1}*(1-$G$2)`;
  if (/四舍五入|保留/.test(p)) { const d = /(\d)\s*位/.exec(p)?.[1] ?? '2'; formula = `=ROUND(${formula.slice(1)},${d})`; }
  if (/如果|若|否则/.test(p)) formula = `=IF(${col}${ctx.r + 1}>0,"是","否")`;
  if (/本格|自己|a1\b/.test(p) && !ctx.feedback) formula = `=${fn}(${col}1:${col}${Math.max(ctx.r + 1, last)})`; // 故意包含自身,演示校验回塞
  return formula;
}

export function generateFormula(sheet: Sheet, prompt: string, pos: { r: number; c: number }, bounds: { rows: number; cols: number }, maxAttempts = 3): { attempts: Attempt[]; formula: string | null } {
  const usedRows = sheet.keys().reduce((m, k) => Math.max(m, Number(k.split(',')[0]) + 1), 0);
  const attempts: Attempt[] = []; let feedback: string | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    const formula = mockModel(prompt, { ...pos, ...bounds, usedRows, feedback });
    const v = sheet.validateFormula(pos.r, pos.c, formula, bounds);
    attempts.push({ formula, ok: v.ok, error: v.ok ? undefined : v.error });
    if (v.ok) return { attempts, formula };
    feedback = v.error;
    if (attempts.length > 1 && attempts[attempts.length - 2].formula === formula) break;   // 模型没改,别空转
  }
  return { attempts, formula: null };
}

export const describeTarget = (r: number, c: number) => a1(r, c);
