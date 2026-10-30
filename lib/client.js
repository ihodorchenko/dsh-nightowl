window.__ModuleLoader__.load({
  id: "dsh-nightowl",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/locales.ts
var en = {
  // Settings → General row.
  "settings.title": "Keep awake",
  "settings.description": "Keeps your Mac awake while DeepSeek Harness works. The display may still turn off, and closing the lid sleeps as usual.",
  "settings.error": "Could not save this setting. Try again.",
  "settings.locked": "This setting cannot be changed right now",
  // Session-header switch: accessible name plus the state tooltip.
  "header.label": "Keep awake for this session",
  "header.on": "This session keeps your Mac awake while it runs",
  "header.muted": "Keep awake is muted for this session",
  "header.masterOff": "Keep awake is off in Settings",
  "header.loading": "Loading keep-awake settings…",
  "header.unavailable": "Keep-awake settings are unavailable",
  "header.readOnly": "Keep-awake settings are read-only right now"
};
var ru = {
  "settings.title": "Не давать Mac засыпать",
  "settings.description": "Не даёт Mac заснуть, пока DeepSeek Harness работает. Экран может отключаться, а при закрытии крышки Mac засыпает как обычно.",
  "settings.error": "Не удалось сохранить настройку. Попробуйте ещё раз.",
  "settings.locked": "Сейчас эту настройку нельзя изменить",
  "header.label": "Не давать Mac засыпать в этом сеансе",
  "header.on": "Этот сеанс не даёт Mac заснуть, пока идёт работа",
  "header.muted": "В этом сеансе Mac может засыпать",
  "header.masterOff": "Функция отключена в настройках",
  "header.loading": "Загрузка настроек…",
  "header.unavailable": "Настройки недоступны",
  "header.readOnly": "Сейчас настройки доступны только для чтения"
};

// src/client/index.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var ENTRY_ID = "nightowl";
var NS = "nightowl";
var ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 24,
  padding: "16px 0",
  borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
};
var ROW_TITLE_STYLE = { fontSize: 14, lineHeight: "20px" };
var ROW_DESCRIPTION_STYLE = {
  marginTop: 4,
  color: "var(--dsw-alias-label-secondary)",
  fontSize: 12,
  lineHeight: "18px"
};
var ROW_ERROR_STYLE = {
  marginTop: 4,
  color: "var(--dsw-alias-state-error-primary)",
  fontSize: 12,
  lineHeight: "18px"
};
var HEADER_ROOT_STYLE = {
  display: "inline-flex",
  flex: "none",
  alignItems: "center",
  gap: 6,
  color: "var(--dsw-alias-label-tertiary)"
};
function MoonIcon({ dimmed }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      style: { display: "block", flex: "none", opacity: dimmed ? 0.5 : 1 },
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z", fill: "currentColor" })
    }
  );
}
function sessionTitle(snapshot, masterEnabled, muted, t) {
  if (snapshot.status === "loading") return t("header.loading");
  if (snapshot.status === "unavailable") return t("header.unavailable");
  if (!snapshot.writable) return t("header.readOnly");
  if (!masterEnabled) return t("header.masterOff");
  if (muted) return t("header.muted");
  return t("header.on");
}
function SessionAwakeSwitch({ sessionId, t, useNightowl, setAwake }) {
  const snapshot = useNightowl((state) => state);
  const [pending, setPending] = (0, import_react.useState)(void 0);
  const config = snapshot.value;
  const masterEnabled = config?.enabled ?? true;
  const muted = config?.mutedSessions?.[String(sessionId)] === true;
  const ready = snapshot.status === "ready";
  const checked = pending ?? (masterEnabled && !muted);
  const disabled = !ready || !snapshot.writable || !masterEnabled || pending !== void 0;
  const title = sessionTitle(snapshot, masterEnabled, muted, t);
  const toggle = (next) => {
    setPending(next);
    void setAwake(next).catch(() => false).finally(() => {
      setPending(void 0);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: HEADER_ROOT_STYLE, title, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MoonIcon, { dimmed: disabled }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Switch,
      {
        checked,
        disabled,
        label: t("header.label"),
        onChange: toggle,
        title
      }
    )
  ] });
}
function KeepAwakeRow({ t, useNightowl, setEnabled }) {
  const snapshot = useNightowl((state) => state);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [failed, setFailed] = (0, import_react.useState)(false);
  const enabled = snapshot.value?.enabled ?? true;
  const locked = snapshot.status !== "ready" || !snapshot.writable;
  const toggle = (next) => {
    setFailed(false);
    setBusy(true);
    void setEnabled(next).then((accepted) => {
      if (!accepted) setFailed(true);
    }).catch(() => {
      setFailed(true);
    }).finally(() => {
      setBusy(false);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: ROW_STYLE, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: ROW_TITLE_STYLE, children: t("settings.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: ROW_DESCRIPTION_STYLE, children: t("settings.description") }),
      failed && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "alert", style: ROW_ERROR_STYLE, children: t("settings.error") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      import_dsh_client_ui_primitives.Switch,
      {
        checked: enabled,
        disabled: busy || locked,
        label: t("settings.title"),
        onChange: toggle,
        title: locked && !busy ? t("settings.locked") : void 0
      }
    )
  ] });
}
var inject = ["slots", "locale", "configForms"];
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { en, ru }), "dsh-nightowl: dictionaries");
  const form = ctx.configForms.get(ENTRY_ID);
  ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
    name: "conversation.session.header.utilities",
    id: "nightowl-keep-awake",
    order: 30,
    locale: NS,
    inject: (sessionId) => ({
      hooks: { nightowl: form },
      // Mute = set the dict key; unmute = remove it, so the default stays on.
      setAwake: (next) => next ? form.mutate([{ op: "unset", path: ["mutedSessions", String(sessionId)] }]) : form.mutate([{ op: "set", path: ["mutedSessions", String(sessionId)], value: true }])
    })
  }, SessionAwakeSwitch));
  ctx.slots.inject("settings.general.item", () => ctx.slots.register({
    name: "settings.general.item",
    id: "nightowl",
    order: 60,
    locale: NS,
    inject: () => ({
      hooks: { nightowl: form },
      setEnabled: (next) => form.set("enabled", next)
    })
  }, KeepAwakeRow));
}
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
//# sourceMappingURL=client.js.map
