# DSH Goal Queue — Desktop native multi-session scheduler

**Plugin v0.3.2-preview.0 source preview**, targeting DPH / DeepSeek Harness Desktop **V0.2.1-rc.2**. Real Windows Desktop installation and agent end-to-end execution are **not yet accepted**; CI only validates mocked Session behavior and static packaging.

See **[Chinese usage guide](README.zh.md)** for operating instructions, installation cautions, recovery paths and data migration.

## Capabilities

- On opening the queue overlay, refresh the official DSH Session catalog; import Host-reported running non-subagent Sessions by exact Session ID without re-submitting a prompt or a Goal.
- Observe imported Sessions and original queue Sessions, with duplicate suppression and original Session links.
- Select a maximum concurrent count **1–8**, default **1**. Imported running Sessions occupy slots. Lowering the limit does not cancel already running Sessions.
- Manually add and reorder tasks from registered Workspaces. New tasks create their own Session, using ordinary prompt or native `/goal`.
- Choose a model and supported reasoning effort per task from the official Host catalog. New tasks freeze the complete selection on save; explicitly following the dispatch-time Host default remains available. Titles use the same selection as task execution.
- Restart / reconnect never grants new dispatch authorization. Persisted active jobs are marked interrupted, then the overlay scan can reattach a Host-confirmed running Session without replay.
- Explicitly resume an interrupted, idle Goal in its **original Session** with native `/goal resume`. Other interrupted jobs are manually investigated and either retried in a new Session or skipped.
- Task titles can be empty. **Optional AI title generation** can be checked on the task form, with a configurable limit of **8–80 Unicode code points (24 by default)**. When checked, the Host runs a separate tool-free model request through the native DSH LLM service and persists the bounded result using the native Session Title service. It never adds a synthetic task prompt, including in pure `/goal` mode. When unchecked, ordinary Sessions retain DSH's native first-human-message title behavior; pure `/goal` still does not trigger that native provider.

## Non-goals and guarantees

Concurrency applies only to observed and queue-owned Sessions, not to every Session on every connected Client. Other users' new Sessions launched after the last overlay scan will not be counted until another scan. There is no distributed Host lock. No cancellation of running Sessions is performed when pausing or reducing concurrency. The absence of a confirmed running state does not authorize resubmission.

Session idle alone is not proof of Goal completion; Goal ID plus native `complete` projection and idle are required. Ordinary work needs a witnessed running-to-idle transition. Neither proves test acceptance of the user's changes.

Opt-in title generation consumes a separate model call through the **task's confirmed model and reasoning selection**, inheriting the Host/model output budget instead of the former fixed 128-token cap. It can add cost and delay before task dispatch. If generation fails, the task may continue with an explicit diagnostic containing the finish reason and available usage counts. It never retries automatically. Model-selection or persistence uncertainty stops dispatch. Titles are pinned using the native Session title service. The command uses `recordInput: false` to avoid extra command-log copies of the task prompt.

The official Harness `selectModel()` API also updates the Host default model asynchronously. Existing Sessions are never retargeted during discovery or recovery. Frozen queued selections do not follow later default changes. No task-output-token control is introduced; a per-response limit would not be a whole-Goal budget.

Legacy queue `version=1` configurations with single `activeId` remain readable. New writes persist `activeIds`, `maxConcurrent`, and optional task provenance without losing old Session IDs. Downgrading to the old plugin after saving with v0.3.0 is unsupported.

## Build

```powershell
git clone https://github.com/zhengxia19/dsh-goal-queue.git
cd dsh-goal-queue
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run build
```

Install through the actual DPH Desktop Profile's supported plugin mechanism; building does not install the plugin. This is currently a private source package, not an npm registry release.

- [Feature extension review](docs/功能扩展复审_2026-10-19.md)
- [AI title extension review](docs/模型标题生成_复审_2026-10-19.md)
- [Desktop E2E checklist](docs/DPH_V0.2.1-rc.2_实机验收清单.md)
- [Development invariants](AGENTS.md)

## v0.3.2-preview.0 changes (not Windows-accepted)

- Fix Pause/Claim, post-create and optional-title races. Unknown Host persistence revokes Client dispatch authorization; a successful refresh never re-arms the queue.
- Serialize explicit old-Goal resume; permit resumable blocked Goals in the original Session; reject retry/skip when the original Host Session is still active.
- Preserve multiline Goal objectives using the official pinned command grammar.
- Keep per-task `attempts` (legacy version-1 compatible); track reuse of completed Sessions via separate `sessionActivity` without rewriting completed history.
- Show unresolved counts, title-input limits, persistent `titleError`, task filters and historical Session navigation.
- This remains **Client-scoped concurrency**, not a global Host lock. Windows Desktop 0.2.1-rc.2 installation/behavior and independent acceptance remain pending. Do not downgrade after new snapshots have been saved without a backup.

[Ordered tasks and Red→Green evidence](docs/change-plan-2026-10-20/00-总调度与验收.md).
