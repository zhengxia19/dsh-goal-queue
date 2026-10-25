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

（以下段落由后续复测追加）
