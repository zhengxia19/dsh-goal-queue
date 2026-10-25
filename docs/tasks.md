# 任务拆解与排期 — dsh-goal-queue U01–U13（2026-10-24，rev.2）

- 上游：`docs/prd.md`（产品经理）、`docs/design.md`（架构师，v1.0 含 U13）
- 基线：分支 `main`，HEAD `69b675f`，v0.3.2-preview.0
- 下游：@工程师（开发任务）、@质量QA（复测任务）
- rev.2 变更：按老板新约束「同一时间只能有一个 agent 工作」，QA 复测改为独立时段，与开发不重叠；总工期 D1–D31。

## 1. 排期原则

- **全局严格串行**：同一时间只有一个 agent 在工作。开发任务每次只做一个可验收变更（PRD §10）；QA 复测各占独立工作日，不与任何开发任务重叠。
- 日期用相对工作日 **D1–D31**（工程师确认环境已就绪，D1 = 开工日）。同一日内只安排同一负责人的连续任务。
- 完成条件 = PRD 验收口径 + design §7 验收映射 + 对应测试文件 Green + `typecheck`/`build` 通过。
- 既有 96 项测试的签名适配（`setTaskModel`/`setSessionId` 增参、`summarizeQueue` 形状、`setConcurrency` 删除）随各任务同步完成，不单列。
- 契约不得自改：design §5 错误码、§6 接口签名照实现；发现设计缺口先 @架构师，需求口径先 @产品经理。

## 2. 依赖与并行说明

- U01 是 U03/U06 的身份前提；U02 是 U03/U05 的可信性前提 → 必须先完成。
- U05 的 schema（`titleError`）先于 U07 的 schema（`DispatchPhase`）定稿，避免两次迁移。
- U13 与 U04 同阶段：占用语义（starting/observedRunning/externalActivity/occupied）一次定稿，U13 排在该阶段末位、依赖 U04 的摘要拆分先落地。
- U09–U11 均为 UI 层，依赖 P0/P1 行为稳定后开始。
- 同阶段内任务触及不同文件（QueueBoard.tsx 冲突时按表内次序做），全部按排期串行执行，无并行项。

## 3. 任务表

| 父任务 | 任务 | 负责人 | 优先级 | 起始 | 结束 | 状态 |
|---|---|---|---|---|---|---|
| **M0 基础设施（P0 前置）** | | | | | | |
| M0 | T0.1 新增 `src/errors.ts`：`QueueErrorCode` 12 码 + `QueueError`（design §5，照抄）（0.25d） | 工程师 | P0 | D1 | D1 | 完成 |
| **M1 U01 Goal 身份保护（R05）** | | | | | | |
| M1 | T1.1 `queue.ts`：`adopt` goalId 冲突原样返回；新增 `flagForReview`；`models.ts` 加 `needsReview`（0.5d） | 工程师 | P0 | D1 | D1 | 完成 |
| M1 | T1.2 `coordinator.ts` scanRunning adopt 前身份预检：goalMode 不符 / 非 goalMode interrupted → `trackSessionActivity` + `flagForReview`，不 adopt 不结算（0.5d） | 工程师 | P0 | D2 | D2 | 完成 |
| M1 | T1.3 新增 `test/goal-identity.test.ts`（§7.3 R05 链：A 中断→B 完成→A 未结算、证据完整、needsReview）（0.5d） | 工程师 | P0 | D2 | D2 | 完成 |
| **M2 U02 可信目录基线（R02）** | | | | | | |
| M2 | T2.1 新增 `src/client/directory.ts`：`SessionDirectory` 接口 + `HostSessionDirectory`（`remote.session.list` → `RemoteResult` 校验，失败抛 DIRECTORY_READ_FAILED；假目录源可注入）（0.5d） | 工程师 | P0 | D3 | D3 | 完成 |
| M2 | T2.2 `coordinator.ts`：scanRunning 以 `directory.list()` 为权威基线；移除 `phase==='ready'` 单一判据；`sessions.refresh` 降级 best-effort；失败 `setArmed(false)`，恢复读取不恢复 armed；`directoryFresh` 替换 `discovered`（0.5d） | 工程师 | P0 | D3 | D3 | 完成 |
| M2 | T2.3 新增 `test/directory-trust.test.ts`（§7.1 ok→fail→ok 链；不引用 `getSnapshot().state`）（0.5d） | 工程师 | P0 | D4 | D4 | 完成 |
| **QA P0** | QA-1 P0 段复测（U01+U02 链，记录 qa.md）（0.25d） | 质量QA | P0 | D5 | D5 | 待办 |
| **M3 U03 发现调度（R01/R03）** | | | | | | |
| M3 | T3.1 `coordinator.ts`：booted→`scheduleDiscovery` 首次只读发现；`runningSignature` 订阅比对触发合并发现；`discoveryQueued` 补扫；connectionReset 重置；`SyncState` + `getSyncState`/`subscribeSync`（0.5d） | 工程师 | P1 | D6 | D6 | 完成 |
| M3 | T3.2 `QueueBoard.tsx` 订阅 syncState 渲染新鲜度（initializing/scanning/fresh 时间/failed 原因），保留手动刷新（0.25d） | 工程师 | P1 | D6 | D6 | 完成 |
| M3 | T3.3 新增 `test/discovery-scheduling.test.ts`（§7.2：面板开闭、首次延迟、重连、Subagent 排除、变化不丢）（0.5d） | 工程师 | P1 | D7 | D7 | 完成 |
| **M4 U04 占用来源区分（R06）** | | | | | | |
| M4 | T4.1 `queue.ts` `summarizeQueue` 拆分 starting/observedRunning/externalActivity/occupied；`index.ts` 新 op `openSessionById`（不存在→SESSION_NOT_FOUND）（0.5d） | 工程师 | P1 | D8 | D8 | 完成 |
| M4 | T4.2 `QueueButton.tsx`「占用 N（启动 X · 运行 Y · 外部 Z）」；Board 新增「外部活动」区，每行「打开」（0.5d） | 工程师 | P1 | D8 | D8 | 完成 |
| M4 | T4.3 新增 `test/session-activity.test.ts`（§7.5：删旧任务后活动仍可打开；仅权威 stop 释放；去重/超限不变）（0.5d） | 工程师 | P1 | D9 | D9 | 完成 |
| **M5 U05 告警生命周期（R04/R07）** | | | | | | |
| M5 | T5.1 schema/models：Task/Attempt 加 `titleError`（**先于 U07 schema 定稿**）；`claim` 归档上一 attempt 的 titleError（0.5d） | 工程师 | P1 | D10 | D10 | 完成 |
| M5 | T5.2 `updateActive` 不再写 `q.error`；`title-command.ts` 失败写 `task.titleError`（0.25d） | 工程师 | P1 | D10 | D10 | 完成 |
| M5 | T5.3 `viewStore` 扩展（notice/formErrors/taskErrors）+ Board 按来源绑定渲染；`q.error` 降为状态提示条；Host 不可信仍阻断（0.5d） | 工程师 | P1 | D11 | D11 | 完成 |
| M5 | T5.4 新增 `test/alert-lifecycle.test.ts`（§7.4）（0.5d） | 工程师 | P1 | D11 | D11 | 完成 |
| **M6 U13 串行派发（并发上限=1）** | | | | | | |
| M6 | T6.1 `settings-schema.ts` `maxConcurrent` → `default(1).transform(() => 1)`（旧值 2–8 归一；schemastery 无链式 transform，落地为静态 `z.transform(z.number().default(1), () => 1)`，语义一致）；删 `queue.ts`/`coordinator.ts` 的 `setConcurrency`；移除 Board「最大并发」下拉（0.5d） | 工程师 | P1 | D12 | D12 | 完成 |
| M6 | T6.2 busy 提示改「串行模式：至多 1 项占用执行」；超上限警告保留；确认 `next()`/`claimGoalResume` 容量守卫即串行闸门、pump 结构不动（`claimGoalResume` 改抛 `QueueError('CAPACITY_FULL','当前执行名额已被占用')`）（0.25d） | 工程师 | P1 | D12 | D12 | 完成 |
| M6 | T6.3 新增 `test/serial-dispatch.test.ts`（旧数据归一；一名额被占 next 返回 undefined；claimGoalResume 占名额后 CAPACITY_FULL；多 pending 仅第一个 claim；释放后第二个才 claim；另含并发点击、连接重置恢复、无并发配置入口断言）（0.5d） | 工程师 | P1 | D13 | D13 | 完成 |
| **QA P1a** | QA-2 P1a 段复测（U03/U04/U05/U13 链，含串行验收例）（0.5d） | 质量QA | P1 | D14 | D14 | 待办 |
| **M7 U06 统一处理入口** | | | | | | |
| M7 | T7.1 新增 `src/client/inspection.ts`：`inspectTask` 只读核实（会话存在/运行/Goal 匹配/各动作可用性+理由）（0.5d） | 工程师 | P1 | D15 | D15 | 待办 |
| M7 | T7.2 `coordinator.ts` 加 `inspect`/`requeueEdited`；Board「查看并处理」面板：动作命名按清单 §5 对照表、去 `window.confirm`、notice 说明下一步；interrupted 非 goalMode 标「待核实」（0.75d） | 工程师 | P1 | D16 | D16 | 待办 |
| M7 | T7.3 新增 `test/board-interactions.test.ts`（§7.6 U06 部分：重复点击、运行中拒绝处置、恢复 claim 不退化）（0.5d） | 工程师 | P1 | D17 | D17 | 待办 |
| **M8 U07 派发阶段与可证明重排** | | | | | | |
| M8 | T8.1 `models.ts` `DispatchPhase`；`queue.ts`：`claim` 记 phase、`setTaskModel`/`setSessionId` 增 phase 参同次 CAS、新增 `markModelConfirmed`/`markCommandSubmitted`/`requeueEdited`（不可证明抛 REQUEUE_EDIT_NOT_PROVEN）（0.75d） | 工程师 | P1 | D18 | D19 | 待办 |
| M8 | T8.2 `coordinator.dispatch` 失败三分类（确认未提交/会话已建命令未提交/提交未知）+ Board 分类展示；旧数据 phase=undefined 不伪造（0.5d） | 工程师 | P1 | D19 | D19 | 待办 |
| M8 | T8.3 新增 `test/dispatch-phase.test.ts`（§7.7：phase 同次 CAS 持久化；command_submitted 失败不重发）（0.5d） | 工程师 | P1 | D20 | D20 | 待办 |
| **M9 U08 工作区显式选择** | | | | | | |
| M9 | T9.1 `newForm` 默认 `workspaceId=''`；核验 uiWorkspace 公开 API 能否确认当前工作区（design §11.2 唯一外部核验项），不能确认则显式选择 + `formErrors.workspace`；保存按钮按授权态文案（0.5d） | 工程师 | P1 | D21 | D21 | 待办 |
| M9 | T9.2 `board-interactions.test.ts` 补 U08 断言（0.25d） | 工程师 | P1 | D22 | D22 | 待办 |
| **QA P1b** | QA-3 P1b 段复测（U06/U07/U08 链）（0.5d） | 质量QA | P1 | D23 | D23 | 待办 |
| **M10 U09 标题三模式（B4）** | | | | | | |
| M10 | T10.1 `QueueBoard.tsx` 单选留空/手动/AI；`settings.ts`/`title-policy.ts` 映射 none/manual→`generateTitle=false`；草稿保留；`titleMaxChars` 入高级选项；缺标题「未命名任务/未命名目标」（0.75d） | 工程师 | P2 | D24 | D24 | 待办 |
| M10 | T10.2 `board-interactions.test.ts` 补标题三模式草稿断言；验证默认请求次数不增加（0.25d） | 工程师 | P2 | D24 | D24 | 待办 |
| **M11 U10 表单顺序与局部错误** | | | | | | |
| M11 | T11.1 表单顺序：任务说明→工作区→执行方式→模型与推理→标题→高级；错误内联 formErrors；模型副作用一行提示；实现术语入 details（0.5d） | 工程师 | P2 | D25 | D25 | 待办 |
| M11 | T11.2 `board-interactions.test.ts` 补表单错误定位断言（0.25d） | 工程师 | P2 | D25 | D25 | 待办 |
| **M12 U11 Board 信息分层** | | | | | | |
| M12 | T12.1 顶部：授权态/占用拆分/待执行/未处置（点击筛异常带计数）/同步新鲜度；主操作按 blockers 切换；行内只留主操作，次操作入「更多」；顶部提示精简（0.75d） | 工程师 | P2 | D26 | D26 | 待办 |
| M12 | T12.2 `styles.ts` 新区块样式；窄窗与 100+ 记录可用性自查（不引入虚拟列表）（0.5d） | 工程师 | P2 | D27 | D27 | 待办 |
| **QA P2** | QA-4 P2 段复测（U09/U10/U11，对照 US-09/10/11 验收标准）（0.5d） | 质量QA | P2 | D28 | D28 | 待办 |
| **M13 U12 整合回归与验收（P1）** | | | | | | |
| M13 | T13.1 全量回归：既有 96 项 + 新增 8 个测试文件全绿；`npm test`/`typecheck`/`build`/CI 通过；R01–R07 探针 Red→Green 复核（0.5d） | 工程师 | P1 | D29 | D29 | 待办 |
| M13 | T13.2 `docs/qa.md`：整合验收记录 + 未执行项记录；老板实机确认清单单独列出（Desktop 安装加载、真实 Host 发现派发、中文路径多工作区、键盘/焦点/Escape/窄窗、R03 时序、串行派发实机观察）（0.5d） | 质量QA | P1 | D30 | D30 | 待办 |
| M13 | T13.3 老板实机确认（交 Chief 转老板，验收签字前完成） | Chief/老板 | P1 | D31 | — | 待办 |

## 4. 里程碑

| 里程碑 | 内容 | 完成日 |
|---|---|---|
| MS1 | P0 完成：U01+U02 复测通过（身份与可信性，R02/R05 转绿） | D5 |
| MS2 | P1a 完成：U03+U04+U05+U13 复测通过（R01/R04/R06/R07 转绿，串行生效） | D14 |
| MS3 | P1b 完成：U06+U07+U08 复测通过 | D23 |
| MS4 | P2 完成：U09+U10+U11 复测通过 | D28 |
| MS5 | U12 整合回归 + 实机验收签字 | D31+ |

## 5. 风险提示

- T9.1 的 uiWorkspace 公开 API 核验是设计标注的唯一外部不确定项：不能确认即走「显式选择」兜底，不阻塞排期。
- QueueBoard.tsx 被 U03–U11 多任务触及：严格按表内次序串行修改，避免交叉冲突。
- 边界 B1–B7 是 QA 复测硬线：任何任务不得为过测试引入自动重跑、隐式启动或删证据。
- 全串行下 QA 时段不可压缩进开发日；若 QA 发现 bug，修复与复测各占独立时段顺延，里程碑相应后移。
