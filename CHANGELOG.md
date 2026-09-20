# Changelog

## Unreleased — 数组 LCS 线性内存化（保留确定对齐）

### 实现选择

数组差异的 LCS 对齐从「完整 DP 矩阵 + 回溯矩阵」替换为**线性内存的分治算法**，
输出与旧实现逐比特一致。关键决策：

- **不采用经典 Hirschberg 分裂规则。** 经典做法用两行长度数组取
  `L1[j] + L2[j]` 的最大值作为分裂点，但并列最大值有多个时，任何固定的
  取最小/取最大规则都会改变对齐结果（见下文「最危险反例」）。本实现对
  64,008 个小型用例穷举验证了这一点：取最小 j 错 46,502 例、取最大 j
  错 11,618 例；而交叉点追踪分治在 1,193,556 个穷举用例上与旧矩阵
  完全一致。
- **交叉点追踪分治（crossing-tracked divide & conquer）。** 每层递归只做
  一次前向 DP，并为中行之下的每一行额外携带一个整数：确定回溯路径穿过
  中行的列号。右下角元素的交叉列就是分裂点 `j*`。由于每个格子的走向
  （`diag` 优先、同成本取 `up`）与旧矩阵逐格一致，递归复现的正是旧矩阵
  的同一条回溯路径——匹配谓词、重复元素、同成本候选的抉择全部不变，
  不通过改排序/平局规则换取低内存。
- **每层只保留两行 DP 值 + 两行交叉列**，辅助内存 `O(m + n)`；递归深度
  `O(log m)`；总时间仍为 `O(m·n)`（常数约为旧矩阵的 2~3 倍）。
- **`showModifications` 配对不改语义。** 渲染游走改为消费 op 序列：
  旧代码读 `backtrack[i-1][j] === 'left'` 判断 modify 配对，等价于序列中
  当前 `up` 的下一个 op 为 `left`；配对成功时与矩阵游走一样**额外消费**
  一个 op（`k++`），保证 `up`+`left` 只产生一对 modify 而不是残留多余的
  add/remove。
- 谓词（`lcsMatch`）与旧矩阵逐字一致；元素类型按行预计算，避免在
  `O(m·n)` 热循环里重复 `getType` 调用（这同时消除了 jest 模块互操作
  在热循环里的开销，12k 用例从 84s 降到约 15s）。
- `lcsMemoryStats.peakArrayLength` 记录运行期峰值数组长度，供测试与
  用户断言线性内存上界。

### 峰值数组长度（大样例记录）

12,000 元素 × 12,000 元素的交替重复样例（`src/differ-lcs.spec.ts` 快照）：

- 峰值数组长度：**24,000**（`m + n`，op 序列上界；DP 行宽为 12,001）
- 旧矩阵单元数：**144,024,001**（`(m+1)²`，约 1.1 GB 级别的分配）
- 渲染输出 digest：`797da030`，左右行数均为 12,005，3 行 remove / 3 行 add

### 原覆盖的空白

改动前测试的空白区域：

- 没有任何针对**重复元素**（同值多份拷贝）对齐抉择的用例；
- 没有针对**同成本候选平局**（`f[i-1][j] === f[i][j-1]` 时取 `up`）的用例；
- `showModifications` 的 LCS 配对路径只有单个 fixture，未覆盖
  `up`+`left` 相邻配对、对象/数组 modify、配对关闭等分支；
- 没有上万元素的大样例，也没有内存用量断言，矩阵的二次膨胀不可见；
- 没有 op 级别的对齐契约测试，对齐规则只被少量端到端快照间接覆盖。

### 相邻语义的退化保护

- **共享 contract 锁定平行实现**：`src/utils/lcs-ops.spec.ts` 内置矩阵
  oracle（同一 `lcsMatch` 谓词），`src/utils/diff-array-lcs.spec.ts` 内置
  旧矩阵渲染参考实现，二者对穷举小样本（二元字母表长度 ≤ 6 全量、
  混合类型长度 ≤ 4 全量 × 两种 `recursiveEqual`）与种子化随机嵌套输入
  （`showModifications` × `recursiveEqual` 全组合）做逐 op / 逐行差分对比。
- **现有 fixture 逐字符快照**：`src/differ-lcs.spec.ts` 对
  `src/differ.spec.ts` 的全部既有输入（空字符串键、键序保持、
  recursive equal、二维数组 lcs/normal）输出 `toMatchSnapshot`。
- **四组新数据**：全相等（全 equal 行）、全不同（全 remove/add）、
  交替重复（确定性对齐 + digest 快照）、上万元素（12,000²，峰值数组长度
  记录 + digest 快照 + 结构不变量）。
- 相邻入口（`normal`、`unorder-*`、`compare-key` 方法、`diffObject`、
  内联 diff）未触碰，其既有测试全部保持绿色。

### 最危险反例与对应回归用例

**反例：`[1, 1]` vs `[1]`（重复元素 + 同成本候选）。**
旧矩阵回溯从 `(2,1)` 出发先走 `diag` 再走 `up`：第二个 `1` 与目标对齐，
第一个 `1` 被删除。若用经典 Hirschberg 取最大 j 分裂，会得到
`diag` 在前 `up` 在后：第一个 `1` 对齐、第二个被删除——remove/equal
位置互换，渲染输出完全不同，且任何依赖稳定对齐的下游（行号、
`showModifications` 配对）全部漂移。同一族反例还包括
`['A','B']` vs `['B','A']`（平局取 `up`）与 `[5,6]` vs `[5,9]`
（`up` 后紧跟 `left` 触发 modify 配对，op 序列错一位就会把一对
modify 渲染成一删一增）。

**回归用例**（`src/utils/diff-array-lcs.spec.ts`）：

- `keeps the duplicate-element alignment ([1, 1] vs [1] removes the first copy)`
- `keeps equal-cost candidate tie-breaking (up on ties)`
- `keeps showModifications pairing decisions`

三者均与内置矩阵参考实现逐行比对，并辅以 `src/differ-lcs.spec.ts` 的
端到端快照锁定。
