import { createHanaAppUiSdk } from "./sdk.js";

const THEME_FACES = ["follow", "light", "dark"];
const HOST_VARS = ["--bg", "--text", "--text-light", "--accent", "--border", "--coral", "--font-ui", "--fs-ui", "--radius-md", "--corner-radius-scale"];

export function resolveThemeFace(snapshot, themeFace = "follow") {
  const requested = THEME_FACES.includes(themeFace) ? themeFace : "follow";
  const palette = requested === "follow" ? null : snapshot?.palettes?.[requested];
  const missingPalette = requested !== "follow" && !(typeof palette?.cssUrl === "string" && palette.cssUrl.trim());
  const effectiveFace = missingPalette ? "follow" : requested;
  const selected = effectiveFace === "follow" ? snapshot : palette;
  return {
    effectiveFace,
    missingPalette,
    theme: typeof selected?.theme === "string" ? selected.theme : "",
    cssUrl: typeof selected?.cssUrl === "string" ? selected.cssUrl : "",
    appearance: effectiveFace === "follow" ? snapshot?.appearance : effectiveFace,
  };
}

export async function requestThemeFace(hana, themeFace) {
  const response = themeFace === undefined
    ? await hana.api.fetch("/theme")
    : await hana.api.fetch("/theme", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ themeFace }),
    });
  let body = null;
  try {
    body = JSON.parse(await response.text());
  } catch {
    /* 空正文或非 JSON 仍按接口失败处理。 */
  }
  if (!response.ok || body?.ok === false) {
    const detail = typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : "";
    throw new Error(detail || "接口返回 " + response.status + "。");
  }
  if (body?.ok !== true || !THEME_FACES.includes(body.themeFace)) throw new Error("接口返回的面板主题不对。");
  return body.themeFace;
}

function themeFailure(error) {
  const message = typeof error?.message === "string" ? error.message.replace(/\s+/g, " ").trim() : "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "没写上。连不上主题接口。";
  return "没写上。" + (message.slice(0, 96) || "再点一次。");
}

// 读写状态独立于 DOM，设置页与面板共用同一份退回规则。
export function createThemeFaceState(hana, onChange = () => {}) {
  let state = { themeFace: "follow", loading: true, saving: false, pendingFace: "", error: "", errorKind: "" };
  let generation = 0;
  let readQueued = false;
  const getState = () => ({ ...state });
  const publish = () => onChange(getState());

  async function read() {
    if (state.saving) {
      readQueued = true;
      return;
    }
    const current = ++generation;
    try {
      const themeFace = await requestThemeFace(hana);
      if (current !== generation) return;
      const keepFailure = state.errorKind === "write";
      state = { ...state, themeFace, loading: false, error: keepFailure ? state.error : "", errorKind: keepFailure ? "write" : "" };
    } catch {
      if (current !== generation) return;
      const keepFailure = state.errorKind === "write";
      state = { ...state, themeFace: "follow", loading: false, error: keepFailure ? state.error : "没读到面板主题，先跟着当前主题。", errorKind: keepFailure ? "write" : "read" };
    }
    publish();
  }

  async function save(themeFace) {
    if (state.loading || state.saving || !THEME_FACES.includes(themeFace)) return false;
    if (themeFace === state.themeFace && !state.error) return false;
    const previous = state.themeFace;
    generation += 1; // 较早的 GET 不能盖住这次点选。
    state = { ...state, saving: true, pendingFace: themeFace, error: "", errorKind: "" };
    publish();
    let saved = false;
    try {
      const next = await requestThemeFace(hana, themeFace);
      state = { ...state, themeFace: next };
      saved = true;
    } catch (error) {
      state = { ...state, themeFace: previous, error: themeFailure(error), errorKind: "write" };
    } finally {
      state = { ...state, saving: false, pendingFace: "" };
      publish();
      if (readQueued) {
        readQueued = false;
        void read();
      }
    }
    return saved;
  }

  return { getState, read, save };
}

// 首次订阅已有打开时的 GET；其后的主题推送和重新可见才补读。
export function observeThemeFace(hana, onSnapshot, refresh, page = globalThis.document) {
  const stops = [];
  let initialTheme = true;
  try {
    stops.push(hana.theme.subscribe((snapshot) => {
      onSnapshot(snapshot);
      if (!initialTheme) void refresh();
      initialTheme = false;
    }));
  } catch {
    /* 没有主题桥时仍可读写主题选择。 */
  }
  let visible;
  try {
    stops.push(hana.lifecycle.subscribe((snapshot) => {
      const next = Boolean(snapshot.visible);
      if (visible === false && next) void refresh();
      visible = next;
    }));
  } catch {
    /* 原生 document 可见性仍可通知。 */
  }
  const onVisible = () => {
    if (page?.visibilityState === "visible") void refresh();
  };
  page?.addEventListener("visibilitychange", onVisible);
  return () => {
    for (const stop of stops) if (typeof stop === "function") stop();
    page?.removeEventListener("visibilitychange", onVisible);
  };
}

function mirrorParent() {
  const parent = window.parent;
  if (!parent || parent === window) return;
  const root = parent.document.documentElement;
  const style = parent.getComputedStyle(root);
  for (const name of HOST_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) document.documentElement.style.setProperty(name, value);
  }
  if (root.dataset.theme) document.documentElement.dataset.theme = root.dataset.theme;
}

function parseColor(value) {
  const text = value.trim();
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const raw = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return [0, 2, 4].map((index) => parseInt(raw.slice(index, index + 2), 16));
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function tuneAccentInk() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const bg = parseColor(style.getPropertyValue("--bg"));
  const text = parseColor(style.getPropertyValue("--text"));
  const accent = parseColor(style.getPropertyValue("--accent"));
  if (bg) root.style.colorScheme = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2] < 140 ? "dark" : "light";
  if (!bg || !text || !accent) return;
  const luminance = (channels) => channels.map((channel) => {
    const unit = channel / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  }).reduce((total, unit, index) => total + unit * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const ink = contrast(accent, bg) >= contrast(accent, text) ? "--bg" : "--text";
  root.style.setProperty("--on-accent", style.getPropertyValue(ink).trim());
}

export function applyThemeSnapshot(snapshot, themeFace) {
  const selected = resolveThemeFace(snapshot, themeFace);
  const root = document.documentElement;
  // 从 follow 切到某一面时，删掉镜像的行内变量，避免压过调色板 CSS。
  for (const name of HOST_VARS) root.style.removeProperty(name);
  root.style.removeProperty("--on-accent");
  root.style.colorScheme = selected.appearance === "dark" ? "dark" : "light";
  root.dataset.themeFace = selected.effectiveFace;
  if (selected.theme && selected.theme !== "inherit" && selected.theme !== "auto") root.dataset.theme = selected.theme;
  else delete root.dataset.theme;

  let link = document.getElementById("hana-theme-css");
  if (selected.cssUrl) {
    if (!link) {
      link = document.createElement("link");
      link.id = "hana-theme-css";
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.onload = tuneAccentInk;
    if (link.getAttribute("href") !== selected.cssUrl) link.setAttribute("href", selected.cssUrl);
  } else if (link) {
    link.remove();
  }
  if (selected.effectiveFace === "follow") {
    try {
      mirrorParent();
    } catch {
      /* 跨文档读不到时，使用快照当前主题，不挡点选。 */
    }
  }
  tuneAccentInk();
  return selected;
}

// 页面 ready 与事件绑定先完成；主题读取失败不会影响模式按钮。
export function followThemeFace(hana, onChange = () => {}) {
  let snapshot = {};
  try {
    snapshot = hana.theme.getSnapshot();
  } catch {
    /* 缺快照仍按 follow 读取保存值。 */
  }
  const render = (state) => {
    const selected = applyThemeSnapshot(snapshot, state.themeFace);
    onChange({ ...state, ...selected });
  };
  const controller = createThemeFaceState(hana, render);
  render(controller.getState());
  observeThemeFace(hana, (next) => {
    snapshot = next;
    render(controller.getState());
  }, controller.read);
  try {
    const parentRoot = window.parent !== window ? window.parent.document.documentElement : null;
    if (parentRoot) {
      const observer = new MutationObserver(() => {
        if (resolveThemeFace(snapshot, controller.getState().themeFace).effectiveFace === "follow") render(controller.getState());
      });
      observer.observe(parentRoot, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
      window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
    }
  } catch {
    /* 没有可读的父窗口时，主题桥仍会通知。 */
  }
  void controller.read();
  return controller;
}

function bootSettings() {
  const hana = createHanaAppUiSdk({ followHostTheme: false });
  // 设置页 readyOnTimeout 为 false，先报 ready，不等待主题或接口。
  hana.ready();
  const group = document.getElementById("theme-seg");
  const buttons = [...group.querySelectorAll(".opt")];
  const fallback = document.getElementById("theme-fallback");
  const status = document.getElementById("theme-status");
  let controller;
  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => { void controller.save(button.dataset.face); });
    button.addEventListener("keydown", (event) => {
      const direction = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : direction ? (index + direction + buttons.length) % buttons.length : -1;
      if (next < 0 || buttons[next].disabled) return;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
  }
  controller = followThemeFace(hana, (state) => {
    const choice = state.pendingFace || state.effectiveFace;
    group.setAttribute("aria-busy", String(state.loading || state.saving));
    for (const button of buttons) {
      const selected = button.dataset.face === choice;
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.disabled = state.loading || state.saving;
    }
    fallback.hidden = !state.missingPalette;
    status.textContent = state.error || (state.saving ? "写入中" : state.loading ? "在读面板主题" : "");
    status.hidden = !status.textContent;
    status.dataset.fault = String(Boolean(state.error));
    status.setAttribute("role", state.error ? "alert" : "status");
  });
}

if (typeof document !== "undefined" && document.getElementById("theme-seg")) bootSettings();
