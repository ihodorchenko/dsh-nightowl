/**
 * Night Owl — browser half.
 *
 * Two controls over the Host plugin entry's config section (the entry id in
 * `cordis.patch.yml`, reached through `ctx.configForms.get('nightowl')`):
 *
 * - a compact Switch in the Session-header utilities that shows whether THIS
 *   session keeps the Mac awake (master `enabled` on and the session not in
 *   `mutedSessions`) and writes the per-session mute either way;
 * - the master row in Settings → General, bound to the `enabled` field and
 *   rendering the shipped row chrome plus a localized write error.
 *
 * Only the Cordis face is exported. The bundle has no CSS-module pipeline, so
 * the row chrome is an inline replica of the shipped `settings.general.item`
 * styles (existing `--dsw-*` tokens only). Cross-plugin contact is the
 * `configForms` service; `react` and the shared primitives package are the
 * page's platform modules.
 */
import { useState, type CSSProperties } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { en, ru, type NightOwlKey } from './locales.ts'

/** Host plugin entry id (the `nightowl` row in `cordis.patch.yml`) and settings namespace. */
const ENTRY_ID = 'nightowl'

/** Locale namespace owned by this plugin. */
const NS = 'nightowl'

/** This plugin's dictionary copy, keyed by namespace. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    nightowl: NightOwlKey
  }
}

/**
 * Resolved value of the Host entry's config section. Both fields are optional
 * here because the mirror snapshot may predate the first accepted value.
 */
interface NightOwlConfig {
  /** Master switch; off disables the whole feature. */
  enabled?: boolean
  /** Sessions that opted out of keep-awake, keyed by session id. */
  mutedSessions?: Readonly<Record<string, boolean>>
}

/** Shared observable config form for the entry (snapshot + Host write queue). */
type NightOwlForm = ConfigForm<NightOwlConfig>

/** Injected business face of the Session-header switch. */
interface SessionAwakeInjected {
  hooks: { nightowl: NightOwlForm }
  /**
   * Persist this session's opt-out and resolve with Host acceptance.
   * @param next - true keeps the session awake (clears the mute), false mutes it.
   */
  setAwake(next: boolean): Promise<boolean>
}

/** Injected business face of the Settings master row. */
interface KeepAwakeRowInjected {
  hooks: { nightowl: NightOwlForm }
  /**
   * Persist the master switch.
   * @param next - the requested feature state.
   */
  setEnabled(next: boolean): Promise<boolean>
}

/** Composed props of the Session-header switch. */
type SessionAwakeProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionAwakeInjected>

/** Composed props of the Settings → General master row. */
type KeepAwakeRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<typeof NS>
  & InjectFace<KeepAwakeRowInjected>

/**
 * Shipped `settings.general.item` row chrome, replicated inline (the shipped
 * row owns `border-bottom`; the General section strips it on the last row).
 */
const ROW_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 24,
  padding: '16px 0',
  borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
}

/** Row title: shipped 14/20 label. */
const ROW_TITLE_STYLE: CSSProperties = { fontSize: 14, lineHeight: '20px' }

/** Row description: shipped 12/18 secondary copy. */
const ROW_DESCRIPTION_STYLE: CSSProperties = {
  marginTop: 4,
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 12,
  lineHeight: '18px',
}

/** Row write error: secondary-size copy in the error state color. */
const ROW_ERROR_STYLE: CSSProperties = {
  marginTop: 4,
  color: 'var(--dsw-alias-state-error-primary)',
  fontSize: 12,
  lineHeight: '18px',
}

/** Header cluster: quiet 14px glyph + 36×20 switch in the header's 8px rhythm. */
const HEADER_ROOT_STYLE: CSSProperties = {
  display: 'inline-flex',
  flex: 'none',
  alignItems: 'center',
  gap: 6,
  color: 'var(--dsw-alias-label-tertiary)',
}

/**
 * Decorative crescent-moon glyph identifying the keep-awake control. The
 * switch's accessible name carries the feature name, so the glyph is hidden
 * from assistive technology.
 * @param props.dimmed - whether the owning switch is locked.
 * @returns the inline icon.
 */
function MoonIcon({ dimmed }: { dimmed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none', opacity: dimmed ? 0.5 : 1 }}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
    </svg>
  )
}

/**
 * Resolve the switch tooltip from the form/deployment state, most authoritative
 * lock reason first.
 * @param snapshot - current config form snapshot.
 * @param masterEnabled - resolved master switch value.
 * @param muted - whether this session opted out.
 * @param t - namespace translate function.
 * @returns localized hover text explaining the current state.
 */
function sessionTitle(
  snapshot: ReturnType<NightOwlForm['getSnapshot']>,
  masterEnabled: boolean,
  muted: boolean,
  t: SessionAwakeProps['t'],
): string {
  if (snapshot.status === 'loading') return t('header.loading')
  if (snapshot.status === 'unavailable') return t('header.unavailable')
  if (!snapshot.writable) return t('header.readOnly')
  if (!masterEnabled) return t('header.masterOff')
  if (muted) return t('header.muted')
  return t('header.on')
}

/**
 * Session-header keep-awake switch.
 *
 * The effective state is `enabled && !mutedSessions[sessionId]`. While the
 * shared form is not ready/writable, the master switch is off, or a write is
 * in flight the control is disabled; the requested state stays visible until
 * the snapshot settles, so a click never reads as a bounce. A refused write
 * reverts silently here (the Settings row owns the localized error).
 * @param props - session id, shared config form Hook, write verb, and copy.
 * @returns the compact header control.
 */
function SessionAwakeSwitch({ sessionId, t, useNightowl, setAwake }: SessionAwakeProps) {
  const snapshot = useNightowl(state => state)
  const [pending, setPending] = useState<boolean | undefined>(undefined)
  const config = snapshot.value
  const masterEnabled = config?.enabled ?? true
  const muted = config?.mutedSessions?.[String(sessionId)] === true
  const ready = snapshot.status === 'ready'
  const checked = pending ?? (masterEnabled && !muted)
  const disabled = !ready || !snapshot.writable || !masterEnabled || pending !== undefined
  const title = sessionTitle(snapshot, masterEnabled, muted, t)
  const toggle = (next: boolean): void => {
    setPending(next)
    void setAwake(next)
      // A refused write leaves the snapshot authoritative; no header copy for it.
      .catch(() => false)
      .finally(() => { setPending(undefined) })
  }
  return (
    <span style={HEADER_ROOT_STYLE} title={title}>
      <MoonIcon dimmed={disabled} />
      <Switch
        checked={checked}
        disabled={disabled}
        label={t('header.label')}
        onChange={toggle}
        title={title}
      />
    </span>
  )
}

/**
 * Settings → General master row: title, description, and the feature switch.
 *
 * Writes are disabled until the shared form reports ready + writable. A write
 * the Host refuses (or a transport rejection) reverts the switch to snapshot
 * state and surfaces the localized error beneath the description.
 * @param props - shared config form Hook, write verb, and copy.
 * @returns the General section row.
 */
function KeepAwakeRow({ t, useNightowl, setEnabled }: KeepAwakeRowProps) {
  const snapshot = useNightowl(state => state)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const enabled = snapshot.value?.enabled ?? true
  const locked = snapshot.status !== 'ready' || !snapshot.writable
  const toggle = (next: boolean): void => {
    setFailed(false)
    setBusy(true)
    void setEnabled(next)
      .then((accepted) => { if (!accepted) setFailed(true) })
      .catch(() => { setFailed(true) })
      .finally(() => { setBusy(false) })
  }
  return (
    <div style={ROW_STYLE}>
      <div>
        <div style={ROW_TITLE_STYLE}>{t('settings.title')}</div>
        <div style={ROW_DESCRIPTION_STYLE}>{t('settings.description')}</div>
        {failed && <div role="alert" style={ROW_ERROR_STYLE}>{t('settings.error')}</div>}
      </div>
      <Switch
        checked={enabled}
        disabled={busy || locked}
        label={t('settings.title')}
        onChange={toggle}
        title={locked && !busy ? t('settings.locked') : undefined}
      />
    </div>
  )
}

/**
 * Required client services: the slot ledger (both seats), copy, and the shared
 * config-forms service that owns the entry's Host mirror/write queue.
 */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Client plugin body: register dictionaries, then the Session-header and
 * Settings contributions against the one shared config form.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en, ru }), 'dsh-nightowl: dictionaries')
  const form = ctx.configForms.get<NightOwlConfig>(ENTRY_ID)

  // The Session-header utilities list is declared by ui-conversation; inject()
  // runs per declaration lifetime and receives this Session's id.
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'nightowl-keep-awake',
    order: 30,
    locale: NS,
    inject: (sessionId: string): SessionAwakeInjected => ({
      hooks: { nightowl: form },
      // Mute = set the dict key; unmute = remove it, so the default stays on.
      setAwake: (next: boolean) => next
        ? form.mutate([{ op: 'unset', path: ['mutedSessions', String(sessionId)] }])
        : form.mutate([{ op: 'set', path: ['mutedSessions', String(sessionId)], value: true }]),
    }),
  }, SessionAwakeSwitch))

  // The General section owns the row chrome; this plugin owns the preference.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'nightowl',
    order: 60,
    locale: NS,
    inject: (): KeepAwakeRowInjected => ({
      hooks: { nightowl: form },
      setEnabled: (next: boolean) => form.set('enabled', next),
    }),
  }, KeepAwakeRow))
}
