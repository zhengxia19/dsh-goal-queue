# Changelog

## Unreleased

### Changed
- Restyled the sidebar footer queue button (`.gq-side`) to the ds-bot capsule style: borderless transparent pill (`border:0`, `background:none`, `border-radius:999px`, `min-height:36px`, `padding:0 14px`, 14px/20px text, `background-color` transition), grey `rgba(127,127,127,.14)` hover wash instead of `filter:brightness`, and `scale(.96)` on press. `.gq-side` was split out of the shared `.gq-root button` rules so overlay buttons are unchanged; `width:100%`, `margin:4px 0` and the `:focus-visible` outline are kept. Button text in `QueueButton.tsx` is unchanged. See [docs/ds-bot按钮风格改造_2026-10-24.md](docs/ds-bot按钮风格改造_2026-10-24.md).

## 0.3.2-preview.0 — 2026-10-20 (source preview, not Desktop accepted)

### Fixed
- Closed Pause/Claim and Session/title setup races; unknown Host configuration writes revoke dispatch authorization.
- Serialized native Goal resume and enabled explicit blocked Goal resume; verified original Session running state before retry/skip.
- Preserved multiline native Goal commands without folding internal whitespace.

### Added
- Backward-compatible TaskAttempt history and separately counted activity for reused old Sessions.
- Unresolved status summary, task filters, historical Session navigation, title cap guidance, and persistent title diagnostics.
- Deterministic race and migration tests with Red→Green GitHub Actions references.

### Not accepted yet
- Windows DPH Desktop 0.2.1-rc.2 real installation, Host schema compatibility and independent E2E review (T13).
- Cross-client/global Host locking and unattended background dispatch are out of scope.

See [implementation plan](docs/change-plan-2026-10-20/00-总调度与验收.md) and [evidence](docs/change-plan-2026-10-20/实施证据与未完成项.md).
