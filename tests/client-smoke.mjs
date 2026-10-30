/**
 * Night Owl browser-half smoke check.
 *
 * `lib/client.js` is a DSH Client closure-factory artifact: evaluating the file
 * submits `{ id, factory }` to `window.__ModuleLoader__`, and the factory gets
 * the page's module-table `require` and returns the Cordis plugin face. This
 * check evaluates the built factory with stubbed platform modules (`react`,
 * `react/jsx-runtime`, the shared UI primitives) plus a fake client context,
 * then asserts:
 *
 *   1. the artifact registers under the package id and closes in the wrapper
 *      shape the loader expects (`exports.apply`/`exports.inject` + return);
 *   2. `apply` registers en+ru dictionaries, asks for exactly one shared
 *      ConfigForm (`nightowl`), and performs exactly two slot registrations
 *      (session-header switch + Settings → General row);
 *   3. the injected write paths map to the Host config paths
 *      (`mutedSessions[sessionId]` set/unset, `enabled` set);
 *   4. both controls render the expected checked/disabled/title states for
 *      ready / muted / master-off / loading / read-only / unavailable / write-
 *      in-flight snapshots, and the Settings row surfaces a refused write.
 *
 * A tiny hook harness stands in for React state so components can be called as
 * plain functions; nothing is mounted. Run `node build.mjs` first, then
 * `node tests/client-smoke.mjs` (or `node --test tests/` if discovered).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(ROOT, 'lib/client.js')
const BUNDLE_MAP = `${BUNDLE}.map`

/** Read a build artifact, turning a missing build into a self-explanatory failure. */
function readArtifact(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`missing ${path} — run \`node build.mjs\` first`, { cause: error })
  }
}

const SOURCE = readArtifact(BUNDLE)
const SOURCE_MAP = readArtifact(BUNDLE_MAP)

// ---------------------------------------------------------------------------
// Evaluate the artifact exactly like the page does: only the loader facade.
// ---------------------------------------------------------------------------

/** Registration captured from the bundle's `window.__ModuleLoader__.load` call. */
let registration
new Function('window', SOURCE)({
  __ModuleLoader__: {
    load(next) {
      registration = next
    },
  },
})

// ---------------------------------------------------------------------------
// Platform-module stubs. `require` below stands in for the loader's module
// table: unknown specifiers fail loudly (everything else must be bundled).
// ---------------------------------------------------------------------------

/** Hook runtime the `react` stub delegates to while a component renders. */
const hookRuntime = { active: undefined }

const reactStub = {
  useState(initial) {
    assert.ok(hookRuntime.active !== undefined, 'useState called outside a render pass')
    return hookRuntime.active.useState(initial)
  },
}

/** Minimal JSX factory: the virtual tree keeps `type`/`props` inspectable. */
function jsx(type, props, key) {
  return { type, props: props ?? {}, key }
}

const jsxRuntimeStub = {
  Fragment: Symbol('Fragment'),
  jsx,
  jsxs: jsx,
}

/** Stand-in for the shared primitives `Switch`: render sites keep their props on the tree. */
function SwitchStub(props) {
  return { type: SwitchStub, props }
}

const primitivesStub = { Switch: SwitchStub }

const requestedSpecifiers = []
const requireStub = (specifier) => {
  requestedSpecifiers.push(specifier)
  const modules = {
    react: reactStub,
    'react/jsx-runtime': jsxRuntimeStub,
    '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
  }
  if (!Object.hasOwn(modules, specifier)) {
    throw new Error(`bundle required an undeclared page module: ${specifier}`)
  }
  return modules[specifier]
}

/** The Cordis plugin face the bundle hands the client module system. */
const plugin = registration.factory(requireStub)

// ---------------------------------------------------------------------------
// Fake client context and shared config form.
// ---------------------------------------------------------------------------

/**
 * One shared ConfigForm stand-in: mutable snapshot plus recorded writes.
 * @param config - initial `enabled`/`mutedSessions` values.
 * @param options.status - mirror status (`ready`/`loading`/`unavailable`).
 * @param options.writable - whether the Host document accepts writes.
 */
function createConfigForm(config = {}, { status = 'ready', writable = true } = {}) {
  const calls = []
  let accept = true
  let gate
  let snapshot = {
    status,
    writable,
    value: { enabled: true, mutedSessions: {}, ...config },
    base: undefined,
    user: undefined,
    revision: 4,
  }
  const settle = () => (gate === undefined ? accept : gate)
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    async mutate(ops) {
      calls.push({ kind: 'mutate', ops })
      return settle()
    },
    async set(field, value) {
      calls.push({ kind: 'set', field, value })
      return settle()
    },
    async unset(field) {
      calls.push({ kind: 'unset', field })
      return settle()
    },
  }
  return {
    form,
    calls,
    /** Replace top-level snapshot fields (status/writable/value...). */
    patch(next) {
      snapshot = { ...snapshot, ...next }
    },
    /** Merge fields into the resolved config value. */
    patchValue(next) {
      snapshot = { ...snapshot, value: { ...snapshot.value, ...next } }
    },
    /** Control whether Host writes are accepted. */
    setAccept(next) {
      accept = next
    },
    /** Hold writes on a promise until the returned release is called. */
    holdWrites() {
      let release
      gate = new Promise((resolve) => { release = resolve })
      return release
    },
    releaseWrites() {
      gate = undefined
    },
  }
}

/** Record every client-service call `apply` makes. */
function createClientContext(form) {
  const effects = []
  const localeRegistrations = []
  const formEntryIds = []
  const slotInjections = []
  const slotRegistrations = []
  const ctx = {
    effect(register, label) {
      const dispose = register()
      effects.push({ label, dispose })
      return () => { void dispose?.() }
    },
    locale: {
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
    },
    configForms: {
      get(entryId) {
        formEntryIds.push(entryId)
        return form
      },
    },
    slots: {
      inject(name, register) {
        slotInjections.push({ name, register })
      },
      register(options, Component) {
        slotRegistrations.push({ options, Component })
        return () => {}
      },
    },
  }
  return { ctx, effects, localeRegistrations, formEntryIds, slotInjections, slotRegistrations }
}

const formHarness = createConfigForm()
const client = createClientContext(formHarness.form)
plugin.apply(client.ctx)

/** The dictionary pair the plugin registered, reduced to the active copy. */
const dictionaries = client.localeRegistrations[0]?.dictionaries ?? {}
const en = dictionaries.en ?? {}
const t = key => en[key] ?? key

/** Find the registration for one slot name (fails when the plugin forgot it). */
function registrationFor(name) {
  const found = client.slotRegistrations.find(entry => entry.options.name === name)
  assert.ok(found !== undefined, `no registration for slot ${name}`)
  return found
}

// ---------------------------------------------------------------------------
// Render harness: components run as plain functions with truthful useState.
// ---------------------------------------------------------------------------

/** Minimal component runtime: ordered state cells keyed by hook call order. */
function createRenderHarness() {
  const states = []
  let index = 0
  return {
    useState(initial) {
      const cell = index++
      if (cell >= states.length) {
        states[cell] = typeof initial === 'function' ? initial() : initial
      }
      return [states[cell], (next) => {
        states[cell] = typeof next === 'function' ? next(states[cell]) : next
      }]
    },
    render(Component, props) {
      index = 0
      hookRuntime.active = this
      try {
        return Component(props)
      } finally {
        hookRuntime.active = undefined
      }
    },
  }
}

/** Depth-first search over the virtual tree. */
function findAll(node, predicate, found = []) {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (node === null || typeof node !== 'object') return found
  if (predicate(node)) {
    found.push(node)
    return found
  }
  findAll(node.props?.children, predicate, found)
  return found
}

/** The single Switch element a control renders. */
function findSwitch(tree) {
  const switches = findAll(tree, node => node.type === SwitchStub)
  assert.equal(switches.length, 1, 'control must render exactly one Switch')
  return switches[0]
}

/** Concatenated visible text of a virtual tree. */
function textContent(node) {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (node === null || typeof node !== 'object') return ''
  return textContent(node.props?.children)
}

/** Await one macrotask so chained promise settle handlers have run. */
const nextTask = () => new Promise((resolve) => { setTimeout(resolve, 0) })

// ---------------------------------------------------------------------------
// 1. Artifact shape.
// ---------------------------------------------------------------------------

test('lib/client.js is a DSH closure-factory artifact with the expected exports face', () => {
  assert.equal(registration?.id, 'dsh-nightowl')
  assert.equal(registration?.factory instanceof Function, true)
  assert.match(SOURCE, /^window\.__ModuleLoader__\.load\(\{/u)
  assert.match(SOURCE, / {2}id: "dsh-nightowl",/u)
  assert.match(SOURCE, / {2}factory: \(require\) => \{/u)
  assert.match(SOURCE, /exports\.apply = apply;/u)
  assert.match(SOURCE, /exports\.inject = inject;/u)
  // The file must close with the module return; the source-map comment is last.
  const withoutMapComment = SOURCE.replace(/\n?\/\/# sourceMappingURL=.*\s*$/u, '')
  assert.ok(
    withoutMapComment.trimEnd().endsWith('return module.exports;\n  }\n});'),
    'wrapper must close with `return module.exports;` and the factory call',
  )
  const map = JSON.parse(SOURCE_MAP)
  assert.equal(map.version, 3)
  assert.equal(map.file, 'client.js')
  assert.ok(map.sources.some(source => source.endsWith('src/client/index.tsx')))
  assert.ok(map.sourcesContent.some(content => typeof content === 'string' && content.includes('nightowl-keep-awake')))
})

// ---------------------------------------------------------------------------
// 2. Plugin face and service registrations.
// ---------------------------------------------------------------------------

test('plugin face: inject list, dictionaries, shared form, and exactly two slots', () => {
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['slots', 'locale', 'configForms'])
  // Only platform-module words may reach require; everything else is bundled.
  assert.deepEqual([...new Set(requestedSpecifiers)].sort(), [
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
    'react/jsx-runtime',
  ])

  // Locale: one namespace holding complete en+ru dictionaries.
  assert.equal(client.localeRegistrations.length, 1)
  assert.equal(client.localeRegistrations[0].namespace, 'nightowl')
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'ru'])
  assert.deepEqual(Object.keys(en).sort(), Object.keys(dictionaries.ru).sort())
  for (const key of [
    'settings.title', 'settings.description', 'settings.error', 'settings.locked',
    'header.label', 'header.on', 'header.muted', 'header.masterOff',
    'header.loading', 'header.unavailable', 'header.readOnly',
  ]) {
    assert.equal(typeof en[key], 'string', `missing en dictionary key ${key}`)
    assert.ok(en[key].length > 0, `empty en dictionary value for ${key}`)
    assert.equal(typeof dictionaries.ru[key], 'string', `missing ru dictionary key ${key}`)
  }

  // Shared config form: the entry id, requested exactly once.
  assert.deepEqual(client.formEntryIds, ['nightowl'])
  // Dictionaries are registered through an effect (so HMR/unload dispose them).
  assert.equal(client.effects.length, 1)
  assert.match(client.effects[0].label, /nightowl: dictionaries/u)

  // Exactly the two owned seats are injected, in declaration order.
  assert.deepEqual(client.slotInjections.map(entry => entry.name), [
    'conversation.session.header.utilities',
    'settings.general.item',
  ])
  // Each slot inject() callback returns its registration disposer.
  for (const injection of client.slotInjections) {
    assert.equal(typeof injection.register(), 'function', `${injection.name} must return a disposer`)
  }
  assert.equal(client.slotRegistrations.length, 2)

  const header = registrationFor('conversation.session.header.utilities')
  assert.equal(header.options.id, 'nightowl-keep-awake')
  assert.equal(header.options.order, 30)
  assert.equal(header.options.locale, 'nightowl')
  assert.equal(typeof header.Component, 'function')

  const row = registrationFor('settings.general.item')
  assert.equal(row.options.id, 'nightowl')
  assert.equal(row.options.order, 60)
  assert.equal(row.options.locale, 'nightowl')
  assert.equal(typeof row.Component, 'function')
})

// ---------------------------------------------------------------------------
// 3. Injected write paths (the Host config contract).
// ---------------------------------------------------------------------------

test('write paths: session mute set/unset, master enabled set', async () => {
  const header = registrationFor('conversation.session.header.utilities')
  const headerInjected = header.options.inject('session-1')
  assert.equal(headerInjected.hooks.nightowl, formHarness.form)

  const row = registrationFor('settings.general.item')
  const rowInjected = row.options.inject()
  assert.equal(rowInjected.hooks.nightowl, formHarness.form)

  await headerInjected.setAwake(false)
  assert.deepEqual(formHarness.calls.at(-1), {
    kind: 'mutate',
    ops: [{ op: 'set', path: ['mutedSessions', 'session-1'], value: true }],
  })

  await headerInjected.setAwake(true)
  assert.deepEqual(formHarness.calls.at(-1), {
    kind: 'mutate',
    ops: [{ op: 'unset', path: ['mutedSessions', 'session-1'] }],
  })

  await rowInjected.setEnabled(false)
  assert.deepEqual(formHarness.calls.at(-1), { kind: 'set', field: 'enabled', value: false })
})

// ---------------------------------------------------------------------------
// 4. Session-header switch states.
// ---------------------------------------------------------------------------

test('session-header switch reflects the effective per-session state', async () => {
  const header = registrationFor('conversation.session.header.utilities')
  const Component = header.Component
  const injected = header.options.inject('session-1')
  const harness = createRenderHarness()
  const props = () => ({
    sessionId: 'session-1',
    t,
    useNightowl: selector => selector(formHarness.form.getSnapshot()),
    setAwake: injected.setAwake,
  })
  const resetForm = () => {
    formHarness.patch({ status: 'ready', writable: true })
    formHarness.patchValue({ enabled: true, mutedSessions: {} })
    formHarness.setAccept(true)
    formHarness.releaseWrites()
  }

  // Ready + enabled + unmuted: effective awake, interactive, tooltip explains it.
  resetForm()
  let tree = harness.render(Component, props())
  let control = findSwitch(tree)
  assert.equal(control.props.checked, true)
  assert.equal(control.props.disabled, false)
  assert.equal(control.props.label, en['header.label'])
  assert.equal(control.props.title, en['header.on'])
  assert.equal(tree.props.title, en['header.on'])
  assert.equal(tree.props.style.display, 'inline-flex')
  assert.equal(tree.props.style.gap, 6)

  // Muted for this session: off but still interactive.
  formHarness.patchValue({ mutedSessions: { 'session-1': true } })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, false)
  assert.equal(control.props.disabled, false)
  assert.equal(control.props.title, en['header.muted'])

  // Master off in Settings: forced off, disabled, tooltip points at Settings.
  formHarness.patchValue({ enabled: false, mutedSessions: {} })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, false)
  assert.equal(control.props.disabled, true)
  assert.equal(control.props.title, en['header.masterOff'])

  // Loading mirror: last known checked state stays visible, control is locked.
  formHarness.patchValue({ enabled: true, mutedSessions: {} })
  formHarness.patch({ status: 'loading' })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, true)
  assert.equal(control.props.disabled, true)
  assert.equal(control.props.title, en['header.loading'])

  // Unavailable namespace.
  formHarness.patch({ status: 'unavailable' })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.disabled, true)
  assert.equal(control.props.title, en['header.unavailable'])

  // Read-only Host document.
  formHarness.patch({ status: 'ready', writable: false })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.disabled, true)
  assert.equal(control.props.title, en['header.readOnly'])

  // Write in flight: the requested state shows immediately, the control locks,
  // and the snapshot becomes authoritative once the write settles.
  resetForm()
  const release = formHarness.holdWrites()
  tree = harness.render(Component, props())
  findSwitch(tree).props.onChange(false)
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, false, 'requested mute must show while in flight')
  assert.equal(control.props.disabled, true, 'control must lock while a write is in flight')
  release(true)
  await nextTask()
  formHarness.releaseWrites()
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, true, 'unsettled fake snapshot keeps the old state')
  assert.equal(control.props.disabled, false)
})

// ---------------------------------------------------------------------------
// 5. Settings master row states and error presentation.
// ---------------------------------------------------------------------------

test('settings row binds the master switch and surfaces refused writes', async () => {
  const row = registrationFor('settings.general.item')
  const Component = row.Component
  const injected = row.options.inject()
  const harness = createRenderHarness()
  const props = () => ({
    t,
    useNightowl: selector => selector(formHarness.form.getSnapshot()),
    setEnabled: injected.setEnabled,
  })
  const resetForm = () => {
    formHarness.patch({ status: 'ready', writable: true })
    formHarness.patchValue({ enabled: true })
    formHarness.setAccept(true)
    formHarness.releaseWrites()
  }

  // Ready: shipped row chrome, title/description copy, live master switch.
  resetForm()
  let tree = harness.render(Component, props())
  let control = findSwitch(tree)
  assert.equal(control.props.checked, true)
  assert.equal(control.props.disabled, false)
  assert.equal(control.props.label, en['settings.title'])
  const styles = tree.props.style
  assert.equal(styles.display, 'flex')
  assert.equal(styles.alignItems, 'center')
  assert.equal(styles.justifyContent, 'space-between')
  assert.equal(styles.gap, 24)
  assert.equal(styles.padding, '16px 0')
  assert.equal(styles.borderBottom, '0.5px solid var(--dsw-alias-border-l2)')
  let panelText = textContent(tree)
  assert.ok(panelText.includes(en['settings.title']))
  assert.ok(panelText.includes(en['settings.description']))
  assert.equal(findAll(tree, node => node.props?.role === 'alert').length, 0)

  // Read-only/not-ready: switch locked with the localized hover reason.
  formHarness.patch({ status: 'loading' })
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.disabled, true)
  assert.equal(control.props.title, en['settings.locked'])

  // Refused write: revert to snapshot state, no crash, localized error below.
  resetForm()
  formHarness.setAccept(false)
  tree = harness.render(Component, props())
  findSwitch(tree).props.onChange(false)
  await nextTask()
  tree = harness.render(Component, props())
  control = findSwitch(tree)
  assert.equal(control.props.checked, true, 'refused write must revert to the snapshot value')
  assert.equal(control.props.disabled, false)
  const alerts = findAll(tree, node => node.props?.role === 'alert')
  assert.equal(alerts.length, 1)
  assert.equal(textContent(alerts[0]), en['settings.error'])

  // Accepted retry clears the error and settles the busy lock.
  resetForm()
  tree = harness.render(Component, props())
  let accepted
  formHarness.form.set = async (field, value) => {
    formHarness.calls.push({ kind: 'set', field, value })
    return new Promise((resolve) => { accepted = resolve })
  }
  findSwitch(tree).props.onChange(true)
  await nextTask()
  tree = harness.render(Component, props())
  assert.equal(findSwitch(tree).props.disabled, true, 'switch locks while the write is in flight')
  assert.equal(findAll(tree, node => node.props?.role === 'alert').length, 0, 'retry clears the error')
  accepted(true)
  await nextTask()
  tree = harness.render(Component, props())
  assert.equal(findSwitch(tree).props.disabled, false)
  assert.equal(findAll(tree, node => node.props?.role === 'alert').length, 0)
})
