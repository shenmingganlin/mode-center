export const MARK = "[模式中心]";

export const DEFAULT_MODES = Object.freeze({
  card: Object.freeze({ on: false, verbosity: "brief" }),
  follow: Object.freeze({ on: false, place: "out" }),
});

const TRAILING = new Set(["。", "！", "？", "!", "?", ".", ",", ";", "；", "、", "…"]);

const CARD_ON_BRIEF = new Set([
  "开启卡片回答模式",
  "启用卡片回答模式",
  "打开卡片回答模式",
  "精简卡片",
]);
const CARD_ON_PRO = new Set(["专业卡片", "开启专业卡片"]);
const CARD_OFF = new Set(["关闭卡片回答模式", "取消卡片回答模式"]);
const FOLLOW_ON = new Set(["开启追问模式", "启用追问模式", "打开追问模式", "开启追问"]);
const FOLLOW_OFF = new Set(["关闭追问模式", "暂停追问模式", "取消追问"]);
const SKIP_CARD = new Set(["这次不用卡片", "这条用文字"]);

export async function readModesFromConfig(config, sessionId, sessionPath, onError = () => {}) {
  if (!sessionId && !sessionPath) return cloneModes(DEFAULT_MODES);

  if (sessionId) {
    try {
      const state = await config.getState();
      const bucket = state?.sessions?.[sessionId];
      if (bucket && Object.prototype.hasOwnProperty.call(bucket, "modes")) {
        return normalizeModes(bucket.modes);
      }
    } catch (error) {
      try {
        await onError(error);
      } catch {
        // Logging failure must not block the path fallback.
      }
    }
  }

  if (!sessionPath) return cloneModes(DEFAULT_MODES);
  try {
    const value = await config.get("modes", { sessionPath });
    return normalizeModes(value);
  } catch (error) {
    try {
      await onError(error);
    } catch {
      // Logging failure must not change the all-off fallback.
    }
    return cloneModes(DEFAULT_MODES);
  }
}

export function cloneModes(modes) {
  const source = modes && typeof modes === "object" ? modes : DEFAULT_MODES;
  return {
    card: {
      on: source.card?.on === true,
      verbosity: source.card?.verbosity === "pro" ? "pro" : "brief",
    },
    follow: {
      on: source.follow?.on === true,
      place: source.follow?.place === "in" ? "in" : "out",
    },
  };
}

export function normalizeModes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return cloneModes(DEFAULT_MODES);
  const card = value.card;
  const follow = value.follow;
  if (!card || typeof card !== "object" || Array.isArray(card) || typeof card.on !== "boolean") {
    return cloneModes(DEFAULT_MODES);
  }
  if (card.verbosity !== "brief" && card.verbosity !== "pro") return cloneModes(DEFAULT_MODES);
  if (!follow || typeof follow !== "object" || Array.isArray(follow) || typeof follow.on !== "boolean") {
    return cloneModes(DEFAULT_MODES);
  }
  return {
    card: { on: card.on, verbosity: card.verbosity },
    follow: { on: follow.on, place: follow.place === "in" ? "in" : "out" },
  };
}

function normalizeFollowPlaceForCard(modes) {
  if (!modes.card.on && modes.follow.place === "in") modes.follow.place = "out";
  return modes;
}

export function chipText(modes) {
  const card = modes?.card?.on === true;
  const follow = modes?.follow?.on === true;
  if (card && follow) return "卡片·追问";
  if (card) return "卡片";
  if (follow) return "追问";
  return "关";
}

export function statusText(modes) {
  const normalized = normalizeModes(modes);
  const card = normalized.card.on
    ? `卡片开·${normalized.card.verbosity === "pro" ? "专业" : "精简"}`
    : "卡片关";
  const place = normalized.card.on && normalized.follow.place === "in" ? "卡内" : "卡外";
  const follow = normalized.follow.on ? `追问开·${place}` : "追问关";
  return `${card}，${follow}。`;
}

export function buildReminder(modes, skipCard) {
  const normalized = normalizeModes(modes);
  const cardOn = normalized.card.on && !skipCard;
  const followOn = normalized.follow.on;
  if (skipCard) {
    let line = `${MARK} 本条不用卡片：过程与结论都用文字，不要出卡片。`;
    if (followOn) line += "追问开：三条可接着问的问题，写在回答末尾。";
    return `${line}本行是应用注入。`;
  }
  if (!cardOn && !followOn) return "";
  let line = `${MARK} `;
  if (cardOn) {
    const level = normalized.card.verbosity === "pro" ? "专业" : "精简";
    line += `卡片开·${level}：过程文字，结论一张卡，读 card-reply。`;
  }
  if (followOn) {
    if (!cardOn) line += "追问开：三条可接着问的问题，写在回答末尾。";
    else if (normalized.follow.place === "in") line += "追问开：三条可接着问的问题，放进结论卡，不要在卡片后面再写一份。这张卡若放不下追问，就写在卡片后面，不要吞掉。";
    else line += "追问开：三条可接着问的问题，写在卡片后面，不要放进卡内。";
  }
  line += "本行是应用注入。";
  return line;
}

export function appendReminder(text, line) {
  if (typeof text !== "string") return null;
  const currentLine = typeof line === "string" ? line : "";
  const start = text.indexOf(MARK);
  if (start < 0) {
    if (!currentLine) return null;
    if (text.length === 0) return currentLine;
    return text.endsWith("\n") ? `${text}${currentLine}` : `${text}\n${currentLine}`;
  }

  const endMarker = "本行是应用注入。";
  const markerEnd = text.indexOf(endMarker, start);
  const lineEnd = text.indexOf("\n", start);
  const end = markerEnd >= 0
    ? markerEnd + endMarker.length
    : lineEnd >= 0 ? lineEnd : text.length;
  const oldLine = text.slice(start, end);
  if (oldLine === currentLine) return null;

  let replaceStart = start;
  if (!currentLine && replaceStart > 0 && text[replaceStart - 1] === "\n") replaceStart -= 1;
  return `${text.slice(0, replaceStart)}${currentLine}${text.slice(end)}`;
}

export function appendReminderToMessages(messages, line) {
  if (!Array.isArray(messages)) return null;
  let userIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") {
      userIndex = i;
      break;
    }
  }
  if (userIndex < 0) return null;

  const message = messages[userIndex];
  let nextMessage;
  if (typeof message.content === "string") {
    const nextText = appendReminder(message.content, line);
    if (nextText == null) return null;
    nextMessage = { ...message, content: nextText };
  } else if (Array.isArray(message.content)) {
    let textIndex = -1;
    for (let i = message.content.length - 1; i >= 0; i -= 1) {
      const part = message.content[i];
      if (part?.type === "text" && typeof part.text === "string") {
        textIndex = i;
        break;
      }
    }
    if (textIndex < 0) return null;
    const part = message.content[textIndex];
    const nextText = appendReminder(part.text, line);
    if (nextText == null) return null;
    const content = message.content.slice();
    content[textIndex] = { ...part, text: nextText };
    nextMessage = { ...message, content };
  } else {
    return null;
  }

  const nextMessages = messages.slice();
  nextMessages[userIndex] = nextMessage;
  return nextMessages;
}

export function normalizeSentence(text) {
  if (typeof text !== "string") return "";
  let value = text.trim();
  if (!value) return "";
  const chars = Array.from(value);
  const last = chars.at(-1);
  if (last && TRAILING.has(last)) value = chars.slice(0, -1).join("").trim();
  return value;
}

export function matchCommand(text) {
  const sentence = normalizeSentence(text);
  if (!sentence) return null;
  if (CARD_ON_BRIEF.has(sentence)) return { kind: "card", on: true, verbosity: "brief" };
  if (CARD_ON_PRO.has(sentence)) return { kind: "card", on: true, verbosity: "pro" };
  if (CARD_OFF.has(sentence)) return { kind: "card", on: false };
  if (FOLLOW_ON.has(sentence)) return { kind: "follow", on: true };
  if (FOLLOW_OFF.has(sentence)) return { kind: "follow", on: false };
  if (SKIP_CARD.has(sentence)) return { kind: "skip" };
  return null;
}

export function applyCommand(current, command) {
  const next = normalizeFollowPlaceForCard(normalizeModes(current));
  if (!command || command.kind === "skip") return next;
  if (command.kind === "card") {
    next.card.on = command.on === true;
    if (command.on === true && (command.verbosity === "brief" || command.verbosity === "pro")) {
      next.card.verbosity = command.verbosity;
    }
  } else if (command.kind === "follow") {
    if (command.on !== undefined) next.follow.on = command.on === true;
    if (command.place !== undefined) next.follow.place = command.place;
  }
  return normalizeFollowPlaceForCard(next);
}

export function applyPatch(current, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("请求体必须是对象");
  const next = normalizeModes(current);
  if (body.card !== undefined) {
    if (!body.card || typeof body.card !== "object" || Array.isArray(body.card)) {
      throw new Error("card 必须是对象");
    }
    if (body.card.on !== undefined) {
      if (typeof body.card.on !== "boolean") throw new Error("card.on 必须是布尔值");
      next.card.on = body.card.on;
    }
    if (body.card.verbosity !== undefined) {
      if (body.card.verbosity !== "brief" && body.card.verbosity !== "pro") {
        throw new Error("verbosity 只允许 brief 或 pro");
      }
      next.card.verbosity = body.card.verbosity;
    }
    if (next.card.on && next.card.verbosity !== "brief" && next.card.verbosity !== "pro") {
      next.card.verbosity = "brief";
    }
  }
  if (body.follow !== undefined) {
    if (!body.follow || typeof body.follow !== "object" || Array.isArray(body.follow)) {
      throw new Error("follow 必须是对象");
    }
    if (body.follow.on !== undefined) {
      if (typeof body.follow.on !== "boolean") throw new Error("follow.on 必须是布尔值");
      next.follow.on = body.follow.on;
    }
    if (body.follow.place !== undefined) {
      if (body.follow.place !== "in" && body.follow.place !== "out") {
        throw new Error("follow.place 只允许 in 或 out");
      }
      next.follow.place = body.follow.place;
    }
  }
  return normalizeFollowPlaceForCard(next);
}

export function slashCommand(args) {
  const parts = String(args || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { kind: "status" };
  if (parts.length === 2 && parts[0] === "card" && (parts[1] === "brief" || parts[1] === "pro" || parts[1] === "off")) {
    return parts[1] === "off"
      ? { kind: "card", on: false }
      : { kind: "card", on: true, verbosity: parts[1] };
  }
  if (parts.length === 2 && parts[0] === "follow" && (parts[1] === "on" || parts[1] === "off")) {
    return { kind: "follow", on: parts[1] === "on" };
  }
  if (parts.length === 2 && parts[0] === "follow" && (parts[1] === "in" || parts[1] === "out")) {
    return { kind: "follow", place: parts[1] };
  }
  return null;
}
