# DSH Goal Queue — Desktop native multi-session scheduler

**Plugin v0.3.0 source preview**, targeting DPH / DeepSeek Harness Desktop **V0.2.1-rc.2**. Real Windows Desktop installation and agent end-to-end execution are **not yet accepted**; CI only validates mocked Session behavior and static packaging.

See **[Chinese usage guide](README.zh.md)** for operating instructions, installation cautions, recovery paths and data migration.

## Capabilities

- On opening the queue overlay, refresh the official DSH Session catalog; import Host-reported running non-subagent Sessions by exact Session ID without re-submitting a prompt or a Goal.
- Observe imported Sessions and original queue Sessions, with duplicate suppression and original Session links.
- Select a maximum concurrent count **1–8**, default **1**. Imported running Sessions occupy slots. Lowering the limit does not cancel already running Sessions.
- Manually add and reorder tasks from registered Workspaces. New tasks create their own Session, using ordinary prompt or native `/goal`.
- Restart / reconnect never grants new dispatch authorization. Persisted active jobs are marked interrupted, then the overlay scan can reattach a Host-confirmed running Session without replay.
- Explicitly resume an interrupted, idle Goal in its **original Session** with native `/goal resume`. Other interrupted jobs are manually investigated and either retried in a new Session or skipped.
- Task titles can be empty. Ordinary Sessions preserve DSH's first-human-message title service and synchronize a real durable Session `title`. A pure `/goal` command is **not** a first human message and does not trigger DSH's first-prompt LLM title provider; no synthetic prompt is sent simply to name a Goal.

## Non-goals and guarantees

Concurrency applies only to observed and queue-owned Sessions, not to every Session on every connected Client. Other users' new Sessions launched after the last overlay scan will not be counted until another scan. There is no distributed Host lock. No cancellation of running Sessions is performed when pausing or reducing concurrency. The absence of a confirmed running state does not authorize resubmission.

Session idle alone is not proof of Goal completion; Goal ID plus native `complete` projection and idle are required. Ordinary work needs a witnessed running-to-idle transition. Neither proves test acceptance of the user's changes.

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
- [Desktop E2E checklist](docs/DPH_V0.2.1-rc.2_实机验收清单.md)
- [Development invariants](AGENTS.md)
