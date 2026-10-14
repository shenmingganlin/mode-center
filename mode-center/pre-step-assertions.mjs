import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./lib/modes.js", import.meta.url), "utf8");
const { appendReminderToMessages } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const oldReminder = "[模式中心] 卡片开·精简：旧提醒。本行是应用注入。";
const reminder = "[模式中心] 卡片开·专业：过程文字，结论一张卡，读 card-reply。本行是应用注入。";

const stringInput = [
  { role: "assistant", content: "Earlier reply" },
  { role: "user", content: "Please answer" },
];
const stringOutput = appendReminderToMessages(stringInput, reminder);
assert.equal(stringOutput[1].content, `Please answer\n${reminder}`);
assert.equal(stringInput[1].content, "Please answer", "input string content was mutated");
assert.notEqual(stringOutput, stringInput, "message array was not copied");
assert.equal(stringOutput[0], stringInput[0], "unmodified message identity changed");

const image = { type: "image", data: "opaque-image" };
const textPart = { type: "text", text: "Describe this" };
const partsInput = [{ role: "user", content: [image, textPart] }];
const partsOutput = appendReminderToMessages(partsInput, reminder);
assert.equal(partsOutput[0].content[1].text, `Describe this\n${reminder}`);
assert.equal(partsOutput[0].content[0], image, "image part was not preserved");
assert.equal(partsInput[0].content[1].text, "Describe this", "input text part was mutated");
assert.notEqual(partsOutput[0].content, partsInput[0].content, "content array was not copied");

const oldInput = [{ role: "user", content: `Question\n${oldReminder}` }];
const replaced = appendReminderToMessages(oldInput, reminder);
assert.equal(replaced[0].content, `Question\n${reminder}`);
assert.equal((replaced[0].content.match(/\[模式中心\]/g) || []).length, 1, "old reminder was duplicated");
assert.equal(appendReminderToMessages([{ role: "user", content: reminder }], reminder), null,
  "identical reminder should not return a decision");

const emptyReminderInput = [{ role: "user", content: "Plain text" }];
assert.equal(appendReminderToMessages(emptyReminderInput, ""), null, "empty reminder changed plain text");
assert.equal(appendReminderToMessages([{ role: "user", content: [{ type: "image" }] }], reminder), null,
  "message without editable text unexpectedly changed");

console.log("Pre-step pure assertions passed: string content, parts array, old reminder replacement, empty reminder no-op, image preservation, and input immutability.");
