# 03｜执行历史追溯与复用 Session 的并发占用

> 阶段目标：保留重试前的执行证据，同时让一个已完成队列任务所关联的 DSH Session 再次运行时被计入并发。**T08→T09**，前置 T07 完成。此阶段涉及持久数据契约，不能当作普通 UI 改动。

## T08 为重试保存执行历史

- [x] **T08 源码与 CI 验证完成；前置：T07 验收通过。**

### 真实源码定位与问题

- `retry()`（`src/queue.ts:164–173`）对异常 Task 清空 `sessionId`、`goalId`、`seenRunning`，并覆盖 `detail`；现有 `Task` 仅有当前字段，没有 Attempt 列表。
- `decode()`（`src/queue.ts:31–68`）会校验 Session ID 唯一性；`queueSchema`（`src/settings-schema.ts`）当前使用 `version=1` 并声明各任务字段。
- 不能通过简单“复制一条相同 sessionId 的任务”实现历史：旧解码会拒绝重复 `sessionId`，也会造成观察与并发名额双计数。

### 源码动作

| 类型 | 文件、现存或建议对象 | 具体动作 |
|---|---|---|
| **建议新增** | `TaskAttempt`（或等价只读执行记录）类型，`Task` 内的可选 `attempts`/`history` 字段 | 每次提交尝试保存 Attempt ID、原 Session ID、Goal ID、开始/结束或更新时刻、终态、错误与来源；不得将这些字段当作新任务直接派发。 |
| **修改** | `queue.ts` 的 `retry()`、`claim()`、`setSessionId()`、`updateActive()`、`adopt()`（仅必要范围） | 任务可重试而不丢原执行尝试；历史快照不因新尝试自动覆写。单个当前尝试与历史尝试的责任明确。 |
| **修改** | `decode()`、`src/settings-schema.ts:queueSchema` | 兼容旧 `version=1`、`activeId`、没有 Attempt 字段的历史队列；进行一次性、幂等的非破坏性迁移，不能默认重置。新快照的 schema 策略需通过 Host 实测选定，不能只靠 TypeScript 编译。 |
| **修改** | `src/client/coordinator.ts` 的派发、恢复与 title 同步关联（必要部分） | 将新的 Session/Goal ID 写入**当前尝试**；通过旧历史引用能打开旧 Session，但不能将其当作新活动占位。 |
| **新增测试** | `test/queue.test.ts`、`test/discovery-concurrency.test.ts`、`test/settings.test.ts` | 旧数据迁移、多次重试、导入任务、重复 ID、损坏快照、断连写入不确定、Host schema roundtrip。 |
| **保留** | `version=1` 与单 `activeId` 读取兼容；既有任务 ID/顺序 | 不改动用户可见任务逻辑排序与已有会话记录。 |
| **删除** | 无既有公开字段必须删除 | 若内部不再直接清空旧会话字段，应改为有证据的归档操作，而非直接剔除兼容字段。 |

### 迁移策略必须先定稿

1. **首选最小改动**：保存只读 Attempt 历史，保留旧 `Task` 的当前 Session 字段与 `activeIds` 入口；不要为“将来可能需要”引入第二套 Goal 数据库。
2. 是否沿用 `version=1` + 可选字段，还是提供 `version=2` + 双版本解码，必须先根据真实 `settings` schema 行为及保存/降级测试确定；**不得无测试直接提高版本常量**。
3. 每个旧 Task 的已有 `sessionId/goalId/detail/timestamp` 必须能进入可追溯记录；迁移重复执行不得制造重复 Attempt；无 Session ID 的旧任务仍可读取。
4. 旧插件降级行为若不能保证兼容，明确文档写明“升级保存后禁止直接降级”，提供保留原配置及手工恢复指引。
5. Attempt 历史只记录插件可证实的运行证据，不伪造成功、修改原生 Goal phase 或承诺记录 DSH 之外的工作。

### 验收

1. **Red**：旧逻辑“异常任务→重试→原 `sessionId` 在队列关联中消失”的可重复用例，留原值与转移后的断言。
2. **Green**：一个 Task 连续重试两次产生三份可区分的尝试证据，每份 Session ID 保留，当前待执行项只占一个待派发位置。
3. 使用旧 `version=1`、只有 `activeId`、缺可选标题字段、已中断目标、已有发现的 Session、无题词发现项分别迁移/读取成功；损坏输入必须拒绝覆盖原队列。
4. 人工跳过仍保留所有历史 Attempt 和“跳过不等于完成”的事实；新重试不得继承不可信的 `seenRunning`。
5. CAS 部分提交、返回丢失、并发刷新不得丢失 Attempt 历史或生成幽灵执行；有明确 fail-closed 路径。
6. 全套单测、类型检查、构建与迁移负向测试成功；留下数据格式对照、复审意见和实际 `queueSchema` 兼容证据。

## T09 原 Session 复用的并发计数

- [x] **T09 源码与 CI 验证完成；前置：T08 验收通过。**

### 真实源码定位与问题

- `Coordinator.scanRunning()`（`src/client/coordinator.ts:268–274`）在 Host 报告 `row.running=true` 后，若发现该 Session 对应旧 Task 且状态不在 `interrupted/running/starting`，就直接跳过。
- `queue.ts:141–159` 的 `adopt()` 按 `sessionId` 查 Task；已有 `completed` Task 的同一 Session 再次运行不能直接增加第二个同 ID Task，否则违反 `decode()` 唯一性和历史不可篡改的约束。

### 源码动作

| 类型 | 文件、现存或建议对象 | 具体动作 |
|---|---|---|
| **修改** | `Coordinator.scanRunning()`、`discover()`、`hold()`、`observe()` | 对 Host 确认仍在运行的已知 Session 重新建立**活动观察**，不把已完成的历史 Task 改回 `running`，也不触发新的 `prompt/goal`。 |
| **建议新增** | `SessionActivity` 或等价唯一 `Session ID → 当前运行占用` 结构 | 将“当前 Session 占用”与“历史 Task/Attempt 终态”分开。活动项可随 Host running→idle 解除，不能制造两个相同 Session 的并发名额。 |
| **修改** | `QueueState` / `next()` 或 Coordinator 容量校验 | 派发时以**唯一当前运行 Session** 总数为准，并对队列自己的 `starting` 预留名额；不依赖过时扫描结果宣称全 Host 锁。 |
| **修改** | `QueueBoard.tsx`、`QueueButton.tsx`（必要部分） | 在界面中标明“再次运行的原有 Session”“只观察”；不会把旧 completed Task 改写为未完成。 |
| **新增测试** | `test/discovery-concurrency.test.ts`、`test/coordinator.test.ts` | completed Session 再次运行、failed/skipped 的原 Session 继续运行、重复扫描、并发降低、Host stopped、断连/恢复、同 ID 去重。 |
| **删除** | 旧扫描中针对完成态“一律跳过”的条件（仅在新的占用去重实现稳定后） | 不删除旧任务记录和历史尝试。 |

### 验收

1. 已完成 Task 的原 Session 被用户在 DSH 中再次启动时，手动扫描能重新计入**一个**当前活动槽位；历史 Task 保持 `completed`，不新建 Prompt、不重复执行旧 Goal。
2. 同一 Session 多次刷新/面板重开/重连只占一个名额；活动 Session 与当前队列 Task 关联时不能重复计数。
3. 活动结束后名额及时释放，确保队列可以继续派发；`maxConcurrent=1/2/8` 测试按唯一 Session ID 计数。
4. 观察状态未知或 Host 列表不完整时必须保持保守调度，不能把漏扫误当无活动任务；多 Client 的新活动仍是本插件可见性之外，文档保持限制。
5. `activeIds`/旧队列配置迁移与 T08 Attempt 历史回归通过，既有 interrupted 重连后复观不退化。
6. 所有专项、全套测试、类型检查和构建成功，留下并发计数表和各个 Session ID 的去重证据。

## 03 阶段签收

- [x] T08 旧执行记录在重试后仍可追溯，迁移非破坏、幂等且 Host 兼容有证据。
- [x] T09 Host 再次运行旧 Session 能正确占名额且不会篡改旧任务终态。
- [ ] CAS 未知结果、重复扫描、跨工作区、最大并发 1–8 的负向测试通过。
- [ ] 全套 `npm test` / `npm run typecheck` / `npm run build` 成功，变更前/后 schema 与复核证据留存。

**全部通过，方可进入 [`04-界面体验与独立验收.md`](04-界面体验与独立验收.md)。**