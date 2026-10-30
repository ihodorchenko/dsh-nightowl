# Changelog

All notable changes to this package are recorded here.

## 0.1.0 — 2026-10-30

First public release.

### Added

- Host half (`index.js`): tracks live agent sessions through `ctx.agents`, `agent/status`, `agent/created`,
  and `agent/disposed`, and reconciles one `/usr/bin/caffeinate -i -w <host pid>` child while the feature
  is enabled and at least one unmuted session is running. Releases on the falling edge and on plugin unload;
  `-w` keeps the child from outliving the app if it crashes.
- Browser half (`lib/client.js`): per-session switch in the Session header (`conversation.session.header.utilities`)
  and a master switch in **Settings → General** (`settings.general.item`), both over the `nightowl`
  configuration form.
- `enabled` and `mutedSessions` volatile configuration fields; Settings writes apply live through the
  Loader's volatile configuration path.
- en/ru dictionaries and plugin-manager locale metadata; MIT license.
- 25 host unit tests and 5 client-bundle tests (`pnpm test`), reproducible client build
  (`pnpm run build`).

### Requirements

- macOS (the bundle declares `platforms: ["darwin"]`).
- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0`.
