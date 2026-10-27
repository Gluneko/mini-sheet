# mini-sheet — 表格引擎(全部手写:虚拟网格 + Pratt 公式解析 + 依赖图增量重算)

## 跑起来
```bash
cd ~/Downloads/mini-sheet
pnpm install
pnpm test      # 引擎单测(词法 / 解析 / 求值 / 依赖图 / 环 / 复制平移 / 撤销 / CSV)
pnpm bench     # 1 万格链式公式基准
pnpm dev       # http://localhost:3200,10 万行 × 50 列
```

## 已完成(Day 1–3 核心)
- [x] 稀疏单元格模型、10 万行虚拟网格、选区、键盘导航、双击 / 回车编辑、公式栏
- [x] 词法 + Pratt 解析器(优先级、右结合乘方、一元、后缀 %、函数、范围、绝对引用)
- [x] 求值器:SUM / AVERAGE / MIN / MAX / COUNT / COUNTA / ABS / ROUND / LEN / CONCAT / AND / OR / NOT / IF(惰性),错误值传播
- [x] 依赖图:单格边 + 大范围区间索引;拓扑增量重算;直接 / 间接 / 自引用 / 范围含自身的环检测与恢复
- [x] 命令式撤销重做(批量操作为一个单元);⌘D 向下填充(相对 / 绝对引用平移)
- [x] CSV 导入导出;基准脚本;重算统计面板

## 已完成(Day 4)
- [x] 可变列宽 / 行高(前缀和 + 二分)
- [x] xlsx 导出(SheetJS)
- [x] 协同单元格(Y.Map,复用 collab-notes 的同步服务端)
- [x] 自然语言生成公式(mock 模型 → 解析 / 引用存在 / 无环校验 → 失败回塞)
- [x] 讲解文档 mini-sheet-讲解.md(附基准表)

## 目录
```
engine/types.ts       值 / 错误 / AST / Cell
engine/refs.ts        A1 ↔ 行列、$ 绝对引用、复制平移
engine/tokenizer.ts   词法
engine/parser.ts      Pratt 解析器 + AST 打印
engine/evaluator.ts   求值与函数表
engine/dep-graph.ts   依赖图、范围索引、拓扑排序与环
engine/sheet.ts       门面:写入 / 增量重算 / 撤销 / CSV
src/VirtualGrid.tsx   虚拟网格与交互
src/App.tsx           工具栏、公式栏、示例数据、压测按钮
bench/bench.ts        基准
```
