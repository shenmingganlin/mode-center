import app from "../index.js";
const off = {
  card: { on: false, verbosity: "brief" },
  follow: { on: false, place: "out" },
};
const on = {
  card: { on: true, verbosity: "brief" },
  follow: { on: true, place: "out" },
};
const reminder = "[模式中心] 卡片开·精简：过程文字，结论一张卡，读 card-reply。追问开：三条可接着问的问题，写在卡片后面，不要放进卡内。本行是应用注入。";

async function runBeforeStart({ sessionId, sessionPath, sessions = {}, pathValue }) {
  const hooks = new Map();
  const getCalls = [];
  const logs = [];
  const receipt = () => ({ ready: Promise.resolve(), disposeAsync: async () => {} });
  const routeApp = { get() {}, post() {} };
  const context = {
    dataDir: "C:/mode-center-w10-test",
    bus: { request: async () => ({}), subscribe: () => receipt() },
    hooks: { onDecision: (name, handler) => { hooks.set(name, handler); return receipt(); } },
    tools: { register: () => receipt() },
    routes: { register: (register) => { register(routeApp); return receipt(); } },
    config: {
      getState: async () => ({ global: {}, agents: {}, sessions }),
      get: async (key, options) => {
        getCalls.push({ key, options });
        if (key !== "modes" || !options?.sessionPath || "sessionId" in options) {
          throw new Error("unexpected config.get options");
        }
        return pathValue;
      },
      set: async () => {},
    },
    logger: { info: async (message) => { logs.push(message); }, warn: async () => {} },
    inputStatus: { set: async () => {} },
    commands: { register: () => receipt() },
    userInteraction: { show: async () => {} },
    storage: { global: {}, agent: () => ({}) },
    models: {},
    media: {},
    providers: {},
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    await app.apply(context);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const handler = hooks.get("agent/before-start");
  if (!handler) throw new Error("agent/before-start hook not registered");
  const systemPrompt = "Existing system prompt";
  const result = await handler({ systemPrompt, session: { sessionId, sessionPath } });
  return { result, getCalls, logs, systemPrompt };
}

const nativePathCase = await runBeforeStart({
  sessionId: "runtime-native-id",
  sessionPath: "C:/sessions/native.jsonl",
  pathValue: on,
});
if (!nativePathCase.result?.systemPrompt?.includes(reminder)) throw new Error("native id did not fall back to active path config");
if (nativePathCase.getCalls.length !== 1 || nativePathCase.getCalls[0].options.sessionPath !== "C:/sessions/native.jsonl") {
  throw new Error("native id path fallback did not use only sessionPath");
}

const savedOffCase = await runBeforeStart({
  sessionId: "sess-saved-off",
  sessionPath: "C:/sessions/saved-off.jsonl",
  sessions: { "sess-saved-off": { modes: off } },
  pathValue: on,
});
if (savedOffCase.result !== undefined) throw new Error("stored all-off config should not inject");
if (savedOffCase.getCalls.length !== 0) throw new Error("stored sessionId bucket incorrectly fell back to path");

const noBucketCase = await runBeforeStart({ sessionId: "native-without-path", sessions: {} });
if (noBucketCase.result !== undefined) throw new Error("missing bucket and path should use all-off defaults");
if (noBucketCase.getCalls.length !== 0) throw new Error("config.get called without a path fallback");

const savedOnCase = await runBeforeStart({
  sessionId: "sess-saved-on",
  sessionPath: "C:/sessions/saved-on.jsonl",
  sessions: { "sess-saved-on": { modes: on } },
  pathValue: off,
});
if (!savedOnCase.result?.systemPrompt?.startsWith(savedOnCase.systemPrompt + "\n" + reminder)) {
  throw new Error("before-start did not append reminder after the existing prompt");
}
if (savedOnCase.systemPrompt !== "Existing system prompt") throw new Error("source prompt unexpectedly mutated");
if (savedOnCase.getCalls.length !== 0) throw new Error("stored active config incorrectly fell back to path");
if (!savedOnCase.logs.includes("mode-center: hook agent/before-start injected=true")) {
  throw new Error("before-start hook log does not identify the hook and injection result");
}
console.log("W10 assertions passed: native-id path fallback; stored all-off no fallback; missing identity defaults off; before-start appends without replacing prompt.");
