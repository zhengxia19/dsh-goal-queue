# AGENTS.md — DSH Goal Queue v0.3.0

此插件适配 DPH / DeepSeek Harness Desktop V0.2.1-rc.2。修改时必须保持下列高优先级约束，构建成功不能替代 Windows DPH Desktop 实机验收。

## 不可破坏的规则

1. **无自动续跑**：启动、重连、重载后不授予新任务派发权。仅用户当前 Client 中明确点击「启动队列」才授权派发。已在运行的原 Session 可以自动读取并重新观察，但不重发命令。
2. **Session ID 去重**：打开管理面板时用 DSH 官方 `sessions.refresh/list/retain` 发现正在运行的 Host Session。不能扫描外部进程，也不得导入 Subagent 作为独立主任务。发现的任务只观察，不自动创建 Prompt / Goal。
3. **并发名额正确**：`maxConcurrent` 为 1–8 的整数，默认 1；`activeIds` 持久化活动占用集合。新任务派发必须先原子 claim，再确认容量；发现的运行任务占名额。降低上限不结束既有 Session。没有跨 Client / Host 全局锁，不得宣称全局并发保证。
4. **异常不得跳过**：`interrupted/blocked/failed` 阻断新增派发，必须人工核实旧 Session 后重试、跳过或对符合条件的旧 Goal 明确执行恢复。普通模式不能在状态未知时偷偷重新发 Prompt。
5. **标题来源真实**：用户标题可以留空；仅同步 DSH Session 列表中的真实 `title`，不能把 `displayTitle` 回退标签误当 LLM 生成标题。纯 `/goal` 不会触发首人类消息标题提供方，不得为取名伪造可执行 Prompt。
6. **状态所有权与兼容**：保留旧 `activeId` 和 version=1 队列读取兼容，新增 `activeIds/maxConcurrent/source` 必须与任务同一次 CAS 保存。不要抹除历史 Session ID，不得在损坏数据时回退为空队列。Goal 的权威数据只来自 DSH 原生 Goal 投影。
7. **完成有证据**：Goal 完成须核验同 ID 的 `phase=complete` 且 Session idle；普通模式必须看到 running→idle。模型回答文字与 RPC 成功均不是完成证据，更不是代码验收。
8. **连接与写入失败停止**：Session 创建、命令提交、配置 CAS 结果未知，必须停止继续派发，显式提示人工核实。不为了消除错误重新发命令。
9. **验收顺序**：新增故障测试、旧数据迁移测试、Session 去重、并发上限、恢复及空标题测试；`npm test`、`npm run typecheck`、`npm run build`、CI 均通过。最终还须真实 Windows DPH Desktop 多工作区 E2E 证据。
10. **范围边界**：使用官方公开 DSH Client/Host 接口，禁止补丁 DPH Desktop 内置代码；仅限制插件可见队列任务，不能推断外部 Client 或模型服务总并发。

## 参考

- [中文使用说明](README.zh.md)
- [本次功能扩展复审](docs/功能扩展复审_2026-10-19.md)
- [DPH 实机验收清单](docs/DPH_V0.2.1-rc.2_实机验收清单.md)
