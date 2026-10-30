# dsh-nightowl

A DeepSeek Harness bundle plugin that keeps your Mac from idle-sleeping while the agent works, so long
tasks can finish. The display may still turn off; closing the lid sleeps the Mac as usual.

The package has two halves: a Host half that runs `/usr/bin/caffeinate -i` while at least one agent turn
is running, and a browser half that adds a per-session switch in the Session header and a master switch
in **Settings → General**. No model tools, no session events, no network.

## What it does and does not do

| While a turn runs | Effect |
|---|---|
| System idle sleep | prevented (`caffeinate -i`, assertion `PreventUserIdleSystemSleep`) |
| Display sleep | **allowed** — the screen may turn off, the Mac keeps working |
| Closing the lid | **allowed** — the Mac sleeps as normal |
| Mac on battery | prevented while the turn runs (plain `-i` semantics) |

The assertion exists only while the feature is on, at least one live agent session is running, and that
session is not muted. When the last turn settles the `caffeinate` child is stopped; if the app crashes in
the middle of a turn the child exits too (`-w <host pid>`), so it never outlives DeepSeek Harness.

## The two switches

- **Session header** — a compact crescent-moon icon and switch in the Session header's utilities. On means
  "keep the Mac awake while this session works". Turning it off writes a per-session mute, so the Mac can
  sleep while that session runs; the choice is remembered in the profile.
- **Settings → General → Keep awake** — the master switch. Off disables the whole feature and disables the
  Session switch. On keeps the default behaviour: every session keeps the Mac awake unless muted.

## Installing

### From GitHub (recommended)

```sh
dsh plugin --profile desktop add git+https://github.com/ihodorchenko/dsh-nightowl.git
```

Or open **Plugins → Add plugin** and paste the same spec. A git install only fetches sources, so nothing is
built on your machine: `lib/client.js` is committed and shipped ready to load. Add `#v0.1.0` to pin the
release tag.

### From a local checkout

```sh
dsh plugin --profile desktop add link:/absolute/path/to/dsh-nightowl
```

The bundle patch inserts one Host row (`nightowl`): the package's `dsh.client` declaration also serves
`lib/client.js` to the Web client, which is where the two switches come from. Removing the bundle removes
both halves:

```sh
dsh plugin --profile desktop remove dsh-nightowl
```

The bundle is macOS-only (`dsh.bundle.platforms: ["darwin"]`). Requires DeepSeek Harness `>=0.2.1-rc.5`
(`engines.dsh`).

## Releases

[v0.1.0](https://github.com/ihodorchenko/dsh-nightowl/releases/tag/v0.1.0) is the first public release;
see [CHANGELOG.md](CHANGELOG.md) for the change list. Releases are tagged on `main`; the tag matches the
git-install spec above.

## Configuration

The row's `config` overrides the schema defaults; both fields are `volatile`, so Settings edits apply live
without a restart.

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch: allow the Host to keep the Mac awake while sessions run. |
| `mutedSessions` | `{}` | Map of session id → `true` for sessions the user muted from the Session header. |

```yaml
- insert:
    - id: nightowl
      name: dsh-nightowl
      config:
        enabled: true
        mutedSessions:
          session-01234567-89ab-cdef-0123-456789abcdef: true
```

A profile override written by the Settings switch replaces the row's `config`, so keep both fields when
you edit the row by hand.

## How it works

- Host (`index.js`): `inject: ['agents']`. Seeds its running-session set from `ctx.agents.list()`, then
  follows `agent/status`, `agent/created`, and `agent/disposed`. On every change it reconciles one
  `/usr/bin/caffeinate -i -w <host pid>` child: spawn on the rising edge, `SIGTERM` on the falling edge,
  and always on plugin unload. Config references are re-read on `loader/volatile-update`. Non-macOS hosts
  and a missing `caffeinate` leave the plugin inert with one warning.
- Client (`src/client/index.tsx` → `lib/client.js`): a Cordis client plugin injecting `slots`, `locale`,
  and `configForms`. It registers the Session-header switch in `conversation.session.header.utilities` and
  the master row in `settings.general.item`; both read and write the `nightowl` settings entry through
  the shared configuration forms.

## Development

```sh
pnpm install     # devDependencies: esbuild + @deepseek-ai/schemastery
pnpm run build   # rebuilds lib/client.js and lib/client.js.map
pnpm test        # node --test "tests/**/*.mjs" — 25 host tests + 5 client-bundle tests
```

.github/workflows/test.yml` in a checkout with the `workflow` token scope reinstalls, rebuilds the
client bundle, verifies it is byte-identical to the committed artifact, and runs the tests on Node 24.

`index.js` is authored JavaScript and ships as-is; `lib/client.js` is the only built artifact. The bundle
is the DSH closure-factory format (`window.__ModuleLoader__.load({ id, factory })`), with React and
`@deepseek-ai/dsh-client-ui-primitives` resolved from the page's shared platform modules.

## Limitations

- macOS only. The plugin is inert elsewhere; Linux/Windows wake locks are not implemented.
- Muting a session keys the decision by session id. The map accumulates as you mute sessions; it is harmless
  but you can prune stale ids in `cordis.patch.yml`.
- The switch reflects configuration, not a live assertion reading. The assertion follows the running
  agents; there is no "awake now" badge.

## License

[MIT](LICENSE) © Night Owl contributors
