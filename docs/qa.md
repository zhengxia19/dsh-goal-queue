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

（以下段落由后续复测追加）
