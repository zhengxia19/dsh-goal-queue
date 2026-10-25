# DSH 任务队列插件 — DPH Desktop V0.2.1-rc.2

> 插件版本：**0.3.2-preview.0 源码预览版**。当前基于 DSH 官方公开 Client Session API。GitHub CI 的构建、类型检查与模拟测试不代替 Windows DPH Desktop 端到端验收。请在隔离的 Desktop Profile / 测试工作区先行试用。

## 功能

- 打开「任务队列」面板时主动调用 `sessions.refresh()`，读取当前 Host 会话目录，将**已在运行且非 Subagent** 的 Session 按 Session ID 去重纳入任务列表。
- 导入的原 Session **只关联、观察，不重新提交 prompt，也不新建 Goal**；可以打开原 Session 检查进度。列表刷新可重复执行，但不会产生同一 Session 的多个任务。
- **串行派发**：并发上限固定为 **1**，同一时刻至多一个队列任务或已纳入的运行 Session 占用执行名额。名额被占时只禁止继续派发，**不终止**已运行的 Session。
- 仍可添加、编辑、删除待执行项，在 DSH 已登记工作区间选择、上移与下移排序。新建任务每项独立创建 Session，并使用普通提示词或原生 `/goal`。
- 添加/编辑任务可选择执行模型和推理强度，选项来自 Host 官方模型目录。默认保存时固定配置；也可明确选择派发时跟随 Host 默认。标题生成与任务使用相同的模型和推理强度。
- 队列**启动／重连后处于暂停状态**。已持久化的活动任务不会自动重新发送，而是标记为 `interrupted` 等待核实；打开面板扫描时，只有 Host 确认**相同 Session ID 仍在运行**的项目才重新关联，仅恢复观察。
- 用户可在旧 Goal 已停止且具有可恢复的持久目标时，明确点击 **「继续原目标」**，在**原 Session** 执行 `/goal resume`；普通任务不作不确定的自动续发，可以人工重排到新 Session。
- **标题三模式**：添加/编辑任务的「标题」区提供 **留空 / 手动填写 / AI 生成** 三选择，默认留空、不增加模型请求。AI 生成在任务实际派发前发起一次独立、无工具的标题模型请求（与任务同模型、同推理强度），长度上限 **8–80 个 Unicode 字符（默认 24）**在「高级选项」中设置；切换模式会保留手动草稿。生成结果通过 DSH 原生 `sessionTitle.rename()` 保存和展示，缺真实标题的任务显示「未命名任务 / 未命名目标」。

## 重要边界

**并发数不是系统级总锁。** 本插件只约束自己掌握并已纳入的任务。应用或其他客户端在上次扫描后新启动的独立 Session，可能暂时不计入名额；用户可点击「刷新运行任务」。这也不改变 Strata 后端并发能力，多个 DPH 客户端同时连接 Host 尚无分布式锁。

**读取正在运行的任务并不等于自动恢复历史命令。** 自动扫描只导入 Host 当前报告为 `running=true` 的 DSH Session；不扫描任意操作系统进程，不自动激活仍处于 idle 的 Goal，也不重发普通任务指令。Goal `phase=complete` 且 Session 空闲才被标为完成；普通模式要求证实原 Session 已观察到 running → idle；这个「完成」不等于代码测试或人工验收通过。

**暂停调度与停止 Agent 是两回事。** 「暂停队列」不取消已经运行的 Session；重新打开面板、重连都不会擅自停止原任务。旧普通任务状态未知时应核对原会话，再选择重试或跳过。

## 如何操作

1. Windows 上打开 DPH Desktop，并确保其 Session 与工作区列表已经同步。
2. 打开侧边栏「任务队列」，自动扫描当前运行的 Session，面板顶部有「刷新运行任务」按钮。
3. 队列为串行模式：并发上限固定为 1，无需设置。
4. 添加新任务：表单按 **任务说明 → 工作区 → 执行方式 → 模型与推理 → 标题 → 高级选项** 排列，保存被禁用或失败时会在对应字段与表单内说明原因。**标题默认留空**，任务说明不能为空。
5. 首次启动或断连重启后，不会自动续发。确认已纳入旧会话的状态，处理 `interrupted`、`blocked`、`failed` 项后，手工点击「启动队列」。
6. 对仍正在运行的旧任务，只观察它完成；对需要续行、且已空闲的旧 Goal，可点击「继续原目标」，不会重新创建 Session。
7. 如果准备重试或人工跳过旧任务，请先在 DPH 中核实原 Session 已停止，防止多次修改相同工作区。

### 旧版队列迁移

0.2.x 的持久队列数据使用 `version=1`、`activeId`。0.3.2-preview.0 **仍接受旧版本**，在读取时派生 `activeIds` 与默认并发数 1，保留旧任务 ID、顺序、Session ID 和执行历史。首次保存会一起写入新的 `activeIds`、`maxConcurrent`、`source`；可选的 `generateTitle`/`titleMaxChars` 没有的旧任务默认为不启用辅助标题。解析失败必须报错，不可覆盖成空队列。新版本执行并保存之后，不应直接降级到旧 0.2.x 插件。

### 模型标题生成：选项、成本与边界

标题默认**留空**。选择「AI 生成」后，已填写的手动标题保留为草稿，切回手动填写可继续使用；AI 长度在「高级选项」中填写 8–80，默认 24。输入长度超限时既在表单层验证，也在 Host 端对模型输出按 Unicode 码点强制截断，不会因为模型忽视长度指令而生成超长标题。模型标题仅从任务说明归纳，不需要用户自定义模型系统提示词。

实际运行时，Host 可选注册 `/goal-queue-title` 命令。该命令属于 DSH 人类命令平面，**不会追加普通用户任务消息，也不会调度 Goal Round**；处理器使用任务已固定且经原生 Session 模型投影确认的 **provider/model/reasoningEffort** 调用 `llm.prepareCall()` 进行独立、无工具的辅助请求，再用 `sessionTitle.rename()` 保存标题。输出预算沿用 Host/模型配置，取消原先固定 128 tokens 的限制。只在用户选择「AI 生成」时产生一次额外模型请求，可能增加 Token 费用、占用模型算力并延后任务开始；**并不占用插件的新增 Session 名额**。

若当前 Host 未加载 `commands`、`llm`、`sessionTitle` 等服务，或模型调用出错，标题生成会失败，插件记录结束状态、可用的错误码、耗时及供应方实际返回的输出/推理 token 数；未返回的计数标为“未知”，不推算。不会因此再次发送任务 Prompt，不以模型标题是否生成判断任务完成。模型设置或持久化结果未知时停止派发。

### 任务模型及 Token 策略

模型目录读取失败时禁用保存；更换模型后必须选择该模型支持的推理强度。不支持推理的模型禁用推理控件。已固定的模型消失或档位不受支持时停止派发，不静默换模型。旧任务没有 `modelSelection` 时，派发前解析 Host 当前默认配置并随任务 CAS 保存；已有或恢复的 Session 保持原配置。

**Harness V0.2.1-rc.2 的原生 `selectModel()` 同时异步更新 Host 默认模型。** 插件遵循该公开接口，不通过修改默认值后再恢复的方式模拟 Session 隔离。已排队的固定配置任务不受后续默认值变化影响；选择“派发时使用 Host 默认”的任务会受影响。

标题字符上限控制最终显示长度，与 token 预算不同。标题请求沿用任务推理强度，高推理档位可能增加耗时和费用；不自动降档、不自动重试。单独的固定 128-token 上限可能在得到标题前耗尽，故移除。暂不新增标题或执行任务的 token 控件：执行响应预算沿用 Host/模型配置，它也不表示整个 Goal 的总预算。独立标题预算如需引入，应先对实际模型和推理档位采样验证。

生成标题的题词作为命令输入发送到本机 DSH Host 进行辅助推理；命令注册时设为 `recordInput: false`，避免在 `command/run` 再存一份完整题词。任务正文仍按原有队列持久化策略保存。

### 原生自动命名的准确行为

官方 `@deepseek-ai/dsh-session-title` 从符合条件的用户消息生成回退标题；如果 Desktop 组合了 `@deepseek-ai/dsh-session-title-first-prompt-llm`，才可能由模型异步生成标题。模型标题不是所有部署都保证存在；插件只同步 DSH 实际提供的非空 `title`，不会把 `displayTitle` 的工作区名称当作模型生成结果。

Goal 通过独立的 `/goal` 命令执行，续行消息来源为 `kind: 'goal'`，不满足默认首消息标题服务仅接受 `kind: 'user'` 的条件。如果需要纯 Goal 的模型标题，**明确选择「AI 生成」**即可使用上述独立模型辅助请求；留空或手动的纯 Goal 仍不触发官方首消息命名器。新版同样不会向 Goal Session 伪造普通用户消息。

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
- [模型标题生成实现](src/title-command.ts)
- [标题输入和字符数验证](src/title-policy.ts)
- [模型标题专项测试](test/title-generation.test.ts)
- [任务模型及标题修复记录](docs/任务模型与标题修复_2026-10-19.md)
- [功能扩展复审及发布边界](docs/功能扩展复审_2026-10-19.md)
- [模型标题功能复审](docs/模型标题生成_复审_2026-10-19.md)
- [实机验收清单](docs/DPH_V0.2.1-rc.2_实机验收清单.md)

此项目仍未在 npm 发布（`private: true`），也尚未通过真实 Windows DPH Desktop V0.2.1-rc.2 的安装和运行验收，不能宣称正式发布。

## v0.3.2-preview.0｜执行安全与历史追溯（2026-10-20）

本变更在隔离分支完成源码与 GitHub Actions 自动化验证，**没有完成 Windows DPH Desktop 实机验收**；请勿据此宣称生产环境稳定。

- **暂停与故障关闭**：对 claim、Session 创建、标题请求三个阶段收紧一次性人工派发授权；未创建 Session 的占位能安全撤销，已创建 Session 但未提交指令时保留 Session ID 并停止，Host 配置写入/读取失信后必须再次手动启动。
- **旧 Goal 恢复**：对同一 Goal 一次只允许一个恢复请求，增加 blocked/paused 恢复入口；重试或跳过之前读取原 Session 当前运行状态，原 Session 在运行时拒绝处置；无 Session ID 时禁止盲目重试。
- **多行目标**：原生 `/goal` 不再压缩换行与缩进。依据 DSH `dsh-v0.2.1-rc.2` 官方命令解析源码确认该版本保留命令输入内部空白。
- **历史与占用**：任务新增可选的 `attempts` 历史记录；旧 `version=1` 可兼容读取并按需生成首次记录。重试不再丢失旧 Session ID。另以 `sessionActivity` 独立统计重新运行的旧 Session，不把已经完成的任务重新标为运行中。仅统计本 Client 已发现的活动。
- **管理界面**：侧边栏显示待处理异常数；任务可以按运行/待执行、异常、历史、全部筛选；历史记录可查看原 Session。可选 AI 标题题词超过 8000 UTF-16 代码单元时表单内提示「任务内容过长，无法再生成标题；可关闭 AI 标题后保存」，独立的 `titleError` 保留标题失败原因。
- **恢复限制**：如果旧 Session 无法访问，队列不会猜测其安全停止；跨 Client 仍不提供全局锁。UI 关闭不会暂停已获授权的队列；退出 Client 后不负责后台派发。队列启用后新增任务可能立即执行，本版不擅自变更这一既有语义。
- **升级与回退**：保留 `version=1`、`activeId` 兼容输入，新增字段包括 `attempts`、`sessionActivity`、`titleError`。首次新版本保存前备份 Desktop Profile；保存新结构后不保证旧插件可以直接安全降级。任何格式损坏一律拒绝清空重建。

实施任务顺序、自动化失败/修复对照和未验收事项见 [变更总调度](docs/change-plan-2026-10-20/00-总调度与验收.md)及[实施证据](docs/change-plan-2026-10-20/实施证据与未完成项.md)。
