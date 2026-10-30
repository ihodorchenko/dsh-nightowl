/**
 * Host-half tests for dsh-nightowl.
 *
 * Run from the package root with the packaged Node:
 *   <node> --test tests/
 *
 * Every child process is a fake `spawn`: no test touches real caffeinate.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CAFFEINATE_PATH,
  Config,
  apply,
  createPlugin,
  createSleepManager,
  inject,
  name,
} from '../index.js'

const HOST_PID = String(process.pid)

/* ── fixtures ─────────────────────────────────────────────────────────── */

/** `child_process.spawn` stand-in that records argv and never starts anything. */
function createFakeSpawn() {
  const spawned = []

  function spawn(command, args, options) {
    const handlers = new Map()
    const child = {
      command,
      args,
      options,
      signals: [],
      once(event, handler) {
        handlers.set(event, handler)
        return child
      },
      emit(event, ...payload) {
        handlers.get(event)?.(...payload)
      },
      kill(signal) {
        child.signals.push(signal)
        return true
      },
    }
    spawned.push(child)
    return child
  }

  return { spawn, spawned }
}

/** Children that were spawned and never received SIGTERM. */
function liveChildren(spawned) {
  return spawned.filter(child => child.signals.length === 0)
}

/** Structural logger that keeps every message for assertions. */
function createFakeLogger() {
  const infos = []
  const warns = []
  return {
    infos,
    warns,
    info(message) { infos.push(String(message)) },
    warn(...args) { warns.push(args) },
  }
}

/**
 * Stable volatile references with the Loader's observable behaviour: the
 * reference identity never changes, only what `.get()` returns.
 */
function createLiveConfig({ enabled = true, mutedSessions = {} } = {}) {
  let current = { enabled, mutedSessions }
  return {
    config: {
      enabled: { get: () => current.enabled },
      mutedSessions: { get: () => current.mutedSessions },
    },
    setEnabled(next) { current = { ...current, enabled: next } },
    setMuted(next) { current = { ...current, mutedSessions: next } },
  }
}

/** Minimal Host context: agent registry, event bus, effect cleanup. */
function createFakeHost(initialAgents = []) {
  const agents = initialAgents.map(agent => ({ ...agent }))
  const listeners = new Map()
  const effects = []
  const logger = createFakeLogger()

  const ctx = {
    logger,
    agents: { list: () => agents.map(agent => ({ ...agent })) },
    on(event, listener) {
      const bucket = listeners.get(event) ?? []
      bucket.push(listener)
      listeners.set(event, bucket)
      return () => {}
    },
    effect(execute) {
      const dispose = execute()
      effects.push(dispose)
      return dispose
    },
  }

  return {
    ctx,
    agents,
    logger,
    effects,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload)
    },
    unload() {
      for (const dispose of effects.splice(0).reverse()) {
        if (typeof dispose === 'function') dispose()
      }
    },
  }
}

/** Manager wired to fake spawn and a fake logger on macOS. */
function managerFixture() {
  const { spawn, spawned } = createFakeSpawn()
  const logger = createFakeLogger()
  const manager = createSleepManager({ spawn, platform: 'darwin', logger })
  return { manager, spawned, logger }
}

/* ── plugin contract ──────────────────────────────────────────────────── */

test('exports the Cordis plugin contract', () => {
  assert.equal(typeof name, 'string')
  assert.ok(name.length > 0)
  assert.deepEqual(inject, ['agents'])
  assert.equal(typeof apply, 'function')
  assert.equal(typeof createPlugin, 'function')
  assert.equal(typeof createSleepManager, 'function')
  assert.equal(CAFFEINATE_PATH, '/usr/bin/caffeinate')
})

test('Config defines volatile enabled/mutedSessions with defaults', () => {
  assert.equal(Config.dict.enabled.meta.volatile, true)
  assert.equal(Config.dict.enabled.meta.default, true)
  assert.equal(Config.dict.mutedSessions.meta.volatile, true)
  assert.deepEqual(Config.dict.mutedSessions.meta.default, {})

  const defaults = Config({})
  assert.equal(defaults.enabled.get(), true)
  assert.deepEqual(defaults.mutedSessions.get(), {})

  const configured = Config({ enabled: false, mutedSessions: { session: true } })
  assert.equal(configured.enabled.get(), false)
  assert.deepEqual(configured.mutedSessions.get(), { session: true })
})

/* ── sleep manager: edges ─────────────────────────────────────────────── */

test('rising edge spawns exactly one caffeinate with the documented argv', () => {
  const { manager, spawned, logger } = managerFixture()

  manager.sync(['session-a'], {}, true)

  assert.equal(spawned.length, 1)
  const [child] = spawned
  assert.equal(child.command, '/usr/bin/caffeinate')
  assert.deepEqual(child.args, ['-i', '-w', HOST_PID])
  assert.deepEqual(child.options, { stdio: 'ignore' })
  assert.deepEqual(child.signals, [])
  assert.equal(logger.infos.filter(message => message.includes('keeping the system awake')).length, 1)
  assert.equal(logger.warns.length, 0)
})

test('repeated reconciles and a second running session never double-spawn', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.sync(['a'], {}, true)
  manager.sync(['a', 'b'], {}, true)
  manager.sync(new Set(['a', 'b', 'c']), {}, true)

  assert.equal(spawned.length, 1)
  assert.equal(liveChildren(spawned).length, 1)
})

test('falling edge kills with SIGTERM exactly once', () => {
  const { manager, spawned, logger } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.sync([], {}, true)
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])

  manager.sync([], {}, true)
  assert.deepEqual(spawned[0].signals, ['SIGTERM'], 'no second kill on an unchanged edge')
  assert.equal(spawned.length, 1)
  assert.equal(logger.infos.filter(message => message.includes('released the system sleep assertion')).length, 1)
})

test('the assertion survives while any unmuted session is still running', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.sync(['a', 'b'], {}, true)
  manager.sync(['b'], {}, true)

  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].signals, [])
  assert.equal(liveChildren(spawned).length, 1)

  manager.sync([], {}, true)
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])
})

/* ── sleep manager: mute and master switch ────────────────────────────── */

test('muting the only running session releases; unmuting re-asserts', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.sync(['a'], { a: true }, true)
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])
  assert.equal(liveChildren(spawned).length, 0)

  manager.sync(['a'], { a: true }, true)
  assert.equal(spawned.length, 1, 'still muted: nothing respawns')

  manager.sync(['a'], { a: false }, true)
  assert.equal(spawned.length, 2, 'a `false` entry is not a mute')
  assert.equal(liveChildren(spawned).length, 1)
})

test('a muted session does not hold the assertion while another runs unmuted', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a', 'b'], { a: true }, true)
  assert.equal(spawned.length, 1)

  manager.sync(['a'], { a: true }, true)
  assert.equal(liveChildren(spawned).length, 0)
})

test('master switch off releases the assertion and on re-asserts', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.sync(['a'], {}, false)
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])

  manager.sync(['a'], {}, false)
  assert.equal(spawned.length, 1, 'still off: nothing respawns')

  manager.sync(['a'], {}, undefined)
  assert.equal(spawned.length, 1, 'only a boolean true keeps the system awake')

  manager.sync(['a'], {}, true)
  assert.equal(spawned.length, 2)
  assert.equal(liveChildren(spawned).length, 1)
})

/* ── sleep manager: dispose, guards, failures ─────────────────────────── */

test('dispose releases the child, is idempotent, and later syncs stay inert', () => {
  const { manager, spawned } = managerFixture()

  manager.sync(['a'], {}, true)
  manager.dispose()
  manager.dispose()
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])

  manager.sync(['a'], {}, true)
  assert.equal(spawned.length, 1, 'a disposed manager never spawns again')
})

test('dispose without a live child is a no-op', () => {
  const { manager, spawned } = managerFixture()
  assert.doesNotThrow(() => {
    manager.dispose()
    manager.dispose()
  })
  assert.equal(spawned.length, 0)
})

test('non-darwin managers stay inert and warn only once', () => {
  const { spawn, spawned } = createFakeSpawn()
  const logger = createFakeLogger()
  const manager = createSleepManager({ spawn, platform: 'linux', logger })

  manager.sync(['a'], {}, true)
  manager.sync(['a'], {}, true)

  assert.equal(spawned.length, 0)
  assert.equal(logger.warns.length, 1)
  assert.match(String(logger.warns[0][0]), /macOS only/)
})

test('a missing caffeinate helper keeps the manager inert', () => {
  const { spawn, spawned } = createFakeSpawn()
  const logger = createFakeLogger()
  const manager = createSleepManager({ spawn, platform: 'darwin', logger, available: false })

  manager.sync(['a'], {}, true)

  assert.equal(spawned.length, 0)
  assert.equal(logger.warns.length, 1)
  assert.match(String(logger.warns[0][0]), /\/usr\/bin\/caffeinate not found/)
})

test('a synchronous spawn failure is warned and never escapes sync', () => {
  const logger = createFakeLogger()
  const spawn = () => { throw new Error('spawn exploded') }
  const manager = createSleepManager({ spawn, platform: 'darwin', logger })

  assert.doesNotThrow(() => manager.sync(['a'], {}, true))
  assert.equal(logger.warns.length, 1)
  assert.match(String(logger.warns[0][0]), /failed to spawn caffeinate/)
  assert.match(String(logger.warns[0][1]?.message), /spawn exploded/)

  // Nothing was retained, so the falling edge and unload stay harmless.
  assert.doesNotThrow(() => {
    manager.sync([], {}, true)
    manager.dispose()
  })
})

test('an asynchronous child error is warned, forgotten, and retried later', () => {
  const { manager, spawned, logger } = managerFixture()

  manager.sync(['a'], {}, true)
  assert.doesNotThrow(() => spawned[0].emit('error', new Error('ENOENT')))

  assert.equal(logger.warns.length, 1)
  assert.match(String(logger.warns[0][0]), /caffeinate failed/)

  manager.sync([], {}, true)
  assert.deepEqual(spawned[0].signals, [], 'the failed child is not killed again')

  manager.sync(['a'], {}, true)
  assert.equal(spawned.length, 2, 'the next rising edge retries')
})

test('an unexpected child exit is warned and the manager recovers', () => {
  const { manager, spawned, logger } = managerFixture()

  manager.sync(['a'], {}, true)
  spawned[0].emit('exit', 1, null)

  assert.equal(logger.warns.length, 1)
  assert.match(String(logger.warns[0][0]), /exited unexpectedly/)

  manager.sync(['a'], {}, true)
  assert.equal(spawned.length, 2)
})

/* ── plugin body: agent tracking ──────────────────────────────────────── */

test('apply seeds from agents that are already running', () => {
  const host = createFakeHost([
    { id: 'running-session', status: 'running' },
    { id: 'idle-session', status: 'idle' },
  ])
  const { spawn, spawned } = createFakeSpawn()

  // No logger override: transition logs must go through ctx.logger.
  createPlugin({ spawn, platform: 'darwin', available: true })(host.ctx, Config({}))

  assert.equal(spawned.length, 1)
  assert.deepEqual(spawned[0].args, ['-i', '-w', HOST_PID])
  assert.equal(host.logger.infos.filter(message => message.includes('keeping the system awake')).length, 1)
})

test('apply tracks status transitions and drops disposed running agents', () => {
  const host = createFakeHost([{ id: 'a', status: 'idle' }])
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx, Config({}))
  assert.equal(spawned.length, 0)

  host.emit('agent/status', { agent: { id: 'a', status: 'running' }, status: 'running' })
  assert.equal(spawned.length, 1, 'idle → running asserts')

  host.emit('agent/status', { agent: { id: 'b', status: 'running' }, status: 'running' })
  assert.equal(spawned.length, 1, 'a second running session does not spawn twice')

  host.emit('agent/status', { agent: { id: 'a', status: 'idle' }, status: 'idle' })
  assert.equal(spawned.length, 1)
  assert.equal(liveChildren(spawned).length, 1, 'b still runs')

  host.emit('agent/disposed', { agent: { id: 'b', status: 'running' } })
  assert.equal(liveChildren(spawned).length, 0, 'disposal of the last running agent releases')
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])
})

test('apply treats an agent created already running as running', () => {
  const host = createFakeHost()
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx, Config({}))

  host.emit('agent/created', { agent: { id: 'late', status: 'running' } })

  assert.equal(spawned.length, 1)
})

/* ── plugin body: volatile settings ───────────────────────────────────── */

test('apply honors the master switch and re-reads volatile config on loader/volatile-update', () => {
  const live = createLiveConfig({ enabled: false })
  const host = createFakeHost([{ id: 'a', status: 'running' }])
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx, live.config)

  assert.equal(spawned.length, 0, 'disabled at mount: a running agent keeps nothing awake')

  live.setEnabled(true)
  host.emit('loader/volatile-update', { paths: [['enabled']] })
  assert.equal(spawned.length, 1, 'master on → assert')

  live.setEnabled(false)
  host.emit('loader/volatile-update', {})
  assert.equal(liveChildren(spawned).length, 0, 'master off → release')

  live.setMuted({ a: true })
  live.setEnabled(true)
  host.emit('loader/volatile-update', {})
  assert.equal(spawned.length, 1, 'only running session muted → stay released')

  live.setMuted({})
  host.emit('loader/volatile-update', {})
  assert.equal(spawned.length, 2, 'unmute → assert again')
  assert.equal(liveChildren(spawned).length, 1)
})

test('apply reads the parsed Config shape end to end', () => {
  const host = createFakeHost([{ id: 'muted-session', status: 'running' }])
  const { spawn, spawned } = createFakeSpawn()
  // Real schema output: Loader-owned volatile references wrapping plain values.
  const config = Config({ mutedSessions: { 'muted-session': true } })

  createPlugin({ spawn, platform: 'darwin', available: true })(host.ctx, config)
  assert.equal(spawned.length, 0, 'the only running session is muted')

  createPlugin({ spawn, platform: 'darwin', available: true })(host.ctx, Config({ enabled: false }))
  assert.equal(spawned.length, 0, 'the master switch is off')
})

test('apply without a config keeps the feature on by default', () => {
  const host = createFakeHost([{ id: 'a', status: 'running' }])
  const { spawn, spawned } = createFakeSpawn()

  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx)

  assert.equal(spawned.length, 1)
})

/* ── plugin body: unload and guards ───────────────────────────────────── */

test('plugin unload releases the assertion and stops reconciling', () => {
  const host = createFakeHost([{ id: 'a', status: 'running' }])
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx, Config({}))
  assert.equal(spawned.length, 1)

  host.unload()
  assert.deepEqual(spawned[0].signals, ['SIGTERM'])

  host.emit('agent/status', { agent: { id: 'a', status: 'running' }, status: 'running' })
  assert.equal(spawned.length, 1, 'an unloaded plugin never spawns again')
})

test('apply stays inert on non-darwin hosts', () => {
  const host = createFakeHost([{ id: 'a', status: 'running' }])
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'linux' })(host.ctx, Config({}))

  host.emit('agent/status', { agent: { id: 'b', status: 'running' }, status: 'running' })

  assert.equal(spawned.length, 0)
  assert.equal(host.logger.warns.length, 1)
  assert.match(String(host.logger.warns[0][0]), /macOS only/)
})

test('malformed host event payloads are contained instead of thrown', () => {
  const host = createFakeHost()
  const { spawn, spawned } = createFakeSpawn()
  createPlugin({ spawn, platform: 'darwin', available: true, logger: host.logger })(host.ctx, Config({}))

  assert.doesNotThrow(() => host.emit('agent/status', undefined))
  assert.doesNotThrow(() => host.emit('agent/disposed', null))
  assert.doesNotThrow(() => host.emit('loader/volatile-update', undefined))

  assert.equal(spawned.length, 0)
  assert.ok(host.logger.warns.length >= 1)
})
