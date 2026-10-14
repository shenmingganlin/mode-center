# 模式中心

按会话记住卡片与追问。面板和斜杠会立刻保存。下一句才带上提醒，已经答完的那句不会改。界面上你打的原话不变。

它不保证模型一定服从。

## 安装

打开 [Release v1.0.0](https://github.com/shenmingganlin/mode-center/releases/tag/v1.0.0)，下载 `app-mode-center-1.0.0.zip`，在 Hana 里安装。

已经装过旧版的，先卸载再装。数据目录会留下。Windows 上不要原位覆盖，会报 `EPERM`。

需要 Hana 0.972.0 或更新。安装时要允许 `app/hooks.agent-pre-step`。

## 怎么用

- 每个会话单独开关。新会话默认全关。
- 输入栏按钮打开选择面板。卡片是关、精简或专业。追问是开或关，位置在卡外或卡内。
- 斜杠：`/mode`、`/mode card brief|pro|off`、`/mode follow on|off|in|out`。
- 「这次不用卡片」「这条用文字」只影响这一条，不关追问，也不记到下一轮。

整句口令「开启卡片回答模式」依赖宿主的 `session/input`。当前桌面提交没有把这条裁决送进应用，请用面板或斜杠。

源码在 `mode-center/`。`DESIGN.md` 和 `MODE-API.md` 是设计说明。
