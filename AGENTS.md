# AGENTS.md — DSH Goal Queue v0.3.2-preview.0

此插件适配 DPH / DeepSeek Harness Desktop V0.2.1-rc.2。修改时必须保持下列高优先级约束，构建成功不能替代 Windows DPH Desktop 实机验收。

## 不可破坏的规则

1. **无自动续跑**：启动、重连、重载后不授予新任务派发权。仅用户当前 Client 中明确点击「启动队列」才授权派发。已在运行的原 Session 可以自动读取并重新观察，但不重发命令。
2. **Session ID 去重**：打开管理面板时用 DSH 官方 `sessions.refresh/list/retain` 发现正在运行的 Host Session。不能扫描外部进程，也不得导入 Subagent 作为独立主任务。发现的任务只观察，不自动创建 Prompt / Goal。
3. **并发名额正确**：`maxConcurrent` 为 1–8 的整数，默认 1；`activeIds` 持久化活动占用集合。新任务派发必须先原子 claim，再确认容量；发现的运行任务占名额。降低上限不结束既有 Session。没有跨 Client / Host 全局锁，不得宣称全局并发保证。
4. **异常不得跳过**：`interrupted/blocked/failed` 阻断新增派发，必须人工核实旧 Session 后重试、跳过或对符合条件的旧 Goal 明确执行恢复。普通模式不能在状态未知时偷偷重新发 Prompt。
5. **标题来源真实，模型请求严格隔离**：标题可以留空。可选 `generateTitle=true` 时采用任务已固定并经原生 Session 模型投影确认的 provider/model/reasoningEffort，**无工具、无 task Session ID 的独立一次性 LLM 请求**，通过 `sessionTitle.rename()` 保存，不向 Agent inbox 追加 Prompt。`titleMaxChars` 必须是 8–80 的整数（默认 24），Host 截断模型输出。标题请求沿用 Host/模型输出预算，不固定为 128 tokens，不自动重试或降档。纯 `/goal` 不会触发原生首消息命名，未勾选时不能假称有 AI 标题；不能将 `displayTitle` 回退标签当作真正标题。标题生成失败不得重发任务、不得在回退中运行额外 Agent 工作。
6. **状态所有权与兼容**：保留旧 `activeId` 和 version=1 队列读取兼容，新增 `activeIds/maxConcurrent/source` 必须与任务同一次 CAS 保存。不要抹除历史 Session ID，不得在损坏数据时回退为空队列。Goal 的权威数据只来自 DSH 原生 Goal 投影。
7. **完成有证据**：Goal 完成须核验同 ID 的 `phase=complete` 且 Session idle；普通模式必须看到 running→idle。模型回答文字与 RPC 成功均不是完成证据，更不是代码验收。
8. **连接与写入失败停止**：Session 创建、命令提交、配置 CAS 结果未知，必须停止继续派发，显式提示人工核实。不为了消除错误重新发命令。
9. **验收顺序**：新增故障测试、旧数据迁移测试、Session 去重、并发上限、恢复及空标题测试；`npm test`、`npm run typecheck`、`npm run build`、CI 均通过。最终还须真实 Windows DPH Desktop 多工作区 E2E 证据。
10. **范围边界**：使用官方公开 DSH Client/Host 接口，禁止补丁 DPH Desktop 内置代码；仅限制插件可见队列任务，不能推断外部 Client 或模型服务总并发。
11. **任务模型配置**：新增/编辑任务从官方 `modelCatalog()` 选择模型和支持的推理档位，默认保存完整快照；明确选择跟随默认或旧数据缺失时，派发前解析并 CAS 固定。通过官方 `selectModel()` 设置后核验返回值与同一 Session 的 `modelSelection.next`，结果未知或不匹配禁止提交任务。原生接口同时更新 Host 默认模型，必须如实提示。发现/恢复已有 Session 不自动改模型。

## 参考

- [中文使用说明](README.zh.md)
- [本次功能扩展复审](docs/功能扩展复审_2026-10-19.md)
- [模型标题生成复审](docs/模型标题生成_复审_2026-10-19.md)
- [任务模型与标题修复及验收状态](docs/任务模型与标题修复_2026-10-19.md)
- [DPH 实机验收清单](docs/DPH_V0.2.1-rc.2_实机验收清单.md)

## v0.3.2-preview.0 调度与历史约束（2026-10-20）

11. 任何 Host settings 的 loading/error/CAS 失信必须撤销 Client 的执行授权；读取恢复不代表再次启动授权。界面必须展示授权真实值，不只看持久 `queue.enabled`。
12. claim 释放只允许尚未创建 Session 的情况；已创建 Session 必须留 ID 和人工核实状态。模型标题请求不能在用户暂停后触发新的目标命令。
13. 同一个 Goal 恢复操作必须由持久原子 claim 获得一次执行权；`blocked` 与 `interrupted` 走同一互斥路径，不能因为第二次恢复失败而破坏第一次操作。
14. 重试/跳过前查询原 Session 当前运行态，连接代际变化与 Host 状态不确定时失败关闭。缺 Session ID 不得自动重派。
15. `attempts` 保存历史执行证据；`sessionActivity` 是当前重新运行的历史 Session 的独立占位，去重按原生 Session ID。旧 `version=1`、`activeId`、可选标题字段继续安全读取。
16. `/goal` 的目标内容除首尾 `trim()` 外不得在插件里折叠空白；与 DSH `dsh-v0.2.1-rc.2` 的命令原始输入契约一致。完成仍验证 Goal ID+complete+idle。
17. AI 标题失败写入 `titleError`，不能改写或伪造任务完成状态；标题长输入只能提示或禁用辅助标题，不能截断原始任务。
18. T01–T12 的 Mock/CI 成功不能代替 T13 Windows E2E、真正 Host schema、安装卸载及独立验收。正式发布前必须复核 [完整变更计划](docs/change-plan-2026-10-20/00-总调度与验收.md)。
