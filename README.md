# DSH Goal Queue

A Desktop-native, workspace-aware, manually ordered serial task queue for **DeepSeek Harness / DPH Desktop V0.2.1-rc.2**.

**Status: source preview, not released.** It uses the public Client Session/Goal interfaces and Host Cordis volatile configuration. The repository test suite and CI verify mocked lifecycle behavior, TypeScript and packaging. **Real Windows Desktop integration (T06) has not been accepted.**

For complete features, installation prerequisites, operating procedures and safety constraints, read **[简体中文说明](README.zh.md)**.

## Safety invariants

- No automatic dispatch on client restart or connection replacement, even if Host settings previously saved an enabled but idle queue.
- A manual Start click authorizes only the current connected Client generation.
- Unresolved `blocked`, `failed`, or `interrupted` tasks block the entire queue. Retry and Skip are explicit human dispositions. A Skip is *not* a successful Goal completion.
- Read failures must be shown as errors; the UI must never pretend that corrupted or unavailable settings form an empty task queue.
- Goal `complete` plus Session idle is required. An ordinary prompt requires an observed running → idle transition.
- An uncertain Host write or unknown Session command admission halts future dispatch. Pausing a queue **does not cancel** its active Session.
- This is single-client orchestration, **not** a distributed lock or a global guard against user-run Sessions.

## Development

```powershell
 git clone https://github.com/zhengxia19/dsh-goal-queue.git
 cd dsh-goal-queue
 npm install --legacy-peer-deps
 npm test
 npm run typecheck
 npm run build
```

**Do not install it in a production Desktop profile before validating the specific build.** The package is currently `private: true`, not published to npm. Desktop-specific plugin installation methods differ and must be verified against the actual runtime/Profile.

- [Windows DPH V0.2.1-rc.2 hands-on acceptance checklist](docs/DPH_V0.2.1-rc.2_实机验收清单.md)
- [Correction and review report (Chinese)](docs/修订复审_2026-10-19.md)
- [Source-of-truth development rules](AGENTS.md)
