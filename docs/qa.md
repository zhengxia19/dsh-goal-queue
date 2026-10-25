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

（以下段落由后续复测追加）
