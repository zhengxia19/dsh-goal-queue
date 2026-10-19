# DSH Goal Queue — DPH / DSH Desktop 跨工作区串行任务队列

> **当前状态：v0.2.1 源码预览版**，目标 DPH / DeepSeek Harness Desktop **V0.2.1-rc.2**。自动化与 GitHub CI 只能验证模拟执行、类型及构建；**真实 Windows Desktop 安装、原生界面和模型端到端测试仍待 T06 验收，不能宣称正式发布。**

## 功能及范围

- 在客户端侧边栏增加 **任务队列**，支持添加、编辑、删除、手工上移／下移、选择已登记 Workspace。
- 每项任务独立选择原生 Goal `/goal` 或普通 Prompt；**目标模式默认勾选**。
- 队列内部同时最多派发 1 项，每项新建独立 Session；它**不接管其他客户端、其他队列或手工打开的 Session**。
- Goal 只有在对应 `goal.id` 匹配、持久 Goal 投影 `phase=complete` 且 Session 空闲时才完成；Goal `blocked/paused` 会暂停队列。
- 普通模式必须观测 Session 从 `running` 到空闲才标记完成。**执行结束不是代码验收通过**。
- 队列数据存储在 DSH Host 对应 Cordis 插件的 `queue` volatile 配置，使用修订号 CAS 写入；不会存储第二份 Goal 数据。
- 关闭管理面板不停止调度；点击**暂停队列只停止后续派发，不取消当前 Session**。

## v0.2.1 安全修订（T01–T05）

1. **重启/重连不自动续跑**：Client 启动及连接切换时，运行期启动授权一律清除。若 Host 曾保存 `enabled=true`，会保守写回 `enabled=false`；即使 `activeId=null` 且仍有待执行项，也不会自动创建 Session。只有当前连接中用户再次点击“启动队列”才可派发。
2. **异常任务阻断**：只要存在 `interrupted`、`blocked` 或 `failed` 任务，后续所有 `pending` 任务均不得启动。用户必须先查看旧 Session，再对异常项明确选择**重新排队**或**人工跳过**。
3. **不隐瞒配置故障**：加载中、读取错误、正常读取分别展示；故障期间不显示误导性的“空队列”，也不允许编辑或启动。支持“重试读取配置”。
4. **不确定执行结果时安全停止**：Session 已创建但记录失败、命令可能已提交但响应不确定、配置写入结果未知等情形全部禁止继续派发。若无法可靠保存失败状态，进入本机隔离错误状态，要求人工检查旧 Session 并重新读取 Host 配置。
5. **故障注入回归**：涵盖重启/重连无活动项、阻塞项、Host 配置不可用、部分提交及响应丢失、快速点击“启动/暂停”竞态等；完整测试请运行 `npm test`。

### 任务状态

`pending → starting → running → completed` 为正常路径。`blocked`、`failed`、`interrupted` 是未决异常，**将阻断整个队列**。人工处理后可转成 `pending`（重新排队，创建新 Session）或 `skipped`（人工确认跳过，保留记录及旧 Session ID）。`skipped` 不代表任务执行成功。

### 正确的恢复操作

1. 启动或连接恢复后，打开侧边栏“任务队列”。队列默认暂停；检查任务记录，特别是 `interrupted` 项的旧 Session。
2. **确认旧 Session 是否仍在修改代码或执行工具**，必要时在 DSH 中由用户手工停止旧 Session；插件不会替你取消旧工作。
3. 根据实际结果，逐项点击“重新排队”或“人工跳过”。注意：重新排队创建**新 Session**，可能重复修改工作区文件；旧 Session 不会继承到新任务。
4. 待无未决异常后，明确点击“启动队列”。重新启动授权仅在**本次客户端连接**有效。
5. 不允许多窗口共享本队列同时执行；尚无跨客户端分布式锁。也无法约束用户另外手动启动的 Session。

## 源码构建（Windows PowerShell）

需要 Node.js >=22.19（推荐 Node.js 24）、npm、Git，以及 npm Registry 可达。`package.json` 固定主要 DSH API 构建依赖 `0.2.1-rc.2`；`npm install --legacy-peer-deps` 用来处理该预发布版的 peer 依赖约束，**不能说明运行时其他版本兼容**。

```powershell
 git clone https://github.com/zhengxia19/dsh-goal-queue.git
 cd dsh-goal-queue
 npm install --legacy-peer-deps
 npm test
 npm run typecheck
 npm run build
```

生成 `lib/` 后仍需通过**实际 Desktop Profile 支持的插件安装入口**加载。建议先执行 `dsh plugin --help` 核实命令，再确认 CLI 操作的 Profile 正是桌面应用正在使用的 Profile。部分第三方 Desktop 的 Extension Dock 只接受 npm Registry 包名，**不接受 GitHub URL 或本地路径**；当前包标记 `private: true`，尚未在 npm 发布，不能声称可直接通过市场安装。不要直接修改桌面程序内置包或覆盖用户既有插件环境。

## 使用方式

在 DSH 里登记测试工作区 → 打开侧边栏“任务队列” → 添加任务（标题、工作区、目标模式、说明）→ 上移/下移 → **点击启动队列**。每项任务有“打开 Session”可检查进度及证据。关闭面板或按 Esc 不会关闭当前会话，也不会停止已经授权的本次队列。

## 发布与验收边界

| 门槛 | 标准 |
|---|---|
| T01–T05 | 回归测试、TypeScript、构建和 GitHub CI 全通过；故障注入证明无自动重发 |
| T06 | 在真实 **DPH Desktop V0.2.1-rc.2 / Windows** 环境安装、运行多工作区、Goal、断连、错误、卸载的端到端验证 |
| 正式发布 | **必须 T06 独立验收通过**，不能以 CI 成功替代 |

完整原子验收步骤见 [DPH 实机验收清单](docs/DPH_V0.2.1-rc.2_实机验收清单.md)；修订记录与独立复审见 [2026-10-19 修订复审报告](docs/修订复审_2026-10-19.md)。

## 主要文件

- `src/queue.ts`：队列模型、异常阻断和人工跳过。
- `src/client/coordinator.ts`：启动授权、单任务调度、Goal 判定和故障隔离。
- `src/client/settings.ts`：Host 配置读取和 CAS 更新。
- `src/client/QueueBoard.tsx`：任务编辑、状态、恢复及异常界面。
- `test/`：原有模拟测试和新增故障注入回归。
- `AGENTS.md`：实施不可破坏的核心约束。

许可：MIT。参考 [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)，插件自身未修改官方 Desktop 内部代码。
