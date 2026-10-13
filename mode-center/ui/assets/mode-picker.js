import { followThemeFace } from "./settings.js";

// 模式选择面板。会话身份只认宿主 inputPanel 上下文，不猜全局焦点。
// 点选只 POST /modes。不发起模型回复，不改输入框正文。

const EXPANDED_HEIGHT = 208;
const COLLAPSED_HEIGHT = 36;

const CARD_OPTIONS = [
  { id: "off", label: "关" },
  { id: "brief", label: "精简" },
  { id: "pro", label: "专业" },
];

const FOLLOW_OPTIONS = [
  { id: "off", label: "关" },
  { id: "on", label: "开" },
];

const PLACE_OPTIONS = [
  { id: "in", label: "卡内" },
  { id: "out", label: "卡外" },
];

export function panelLine(state) {
  if (!state) return "关";
  const parts = [];
  if (state.cardOn) parts.push(state.verbosity === "pro" ? "卡片·专业" : "卡片·精简");
  if (state.followOn) parts.push(state.cardOn && state.place === "in" ? "追问·卡内" : "追问·卡外");
  return parts.length ? parts.join(" · ") : "关";
}

export function cardChoice(state) {
  if (!state?.cardOn) return "off";
  return state.verbosity === "pro" ? "pro" : "brief";
}

export function followChoice(state) {
  return state?.followOn ? "on" : "off";
}

export function placeChoice(state) {
  if (!state?.cardOn) return "out";
  return state.place === "in" ? "in" : "out";
}

export function cardOffPatch(place) {
  if (place === "in") return { card: { on: false }, follow: { place: "out" } };
  return { card: { on: false } };
}

export function presentModes(state, heldOut) {
  if (!state) return { state, heldOut: false };
  const hold = Boolean(heldOut) || (!state.cardOn && state.place === "in");
  if (hold && state.place === "in") return { state: { ...state, place: "out" }, heldOut: true };
  return { state, heldOut: hold };
}

export function shouldSyncPlace(alreadySent, state) {
  return !alreadySent && Boolean(state) && !state.cardOn && state.place === "in";
}

export function patchFor(group, choice) {
  if (group === "card" && choice === "off") return { card: { on: false } };
  if (group === "card" && choice === "brief") return { card: { on: true, verbosity: "brief" } };
  if (group === "card" && choice === "pro") return { card: { on: true, verbosity: "pro" } };
  if (group === "follow" && choice === "off") return { follow: { on: false } };
  if (group === "follow" && choice === "on") return { follow: { on: true } };
  if (group === "place" && choice === "in") return { follow: { place: "in" } };
  if (group === "place" && choice === "out") return { follow: { place: "out" } };
  return null;
}

export function readModes(body) {
  if (!body || body.ok !== true || !body.modes || typeof body.modes !== "object") {
    return { ok: false, error: "模式读数不对。" };
  }
  const card = body.modes.card;
  const follow = body.modes.follow;
  if (!card || typeof card.on !== "boolean" || !follow || typeof follow.on !== "boolean") {
    return { ok: false, error: "模式读数不对。" };
  }
  if (card.on && card.verbosity !== "brief" && card.verbosity !== "pro") {
    return { ok: false, error: "模式读数不对。" };
  }
  return {
    ok: true,
    state: {
      cardOn: card.on,
      verbosity: card.verbosity === "pro" ? "pro" : "brief",
      followOn: follow.on,
      place: follow.place === "in" ? "in" : "out",
    },
  };
}

export function failureText(kind, body, status) {
  const prefix = kind === "load" ? "没读到。" : "没写上。";
  const raw = body && typeof body === "object"
    ? (typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "")
    : "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (text) return prefix + text.slice(0, 72);
  if (typeof status === "number") return prefix + "接口返回 " + status + "。";
  return prefix + "再点一次。";
}

export function collapsedLine(view) {
  if (view.phase === "wait") return "在等宿主确认会话";
  if (view.phase === "unbound") return "还没绑到这个会话";
  if (!view.state && view.phase === "loading") return "在读模式";
  if (!view.state && view.phase === "load-error") return "没读到模式";
  const line = panelLine(view.state);
  if (view.phase === "write-error") return "没写上 · " + line;
  if (view.phase === "panel-error") return view.detail || "面板没动";
  return line;
}

function sessionIdOf(panel) {
  return panel && typeof panel.sessionId === "string" ? panel.sessionId : "";
}

async function readBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function boot(hana) {
  window.__modePickerBooted = true;

  const slip = document.getElementById("slip");
  const summary = document.getElementById("summary");
  const expandBtn = document.getElementById("expand");
  const collapseBtn = document.getElementById("collapse");
  const status = document.getElementById("status");
  const statusText = document.getElementById("status-text");
  const retry = document.getElementById("retry");
  const cardSeg = document.getElementById("card-seg");
  const followSeg = document.getElementById("follow-seg");
  const placeGroup = document.getElementById("place-group");
  const placeSeg = document.getElementById("place-seg");

  const view = {
    phase: "wait",
    state: null,
    detail: "",
    expanded: false,
    pendingChoice: "",
  };

  let boundSession = null;
  let seenRevision = -1;
  let localRevision = -1;
  let loadGen = 0;
  let writeGen = 0;
  let busy = false;
  let presentationBusy = false;
  let heightAnnounced = false;
  let placeHeldOut = false;
  let placeSyncSent = false;
  let serverPlace = "out";

  mountSeg(cardSeg, "card", CARD_OPTIONS);
  mountSeg(followSeg, "follow", FOLLOW_OPTIONS);
  mountSeg(placeSeg, "place", PLACE_OPTIONS);
  expandBtn.addEventListener("click", () => { void setExpanded(true); });
  collapseBtn.addEventListener("click", () => { void setExpanded(false); });
  retry.addEventListener("click", () => {
    if (boundSession) void load(boundSession);
  });

  function mountSeg(container, group, options) {
    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "opt";
      button.role = "radio";
      button.dataset.choice = option.id;
      button.textContent = option.label;
      button.addEventListener("click", () => choose(group, option.id));
      button.addEventListener("keydown", (event) => onSegKey(event, container, index));
      container.append(button);
    });
  }

  function onSegKey(event, container, index) {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = container.children.length - 1;
    else if (dir) next = (index + dir + container.children.length) % container.children.length;
    else return;
    event.preventDefault();
    const button = container.children[next];
    if (!(button instanceof HTMLButtonElement)) return;
    button.focus();
    if (!button.disabled) button.click();
  }

  function paint() {
    const shown = shownState();
    const line = collapsedLine(shown ? { ...view, state: shown } : view);
    const expanded = view.expanded;
    slip.dataset.expanded = expanded ? "true" : "false";
    slip.dataset.phase = view.phase;
    summary.textContent = expanded && shown ? panelLine(shown) : line;
    summary.title = view.detail || line;
    expandBtn.hidden = expanded;
    expandBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    expandBtn.setAttribute("aria-label", "展开模式选择，当前" + line);
    collapseBtn.hidden = !expanded;
    const placeOpen = Boolean(view.state?.followOn);
    const cardOffHint = placeOpen && !view.state.cardOn ? "卡片关着时，追问写在外面" : "";
    placeGroup.hidden = !placeOpen;
    const fault = view.phase === "write-error" || view.phase === "load-error" || view.phase === "panel-error";
    const showStatus = expanded && (fault || view.phase === "pending" || (view.phase === "ready" && Boolean(cardOffHint)));
    status.hidden = !showStatus;
    status.dataset.empty = showStatus ? "false" : "true";
    status.dataset.fault = fault ? "true" : "false";
    statusText.textContent = !showStatus ? "" : view.phase === "pending" ? "写入中" : fault ? view.detail : cardOffHint;
    status.setAttribute("role", fault ? "alert" : "status");
    retry.hidden = !(expanded && view.phase === "load-error" && boundSession);
    paintSeg(cardSeg, view.state ? cardChoice(view.state) : "", pendingOf("card"));
    paintSeg(followSeg, view.state ? followChoice(view.state) : "", pendingOf("follow"));
    paintSeg(placeSeg, shown ? placeChoice(shown) : "", pendingOf("place"));
    const locked = busy || !view.state || !boundSession;
    for (const button of slip.querySelectorAll(".opt")) button.disabled = locked;
    const placeIn = placeSeg.querySelector("[data-choice='in']");
    if (placeIn instanceof HTMLButtonElement) {
      if (!placeOpen || (view.state && !view.state.cardOn)) placeIn.disabled = true;
      placeIn.title = view.state && !view.state.cardOn ? "卡片关着时，追问写在外面" : "";
    }
    if (!placeOpen) {
      for (const button of placeSeg.querySelectorAll(".opt")) button.disabled = true;
    }
  }

  function pendingOf(group) {
    const prefix = group + ":";
    return view.pendingChoice.startsWith(prefix) ? view.pendingChoice.slice(prefix.length) : "";
  }

  function shownState() {
    if (!view.state) return null;
    const turningOff = view.pendingChoice === "card:off";
    if (!turningOff && !placeHeldOut && view.state.cardOn) return view.state;
    return view.state.place === "in" ? { ...view.state, place: "out" } : view.state;
  }

  function paintSeg(container, selected, pending) {
    const buttons = [...container.querySelectorAll(".opt")];
    const current = buttons.find((button) => button.dataset.choice === selected) || buttons[0];
    for (const button of buttons) {
      const on = button.dataset.choice === selected && Boolean(view.state);
      button.setAttribute("aria-checked", on ? "true" : "false");
      button.tabIndex = button === current ? 0 : -1;
      if (button.dataset.choice === pending) button.dataset.pending = "true";
      else delete button.dataset.pending;
    }
  }

  function applyExpanded(next) {
    view.expanded = Boolean(next);
    paint();
  }

  async function setExpanded(next) {
    if (presentationBusy) return;
    presentationBusy = true;
    const previous = view.expanded;
    applyExpanded(next);
    try {
      const result = await hana.inputPanel.setPresentation({
        expanded: next,
        height: EXPANDED_HEIGHT,
        collapsedHeight: COLLAPSED_HEIGHT,
      });
      const revision = result?.presentationRevision;
      if (typeof revision === "number") {
        localRevision = revision;
        seenRevision = Math.max(seenRevision, revision);
      }
      const confirmed = result?.presentation?.expanded;
      if (view.phase === "panel-error") {
        view.phase = view.state ? "ready" : "wait";
        view.detail = "";
      }
      applyExpanded(typeof confirmed === "boolean" ? confirmed : next);
      const focusTarget = view.expanded
        ? slip.querySelector(".opt[aria-checked='true']") || collapseBtn
        : expandBtn;
      if (focusTarget instanceof HTMLElement) focusTarget.focus();
    } catch (error) {
      applyExpanded(previous);
      view.phase = "panel-error";
      view.detail = "面板没" + (next ? "展开" : "收起") + "。" + clip(error);
      paint();
    } finally {
      presentationBusy = false;
    }
  }

  function announceHeight() {
    if (heightAnnounced || presentationBusy || !view.expanded) return;
    heightAnnounced = true;
    presentationBusy = true;
    hana.inputPanel.setPresentation({
      expanded: true,
      height: EXPANDED_HEIGHT,
      collapsedHeight: COLLAPSED_HEIGHT,
    }).then((result) => {
      const revision = result?.presentationRevision;
      if (typeof revision === "number") {
        localRevision = revision;
        seenRevision = Math.max(seenRevision, revision);
      }
    }).catch(() => {
      /* 高度没加上时，第三行仍在文档里，点选不靠这次确认。 */
    }).finally(() => {
      presentationBusy = false;
    });
  }

  function clip(error) {
    const text = error && typeof error.message === "string" ? error.message.replace(/\s+/g, " ").trim() : "";
    if (/failed to fetch|networkerror|load failed/i.test(text)) return "连不上模式接口";
    return text.slice(0, 60);
  }

  function currentChoice(group) {
    if (group === "card") return cardChoice(view.state);
    if (group === "place") return placeChoice(view.state);
    return followChoice(view.state);
  }

  function rememberServer(raw) {
    serverPlace = raw?.place === "in" ? "in" : "out";
  }

  function adopt(raw) {
    rememberServer(raw);
    const next = presentModes(raw, placeHeldOut);
    placeHeldOut = next.heldOut;
    return next.state;
  }

  function releaseUnconfirmedHold(group, choice) {
    if (group === "card" && choice === "off" && view.state?.cardOn && view.state?.place === "in") placeHeldOut = false;
  }

  function syncStalePlace(sessionId, raw) {
    if (!shouldSyncPlace(placeSyncSent, raw) || !sessionId) return;
    placeSyncSent = true;
    placeHeldOut = true;
    void write(sessionId, "place", "out", { follow: { place: "out" } });
  }

  function choose(group, choice) {
    if (busy || !boundSession || !view.state) return;
    if (group === "place" && !view.state.followOn) return;
    if (group === "place" && choice === "in" && !view.state.cardOn) return;
    if (currentChoice(group) === choice) return;
    if (group === "place" && choice === "in") placeHeldOut = false;
    const placeNow = view.state.place === "in" || serverPlace === "in" ? "in" : "out";
    const patch = group === "card" && choice === "off" ? cardOffPatch(placeNow) : patchFor(group, choice);
    if (!patch) return;
    if (group === "card" && choice === "off" && placeNow === "in") placeHeldOut = true;
    void write(boundSession, group, choice, patch);
  }

  async function load(sessionId) {
    const gen = ++loadGen;
    view.phase = "loading";
    view.detail = "";
    paint();
    try {
      const response = await hana.api.fetch("/modes?sessionId=" + encodeURIComponent(sessionId));
      const body = await readBody(response);
      if (gen !== loadGen || sessionId !== boundSession) return;
      if (!response.ok || body?.ok === false) {
        view.phase = "load-error";
        view.detail = failureText("load", body, response.ok ? null : response.status);
        paint();
        return;
      }
      const read = readModes(body);
      if (!read.ok) {
        view.phase = "load-error";
        view.detail = read.error;
        paint();
        return;
      }
      const raw = read.state;
      view.state = adopt(raw);
      view.phase = "ready";
      view.detail = "";
      paint();
      syncStalePlace(sessionId, raw);
    } catch (error) {
      if (gen !== loadGen || sessionId !== boundSession) return;
      view.phase = "load-error";
      view.detail = failureText("load", { message: clip(error) }, null);
      paint();
    }
  }

  async function write(sessionId, group, choice, patch) {
    const gen = ++writeGen;
    busy = true;
    view.phase = "pending";
    view.pendingChoice = group + ":" + choice;
    view.detail = "";
    paint();
    try {
      const response = await hana.api.fetch("/modes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, ...patch }),
      });
      const body = await readBody(response);
      if (gen !== writeGen || sessionId !== boundSession) return;
      busy = false;
      view.pendingChoice = "";
      if (!response.ok || body?.ok === false) {
        releaseUnconfirmedHold(group, choice);
        view.phase = "write-error";
        view.detail = failureText("write", body, response.ok ? null : response.status);
        paint();
        return;
      }
      const read = readModes(body);
      if (!read.ok) {
        releaseUnconfirmedHold(group, choice);
        view.phase = "write-error";
        view.detail = read.error;
        paint();
        return;
      }
      const raw = read.state;
      view.state = adopt(raw);
      view.phase = "ready";
      view.detail = "";
      paint();
      syncStalePlace(sessionId, raw);
    } catch (error) {
      if (gen !== writeGen || sessionId !== boundSession) return;
      busy = false;
      view.pendingChoice = "";
      releaseUnconfirmedHold(group, choice);
      view.phase = "write-error";
      view.detail = failureText("write", { message: clip(error) }, null);
      paint();
    }
  }

  function onPanel(panel) {
    if (!panel) {
      boundSession = "";
      loadGen += 1;
      writeGen += 1;
      busy = false;
      placeHeldOut = false;
      placeSyncSent = false;
      serverPlace = "out";
      view.state = null;
      view.pendingChoice = "";
      view.phase = "wait";
      view.detail = "";
      paint();
      return;
    }
    const revision = typeof panel.presentationRevision === "number" ? panel.presentationRevision : -1;
    if (revision >= seenRevision) {
      seenRevision = revision;
      if (!presentationBusy && revision >= localRevision) applyExpanded(Boolean(panel.presentation?.expanded));
    }
    if (view.expanded) announceHeight();
    const sessionId = sessionIdOf(panel);
    if (sessionId === boundSession) return;
    boundSession = sessionId;
    loadGen += 1;
    writeGen += 1;
    busy = false;
    placeHeldOut = false;
    placeSyncSent = false;
    serverPlace = "out";
    view.pendingChoice = "";
    view.state = null;
    if (!sessionId) {
      view.phase = "unbound";
      view.detail = "还没绑到这个会话，不能改模式。";
      paint();
      return;
    }
    void load(sessionId);
  }

  paint();
  hana.inputPanel.onContextChanged(onPanel);
  hana.inputPanel.onSubmit(() => null);
  const current = hana.inputPanel.getContext();
  if (current) onPanel(current);
  hana.ready();
  followThemeFace(hana);
}

if (typeof document !== "undefined") {
  const { createHanaAppUiSdk } = await import("./sdk.js");
  boot(createHanaAppUiSdk({ followHostTheme: false }));
}
