# QA 记录 — dsh-goal-queue U01–U13（质量QA）

- 仓库：`D:\Code\dsh-goal-queue`，分支 `main`
- 被测提交：`6d0ba7f`（feat(U01,U02): goal identity protection + trusted directory baseline），基线 `69b675f`
- 本文档按里程碑复测滚动追加：QA-1（P0）已完成；QA-2（P1a）/ QA-3（P1b）/ QA-4（P2）/ T13.2（整合）待排期。

---

## QA-1：P0 段复测（U01 + U02）

- **测试标题**：MS1 P0 链复测——Goal 身份保护（R05）与可信目录基线（R02）
- **测试范围**：U01（`queue.ts` adopt/flagForReview、`coordinator.ts` scanRunning 身份预检、`models/needsReview`）、U02（`client/directory.ts`、scanRunning 权威基线、armed 语义）、边界 B1/B2/B3/B6 在 P0 链上的落点
- **优先级**：P0
- **复测日期**：2026-10-24（D5）
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；代码对照 design §5/§6/§7 契约逐项审查；R02/R05 探针用 QA 适配夹具（`.artifacts/optimization-analysis-2026-10-24/behavior-probes-qa1.mjs`）复核 Red→Green

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA1-01 | US-01/US-02 | HEAD=6d0ba7f，工作树干净 | `npm run typecheck` | 无类型错误 | 通过，无输出错误 | ✅ 通过 |
| QA1-02 | US-01/US-02 | 同上 | `npm test` 全量 | 104/104 全绿（既有 96 不回归 + 新增 8） | tests 104 / pass 104 / fail 0 | ✅ 通过 |
| QA1-03 | US-01/US-02 | 同上 | `npm run build` | 构建成功 | CJS+ESM 构建完成 | ✅ 通过 |
| QA1-04 | US-01 | 队列含 interrupted Goal 任务（goalId=A），同 Session 运行 Goal B | 跑 `test/goal-identity.test.ts` R05 链：discover → B 完成 → B stop | A 不 adopt 不结算（status=interrupted）、goalId 不被覆盖、attempts 保留、needsReview=true、B 计入 sessionActivity、权威 stop 释放占用 | 5 项断言全过 | ✅ 通过 |
| QA1-05 | US-01 | 同上（探针级） | 运行 QA 适配探针 `behavior-probes-qa1.mjs` R05 | R05 由 Red 转 Green：goalId 保持 original-goal、status=interrupted、needsReview=true、attempt 证据 goalId 不变、零 create/提交 | verdict=PASS，actual 全部符合 | ✅ 通过 |
| QA1-06 | US-01 | 纯函数级 | adopt 传入 goalId=B 的 interrupted 任务（goalId=A） | 原样返回 q（防御纵深，不覆盖不结算） | `r===q` 断言通过；代码 queue.ts:246 与 design §6.1 一致 | ✅ 通过 |
| QA1-07 | US-01 | interrupted 普通（非 goalMode）任务，原 Session 仍在运行 | discover 扫描 | 不自动 adopt 结算；trackSessionActivity + flagForReview，detail 含「缺少本次执行边界证据」 | 断言通过（PRD §3 U01「该分支需另加测试」已覆盖） | ✅ 通过 |
| QA1-08 | US-01 | interrupted Goal 任务，同 Session 仍运行同 Goal | discover 扫描 | 照旧 adopt 为 running，不标 needsReview（自动观察仍可用） | 断言通过 | ✅ 通过 |
| QA1-09 | US-02 | 队列含 2 个 pending 任务，假目录源 ok→fail→ok | 跑 `test/directory-trust.test.ts` R02 链：ok 启用派发 A → fail discover → A 结束触发 pump → ok discover → 手工再启用 | fail 抛 DIRECTORY_READ_FAILED 且 isAuthorized=false；失败期间无新派发；恢复读取后 armed 仍 false；手工启用才派发 B | 断言全过（created 计数 1→1→1→2） | ✅ 通过 |
| QA1-10 | US-02 | 从未成功读取目录 | 直接 `enable(true)` | 拒绝启用（需可信目录读取先行），零创建 | rejects /扫描/；created=0；探针级 enableRejected=true | ✅ 通过 |
| QA1-11 | US-02/B1 | 目录读取失败已解除授权 | 恢复读取成功后观察 | 不自动重新授权、不自动重跑（armed 保持 false） | isAuthorized=false 断言通过 | ✅ 通过 |
| QA1-12 | US-02/B6 | 代码审查 | 核对 `directory.ts` 取得方式 | 经公开 `remote.session.list({}, signal)` 的 `RemoteResult` 校验 `r.ok`，失败抛 DIRECTORY_READ_FAILED；不将额外 RPC 成功称为全局锁 | 与 design §6.3 逐条一致 | ✅ 通过 |
| QA1-13 | US-02/B6 | 代码审查 + 静态断言 | `directory-trust.test.ts` 静态扫描 8 个客户端源文件；QA 另行 grep 复核 | 不引用私有 `getSnapshot().state`；`byId` 仅用于标题/retain | 无违规引用（syncTitles 仅用 byId，符合不变式 3） | ✅ 通过 |
| QA1-14 | US-02 | 代码审查 | 核对 scanRunning 中 `sessions.refresh()` 处理 | 降级 best-effort：失败仅 console.warn，不影响权威基线；权威基线唯一来源为 directory.list | coordinator.ts:393 符合 design §6.3-5 | ✅ 通过 |
| QA1-15 | US-01/B3 | flagForReview 前后 | 检查 attempts 数量与关键字段 | 不删 attempts；status 不变；goalId/sessionId/seenRunning 保留 | attempts.length=1、goalId 保留断言通过 | ✅ 通过 |
| QA1-16 | 全部 | 基线 69b675f 96 项 | 对比既有测试语义 | 仅 discovery 夹具注入假目录源（+2 行），断言语义不变 | diff 核实：discovery-concurrency.test.ts 仅加 directory 注入 | ✅ 通过 |
| QA1-17 | US-03/04/05 | 探针级回归 | 运行 QA 适配探针其余 5 项 | R01/R03/R04/R06/R07 允许仍 RED（对应 U03/U04/U05 未实施，非本轮范围） | 5 项 RED，失败原因均指向未实施变更，无意外回归 | ✅ 记录 |

### 结论

**QA-1 通过**。U01/U02 验收口径全部满足：R02、R05 探针 Red→Green；契约（design §5 错误码 12 项、§6.1/§6.2/§6.3 签名）与实现逐项一致；边界 B1（恢复不自动重跑）、B3（证据保留）、B6（不访问私有 manager）在 P0 链上验证成立。无阻塞 bug，MS1 达成。

### 观察项（非阻塞，交工程师/架构师知悉）

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| OBS-1 | 低 | `flagForReview` 经 `amendAttempt` 会把最后一个 attempt 的 `detail` 文本覆写为核实文案（原「程序启动或连接切换…」detail 字符串丢失；status/goalId/sessionId/seenRunning 均保留）。design §6.1 契约「写 detail」已满足 | 请架构师确认 attempt 级 detail 是否需要追加而非覆写（B3 口径）；如需改，随 U05（同文件）一并处理 |
| OBS-2 | 低 | `docs/prd.md`、`docs/design.md` 未提交 git（untracked），`docs/tasks.md` 已提交 | 工程师下次提交时补交 docs，保证验收可追溯 |
| OBS-3 | 中 | 原 `.artifacts/…/behavior-probes.mjs` 夹具未注入 SessionDirectory，在当前代码上直接崩溃（非断言错误）。T13.1「R01–R07 探针 Red→Green 复核」将跑不通原探针 | 工程师在 M3 末或 T13.1 前适配原探针（QA 参考副本 `behavior-probes-qa1.mjs` 已给出最小适配） |
| OBS-4 | 确认 | design §7 U02 写「失败 → syncState=failed」，但 SyncState 属 T3.1（U03）交付，本轮 scanRunning 未含 syncState | 按 tasks.md 次序属有意顺延，请架构师确认 M3 落地即可 |

---

## QA-2：P1a 整链复测（U03 + U04 + U05 + U13）

- **测试标题**：MS2 P1a 链复测——发现调度（U03/R01·R03）、占用来源拆分（U04/R06）、告警生命周期（U05/R07）、串行派发（U13）
- **测试范围**：U03（`coordinator.ts` boot 自动发现、`runningSignature` 合并发现、`discoveryQueued` 补扫、subagent 排除、connectionReset 重置、`syncState` 四态 + Board 新鲜度）、U04（`queue.ts` `summarizeQueue` 拆分、`sessionActivity` 跟踪/释放、Board 外部活动区、`openSessionById`）、U05（`updateActive` 告警收敛、`titleError` 归属与归档、Board 分源渲染）、U13（`maxConcurrent` 归一 1、`setConcurrency` 移除、串行闸门、`CAPACITY_FULL`）；PRD §7 事件链 1–5、8；边界 B1/B4/B7；QA-1 观察项 OBS-2/OBS-3/OBS-4 闭环确认
- **优先级**：P1
- **被测提交**：`feaccaf`（U13/M6）、`5227d73`（U05/M5）、`d0abf7b`（U04/M4）、`2453fea`（U03/M3）；QA-1 基线 `6d0ba7f`；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；直接运行原 `behavior-probes.mjs`（工程师已按 OBS-3 适配）复核 R01–R07；代码对照 design §5/§6/§7/§9 契约逐项审查；PRD §7 事件链逐条映射到测试与实现

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA2-01 | US-03/04/05/13 | HEAD=feaccaf，工作树干净 | `npm run typecheck` | 无类型错误 | 通过，无错误输出 | ✅ 通过 |
| QA2-02 | 同上 | 同上 | `npm test` 全量 | 123/123 全绿（104→110→116→123 递增，既有不回归） | tests 123 / pass 123 / fail 0 | ✅ 通过 |
| QA2-03 | 同上 | 同上 | `npm run build` | 构建成功 | CJS+ESM 构建完成 | ✅ 通过 |
| QA2-04 | US-03/04/05 | 原探针已注入 SessionDirectory | `node --experimental-strip-types .artifacts/…/behavior-probes.mjs` | R01–R07 全部 PASS（OBS-3 闭环） | 7/7 PASS，无崩溃无意外回归 | ✅ 通过 |
| QA2-05 | US-03（链1） | 队列含 pending，目录源 ok→fail→ok | `discovery-scheduling.test.ts` 扫描失败用例 + R02 探针 | 失败 → `syncState=failed`（含 reason）+ `setArmed(false)`；`enable` 拒绝；恢复读取 → fresh 但 `isAuthorized=false`；全程零派发 | 断言全过；OBS-4 闭环（syncState=failed 已随 M3 落地） | ✅ 通过 |
| QA2-06 | US-03（链2） | 面板从未打开 | boot → 自动首次只读发现；Host 列表变化 → 签名比对；扫描中再变化；subagent 运行 | boot 自动发现 1 次（R01）；签名变化触发且仅触发 1 次合并发现、签名不变不重复扫；扫描中登记 `discoveryQueued` 本轮后补扫；subagent 不改签名不收养 | discovery-scheduling 6 项全过；R01/R03 PASS | ✅ 通过 |
| QA2-07 | US-03 | boot 前调用 discover | 未 start 直接 `discover()` | 不抛错，排队等 boot 收敛后执行 | R03 探针 PASS（按 U03 契约适配后 Red→Green） | ✅ 通过 |
| QA2-08 | US-01（链3） | interrupted Goal A（goalId=A），同 Session 跑 Goal B | `goal-identity.test.ts` R05 链回归复测 | A 不 adopt 不结算、goalId 不被覆盖、attempts 证据完整、needsReview=true；B 结束 A 仍待人工处置 | 5 项全过（U01 链在 U03 自动发现下无回归） | ✅ 通过 |
| QA2-09 | US-05（链4） | 活跃任务 + 标题失败 + Host 错误并存 | `alert-lifecycle.test.ts`：updateActive 多源告警 | `q.error` 不被 updateActive 写入；标题失败写 `task.titleError`；claim 时归档进上一 attempt 且不串新 attempt；decode 保留；Host 不可信时阻断 | 断言全过；R07 PASS | ✅ 通过 |
| QA2-10 | US-05（链4） | interrupted/failed 任务，原 Session 运行中或 Session ID 缺失 | `retry`/`skip` 处置守卫（discovery-concurrency T06 组） | 原 Session 运行中拒绝处置；failed 且缺 Session ID 拒绝盲目重试；idle 原 Session 可重试回 pending | 断言全过；守卫文案允许 运行/停止/处置 口径，语义未弱化 | ✅ 通过 |
| QA2-11 | US-04（链5） | 旧任务已完成于外部复用会话，随后删除任务 | `session-activity.test.ts` R06 链：discover → remove → openSessionById → 权威 stop | 删除后 `occupied=1`/`externalActivity=1` 不隐身；`openSessionById` 仍可直达；不存在会话抛 `SESSION_NOT_FOUND` 不静默；仅权威 stop 释放 | 断言全过；R06 PASS | ✅ 通过 |
| QA2-12 | US-04 | 自有运行会话 + 外部活动并存 | `summarizeQueue` 拆分与去重 | `starting/observedRunning/externalActivity/occupied` 分列正确；自有会话双计去重为一个名额；达上限 `next()` 不派发 | 断言全过；QueueButton 显示「占用N（启动X · 运行Y · 外部Z）」与 design 一致 | ✅ 通过 |
| QA2-13 | US-13（链8） | 3 个 pending 任务 | `serial-dispatch.test.ts`：enable → 首任务完成 → pump | 仅第一个 claim；释放后第二个才 claim；全程 `maxHolds≤1` | 断言全过 | ✅ 通过 |
| QA2-14 | US-13（链8） | 2 个 pending | 三连 `enable(true)` 并发点击 | 仍恰好 1 个 claim、1 个 hold，无双重派发 | `Promise.allSettled` 三连击后 created=1、activeIds=['a']、maxHolds≤1 | ✅ 通过 |
| QA2-15 | US-13（链8） | 运行中触发连接重置 | connectionReset → discover → enable → 处置 → retry → enable | 重置后 enabled=false、任务 interrupted、未处置前 enable 拒绝；处置后恰好 1 个 claim、maxHolds≤1 | 断言全过（恢复路径不破坏串行） | ✅ 通过 |
| QA2-16 | US-13/B7 | 旧数据 `maxConcurrent=3` | `decode` 归一 + schema 校验 | 归一为 1、不弹错不丢任务；`queue.ts` decode 同步归一（非数字垃圾仍拒绝）；`Coordinator.prototype` 无 `setConcurrency` | 断言全过；schemastery 用 `z.transform(z.number().default(1), () => 1)` 实现，与 design 伪代码语义一致（QA 已核行为等价） | ✅ 通过 |
| QA2-17 | US-13 | 唯一名额被占（active claim 或外部会话） | `next()` 与 `claimGoalResume` | `next()` 返回 undefined；`claimGoalResume` 抛 `QueueError('CAPACITY_FULL','当前执行名额已被占用')`（含外部活动占位场景） | 断言全过 | ✅ 通过 |
| QA2-18 | US-13 | Board 代码审查 | 「最大并发」下拉、busy 提示、超上限警告 | 下拉已移除；busy 提示「串行模式：至多 1 项占用执行」（占用拆分保留）；超上限警告保留 | 与 design U13 一致；src 无 `setConcurrency` 残留（grep 复核） | ✅ 通过 |
| QA2-19 | US-03/04/05 | Board 代码审查 | 新鲜度、外部活动区、错误分源渲染 | syncState 四态新鲜度文案 + 手动「刷新运行任务」保留；外部活动区每行「打开」+ 行级 taskErrors；notice/formErrors/taskErrors/q.error 分源渲染（q.error role=status） | 与 design §U03/U04/U05 界面口径一致 | ✅ 通过 |
| QA2-20 | US-03 | 连接重置路径 | `connectionReset()` 行为 | 重置 `directoryFresh`/`runningSignature`/`syncState=initializing`，boot 收敛后自动重扫新基线 | discovery-scheduling 用例断言全过 | ✅ 通过 |
| QA2-21 | 契约 | design §5/§6/§9 | 错误码 12 项、公开签名、`Task/Attempt.titleError` 字段逐项对照 | 无自改；`viewStore` 扩展与 design §6.5 一致；src 无私有 `getSnapshot().state` 引用 | 逐项一致 | ✅ 通过 |
| QA2-22 | 回归 | 既有测试适配审查 | `discovery-concurrency.test.ts` 改写核对 | setConcurrency 用例改写为串行闸门语义（闸门行为保留）；目录夹具镜像 Host 真实态以适配 U03 自动发现；failFirstScan 保留「可信扫描前禁启动」场景可达性 | 语义未弱化，仅夹具/入口适配 | ✅ 通过 |
| QA2-23 | 追溯 | OBS-2/OBS-3 闭环 | 检查 docs 与探针入库 | `docs/prd.md`、`docs/design.md` 已随 `2453fea` 入库；原探针已注入 SessionDirectory 并按 U02/U03 契约适配跑通 | 均已闭环 | ✅ 通过 |

### 结论

**QA-2 通过，MS2 达成**。PRD §7 事件链 1–5、8 逐条有对应测试且全绿（链 6、7 属 QA-3/QA-4 范围）；探针 R01–R07 全 PASS；契约（design §5 错误码、§6 签名、§9 titleError）无自改；边界 B1（失败不自动重跑）、B4（占用不因删任务隐身）、B7（并发上限固定 1）验证成立。无阻塞 bug。

### 观察项（非阻塞）

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| OBS-5 | 低 | Board「执行历史（N）」行只渲染 第N次/状态/Session/时间，不显示 attempt 级 `titleError`/`detail`。归档诊断数据完整保留（claim 归档、decode 保留均已验证），design「历史诊断留在对应任务/执行记录并标注第 N 次执行」按数据口径满足 | 显示口径请架构师/产品经理确认：若要求历史行可见诊断文本，随后续里程碑小改 |
| OBS-6 | 低 | `enable()` 拒绝仍抛普通 `Error`（文案含「扫描」）而非挂码 `QueueError` | design §5 允许「既有字符串错误保留原文案逐步挂码」，合规；后续里程碑可统一挂码 |
| OBS-1 | 跟踪中 | attempt 级 `detail` 覆写问题架构师未回复；按 design §6.1「写 detail」现口径合规 | 继续按现口径，不阻塞 |
| 备注 | — | `window.confirm` 与 newForm 默认 `workspaces.items[0]` 仍在 | 属 U06（M7）/U08（M9）范围，QA-3 覆盖，非本轮缺陷 |

---

## QA-3：M7/U06 复测（查看并处理入口 + 命名修正）

- **测试标题**：U06 处置入口复测——只读核实（inspect）、六动作可用性、可证明重排队（requeueEdited）、权威命名（清单 §5）
- **测试范围**：U06（`client/inspection.ts`、`coordinator.ts` inspect/goalOf/requeueEdited/enable 挂码、`QueueBoard.tsx` 核实面板与六动作、`queue.ts` `requeueEdited`、`attempt.phase` schema 提前）；命名修正 `4b39ad0`（design rev.1.1 / 清单 §5 / PRD US-06）；PRD §7 链 6 的 U06 部分与链 7 的既有部分（CAS/回包丢失涉 U07 未实施项留待 QA-4）
- **优先级**：P1
- **被测提交**：`4b39ad0`（命名修正）、`855ed0f`（design rev.1.1）、`d672a4a`（U06/M7）；QA-2 基线 `757eb8c`；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；原探针 R01–R07 复核；代码对照 design rev.1.1 §5/§6.1/§6.2/§6.4/§U06 逐项审查；命名对照清单 §5 对照表与 PRD US-06 grep 复核

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA3-01 | US-06 | HEAD=4b39ad0，工作树干净 | `npm run typecheck` | 无类型错误 | 通过 | ✅ 通过 |
| QA3-02 | US-06 | 同上 | `npm test` 全量 | 128/128 全绿（123 + 新增 board-interactions 5 项） | tests 128 / pass 128 / fail 0 | ✅ 通过 |
| QA3-03 | US-06 | 同上 | `npm run build` | 构建成功 | CJS+ESM 完成 | ✅ 通过 |
| QA3-04 | 回归 | 同上 | 原探针 R01–R07 | 7/7 PASS 无回归 | 7/7 PASS | ✅ 通过 |
| QA3-05 | US-06 | interrupted 任务，原 Session 存在已停止 | 连续两次 `inspect`；再 inspect 不存在任务 | 两次结果 deep-equal；`host.set` 写次数 0（零写入、不占名额）；未知任务抛 `TASK_NOT_FOUND` 挂码 | 断言全过 | ✅ 通过 |
| QA3-06 | US-06（链7） | 原 Session 仍在运行 | inspect → retry → skip | canRetry/canSkip/canResume=false，reason「原会话仍在运行，请先处置」+ 运行警告；retry/skip 抛 `SESSION_STILL_RUNNING`（design §5 既有码）；任务状态不变 | 断言全过；coordinator.ts:181 挂码 | ✅ 通过 |
| QA3-07 | US-06 | 两个 interrupted Goal 任务，各自 Session 空闲、Goal phase=paused | inspect → resumeGoal → 重复 resume → resume 第二个 | 恰好一次 claim（activeIds=['old']）、`/goal resume` 恰好提交一次；重复恢复拒绝；第二个抛 `CAPACITY_FULL`；inspect 显示「当前执行名额已被占用」 | 断言全过（原子恢复 claim 不退化） | ✅ 通过 |
| QA3-08 | US-06/US-07 | failed 任务，最后 attempt phase=precheck 无 sessionId | inspect → requeueEdited | canRequeueEdited=true；回 pending、title 更新、sessionId 清空、attempts 证据保留（phase 不变） | 断言全过 | ✅ 通过 |
| QA3-09 | US-07 | 最后 attempt phase=command_submitted | inspect + requeueEdited | 两者均拒：inspect canRequeueEdited=false；写路径抛 `REQUEUE_EDIT_NOT_PROVEN` | 断言全过 | ✅ 通过 |
| QA3-10 | US-07/B4 | legacy attempt 无 phase | inspect + requeueEdited | 保守拒绝，reason「派发阶段未记录，无法证明命令未提交」；不伪造 phase | 断言全过；decode 对 phase 校验（非法拒、undefined 允许） | ✅ 通过 |
| QA3-11 | US-06 | 代码审查 | `queue.requeueEdited` 对照 design §6.1 | 签名 `(q,id,input,now)` 一致；守卫 UNRESOLVED + 最后 attempt 无 sessionId + phase∈{claimed,precheck}；保留 attempts、清 goalId/sessionId；额外 `!activeIds.includes(id)` 为更严守卫 | 一致 | ✅ 通过 |
| QA3-12 | US-06 | 代码审查 | `goalOf`（GoalGateway）对照 design §6.4 rev.1.1 | 走 `faceOf('goal')` 只读快照；断连/降级读/epoch 变化返回 undefined；不 claim 名额、不打开会话；见 OBS-7（retain 措辞） | 行为符合契约意图 | ✅ 通过 |
| QA3-13 | US-06 | 代码审查 + 静态断言 | Board 六动作命名对照清单 §5 / PRD US-06 / design rev.1.1 | 「查看原会话/继续原目标/重试此任务（新会话）/跳过此任务/修改后重新排队/删除记录」全部在位；旧命名「恢复原 Goal/编辑后重新排队」反向断言防回流；QA grep 复核 src 无旧命名 | 一致；`4b39ad0` 修正到位 | ✅ 通过 |
| QA3-14 | US-06 | 代码审查 | notice 文案与下一步说明 | 跳过→「已跳过，队列仍暂停。点击“启动队列”继续待执行任务。」；重试→「已重新排队，点击“启动队列”执行」；恢复→「原 Goal 已恢复，占用一个执行名额」（design 335 行固定文案，非按钮标签，保留正确）；重排队/删除 notice 到位；不可用动作渲染理由 | 与 design §U06 逐条一致 | ✅ 通过 |
| QA3-15 | US-06 | 代码审查 | 重复点击防护 | `act` 以 acting 重入守卫；inspect 面板再点关闭；modal submitting 守卫；`window.confirm` 全仓 Board 移除（静态断言） | 到位 | ✅ 通过 |
| QA3-16 | US-06 | 代码审查 | interrupted 非 goalMode 标签 | 显示「待核实」（不再「待人工恢复」）；goalMode 仍「待人工恢复」 | QueueBoard.tsx:26 符合 | ✅ 通过 |
| QA3-17 | OBS-6 | enable() 前置检查 | 挂码核验 | `NOT_BOOTED`/`CONNECTION_CHANGED`/`UNRESOLVED_BLOCKING` 挂码、文案保留；directoryFresh 前置仍普通 Error——design §6.2 仅要求上述三码，合规 | OBS-6 闭环 | ✅ 通过 |
| QA3-18 | US-07 | schema 审查 | `attempt.phase` 提前至 M7 | 字段 + `PHASES` 校验入 decode；design rev.1.1 §U07 认可「schema 提前、U07 只补写入不动结构」 | 一致 | ✅ 通过 |
| QA3-19 | 链6/7 | 范围判定 | PRD §7 链 6/7 映射 | 链 6：处置、重复点击已验；分类切换既有过滤测试无回归；表单错误定位（U08）、标题模式切换（U09）留待 M8/M9 后整段 QA-3。链 7：运行拒绝、恢复一次执行权、重连撤销授权已验；CAS/回包丢失不重发涉 U07 未实施，留待 QA-4 | 按排期留待项均有归属 | ✅ 记录 |

### 结论

**QA-3（M7/U06 + 命名修正）通过**。inspect 只读幂等零写入、六动作可用性与理由、恢复原子 claim 不退化、可证明性判定与 legacy 保守拒绝、权威命名与 notice 下一步文案全部符合 design rev.1.1 与清单 §5；OBS-6 闭环。无阻塞 bug。

### 观察项（非阻塞）

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| OBS-7 | 低 | `goalOf` 经 `sessions.retain`（acquire→读投影→finally release）读取 Goal 投影；design §6.4 rev.1.1 措辞「不得引入写入、claim 或 retain」按字面则投影不可读（retain 是访问 projections 的唯一公开途径）。实现为瞬时只读获取、即取即放、零写入、不占名额，符合契约意图 | 请架构师把措辞修订为「不得引入持久 retain / claim / 写入」，或确认现实现即口径 |
| OBS-8 | 低 | `inspectTask` 的 slotTaken 用 `activeIds.length + sessionActivity.length >= maxConcurrent` 直加，未走 `summarizeQueue` 去重口径；理论上自有会话双计会虚报「名额已被占用」（保守方向，且 trackSessionActivity 已对自有运行会话去重，实际难触发） | U07 实施时统一改用 `summarizeQueue().occupied`，与派发闸门同口径 |
| OBS-5 | 跟踪中 | 执行历史行不显示 attempt 级 titleError/detail（QA-2 提出），架构师未回复 | 不阻塞，随后续里程碑确认 |

---

## QA-4：M8/U07 段复测（派发阶段 CAS + 失败三分类）

- **测试标题**：U07 复测——phase 与业务数据同次 CAS、可证明重排全链路、dispatch 失败三分类、旧数据不伪造
- **测试范围**：U07（`queue.ts` `applyPhase`/`claim`/`setTaskModel`/`setSessionId`/`markModelConfirmed`/`markCommandSubmitted`/decode 校验、`coordinator.ts` dispatch 阶段写入与 catch 三分类、`settings-schema.ts` phase 校验、`inspection.ts` OBS-8 闭环）；PRD §7 链 7 的 CAS/回包丢失部分；边界 B1（不自动重跑）/B2（孤儿 Session 处置）/B4（证据不伪造）
- **优先级**：P1
- **被测提交**：`05d8b7b`（U07/M8）；QA-3 基线 `4a9ad5c`（含 design rev.1.2 `31df308` OBS-7 裁定）；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；原探针 R01–R07 复核；代码对照 design §5/§6.1/§8.4/§U07 逐项审查；`git show` 核对既有测试适配是否仅签名级

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA4-01 | US-07 | HEAD=05d8b7b，工作树干净 | `npm run typecheck` | 无类型错误 | 通过 | ✅ 通过 |
| QA4-02 | US-07 | 同上 | `npm test` 全量 | 136/136 全绿（128 + 新增 dispatch-phase 8 项） | tests 136 / pass 136 / fail 0 | ✅ 通过 |
| QA4-03 | US-07 | 同上 | `npm run build` | 构建成功 | CJS+ESM 完成 | ✅ 通过 |
| QA4-04 | 回归 | 同上 | 原探针 R01–R07 | 7/7 PASS 无回归 | 7/7 PASS | ✅ 通过 |
| QA4-05 | US-07/B4 | 新 claim / legacy 旧数据 | claim 后查 phase；decode 无 phase 旧任务 | claim 记 `phase:'claimed'`（Attempt 与任务镜像双写）；旧任务/旧 Attempt `phase=undefined` 不伪造 | 断言全过 | ✅ 通过 |
| QA4-06 | US-07 | 活跃任务 | setTaskModel(…,`precheck`) → setSessionId(…,`session_created`) → markModelConfirmed → markCommandSubmitted → JSON 往返 decode | 每次 phase 与业务数据（modelSelection/sessionId）同一状态拷贝写入；持久化往返 phase 保留；同一 Attempt 内单调不回退（command_submitted 后再 markModelConfirmed 不降级） | 断言全过 | ✅ 通过 |
| QA4-07 | US-07 | 各阶段失败任务 | requeueEdited 对 claimed/precheck（无 sessionId）、session_created、model_confirmed、command_submitted、legacy | 仅 claimed/precheck 且无 sessionId 放行（回 pending、证据保留）；其余全部抛 `REQUEUE_EDIT_NOT_PROVEN`；legacy 保守拒绝 | 断言全过（M7 判定在 phase 写入后全链路生效） | ✅ 通过 |
| QA4-08 | US-07/B1 | phase=command_submitted 失败 | requeueEdited → retry → claim | 简化重排拒绝；用户 retry 开新 Attempt（计数 2）、旧 Attempt `command_submitted` 证据归档不动；队列保持暂停不自动重发 | 断言全过 | ✅ 通过 |
| QA4-09 | US-07（链7） | 创建前失败（非法模型） | coordinator 全流程 dispatch 失败 | status=failed、detail 含「已确认未提交，可修改后重新排队」、attempt phase=claimed；requeueEdited 放行 | 断言全过 | ✅ 通过 |
| QA4-10 | US-07（链7） | Session 已建、select 失败 | coordinator 全流程 | status=interrupted、detail 含「会话已创建、命令未提交，需处置原会话」、phase=session_created；简化重排拒绝 | 断言全过 | ✅ 通过 |
| QA4-11 | US-07（链7/B1） | /goal 回包丢失 | coordinator 全流程 | status=interrupted、detail 含「命令提交状态未知，保守处理，不会自动重发」、phase=command_submitted；`enabled=false` 保持暂停、无自动重发 | 断言全过 | ✅ 通过 |
| QA4-12 | US-07/B1 | 代码 + 静态断言 | markCommandSubmitted 写入时序 | 先于 `held.session.command('/goal')` 与 `held.session.prompt(` 持久化；`SUBMISSION_UNKNOWN` 码在位；abandon 路径文案对齐三分类 | 静态断言测试 + QA 复核一致 | ✅ 通过 |
| QA4-13 | US-07/B2 | create 成功但 setSessionId 持久化失败 | 分类逻辑审查 + recovery-regression 既有断言 | 叠加本地 created 事实按「会话已创建」分类 interrupted（孤儿 Session 需处置，不回落 pending）；recovery-regression 测试未改动未弱化（不在提交文件清单） | 修正方向保 B2/T04 语义，见 OBS-10 | ✅ 通过 |
| QA4-14 | 契约 | 代码审查 | decode/schema 对 phase 的校验 | 任务级与 Attempt 级 phase 均校验（非法值整包拒绝、undefined 允许）；`updateActive` forbidden 列表加入 `phase` 防旁路改写 | settings-schema.ts:25/33、queue.ts decode 一致 | ✅ 通过 |
| QA4-15 | 契约 | 代码审查 | design §8.4 状态机迁移对照 | claimed→precheck→session_created→model_confirmed→command_submitted 全部经 CAS；失败边见 OBS-9 | 迁移与守卫一致 | ✅ 通过 |
| QA4-16 | OBS-8 | inspection.ts | slotTaken 判定 | 改走 `summarizeQueue(q).occupied >= maxConcurrent`，与 Board/派发闸门同口径 | 已闭环 | ✅ 通过 |
| QA4-17 | OBS-7 | design rev.1.2（`31df308`） | 架构师裁定核对 | 「不得引入持久 retain；瞬时 retain 读投影即口径」——与 `goalOf` 实现一致 | 已闭环 | ✅ 通过 |
| QA4-18 | 回归 | 既有测试适配 | `git show` 核对 alert-lifecycle/model-selection/queue.test | 仅 `setSessionId`/`setTaskModel` 加 phase 实参，断言语义不变 | 纯签名级 | ✅ 通过 |

### 结论

**QA-4（M8/U07 段）通过**。phase 与业务数据同次 CAS 落地（丢失写入不可能拆对）、可证明重排按持久证据判定、提交前先持久化 `command_submitted` 保证回包丢失不自动重发（B1）、旧数据 phase 不伪造（B4）、孤儿 Session 按「会话已创建」处置（B2）。无阻塞 bug。

### 观察项（非阻塞）

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| OBS-9 | 低 | design §8.4 状态机图失败边统一标 `failed`，实现按语义取 `interrupted`（session_created/model_confirmed/command_submitted）与 `failed`（claimed/precheck）——与 B2、T04 既有语义一致 | 请架构师修正 §8.4 图标注（failed→interrupted 按阶段区分） |
| OBS-10 | 低 | 三分类叠加「本地 created 事实」修正（create 成功但持久化失败按会话已创建分类）：方向保 B2/T04，但 design §U07 只写「按持久 phase 证据」 | 请架构师在 §U07/§8.4 补一句「同次派发内可叠加本地 create 事实」即闭环 |
| OBS-11 | 低 | design §U07 分类文案仍写「可编辑后重新排队」（rev.1.1 未同步该行），实现按权威命名「可修改后重新排队」；另 `SUBMISSION_UNKNOWN` 码现仅作 message 来源，码本身不持久化不上 UI（design 未要求） | 请架构师同步文案口径；码口径如需上 UI 请明示 |

---

## QA-5：M9/U08 段复测（工作区显式选择 + 保存后执行语义）

- **测试标题**：U08 复测——不猜默认工作区、显式选择内联校验、保存按钮按授权态文案、外部 API 核验结论独立复核
- **测试范围**：U08（`QueueBoard.tsx` `newForm()`/保存校验/按钮文案、design §11.2 唯一外部核验项）；PRD §7 链 7 工作区部分；边界 B1（不暗改授权规则）/B7（不改 DPH 内置代码）
- **优先级**：P1
- **被测提交**：`8ed63c3`（U08/M9）；QA-4 基线 `1ee2c2b`；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；原探针 R01–R07 复核；`git show 8ed63c3` 全量 diff 对照 design §U08 逐句核验；工程师外部核验结论由 QA 独立扫宿主公开类型复核

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA5-01 | US-08 | HEAD=8ed63c3，工作树干净 | `npm run typecheck` | 无类型错误 | 通过 | ✅ 通过 |
| QA5-02 | US-08 | 同上 | `npm test` 全量 | 137/137 全绿（136 + 新增 U08 断言 1 项） | tests 137 / pass 137 / fail 0 | ✅ 通过 |
| QA5-03 | US-08 | 同上 | `npm run build` | 构建成功 | CJS+ESM 完成 | ✅ 通过 |
| QA5-04 | 回归 | 同上 | 原探针 R01–R07 | 7/7 PASS 无回归 | 7/7 PASS | ✅ 通过 |
| QA5-05 | US-08（R07 链工作区部分） | 多工作区含中文路径 | 审查 newForm + 静态断言 | 默认 `workspaceId=''`，源码不再出现 `workspaces.items[0]`，首项不被预选 | 断言在位且通过 | ✅ 通过 |
| QA5-06 | US-08 | 表单未选工作区点保存 | 审查保存校验与渲染 | `formErrors.workspace='请选择工作区'` 内联 `role="alert"` 显示在字段下；select 原生 `required` 气泡移除；保存按钮不再 `!workspaceId` 前置禁用（保证内联错误可触发），其余门禁（submitting/catalog/modelError/超长）保留；选定即清错 | 与预期一致 | ✅ 通过 |
| QA5-07 | US-08 | 各授权态 | 对照 design §U08 358 行逐字核验按钮文案 | `queueEnabled`(=`q.enabled && authorized`) 且 pending>0 →「加入运行中的队列」+提示「加入后将按可用名额执行」；pending=0 →「等待新任务，加入后执行」；未授权/未启用 →「保存任务」；requeueFor 场景保留「重新排队」（U06 权威命名）；旧裸「保存」标签防回流断言在位 | 四态文案与 design 逐字一致 | ✅ 通过 |
| QA5-08 | design §11.2 | 宿主公开类型 | QA 独立扫 `@deepseek-ai` 全部 .d.ts | `UiWorkspace` 接口仅动作（openSession/openWorkspace/connectWorkspace/forkSession/startSession/archive/reorder），无当前工作区 getter；`UiWorkspaceService.selection` 为 `private readonly`；`startSession` 缺省「inherits the current or most recent Workspace」是内部行为不可读；全类型包 grep `currentWorkspace/getWorkspace/workspaceSelection` 零命中 | 工程师核验结论独立复核成立 → 显式选择兜底是 design 预设路径 | ✅ 通过 |
| QA5-09 | B1/B7 | diff 审查 | `git show 8ed63c3` 文件清单 | 仅 `QueueBoard.tsx` 表单区 + 测试 + tasks.md 勾选；授权规则、派发规则、DPH 内置代码零改动 | 3 files +30/−5，符合 | ✅ 通过 |
| QA5-10 | 口径 | design §U08 原文 | 文案裁定核对 | design 358 行原文「等待新任务，加入后执行」为权威；Chief 点名消息中「加入后会执行」系转述笔误，实现按 design 逐字正确，无需改动 | 确认，无需裁定 | ✅ 通过 |

### 结论

**QA-5（M9/U08 段）通过**。不猜默认工作区、显式选择 + 内联校验、按钮文案四态与 design §U08 逐字一致；§11.2 唯一外部核验项（uiWorkspace 无当前工作区读取途径）经 QA 独立扫描宿主公开类型复核成立，显式选择兜底即 design 预设路径。无阻塞 bug，无新观察项。

---

## QA-6：M10/U09 段复测（标题三模式，B4）

- **测试标题**：U09 复测——标题单选三模式、默认不额外生成（B4）、草稿保留、高级选项折叠、缺标题统一显示、持久结构不变
- **测试范围**：U09（`QueueBoard.tsx` 标题区重构/映射/显示、`title-policy.ts` 常量复用）；边界 B4（不默认增加标题模型请求）；既有标题生成行为（无工具、同模型、截断、失败隔离）回归
- **优先级**：P2
- **被测提交**：`ab6ce26`（U09/M10）；QA-5 基线 `158f4d8`；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；原探针 R01–R07 复核；`git show ab6ce26` 全量 diff 对照 design §U09 逐句核验；grep 全 src 复核旧文案清零

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA6-01 | US-09 | HEAD=ab6ce26，工作树干净 | `npm run typecheck` | 无类型错误 | 通过 | ✅ 通过 |
| QA6-02 | US-09 | 同上 | `npm test` 全量 | 138/138 全绿（137 + 新增 U09 用例 1 项） | tests 138 / pass 138 / fail 0 | ✅ 通过 |
| QA6-03 | US-09 | 同上 | `npm run build`（pretest 已含） | 构建成功 | CJS+ESM 完成 | ✅ 通过 |
| QA6-04 | 回归 | 同上 | 原探针 R01–R07 | 7/7 PASS 无回归 | 7/7 PASS | ✅ 通过 |
| QA6-05 | US-09/B4 | 新建表单 | 审查 newForm 与单选组 | 三模式单选文案「留空（不额外生成，不增加模型请求）/ 手动填写 / AI 生成（一次额外模型请求）」；默认 `titleMode='none'`——默认零额外模型请求 | 断言在位且通过 | ✅ 通过 |
| QA6-06 | US-09 | 保存映射 | 审查 input 构造 | `generateTitle:titleMode==='ai'`、`title:titleMode==='manual'?title:''`——none/manual 均落 `generateTitle=false`；持久字段形状不变，无第二份持久状态 | 与预期一致；title-generation 往返用例原样绿 | ✅ 通过 |
| QA6-07 | US-09 | 模式切换 | 审查状态流转 | `title` 草稿跨模式切换不清空；旧勾选 `if(e.target.checked)setTitle('')` 丢输入行为已删（防回流断言）；AI 模式提示「已填写的手动标题会保留为草稿，切回手动填写可继续使用」；UI 无 `setGenerateTitle` 平行布尔 | 断言全过 | ✅ 通过 |
| QA6-08 | US-09 | 高级选项 | 审查 titleMaxChars 位置 | 移入 `<details>高级选项` 折叠区、标注「一次额外模型请求」、默认 `DEFAULT_TITLE_CHARS`(24)、边界复用 `MIN/MAX_TITLE_CHARS` 常量 | 与预期一致 | ✅ 通过 |
| QA6-09 | US-09 | 缺标题任务行 | 审查显示 + grep 全 src | `task.title \|\| (goalMode ? '未命名目标' : '未命名任务')`；「等待 DSH 自动生成标题」「未命名目标任务」全 src 零残留（grep 无命中）+ 防回流断言 | 清零确认 | ✅ 通过 |
| QA6-10 | 回归 | 既有标题行为 | diff 文件清单 + title-generation.test.ts | 无工具、同模型、截断、失败隔离零触碰（测试文件不在提交清单，9 项失败隔离用例全绿）；editForm 对存量任务映射 ai/manual/none 正确 | 全绿 | ✅ 通过 |
| QA6-11 | 口径 | design §U10 372 行 | AI 超长保存报错文案归属核对 | 保存报错保留原句「…请缩短题词或关闭标题生成」；design 新文案「任务内容过长，无法再生成标题；可关闭 AI 标题后保存」列于 §U10（M11 范围），不提前属正确归属；QA-7 须核验 M11 落地该文案 | 口径成立，列入 QA-7 跟踪 | ✅ 通过 |

### 结论

**QA-6（M10/U09 段）通过**。三模式单选与 design §U09 逐句一致；B4 默认 none 零额外请求、none/manual 同映射 `generateTitle=false` 且持久结构不变（无第二份状态）；草稿保留修掉旧丢输入行为；缺标题显示统一、旧文案清零。无阻塞 bug，无新观察项。

**跟踪项**：AI 超长保存报错新文案属 §U10/M11，QA-7 复测时核验落地。

---

## QA-7：M11/U10 段复测（表单顺序、局部错误与精简文案）

- **测试标题**：U10 复测——表单六段顺序、保存错误内联与禁用原因、模型副作用一行提示、实现术语入 help/details、AI 超长新文案（QA-6 跟踪项闭环）、README 同步
- **测试范围**：U10（`QueueBoard.tsx` 表单重排/内联错误/saveBlock/术语外移/新文案；README.md/README.zh.md 同步）；QA-6 跟踪项核验
- **优先级**：P2
- **被测提交**：`6d55002`（U10/M11）；QA-6 基线 `2cd2945`；工作树干净
- **复测日期**：2026-10-25
- **验证方式**：独立重跑 `typecheck` / `npm test` / `build`；原探针 R01–R07 复核；`git show 6d55002` 全量 diff 对照 design §U10 逐句核验；QA 独立截取表单区 grep 术语残留

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA7-01 | US-10 | HEAD=6d55002，工作树干净 | `npm run typecheck` | 无类型错误 | 通过 | ✅ 通过 |
| QA7-02 | US-10 | 同上 | `npm test` 全量 | 139/139 全绿（138 + 新增 U10 用例 1 项） | tests 139 / pass 139 / fail 0 | ✅ 通过 |
| QA7-03 | US-10 | 同上 | `npm run build`（pretest 已含） | 构建成功 | CJS+ESM 完成 | ✅ 通过 |
| QA7-04 | 回归 | 同上 | 原探针 R01–R07 | 7/7 PASS 无回归 | 7/7 PASS | ✅ 通过 |
| QA7-05 | US-10 | 表单 JSX | QA 独立按 diff 核对 + 递增 indexOf 断言 | 顺序：任务说明 → 执行工作区 → 执行方式（/goal 勾选）→ 模型与推理 → 标题 → 高级选项 | 与 design §U10 一致；标记用精确标签（如 `推理强度<select`）避免勾选文案早现干扰，工程师提示属实 | ✅ 通过 |
| QA7-06 | US-10 | 各失败路径 | 审查错误渲染位置 | 工作区/标题/模型错误均内联对应字段下（role=alert）；保存失败 `保存失败：` 内联 footer；不再依赖背后全局红框 | 与预期一致 | ✅ 通过 |
| QA7-07 | US-10 | 保存禁用条件 | 审查 saveBlock | 禁用保存显示「暂不能保存：{原因}」，按 submitting→目录→模型→超长 顺序给首个原因 | 与预期一致 | ✅ 通过 |
| QA7-08 | US-10 | 模型区 | 对照 design 引句 | 一行提示可见；实现为「派发时设置模型也会更新 Host 默认模型；恢复已有 Session 不重新设置模型。」——与 design 引句「执行时设置模型会同时更新 Host 默认模型」存在「执行时/派发时」「同时/也」措辞差 | 见 OBS-12 | ⚠️ 通过（带观察项） |
| QA7-09 | US-10 | 主表单区 | QA 独立截取 form 区 grep `CAS\|投影\|token\|UTF-16\|Harness` | 实现术语不入主表单；UTF-16 仅出现在 help/details 内 | 命中仅 1 处且在「标题生成帮助」details 内；CAS/投影/token/Harness 零残留 | ✅ 通过 |
| QA7-10 | US-10/QA-6 跟踪项 | AI 超长 | live 提示与保存报错文案 | 同句「任务内容过长，无法再生成标题；可关闭 AI 标题后保存」；不建议删正文；「请缩短题词」删除有防回流；「任务说明正文不会被截断」在 help 内 | 逐字一致，QA-6 跟踪项闭环 | ✅ 通过 |
| QA7-11 | 文档 | README diff | 双语 README 核对 | 并发 1–8→串行固定 1、「激活旧 Goal」→「继续原目标」、标题勾选→三模式、表单顺序与新文案、删「修改并发数」步骤 | 双语均已同步，无旧口径残留 | ✅ 通过 |

### 结论

**QA-7（M11/U10 段）通过**。六段顺序、内联错误、禁用原因、术语外移、超长新文案全部与 design §U10 一致；QA-6 跟踪项闭环；README 双语同步到位。无阻塞 bug。

### 观察项（非阻塞）

| 编号 | 级别 | 内容 | 建议 |
|---|---|---|---|
| OBS-12 | 低 | 模型副作用提示实现为「**派发时**设置模型**也**会更新 Host 默认模型；恢复已有 Session 不重新设置模型。」，design §U10 引句为「**执行时**设置模型**会同时**更新 Host 默认模型」——语义相同，「派发时」更贴插件术语，但与 design 引句未逐字一致 | 请架构师裁定：以 design 引句为准改文案，或 rev. 更新引句认可现文案 |

---

## QA-8：M12（U11 Board 信息分层 + OBS-5）复测

- **测试标题**：QA-8 U11 Board 信息分层复测（顶部授权态/占用拆分/待执行/未处置直达、主操作按 blockers 切换、行分层、筛选计数、详情折叠含 attempt 级证据）
- **被测提交**：`e34a742`（feat(U11/T12)，6 files +90/−29）
- **测试范围**：design §U11、PRD US-11 验收口径、OBS-5 闭环核验、README 双语同步
- **优先级**：P2（UI 分层，行为红线 B1–B7 回归由探针把关）
- **独立验证**：`npm run typecheck` ✅；`npm test` **140/140 全绿**（基线 139 + 新增 U11 用例 1）；`npm run build` ✅；探针 R01–R07 **7/7 PASS** 无回归

### 测试用例表

| 测试编号 | 关联用户故事 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA8-01 | US-11 | 被测 `e34a742` | 独立跑三命令 + 探针 | 全绿无回归 | 140/140、build ✅、探针 7/7 | ✅ |
| QA8-02 | US-11 | design §U11 顶部口径 | 对照源码核验顶部五要素 | 授权态、占用拆分、待执行、未处置（点击→筛异常）、同步新鲜度 | 授权态（gq-notes 已启用/未获授权句）；占用「启动占位/已观察运行/外部会话」（starting claim 不再统称运行会话）；`{summary.pending} 项待执行`；「N 项异常」与告警条均为 `setFilter('abnormal')` 可点入口（≥2 处断言）；syncLabel 新鲜度（U03 延续） | ✅ |
| QA8-03 | US-11 | 主操作切换口径 | 核验主按钮三分支 | blockers>0→「处理 N 项异常」直达异常筛选；无异常→「启动队列」（显式授权、扫描中禁用）；已启用→「暂停队列」 | 三分支逐字一致；禁用条件 `!queueEnabled&&blockers.length===0&&discovering`——有异常时按钮可点（仅切筛选，不派发），无异常扫描中禁用，符合「启动仍是显式授权」 | ✅ |
| QA8-04 | US-11 | 筛选计数与筛选结果一致 | 独立对照 `filterCounts` 与 `queue-view.ts filterTaskRows` 谓词 | 四筛选计数=对应筛选实际行数 | current=pending/running/starting、abnormal=`summary.unresolved`（=UNRESOLVED 过滤，与 `summarizeQueue` 同源）、history=completed/skipped、all=全量——四条谓词逐字一致 | ✅ |
| QA8-05 | US-11 | 行分层 | 核验行内要素与主操作 | 行内只留标题、工作区、状态、必要原因（task.detail/titleError）、主操作（异常→查看并处理 / 待执行→编辑 / 非异常有 Session→查看原会话）；次操作入「更多」 | 行 214–226 齐全；主操作三分支按 abnormal/editable/sessionId 渲染；上移/下移/编辑/删除只在适用时渲染入「更多」，无灰色 disabled 占位（`disabled={!editable` 防回流断言）；needsReview 任务行内给「查看并处理」不入异常筛选——与 blockers=UNRESOLVED 既有口径一致，非回归 | ✅ |
| QA8-06 | US-11 / OBS-5 | 详情折叠 | 核验「详情」区内容与位置 | 模型详情、创建/状态时间戳、完整 Session ID、执行记录全部折叠；attempt 级 `titleError`（标注）与 `detail` 逐条显示 | 全部在 `<details className="gq-task-details">` 之后（indexOf 断言）；`attempt.titleError` 标「标题生成失败：」、`attempt.detail` 逐条渲染——**OBS-5 闭环** | ✅ |
| QA8-07 | US-11 | 常驻提示与帮助 | 逐字对照 design §U11 引句 | 「暂停只停止派发，已在运行的任务继续。」；完成判据入帮助折叠 | 与 design §U11 引句逐字一致（PRD「已运行任务继续」以 design 为准）；判据入「完成判据与验收边界」details | ✅ |
| QA8-08 | US-11 | 窄窗与 100+ 记录 | 核验 styles.ts 与列表策略 | ≤720px 媒体查询、控件 ≥36px 触控高度；未引入虚拟列表（清单：未实测不引入） | 媒体查询收紧内边距 + `min-height:36px`；无虚拟列表，沿用 `gq-list` 滚动 | ✅ |
| QA8-09 | US-11 | 键盘/焦点 | 核验折叠实现方式 | 键盘展开收起、焦点归还留 U12 实机验证 | 原生 `<details>`（更多/详情/帮助）天然可用；Escape 关闭面板既有在位；实机项按 design §U11 归 U12 | ✅ |
| QA8-10 | US-11 | README 同步 | 对照双语新增条目 | 「信息分层」条目双语一致 | README.md/README.zh.md 均已同步（异常直达、计数、行分层、attempt 级证据折叠） | ✅ |

### 既有测试适配核对

本轮无既有测试改动（纯新增 1 项用例），无适配风险。

### 结论与观察项

**QA-8（M12/U11 段 + OBS-5）通过**。顶部五要素、主操作按 blockers 切换、筛选计数与筛选谓词同源一致、行分层无 disabled 占位、详情折叠含 attempt 级证据（OBS-5 闭环）、常驻提示与 design §U11 逐字一致、窄窗媒体查询到位、README 双语同步。无阻塞 bug，无新观察项。

观察项台账更新：OBS-5 闭环；跟踪中仅剩 OBS-1（attempt detail 覆写，待产品经理口径）。

---

## QA-9：U12 整合验收（T13.2）

- **测试标题**：QA-9 U12 整合回归 + 观察项台账全量销账 + 老板实机确认清单
- **被测提交**：`16dab87`（HEAD，工作树干净；含 U01–U11+U13 全部实施与 QA-1–QA-8 记录）
- **测试范围**：全量回归（三命令 + 探针）、整合覆盖映射（迁移/去重/串行/恢复/空标题/多工作区）、OBS-1–OBS-12 逐条销账、实机项分离
- **优先级**：P1（最终验收前置）

### 全量回归

| 项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | **140/140 全绿**（17 个测试文件） |
| `npm run build` | ✅ |
| 探针 R01–R07（`behavior-probes.mjs`，模拟传输） | **7/7 PASS**（R01–R07 全部 Red→Green，OBS-3 闭环后跑通原探针） |

### 整合覆盖映射（Chief 指定项 → 自动化证据）

| 整合项 | 自动化覆盖 | 状态 |
|---|---|---|
| 旧数据迁移 | `settings.test.ts`（`maxConcurrent` 2–8 归一 1 不弹错不丢数据）、`queue.test.ts` decode（legacy 无 phase 不伪造、垃圾值拒绝）、`dispatch-phase.test.ts`（phase 迁移） | ✅ |
| 去重 | `discovery-concurrency.test.ts`（同 sessionId 重复 adopt 不建第二行）、`session-activity.test.ts` + `summarizeQueue` 去重口径（OBS-8） | ✅ |
| 串行并发=1 | `serial-dispatch.test.ts` 7 项（含恢复、重连、三连点击，全程 maxHolds≤1） | ✅ |
| 恢复 | `recovery-regression.test.ts`（重启标 interrupted 不自动重发、Host 确认同 Session 仅恢复观察、T04 create 事实） | ✅ |
| 空标题 | `title-generation.test.ts`（缺标题显示「未命名任务/未命名目标」、失败隔离 9 项） | ✅ |
| 两工作区含中文路径 | 自动化覆盖**显式选择逻辑**（`board-interactions.test.ts` U08：无 `items[0]` 猜测、必选校验）；workspaceId 为不透明字符串，**真实中文路径工作区属实机项**（见清单 C3） | ✅（逻辑）/ 实机 |

### 观察项台账销账（OBS-1–OBS-12）

| 编号 | 内容 | 闭环证据 | 状态 |
|---|---|---|---|
| OBS-1 | attempt `detail` 覆写口径 | 产品经理本轮确认最终口径「detail=派发/执行诊断，titleError=标题生成诊断，分离归档、详情区按执行记录可见」；实现一致：`coordinator.ts:352` 标题失败只写 `titleError`、`queue.ts:223-225` claim 时 task 级 titleError 归档至末次 Attempt、派发诊断走 `detail` | ✅ 闭环 |
| OBS-2 | prd/design 未入库 | 随 `2453fea` 入库（QA-2 核验） | ✅ |
| OBS-3 | 原探针夹具崩溃 | 已注入 SessionDirectory 按契约适配，7/7 跑通（QA-2 起持续复核） | ✅ |
| OBS-4 | syncState=failed 属 U03 顺延 | 随 M3 落地（QA-2 QA2-05 闭环） | ✅ |
| OBS-5 | 历史行 attempt 级显示口径 | M12 详情折叠区逐条显示 `attempt.titleError`（标「标题生成失败：」）与 `attempt.detail`（QA-8 QA8-06） | ✅ |
| OBS-6 | enable 未挂错误码 | M7 挂 `NOT_BOOTED`/`CONNECTION_CHANGED`/`UNRESOLVED_BLOCKING`（QA-3） | ✅ |
| OBS-7 | `goalOf` 瞬时 retain | design rev.1.2（`31df308`）裁定口径，实现一致（QA-4） | ✅ |
| OBS-8 | slotTaken 直加计数 | M8 改走 `summarizeQueue` 去重口径（QA-4） | ✅ |
| OBS-9 | §8.4 图失败边 failed vs interrupted | design rev.1.3（`ec282b8`）状态图按语义分流，与实现一致 | ✅ |
| OBS-10 | 本地 create 事实口径 | design rev.1.3 补「同次派发可叠加本地 create 事实」，与实现一致 | ✅ |
| OBS-11 | `SUBMISSION_UNKNOWN` 码不上 UI | design rev.1.3 确认「码供程序/测试断言，UI 展示人读文案」即现实现 | ✅ |
| OBS-12 | 副作用提示措辞 | design rev.1.4（`7efdb0b`）认可现文案并引句对齐 | ✅ |

**台账 12/12 全部闭环。**

### 老板 DPH Desktop 实机确认清单（T13.3，验收签字前完成）

标注：〔自动=已覆盖，实机=必须实机确认〕

| 编号 | 项 | 自动化状态 | 实机确认要点 |
|---|---|---|---|
| C1 | Desktop 安装/加载/卸载 | 自动=构建产物与 bundle 测试；**实机** | 插件在真实 DPH Desktop 安装、Board 打开、卸载干净 |
| C2 | 真实 Host 发现与派发 | 自动=模拟传输全链；**实机** | 真实 `sessions.list` 发现、`/goal` 提交、Goal 投影观察 |
| C3 | 两工作区含中文路径 | 自动=显式选择逻辑；**实机** | 新建任务不误选、中文路径工作区正确显示与派发 |
| C4 | 键盘/焦点/Escape/返回位置/窄窗 | 自动=静态结构 + ≤720px 媒体查询 + 原生 `<details>`；**实机** | Tab 遍历、Enter 展开「更多/详情」、Escape 关面板、焦点归还、窄窗触控 ≥36px |
| C5 | R03 时序（boot 前打开面板） | 自动=探针 R03 PASS；**实机** | 冷启动立即开面板不报错、boot 收敛后自动扫描 |
| C6 | 串行派发实机观察 | 自动=`serial-dispatch` 7 项；**实机** | 多任务待执行启动队列后仅一个运行，处置后下一个才派发 |
| C7 | 真实 Host 断连重连 | 自动=模拟 connectionReset；**实机** | 拔网/重启 Host → 目录 failed → 恢复后不自动重新授权、不自动重发 |
| C8 | 100+ 记录滚动 | 未测（清单约定未实测不引入虚拟列表）；**实机** | 长列表滚动可用、无渲染卡顿 |
| C9 | 详情区 attempt 级证据显示 | 自动=数据层 + 静态断言；**实机** | 「详情」展开后每次执行的标题失败/处置说明可读、完整 Session ID 可打开历史 Session |

### 结论

**QA-9（U12 整合验收）自动化部分通过**：全量回归 140/140 + 探针 7/7、整合覆盖映射全部有测试证据、观察项台账 12/12 闭环。剩余 C1–C9 中「实机」列为老板 DPH Desktop 确认项（T13.3），由 Chief 转老板执行；其中 C4/C8 完全无自动化，C1/C2/C3/C5/C6/C7/C9 自动化已覆盖逻辑层、实机确认真实环境行为。

---

## QA-10：实机缺陷修复复测（面板打不开 / React #310）

- **测试标题**：QA-10 实机缺陷「点击任务队列按钮面板打不开」修复复测（hook 顺序违规）
- **被测提交**：`e9260d1`（fix(client)，QueueBoard hooks 移至提前 return 之前 + 新增 `test/board-mount.test.ts` 挂载回归）
- **优先级**：P0（实机必现缺陷，阻塞 C1–C9 全部实机项）

| 测试编号 | 关联 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA10-01 | 实机缺陷 | HEAD `e9260d1` | 独立跑三命令 + 探针 | 全绿 | typecheck ✅、**142/142**、build ✅、探针 7/7 | ✅ |
| QA10-02 | 修复结构 | design 约束：不动组件结构 | 审计 QueueBoard 全部 hook 位置 | 所有 useState/useEffect/useSyncExternalStore 在 `!open`（83 行）与 not-ready（86 行）提前 return 之前；return 之后零 hook | 43–77 行全部前置，return 后无残留；改动仅移动五处 useState，最小修复 | ✅ |
| QA10-03 | 红绿可复现 | 仅回退 QueueBoard.tsx 至 `e9260d1~1` | 重建 bundle 后单跑 board-mount | 修复前红：逐字 React #310 | `Error: Rendered more hooks than during the previous render.` + `slot entry crashed in 'shell.overlay'`——与老板实机症状（按钮在、点了打不开、槽位被错误替换）逐字吻合 | ✅ |
| QA10-04 | 修复有效 | 恢复 `e9260d1` | 重建 bundle 后单跑 board-mount | 全绿 | 3/3 通过（含两个崩溃转换：ready 首击、open 时 loading→ready） | ✅ |
| QA10-05 | 漏检根因 | 复盘 140 全绿为何漏检 | 核对 test/ 挂载覆盖 | 此前 QueueBoard 仅源码扫描/coordinator 级测试，从未渲染 open=false→true 转换 | 属实；board-mount 用 jsdom+真 Context+真 renderer bundle+真 slot registry 端到端挂载构建产物，补上该盲区 | ✅ |

**QA-10 通过**。根因定位准确（5 个面板 useState 位于提前 return 之后，首开 25→30 hook 抛 React #310），修复最小且不触契约，挂载回归红绿独立复现。devDeps 新增 jsdom/zustand/immer/@types/jsdom 仅测试用，不入产物依赖。

**在途项**：工程师工作区尚有未提交的第三个 mount 用例（error→ready 重试 + 面板开合跨分支 hook 一致性），QA 侧跑测时该用例绿（3/3），待其提交后并入台账。→ 已并入，见下方 QA-10b。

**提醒老板**：需重启 DPH Desktop 加载新 bundle（`lib/client.js` 已重建）后继续 C1–C9。

---

## QA-10b：第三 mount 用例并入复测（`3944e2e`）

- **测试标题**：QA-10b error↔ready 跨分支开合防回流用例并入复测
- **被测提交**：`3944e2e`（test(client)，新增第三挂载用例 + 断言改轮询）
- **优先级**：P1（防回流加固，不触产品代码）

| 测试编号 | 关联 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 状态 |
|---|---|---|---|---|---|---|
| QA10b-01 | 全量门禁 | HEAD `3944e2e` | 独立跑三命令 + 探针 | 全绿 | typecheck ✅、**143/143**、build ✅、探针 7/7 | ✅ |
| QA10b-02 | 红绿复现（三用例） | `git checkout e9260d1^ -- src/client/QueueBoard.tsx` + 重建 bundle | 单跑 board-mount | 三红，报错逐字 React #310 | 3 fail，逐字 `Error: Rendered more hooks than during the previous render.` + `slot entry crashed in 'shell.overlay'` | ✅ |
| QA10b-03 | 修复有效 | `git checkout e9260d1 -- src/client/QueueBoard.tsx` + 重建 bundle | 单跑 board-mount | 三绿 | 3/3 通过，工作区恢复干净 | ✅ |
| QA10b-04 | 用例内容审计 | `git show 3944e2e` | 核对第三用例断言 | 覆盖 error 快照→开→关→重开→「重试读取配置」→ready 全转换，每步断言无 slot 崩溃 | 属实：按钮报「(配置错误)」、错误面板开合两次、重试后面板保持挂载显示「队列为空」，`[data-slot-error]` 计数 0 + slot crash 错误列表为空 | ✅ |
| QA10b-05 | 防 flaky | 固定 sleep 改轮询 `waitFor`（10ms 间隔、3s 上限） | board-mount 连跑三轮 | 三轮稳定全绿 | 3/3、3/3、3/3，无抖动 | ✅ |

**QA-10b 通过**。第三用例走的是 Chief 要求的 error↔ready 反复开合路径，轮询断言消除负载下时序抖动；红绿复现法（回退被测文件+重建 bundle）三红/三绿逐字复核成立。挂载盲区现有 3 用例守卫（ready 首击、open 时 loading→ready、error→ready 跨分支）。

**提醒老板**：需重启 DPH Desktop 加载新 bundle（`lib/client.js` 已重建）后继续 C1–C9。

---

## 观察项登记：OBS-13（实机走查噪音，非缺陷）

| 编号 | 现象 | 归属判定 | QA 独立核验 | 处置 |
|---|---|---|---|---|
| OBS-13 | 实机控制台 `GET dsh-app://app/plugins/events net::ERR_FAILED 200 (OK)` 刷屏 | 宿主既有行为：DPH 插件热更新系统的 SSE 长连接（`/plugins/events`），Electron 自定义协议下流式响应被中止的常见噪音（窗口刷新/连接重建时出现）；与 React #310 开窗缺陷无关 | ① 我方 `src/` 全量 grep `fetch\|EventSource\|plugins/events\|XMLHttpRequest` 零命中——goal-queue 插件从不发网络请求；② 独立扫 `app.asar`：`plugins/events` 命中 11 处，与工程师计数一致，抽样原文为宿主热重载文档（"The Host half watches each package's stamped entry artifact and serves `/plugins/events`…"） | 非缺陷、不修、不扩大修复面；若重启后仍刷屏且影响实机走查判读，再单独交 Chief 定夺 |

---

（以下段落由后续复测追加）