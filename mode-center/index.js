import { defineApp } from "./sdk/app-contract/server-client.js";
import {
  DEFAULT_MODES,
  appendReminder,
  appendReminderToMessages,
  applyCommand,
  applyPatch,
  buildReminder,
  chipText,
  cloneModes,
  matchCommand,
  normalizeModes,
  readModesFromConfig,
  slashCommand,
  statusText,
} from "./lib/modes.js";

export const name = "mode-center";

const CHIP_ID = "mode-chip";
const PANEL_TOOLTIP = "面板未授权。用 /mode 切换。";

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function modesBody(sessionId, modes) {
  return {
    ok: true,
    sessionId,
    modes,
    chipText: chipText(modes),
  };
}

export default defineApp(async (sdk) => {
  const idToPath = new Map();
  const pathToId = new Map();
  const isolatedIds = new Set();
  const isolatedPaths = new Set();
  let panelDenied = false;
  let commandState = "idle";

  const remember = (sessionId, sessionPath) => {
    if (!sessionId || !sessionPath) return;
    idToPath.set(sessionId, sessionPath);
    pathToId.set(sessionPath, sessionId);
  };

  const isIsolated = (sessionId, sessionPath) => {
    return (sessionId && isolatedIds.has(sessionId)) || (sessionPath && isolatedPaths.has(sessionPath));
  };

  const cleanId = (value) => typeof value === "string" && value.trim() ? value.trim() : "";

  const resolveIdentity = (sessionId, sessionPath) => {
    const id = sessionId || (sessionPath && pathToId.get(sessionPath)) || "";
    const path = sessionPath || (sessionId && idToPath.get(sessionId)) || "";
    return { sessionId: id, sessionPath: path };
  };

  const readModes = async (sessionId, sessionPath) => {
    if (isIsolated(sessionId, sessionPath)) return cloneModes(DEFAULT_MODES);
    return readModesFromConfig(sdk.config, sessionId, sessionPath, (error) => {
      void sdk.logger.info("mode-center: config unread", {
        message: error?.message || String(error),
      });
    });
  };

  const writeModes = async (sessionId, sessionPath, modes) => {
    if (isIsolated(sessionId, sessionPath)) throw new Error("隔离会话不写配置");
    if (!sessionId && !sessionPath) throw new Error("没有会话身份，不写配置");
    const value = normalizeModes(modes);
    if (sessionId) {
      await sdk.config.set("modes", value, { sessionId });
      return;
    }
    await sdk.config.set("modes", value, { sessionPath });
  };

  const refreshChip = async (sessionId, sessionPath) => {
    if (!sessionId || isIsolated(sessionId, sessionPath)) return;
    const modes = await readModes(sessionId, sessionPath);
    const patch = { sessionId, id: CHIP_ID, text: chipText(modes) };
    if (panelDenied) patch.tooltip = PANEL_TOOLTIP;
    try {
      await sdk.inputStatus.set(patch);
    } catch (error) {
      await sdk.logger.info("mode-center: chip refresh skipped", {
        message: error?.message || String(error),
      });
    }
  };

  const onSessionCreated = (event, sessionPathArg) => {
    if (!event || typeof event !== "object") return;
    if (typeof event.type === "string" && event.type !== "session_created") return;
    const sessionId = typeof event.sessionId === "string" ? event.sessionId.trim() : "";
    const fromEvent = typeof event.sessionPath === "string" ? event.sessionPath.trim() : "";
    const fromArg = typeof sessionPathArg === "string" ? sessionPathArg.trim() : "";
    const sessionPath = fromEvent || fromArg;
    if (event.isolated === true) {
      if (sessionId) isolatedIds.add(sessionId);
      if (sessionPath) isolatedPaths.add(sessionPath);
      return;
    }
    if (sessionId && sessionPath) remember(sessionId, sessionPath);
    if (sessionId) void refreshChip(sessionId, sessionPath);
  };

  const logHook = async (hook, rawId, rawPath, modes, injected) => {
    try {
      await sdk.logger.info(`mode-center: hook ${hook} injected=${injected === true}`);
    } catch {
      // 日志失败不能挡住这一轮。
    }
  };

  await sdk.bus.subscribe(onSessionCreated, { types: ["session_created"] });

  await sdk.hooks.onDecision("session/input", async ({ text, session }) => {
    const rawId = cleanId(session?.sessionId);
    const rawPath = cleanId(session?.sessionPath);
    const { sessionId, sessionPath } = resolveIdentity(rawId, rawPath);
    let modes = cloneModes(DEFAULT_MODES);
    let injected = false;
    try {
      if (typeof text !== "string" || isIsolated(sessionId, sessionPath) || (!sessionId && !sessionPath)) return;
      if (rawId && rawPath) remember(rawId, rawPath);

      const command = matchCommand(text);
      const skipCard = command?.kind === "skip";
      if (command && !skipCard) {
        try {
          const next = applyCommand(await readModes(sessionId, sessionPath), command);
          await writeModes(sessionId, sessionPath, next);
          if (sessionId) await refreshChip(sessionId, sessionPath);
        } catch (error) {
          await sdk.logger.warn("mode-center: command did not persist", {
            message: error?.message || String(error),
          });
        }
      }

      modes = await readModes(sessionId, sessionPath);
      const nextText = appendReminder(text, buildReminder(modes, skipCard));
      if (nextText == null) return;
      injected = true;
      return { text: nextText };
    } finally {
      await logHook("session/input", rawId, rawPath, modes, injected);
    }
  });

  await sdk.hooks.onDecision("agent/pre-step", async ({ messages, session }) => {
    const rawId = cleanId(session?.sessionId);
    const rawPath = cleanId(session?.sessionPath);
    const { sessionId, sessionPath } = resolveIdentity(rawId, rawPath);
    let modes = cloneModes(DEFAULT_MODES);
    let injected = false;
    try {
      if (!Array.isArray(messages) || isIsolated(sessionId, sessionPath) || (!sessionId && !sessionPath)) return;
      if (rawId && rawPath) remember(rawId, rawPath);

      let lastUserText;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role !== "user") continue;
        if (typeof message.content === "string") {
          lastUserText = message.content;
        } else if (Array.isArray(message.content)) {
          for (let j = message.content.length - 1; j >= 0; j -= 1) {
            const part = message.content[j];
            if (part?.type === "text" && typeof part.text === "string") {
              lastUserText = part.text;
              break;
            }
          }
        }
        break;
      }

      const skipCard = matchCommand(lastUserText)?.kind === "skip";
      modes = await readModes(sessionId, sessionPath);
      const nextMessages = appendReminderToMessages(messages, buildReminder(modes, skipCard));
      if (nextMessages == null) return;
      injected = true;
      return { messages: nextMessages };
    } finally {
      await logHook("agent/pre-step", rawId, rawPath, modes, injected);
    }
  });

  await sdk.hooks.onDecision("agent/before-start", async ({ systemPrompt, session }) => {
    const rawId = cleanId(session?.sessionId);
    const rawPath = cleanId(session?.sessionPath);
    const { sessionId, sessionPath } = resolveIdentity(rawId, rawPath);
    let modes = cloneModes(DEFAULT_MODES);
    let injected = false;
    try {
      if (typeof systemPrompt !== "string" || isIsolated(sessionId, sessionPath) || (!sessionId && !sessionPath)) return;
      if (rawId && rawPath) remember(rawId, rawPath);

      modes = await readModes(sessionId, sessionPath);
      const nextPrompt = appendReminder(systemPrompt, buildReminder(modes, false));
      if (nextPrompt == null) return;
      injected = true;
      return { systemPrompt: nextPrompt };
    } finally {
      await logHook("agent/before-start", rawId, rawPath, modes, injected);
    }
  });

  await sdk.tools.register({
    name: "open_mode_picker",
    description: "打开当前会话的模式面板。不发送消息，不发起模型回复。",
    parameters: { type: "object", properties: {} },
    execute: async (args) => {
      const sessionId = typeof args?.context?.sessionId === "string" ? args.context.sessionId : "";
      const sessionPath = typeof args?.context?.sessionPath === "string" ? args.context.sessionPath : "";
      if (!sessionId || !sessionPath) {
        return textResult("打不开面板：这次点击没有会话身份。");
      }
      if (isIsolated(sessionId, sessionPath)) {
        return textResult("隔离会话不打开模式面板。");
      }
      remember(sessionId, sessionPath);
      try {
        await sdk.userInteraction.show({
          sessionId,
          id: "mode-picker",
          title: "模式",
          contentFrame: {
            route: "/mode-picker.html",
            data: { sessionId },
          },
          presentation: { height: 208, collapsedHeight: 36, expanded: true },
        });
      } catch (error) {
        const message = error?.message || String(error);
        if (message.includes("app/input.panels")) {
          panelDenied = true;
          await refreshChip(sessionId, sessionPath);
          return textResult("面板未授权。用 /mode card 或 /mode follow 切换。");
        }
        return textResult(message);
      }
      panelDenied = false;
      await refreshChip(sessionId, sessionPath);
      return textResult("已打开模式面板。");
    },
  });

  await sdk.routes.register((app) => {
    app.get("/theme", async (c) => {
      try {
        const value = await sdk.config.get("themeFace");
        const themeFace = value === "light" || value === "dark" ? value : "follow";
        return c.json({ ok: true, themeFace });
      } catch {
        return c.json({ ok: true, themeFace: "follow" });
      }
    });

    app.post("/theme", async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "themeFace 只允许 follow、light 或 dark" }, 400);
      }
      const themeFace = body?.themeFace;
      if (themeFace !== "follow" && themeFace !== "light" && themeFace !== "dark") {
        return c.json({ ok: false, error: "themeFace 只允许 follow、light 或 dark" }, 400);
      }
      await sdk.config.set("themeFace", themeFace);
      return c.json({ ok: true, themeFace });
    });

    app.get("/modes", async (c) => {
      const sessionId = String(c.req.query("sessionId") || "").trim();
      if (!sessionId) return c.json({ ok: false, error: "缺少 sessionId，不写配置" }, 400);
      if (isolatedIds.has(sessionId)) return c.json(modesBody(sessionId, cloneModes(DEFAULT_MODES)));
      const sessionPath = idToPath.get(sessionId) || "";
      return c.json(modesBody(sessionId, await readModes(sessionId, sessionPath)));
    });

    app.post("/modes", async (c) => {
      let body;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ ok: false, error: "请求体不是 JSON" }, 400);
      }
      const sessionId = body && typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) return c.json({ ok: false, error: "缺少 sessionId，不写配置" }, 400);
      if (isolatedIds.has(sessionId)) return c.json({ ok: false, error: "隔离会话不写配置" }, 400);
      const sessionPath = idToPath.get(sessionId) || "";
      const current = await readModes(sessionId, sessionPath);
      let next;
      try {
        next = applyPatch(current, body);
      } catch (error) {
        return c.json({ ok: false, error: error?.message || "请求无效" }, 400);
      }
      if (body.card === undefined && body.follow === undefined) {
        return c.json(modesBody(sessionId, current));
      }
      try {
        await writeModes(sessionId, sessionPath, next);
      } catch (error) {
        return c.json({ ok: false, error: error?.message || "没有写入" }, 400);
      }
      await refreshChip(sessionId, sessionPath);
      return c.json(modesBody(sessionId, next));
    });
  });

  const registerModeCommand = () => {
    if (commandState !== "idle") return;
    commandState = "pending";
    sdk.commands.register({
      name: "mode",
      description: "查看或切换当前桌面会话的卡片与追问",
      usage: "/mode | /mode card brief|pro|off | /mode follow on|off|in|out",
      handler: async (invocation) => {
        const sessionPath = typeof invocation?.sessionPath === "string" ? invocation.sessionPath : "";
        if (!sessionPath) return "仅桌面会话可用";
        if (isolatedPaths.has(sessionPath)) return "隔离会话不改模式";
        const sessionId = pathToId.get(sessionPath) || "";
        const command = slashCommand(invocation?.args);
        if (!command) return "用法：/mode、/mode card brief|pro|off、/mode follow on|off|in|out";
        if (command.kind === "status") return statusText(await readModes(sessionId, sessionPath));
        try {
          const next = applyCommand(await readModes(sessionId, sessionPath), command);
          await writeModes(sessionId, sessionPath, next);
          if (sessionId) await refreshChip(sessionId, sessionPath);
          return statusText(next);
        } catch (error) {
          return error?.message || "没有写入";
        }
      },
    }).then(() => {
      commandState = "done";
    }).catch((error) => {
      commandState = "idle";
      void sdk.logger.info("mode-center: /mode unavailable in this composition", {
        message: error?.message || String(error),
      });
    });
  };

  registerModeCommand();
  setTimeout(registerModeCommand, 1500);
});
