# DSH 任务队列插件 — DPH Desktop V0.2.1-rc.2

> 插件版本：**0.3.0 源码预览版**。当前基于 DSH 官方公开 Client Session API。GitHub CI 的构建、类型检查与模拟测试不代替 Windows DPH Desktop 端到端验收。请在隔离的 Desktop Profile / 测试工作区先行试用。

## 功能

- 打开「任务队列」面板时主动调用 `sessions.refresh()`，读取当前 Host 会话目录，将**已在运行且非 Subagent** 的 Session 按 Session ID 去重纳入任务列表。
- 导入的原 Session **只关联、观察，不重新提交 prompt，也不新建 Goal**；可以打开原 Session 检查进度。列表刷新可重复执行，但不会产生同一 Session 的多个任务。
- 支持队列并发数 **1–8**，默认 **1**。并发名额包括新派发任务和已纳入的原有运行 Session。降低并发数**不终止**正在运行的 Session；超过上限时只禁止继续派发。
- 仍可添加、编辑、删除待执行项，在 DSH 已登记工作区间选择、上移与下移排序。新建任务每项独立创建 Session，并使用普通提示词或原生 `/goal`。
- 队列**启动／重连后处于暂停状态**。已持久化的活动任务不会自动重新发送，而是标记为 `interrupted` 等待核实；打开面板扫描时，只有 Host 确认**相同 Session ID 仍在运行**的项目才重新关联，仅恢复观察。
- 用户可在旧 Goal 已停止且具有可恢复的持久目标时，明确点击 **「激活旧 Goal」**，在**原 Session** 执行 `/goal resume`；普通任务不作不确定的自动续发，可以人工重排到新 Session。
- 标题字段可以留空。普通模式保留 DSH 原生会话命名路径，不人工注入额外 prompt 或重命名；当 DSH Session 列表提供真正的 `title` 时同步显示。**纯 `/goal` 命令不会触发 DSH 的首条用户消息标题生成器**，因此纯 Goal 留空时暂显示「未命名目标任务」，不会声称已有模型生成标题。

## 重要边界

**并发数不是系统级总锁。** 本插件只约束自己掌握并已纳入的任务。应用或其他客户端在上次扫描后新启动的独立 Session，可能暂时不计入名额；用户可点击「刷新运行任务」。这也不改变 Strata 后端并发能力，多个 DPH 客户端同时连接 Host 尚无分布式锁。

**读取正在运行的任务并不等于自动恢复历史命令。** 自动扫描只导入 Host 当前报告为 `running=true` 的 DSH Session；不扫描任意操作系统进程，不自动激活仍处于 idle 的 Goal，也不重发普通任务指令。Goal `phase=complete` 且 Session 空闲才被标为完成；普通模式要求证实原 Session 已观察到 running → idle；这个「完成」不等于代码测试或人工验收通过。

**暂停调度与停止 Agent 是两回事。** 「暂停队列」不取消已经运行的 Session；重新打开面板、重连、修改并发数都不会擅自停止原任务。旧普通任务状态未知时应核对原会话，再选择重试或跳过。

## 如何操作

1. Windows 上打开 DPH Desktop，并确保其 Session 与工作区列表已经同步。
2. 打开侧边栏「任务队列」，自动扫描当前运行的 Session，面板顶部有「刷新运行任务」按钮。
3. 在「最大并发」下拉框选择 1–8；建议首次使用仍保留默认 1。
4. 添加新任务，选择工作区与普通/目标模式。**标题可以留空**，任务说明不能为空。
5. 首次启动或断连重启后，不会自动续发。确认已纳入旧会话的状态，处理 `interrupted`、`blocked`、`failed` 项后，手工点击「启动队列」。
6. 对仍正在运行的旧任务，只观察它完成；对需要续行、且已空闲的旧 Goal，可点击「激活旧 Goal」，不会重新创建 Session。
7. 如果准备重试或人工跳过旧任务，请先在 DPH 中核实原 Session 已停止，防止多次修改相同工作区。

### 旧版队列迁移

0.2.x 的持久队列数据使用 `version=1`、`activeId`。0.3.0 **仍接受旧版本**，在读取时派生 `activeIds` 与默认并发数 1，保留旧任务 ID、顺序、Session ID 和执行历史。首次保存会一起写入新的 `activeIds`、`maxConcurrent`、`source`。解析失败必须报错，不可覆盖成空队列。新版本执行并保存之后，不应直接降级到旧 0.2.x 插件。

### 原生自动命名的准确行为

官方 `@deepseek-ai/dsh-session-title` 从符合条件的用户消息生成回退标题；如果 Desktop 组合了 `@deepseek-ai/dsh-session-title-first-prompt-llm`，才可能由模型异步生成标题。模型标题不是所有部署都保证存在；插件只同步 DSH 实际提供的非空 `title`，不会把 `displayTitle` 的工作区名称当作模型生成结果。

Goal 通过独立的 `/goal` 命令执行，续行消息来源为 `kind: 'goal'`，不满足默认首消息标题服务仅接受 `kind: 'user'` 的条件。若将来需要纯 Goal 的模型标题，应另行实现受控的辅助标题推理接口与额外请求配额，并通过实际端到端测试；当前版本不在 Goal Session 中伪造普通用户消息。

## 开发与构建

需要 Node.js >= 22.19（推荐 24）、npm 和 Git。依赖针对 DSH `0.2.1-rc.2`；安装方式需与实际 DPH Desktop Profile 对齐。

```powershell
git clone https://github.com/zhengxia19/dsh-goal-queue.git
cd dsh-goal-queue
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run build
```

`npm test` 使用模拟 Host/Session，测试并发、数据兼容、自动发现、原 Session 恢复及异常停止。生产 Desktop Profile 的插件安装不能以源码构建成功代替。

## 关键源码

- [队列状态与旧数据迁移](src/queue.ts)
- [多 Session 调度、发现与恢复](src/client/coordinator.ts)
- [原生 Session/Goal 完成判据](src/client/observe-task.ts)
- [配置 CAS 读写](src/client/settings.ts)
- [管理面板](src/client/QueueBoard.tsx)
- [新增功能测试](test/discovery-concurrency.test.ts)
- [功能扩展复审及发布边界](docs/功能扩展复审_2026-10-19.md)
- [实机验收清单](docs/DPH_V0.2.1-rc.2_实机验收清单.md)

此项目暂未在 npm 发布（`private: true`），也尚未通过真实 Windows DPH Desktop V0.2.1-rc.2 的安装和运行验收，不能宣称正式发布。
