# AGENTS.md

This repository implements a DeepSeek Harness (DSH) Desktop-native serialized workspace task queue.

## Hard invariants

1. Never run more than one queue-owned task simultaneously. Do not assume unrelated user sessions are exclusively owned.
2. Never treat model text, process exit, or a successful command RPC as proof that a Goal has completed: read the authoritative `goal` projection and confirm Session idle.
3. Do not auto-run after a restart or connection loss; preserve history, require explicit manual inspection/retry.
4. Keep the active task ID and tasks in the same atomic settings payload. No second Goal source of truth.
5. User-selected workspace and task priority must be obeyed. Do not edit active tasks.
6. Ordinary mode is a single Session prompt, not a Goal. It can only finish after witnessed running-to-idle.
7. Tests should cover blocked/interrupted states and no unintended next-task execution.
8. Use supported public DSH plugin API; avoid patching Desktop internals.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build` before declaring the plugin release-ready. Integration on real DSH Desktop is mandatory for release claims.
