/**
 * 基准:10 000 格链式依赖(A2=A1+1 … A10000=A9999+1),改 A1 一次 → 全链重算。
 * 再测:SUM 大范围 + 单格改动、无关格改动(应接近 0)。
 * 跑:pnpm bench
 */
import { Sheet } from '../engine/index';

const N = Number(process.argv[2] || 10000);
const s = new Sheet();
let t0 = performance.now();
s.setCell(0, 0, '1');
const entries = []; for (let r = 1; r < N; r++) entries.push({ r, c: 0, raw: `=A${r}+1` });
s.setCells(entries);
console.log(`建链 ${N} 格:${(performance.now() - t0).toFixed(1)} ms,末格 = ${s.getValue(N - 1, 0)}`);

t0 = performance.now(); s.setCell(0, 0, '100');
console.log(`改首格 → 重算 ${s.lastRecalc.evaluated} 格:${(performance.now() - t0).toFixed(1)} ms,末格 = ${s.getValue(N - 1, 0)}`);

t0 = performance.now(); s.setCell(Math.floor(N / 2), 0, `=A${Math.floor(N / 2)}+1000`);
console.log(`改中间格 → 重算 ${s.lastRecalc.evaluated} 格:${(performance.now() - t0).toFixed(1)} ms`);

s.setCell(0, 1, `=SUM(A1:A${N})`);
t0 = performance.now(); s.setCell(5, 0, '=A5+2');
console.log(`链中改一格 + 大范围 SUM 依赖 → 重算 ${s.lastRecalc.evaluated} 格:${(performance.now() - t0).toFixed(1)} ms,SUM = ${s.getValue(0, 1)}`);

t0 = performance.now(); s.setCell(0, 5, 'hello');
console.log(`改无关格 → 重算 ${s.lastRecalc.evaluated} 格:${(performance.now() - t0).toFixed(2)} ms`);
