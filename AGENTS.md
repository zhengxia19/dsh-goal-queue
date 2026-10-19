# AGENTS.md — DSH Goal Queue

此插件为 DPH / DeepSeek Harness Desktop V0.2.1-rc.2 的单客户端跨工作区串行调度器。任何修改必须先遵守以下高优先级约束；不可以构建成功代替真实 Desktop 验收。

## 不可破坏的规则

1. **默认无启动授权**：每次进程启动、Client 重载和 Host 连接重置后，必须清除进程内派发授权；哪怕 Host 保存 `enabled=true`、`activeId=null`、`pending>0`，也禁止自动派发。只有当前连接中的用户明确“启动队列”才能授权。人工暂停不取消已运行的 Session。
2. **单项串行**：本队列同时最多一项。该保证不涵盖其他客户端或用户自行运行的 Session；绝不能宣称拥有全局锁。
3. **不确定则停止**：Host CAS 冲突、写入回包丢失、命令提交状态未知、Session 创建后记账失败、配置加载异常时，禁止派发下一项并保留可检查的异常证据。严禁回退到 `EMPTY_QUEUE` 继续工作。
4. **异常不能跳过**：存在 `interrupted`、`blocked`、`failed` 项时不允许启动后续 `pending`。必须人工检查旧 Session 后选择重试（创建新 Session）或人工跳过（`skipped`，不代表成功），不能直接删掉未决异常任务。
5. **Goal 证据**：只接受对应 Goal ID 的原生投影 `complete` + Session 空闲。模型文字、RPC 成功或单纯空闲均不代表 Goal 完成。普通任务必须亲眼观察到 Session running→idle。
6. **状态所有权**：tasks 与 activeId 必须作为一份队列记录同次 CAS 提交；不要建立第二套 Goal 状态库。执行任务不能编辑身份。保留 Workspace 和历史 Session ID。
7. **只用受支持接口**：禁止补丁官方 Desktop 内部文件，禁止将未经实测的安装/兼容性描述成已验收。
8. **先测试后闭环**：故障回归需覆盖重启空闲启用、断连、异常阻断、配置加载/写入失败、请求已提交但响应丢失。`npm test`、`npm run typecheck`、`npm run build`、CI 均通过后，还须完成独立的 T06 实机证据才能宣布可发布。

## 审查资料

- [中文 README](README.zh.md)
- [独立复审与修订记录](docs/修订复审_2026-10-19.md)
- [DPH 实机验收清单（T06）](docs/DPH_V0.2.1-rc.2_实机验收清单.md)
