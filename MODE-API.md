# 模式中心 · 面板与注入接口

计划修订 r1。路径在静态检查后改过一次：宿主要求可安装目录名等于 id，不能再放在名为 `app` 的文件夹里。本文件的接口字段仍准；与 DESIGN.md 的范围冲突时，以本文件为准。

## 文件写者

- 墨斗：可安装包里除 `ui/**` 以外的实现。不要再写回旧的 `app/` 目录。
- 拾光：只写可安装包里的 `ui/**`。
- 明微：`DESIGN.md`、`MODE-API.md`、`skills-src/**`。实现者只复制 `skills-src`，不改写。

可安装目录：`C:\Users\Ganlin\Desktop\OH-WorkSpace\OH-Works\Projects\mode-center\mode-center`

## 配置

`sdk.config`，调用时带 `sessionPath`。键 `modes`。

```json
{
  "card": { "on": false, "verbosity": "brief" },
  "follow": { "on": false }
}
```

`verbosity` 只允许 `brief` 或 `pro`。缺省、缺路径、子会话，一律当全关，不写盘。

## 按钮

`contributes.ui.inputStatus` 只声明一项：

- id: `mode-chip`
- title: `模式中心`
- toolName: `open_mode_picker`
- icon: `pin`
- text 缺省: `关`

`chipText`：全关为 `关`；只卡片为 `卡片`；只追问为 `追问`；两个都开为 `卡片·追问`。专业不写进按钮，面板里显示。

## 工具 open_mode_picker

宿主点击传入 `context.sessionId` 与 `context.sessionPath`。用它们调用：

```js
sdk.userInteraction.show({
  sessionId,
  id: "mode-picker",
  title: "模式",
  contentFrame: {
    route: "/mode-picker.html",
    data: { sessionId }
  },
  presentation: { height: 208, collapsedHeight: 36, expanded: true }
})
```

不发起模型回复。授权失败要明确报错，不要假装面板已打开。

## 路由

页面用自己的 `hana.api.fetch`，不要拼外部 URL，不要带令牌。

`GET /modes?sessionId=`

```json
{
  "ok": true,
  "sessionId": "...",
  "modes": { "card": { "on": false, "verbosity": "brief" }, "follow": { "on": false } },
  "chipText": "关"
}
```

`POST /modes`

```json
{
  "sessionId": "...",
  "card": { "on": true, "verbosity": "pro" },
  "follow": { "on": true }
}
```

字段都可选，只改传入的部分。把卡片打开且没给 verbosity 时，用已存的，没有就 `brief`。成功后刷新该 `sessionId` 的按钮，返回与 GET 相同的形状。缺 `sessionId` 返回明确错误，不写全局配置。

## 注入

两个钩子共用一个函数。没有开着的模式就返回不改。

全开示例：

`[模式中心] 卡片开·精简：过程文字，结论一张卡，读 card-reply。追问开：三条可接着问的问题，写在卡片后面，不要放进卡内。本行是应用注入。`

位置由 `follow.place` 决定，只允许 `in` 或 `out`。缺省 `out`。旧配置没有这个字段时也按 `out`，不能因此整份配置作废。

- 卡片开着且 `place` 为 `out`：`追问开：三条可接着问的问题，写在卡片后面，不要放进卡内。`
- 卡片开着且 `place` 为 `in`：`追问开：三条可接着问的问题，放进结论卡，不要在卡片后面再写一份。这张卡若放不下追问，就写在卡片后面，不要吞掉。`
- 卡片关着，或这一条跳过卡片：`追问开：三条可接着问的问题，写在回答末尾。` 这时忽略 `place`。
- 卡片被关掉时，如果 `place` 还是 `in`，写入结果改成 `out`。不要留着一个关着卡片却仍记着卡内的状态。重新打开卡片不会自动改回 `in`。

专业把「精简」换成「专业」。只开一个就只写那一句。

同一段文本里若已有从 `[模式中心]` 到 `本行是应用注入。` 的旧句，用当前句换掉这一段，不要再追加第二句。找不到结尾时，换掉从标记到该行结束。当前句为空时删掉旧句（连同它前面那一个换行）。旧句已经等于当前句时不改。没有标记且当前句为空时也不改。

`POST /modes` 可以只带 `follow.place`，不带 `follow.on`。只改传入的字段，不要把另一个字段清掉。

`session/input` 改的是模型看到的这一条输入，不替换用户原文里标记之前的字。`agent/before-start` 只改 `systemPrompt` 里的同一句。不注册 `session.beforeCompact`。

读配置：有 `sessionId` 时先按它读。读到一份合法对象（包括两个都关）就用它，不再按 `sessionPath` 读。只有返回 `null` 或 `undefined` 时才读路径。按编号读抛错时记一笔日志并当全关，不要改读路径。没有编号时才只按路径读。

## 整句口令

去掉首尾空白和一个结尾标点后，整句等于下列之一才改配置。更长的句子不算。

- 开启卡片回答模式 / 启用卡片回答模式 / 打开卡片回答模式 → 卡片开，精简
- 关闭卡片回答模式 / 取消卡片回答模式 → 卡片关
- 专业卡片 / 开启专业卡片 → 卡片开，专业
- 精简卡片 → 卡片开，精简
- 开启追问模式 / 启用追问模式 / 打开追问模式 / 开启追问 → 追问开
- 关闭追问模式 / 暂停追问模式 / 取消追问 → 追问关

「这次不用卡片」「这条用文字」不落盘，不写进进程内存，不影响下一轮。只改这一条用户消息上的注入。`agent/before-start` 不看这句口令，仍按已存配置写系统提示。

这一条跳过卡片、追问仍开时，注入逐字为：`[模式中心] 本条不用卡片：过程与结论都用文字，不要出卡片。追问开：三条可接着问的问题，写在回答末尾。本行是应用注入。`

这一条跳过卡片、追问也关时，注入逐字为：`[模式中心] 本条不用卡片：过程与结论都用文字，不要出卡片。本行是应用注入。`

## 斜杠

`/mode` 回报当前状态，追问开着时写出卡内或卡外，例如 `卡片开·精简，追问开·卡外。` 追问关着时不写位置。`/mode card brief|pro|off`。`/mode follow on|off` 只改开关。`/mode follow in|out` 只改位置，不改开关；卡片关着时 `in` 仍被写成 `out`，回复里看到的是写入后的状态。`sessionPath` 为空时回复仅桌面会话可用，不写盘。

`/mode` 的文案在回报前先按「卡片关着则位置视为卡外」来念。不要为了这一句去改盘。磁盘上若还留着关卡片且 `in`，注入已经按末尾写，面板打开时仍会补写成 `out`。

## 面板主题

计划修订 r2。只影响模式面板和模式中心设置页。不给输入栏加按钮，不改芯片，不改卡片回答的结论卡。

全局键 `themeFace`，不按会话。只允许 `follow`、`light`、`dark`。缺省、缺键、读失败都当 `follow`。不要写进 `modes`。

```json
{
  "type": "string",
  "title": "面板主题",
  "description": "模式面板和这个设置页的深浅。跟随用当前 Hana 主题；浅色或深色用宿主下发的对应配色，可以和当前主题相反。",
  "enum": ["follow", "light", "dark"],
  "default": "follow",
  "ui": { "enumLabels": ["跟随当前", "浅色", "深色"] }
}
```

`GET /theme` 无查询参数，返回 `{ "ok": true, "themeFace": "follow" }`。

`POST /theme` 正文 `{ "themeFace": "light" }`。成功返回与 GET 相同。值不是这三字之一时 400，正文 `{ "ok": false, "error": "themeFace 只允许 follow、light 或 dark" }`，不写盘。

套用规则，设置页和模式面板相同：

- `follow`：用 `hana.theme` 当前的 `theme` 与 `cssUrl`。可以继续抄宿主已经算好的颜色变量。
- `light` / `dark`：只用快照里 `palettes.light` 或 `palettes.dark` 的 `theme` 与 `cssUrl`。不要抄宿主当前算出来的变量，否则深色主题会把浅色盖掉。
- 所选一面没有 `cssUrl`：退回 `follow`，不要自己拼地址，也不要读宿主配置。设置页可以写一句「这份 Hana 没有单独的浅色或深色样式，先跟着当前主题」。面板不弹错误。
- 地址必须用宿主下发的，原样挂上。

设置页用三个选择：跟随当前、浅色、深色。点了就 POST，成功后再套用。失败时选择回到写入前，并留下失败句。面板只读这个值，打开时读一次；主题推送或页面重新可见时再读一次。面板里不放这三个选择。
