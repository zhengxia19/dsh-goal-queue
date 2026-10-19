# DSH Goal Queue — DeepSeek Harness 桌面版跨工作区串行任务插件

> 状态：**v0.1.0 源码预览版**。核心调度逻辑及模拟 Session/Goal 集成测试通过，**尚未在真实 DSH Desktop 应用中安装、构建或验收**。请勿将此版本当作已经过生产验证的软件。

## 功能

- 在 DSH 桌面应用的原生侧边栏增加“任务队列”入口，显示完整管理界面。
- 选择已登记 Workspace，创建、编辑、删除、上移、下移任务。
- 每项任务选择 **目标模式**（通过 `session.command('/goal ...')` 激活原生 Goal）或**普通模式**（通过 `session.prompt(...)` 执行一个常规任务）。
- 队列最大并发数固定为 **1**；每项任务创建一个独立 Session，工作目录由 Workspace 决定。
- Goal 任务只有在当前 Goal 的持久投影明确为 `complete` **且 Session 已空闲**后才进入下一项；`paused/blocked` 或错误均暂停队列。
- 普通任务必须见证本 Session 的 `running → idle`，才视为一次任务执行完成。这不是外部测试验收，不能保证代码功能正确。
- 任务、次序、状态存储在 DSH 的 Host 端 settings 命名空间（`goal-queue`），不保存第二份 Goal 状态。
- 重启/断连时对尚未确认的执行进行保守暂停，避免悄悄在另一个 Session 重做。
- 人工暂停**仅停止派发下一项**，不会自动取消当前正在运行的 Session。

## 已知限制

1. 当前仅调度**通过插件新增**的任务；不接管用户手工在其他窗口运行的 `/goal`，也无法阻止不属于本队列的 Session 并行运行。
2. 调度逻辑运行在已加载的 DSH Desktop/Web 客户端中。关闭整个应用后不会后台继续派发；重启后未完成的任务标为 `interrupted`，需要人工处理。
3. 一个任务对应一个新 Session。目标模式不会继承先前的 Session 对话；只能共享同 Workspace 下的磁盘文件。
4. 普通模式以 DSH Session 的运行结束为“完成”判据；无独立测试评估器。若没有观测到运行事件，任务会保持运行状态，不会猜测完成。
5. 多个 DSH 客户端同时连接同一 Host 的情况下，本版本没有跨多个浏览器窗口的分布式锁；不要在多个客户端同时启用队列。
6. 目标模式命令须由原生 `/goal` 插件支持，目标必须能以单行文本表达；多行输入会转为单行。若 `command()` 不匹配则拒绝执行。
7. 旧任务重排会创建新 Session，可能重复修改 Workspace 文件。确认之前的 Session 已停止并检查代码后再重排。
8. 没有提供长时间无进展自动超时；需人工查看可能停留在 `running` 的任务。

## 安装（源码构建）

需要 Desktop 使用与官方 DSH 兼容、包含 `@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-goal` 的运行版本。Node.js >= 22.19，pnpm 或 npm 以及可访问的 npm Registry。

```powershell
# 在有 GitHub 仓库后，Windows PowerShell 中运行
# git clone https://github.com/zhengxia19/dsh-goal-queue.git
# cd dsh-goal-queue
npm install
npm test
npm run typecheck
npm run build

# 使用实际存放插件的本机绝对路径替换下行的路径
# 运行 DSH Desktop 时，为其正在使用的 desktop profile 安装插件
dsh plugin --profile desktop add "D:\Source\dsh-goal-queue"
```

重启 DSH Desktop。进入原生侧边栏“任务队列”，添加任务并启用队列。

**重要：** 部分第三方 Desktop 发行版的 `Tools > Extension Dock` 只支持 npm Registry 包名，不接受 GitHub URL 或本地路径。这种发行版要使用 DSH CLI 对当前 Profile 安装，不能直接向 Extension Dock 粘贴本仓库地址。请根据本机实际 Profile 名称执行。

若 GitHub 源码安装方式被本机 pnpm 构建许可拦截，请按 DSH CLI 明确提示放行**本插件**的构建脚本，不要泛化放开所有包的构建权限。安装失败时保留原有 DSH Profile，优先不要修改官方内置组件。

## 使用步骤

1. 在 DSH 工作区管理里登记项目目录。
2. 打开“任务队列”，点击“添加任务”，选择工作区、输入标题与完整任务要求。
3. 需要持续自治工作时勾选“使用原生目标模式”；普通小任务不勾选。
4. 通过“上移/下移”调整执行顺序；只允许待执行项互相排序。
5. 点击“启动队列”。当前任务结束后自动启动下一项。遇到阻塞、报错或连接重置会暂停。
6. 通过“打开 Session”确认运行证据，必要时人工修正。手工重排异常项前先确认旧 Session 已停止。

## 数据和状态

`pending → starting → running → completed` 是正常路径；异常状态包括 `blocked / failed / interrupted`。`completed` 的含义是检测到 DSH 的执行完成信号，**不等于人工验收通过**。

持久化存储用 `goal-queue` settings 分区的单个 `queue` 字段，包含 `enabled`、`activeId`、按顺序排列的 tasks、错误文本。`activeId` 与任务状态一起提交，尽可能保持写入一致性。

## 验证

```powershell
npm test
npm run typecheck
npm run build
```

其中 `npm test` 是内存模拟测试，不需要运行模型。真实 Desktop 集成测试应至少涵盖：多 Workspace 任务依次启动、Goal `complete` 后进入下一项、`blocked` 后不进入下一项、普通任务运行→空闲、网络断连与应用重启、中文工作区路径，以及 Windows 环境中插件的添加/卸载。

## 目录结构

- `src/index.ts`：原生 Host 插件设置注册。
- `src/client/index.ts`：DSH Client 槽位贡献。
- `src/client/QueueBoard.tsx`：队列管理界面。
- `src/client/coordinator.ts`：串行调度与状态观察。
- `src/queue.ts`：可独立测试的持久化队列领域逻辑。
- `test/`：领域与模拟执行测试。

## 第三方接口参考

- DeepSeek Harness 官方源码：<https://github.com/deepseek-ai/deepseek-harness>
- Goal domain：<https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/goal/goal>
- Session Client API：<https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/api/session-controller>
- DSH Desktop 介绍：<https://github.com/ningbainb/deepseek-harness-desktop>
- 结构参考（非代码依赖）：<https://github.com/Stijnus/dsh-ds-kanban>

## 许可

MIT。插件代码独立编写，没有复制第三方看板源代码。
