/**
 * `nightowl` locale namespace dictionaries.
 *
 * The Session-header switch and the Settings → General row both draw every
 * visible/accessible string from here; no copy is hardcoded in the components.
 * English is the key-set source of truth and Russian is checked complete
 * against it; other active locales fall back to English through the locale
 * service's fallback chain.
 */

/** English dictionary — the key-set source of truth. */
export const en = {
  // Settings → General row.
  'settings.title': 'Keep awake',
  'settings.description':
    'Keeps your Mac awake while DeepSeek Harness works. The display may still turn off, and closing the lid sleeps as usual.',
  'settings.error': 'Could not save this setting. Try again.',
  'settings.locked': 'This setting cannot be changed right now',
  // Session-header switch: accessible name plus the state tooltip.
  'header.label': 'Keep awake for this session',
  'header.on': 'This session keeps your Mac awake while it runs',
  'header.muted': 'Keep awake is muted for this session',
  'header.masterOff': 'Keep awake is off in Settings',
  'header.loading': 'Loading keep-awake settings…',
  'header.unavailable': 'Keep-awake settings are unavailable',
  'header.readOnly': 'Keep-awake settings are read-only right now',
} satisfies Record<string, string>

/** The `nightowl` namespace key union. */
export type NightOwlKey = keyof typeof en

/** Russian dictionary, checked complete against the English key set. */
export const ru = {
  'settings.title': 'Не давать Mac засыпать',
  'settings.description':
    'Не даёт Mac заснуть, пока DeepSeek Harness работает. Экран может отключаться, а при закрытии крышки Mac засыпает как обычно.',
  'settings.error': 'Не удалось сохранить настройку. Попробуйте ещё раз.',
  'settings.locked': 'Сейчас эту настройку нельзя изменить',
  'header.label': 'Не давать Mac засыпать в этом сеансе',
  'header.on': 'Этот сеанс не даёт Mac заснуть, пока идёт работа',
  'header.muted': 'В этом сеансе Mac может засыпать',
  'header.masterOff': 'Функция отключена в настройках',
  'header.loading': 'Загрузка настроек…',
  'header.unavailable': 'Настройки недоступны',
  'header.readOnly': 'Сейчас настройки доступны только для чтения',
} satisfies Record<NightOwlKey, string>
