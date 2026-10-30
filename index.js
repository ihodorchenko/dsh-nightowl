/**
 * Night Owl host half: keeps the Mac's system awake while agent work runs.
 *
 * Holds at most one `/usr/bin/caffeinate -i -w <host pid>` child while the
 * feature is enabled and at least one live agent session is running unmuted.
 * `-i` asserts only `PreventUserIdleSystemSleep` (the display may still sleep),
 * and `-w` binds the child to this Host process so it can never outlive it.
 *
 * @module dsh-nightowl
 */

import { spawn as spawnProcess } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'

import z from '@deepseek-ai/schemastery'

/** Cordis plugin name. */
export const name = 'nightowl'

/** Host services required by this plugin: the live agent registry. */
export const inject = ['agents']

/** The macOS sleep-assertion helper owned by this plugin. */
export const CAFFEINATE_PATH = '/usr/bin/caffeinate'

/**
 * Live settings of this plugin's Loader row.
 *
 * Both fields are `.volatile()`: the Loader commits Settings edits into the
 * same resolved references in place and then emits `loader/volatile-update`
 * instead of remounting the plugin. `enabled` is the master switch; each
 * `mutedSessions[id] === true` opts one session out.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  mutedSessions: z.dict(z.boolean()).default({}).volatile(),
})

/** Read the current value behind a Loader-owned volatile reference. */
function readLive(value, fallback) {
  if (value === null || value === undefined) return fallback
  return typeof value.get === 'function' ? value.get() : value
}

/** Read `mutedSessions` defensively; anything but an object means nothing is muted. */
function readMuted(value) {
  const muted = readLive(value, {})
  return typeof muted === 'object' && muted !== null ? muted : {}
}

/** Stable string id of one live agent (`SessionId` is a branded string). */
function sessionIdOf(agent) {
  const id = agent?.id
  return id === null || id === undefined ? undefined : String(id)
}

/** Whether the caffeinate helper is present and executable on this Host. */
function caffeinateAvailable(platform) {
  if (platform !== 'darwin') return false
  try {
    accessSync(CAFFEINATE_PATH, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Build the sleep-assertion child lifecycle.
 *
 * Dependency-injected (`spawn`, `platform`, `logger`) so tests can drive every
 * transition without touching the real system. `sync` is idempotent: it derives
 * the effective state from the snapshot it receives and acts only on edges.
 *
 * @param {object} [options] - host dependencies.
 * @param {Function} [options.spawn] - `node:child_process` compatible spawn.
 * @param {string} [options.platform] - host platform; non-darwin stays inert.
 * @param {object} [options.logger] - structural logger with `info`/`warn`.
 * @param {boolean} [options.available] - whether `CAFFEINATE_PATH` exists.
 * @returns {{ sync: (runningIds: Iterable<string>, muted: Record<string, boolean>, enabled: boolean) => void, dispose: () => void }}
 */
export function createSleepManager({
  spawn = spawnProcess,
  platform = process.platform,
  logger = console,
  available = true,
} = {}) {
  const inertReason = platform !== 'darwin'
    ? 'macOS only'
    : available !== true ? `${CAFFEINATE_PATH} not found` : null

  /** @type {any} */
  let child = null
  let disposed = false
  let inertReported = false

  const info = (message) => {
    try { logger?.info?.(`nightowl: ${message}`) } catch { /* logging must never fail the host */ }
  }
  const warn = (message, error) => {
    try {
      if (error === undefined) logger?.warn?.(`nightowl: ${message}`)
      else logger?.warn?.(`nightowl: ${message}`, error)
    } catch { /* swallowed */ }
  }

  function start() {
    try {
      const proc = spawn(CAFFEINATE_PATH, ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
      if (proc === null || proc === undefined) {
        warn('caffeinate spawn returned no child process')
        return
      }
      child = proc
      info(`keeping the system awake (caffeinate -i -w ${process.pid})`)
      // An unobserved 'error' event would crash the Host; an unexpected exit is
      // reported and left for the next agent transition to reconcile.
      if (typeof proc.once === 'function') {
        proc.once('error', (error) => {
          if (child === proc) child = null
          warn('caffeinate failed', error)
        })
        proc.once('exit', (code, signal) => {
          if (child !== proc) return
          child = null
          warn(`caffeinate exited unexpectedly (code ${String(code)}, signal ${String(signal)})`)
        })
      }
    } catch (error) {
      child = null
      warn('failed to spawn caffeinate', error)
    }
  }

  function stop(message) {
    const proc = child
    if (proc === null) return
    // Clear before kill so the intentional exit is never reported as unexpected.
    child = null
    info(message)
    try { proc.kill('SIGTERM') } catch (error) { warn('failed to stop caffeinate', error) }
  }

  return {
    /** Reconcile the child with the effective keep-awake state. */
    sync(runningIds, muted, enabled) {
      if (disposed) return
      if (inertReason !== null) {
        if (!inertReported) {
          inertReported = true
          warn(`keep-awake inert (${inertReason})`)
        }
        return
      }
      let wanted = false
      if (enabled === true && runningIds !== null && runningIds !== undefined) {
        for (const id of runningIds) {
          if (muted?.[id] !== true) { wanted = true; break }
        }
      }
      if (wanted) {
        if (child === null) start()
      } else if (child !== null) {
        stop('released the system sleep assertion')
      }
    },
    /** Kill the child and make every later sync a no-op (unload/HMR cleanup). */
    dispose() {
      if (disposed) return
      disposed = true
      stop('released the system sleep assertion on unload')
    },
  }
}

/**
 * Build the Cordis plugin body with injectable host dependencies.
 *
 * The exported {@link apply} uses the real process dependencies; tests use this
 * factory with a fake `spawn` so no real child is ever started.
 *
 * @param {object} [deps] - host dependencies.
 * @param {Function} [deps.spawn] - spawn implementation.
 * @param {string} [deps.platform] - host platform.
 * @param {object} [deps.logger] - logger override (defaults to `ctx.logger`).
 * @param {boolean} [deps.available] - `CAFFEINATE_PATH` availability override.
 * @returns {(ctx: any, config?: any) => void} plugin body.
 */
export function createPlugin({ spawn = spawnProcess, platform = process.platform, logger, available } = {}) {
  return function apply(ctx, config) {
    const log = logger ?? ctx?.logger
    const manager = createSleepManager({
      spawn,
      platform,
      logger: log,
      available: available ?? caffeinateAvailable(platform),
    })

    /** Ids of live agents whose public status is `running`. */
    const running = new Set()

    const reconcile = () => {
      try {
        const enabled = readLive(config?.enabled, true) === true
        manager.sync(running, readMuted(config?.mutedSessions), enabled)
      } catch (error) {
        try { log?.warn?.('nightowl: keep-awake reconcile failed', error) } catch { /* swallowed */ }
      }
    }

    /** Host event listeners must contain every failure instead of rethrowing it. */
    const listen = (event, handler) => {
      try {
        ctx.on(event, (payload) => {
          try {
            handler(payload)
          } catch (error) {
            try { log?.warn?.(`nightowl: ${event} handling failed`, error) } catch { /* swallowed */ }
          }
        })
      } catch (error) {
        try { log?.warn?.(`nightowl: cannot observe ${event}`, error) } catch { /* swallowed */ }
      }
    }

    const remember = (agent, status) => {
      const id = sessionIdOf(agent)
      if (id === undefined) return
      if (status === 'running') running.add(id)
      else running.delete(id)
    }

    listen('agent/status', ({ agent, status }) => {
      remember(agent, status)
      reconcile()
    })
    listen('agent/created', ({ agent }) => {
      remember(agent, agent?.status)
      reconcile()
    })
    listen('agent/disposed', ({ agent }) => {
      remember(agent, 'idle')
      reconcile()
    })
    // Volatile Settings writes update the references in place, then ping here.
    listen('loader/volatile-update', () => { reconcile() })

    // Unload/HMR must never leave the assertion behind.
    ctx.effect(() => () => { manager.dispose() }, 'nightowl: caffeinate assertion')

    // Seed from agents that were already running before this plugin mounted.
    try {
      for (const agent of ctx.agents.list()) remember(agent, agent?.status)
    } catch (error) {
      try { log?.warn?.('nightowl: cannot read the agent registry', error) } catch { /* swallowed */ }
    }
    reconcile()
  }
}

/** Cordis plugin body used by the Loader. */
export const apply = createPlugin()
