import assert from "node:assert/strict";
import test from "node:test";

import {
  TRAY_BALLOON_TEXT,
  TRAY_MENU_ITEMS,
  TRAY_TITLE,
  buildTrayConfig,
} from "../src/lib/tray-config.js";

const BASE = {
  nodePath: "C:\\Program Files\\nodejs\\node.exe",
  serviceArgs: ["D:\\Me\\副业\\Trae多账号协同\\scripts\\service.js"],
  iconPath: "D:\\Me\\副业\\Trae多账号协同\\data\\tray.ico",
  workingDirectory: "D:\\Me\\副业\\Trae多账号协同",
};

test("the tray config keeps the Chinese labels intact", () => {
  const config = buildTrayConfig(BASE);
  assert.equal(config.title, TRAY_TITLE);
  assert.equal(config.balloonText, TRAY_BALLOON_TEXT);
  assert.equal(config.items.length, TRAY_MENU_ITEMS.length);
  const labels = config.items.map((item) => item.label);
  assert.equal(labels.includes("停止后台服务"), true);
  assert.equal(labels.includes("退出托盘"), true);
  for (const label of labels) {
    assert.match(label, /[\u4e00-\u9fa5]/);
  }
});

test("the tray config survives a JSON round trip without mojibake", () => {
  const config = buildTrayConfig(BASE);
  const restored = JSON.parse(JSON.stringify(config));
  assert.deepEqual(restored, config);
  assert.equal(restored.items[0].label, "启动 TRAE 与面板");
});

test("every menu item declares a supported window mode", () => {
  const config = buildTrayConfig(BASE);
  for (const item of config.items) {
    assert.equal(["hidden", "normal"].includes(item.window), true);
  }
  const exitItem = config.items.find((item) => item.command === "exit");
  assert.ok(exitItem);
  assert.equal(exitItem.window, "hidden");
});

test("the tray config points at a callable service entry", () => {
  const config = buildTrayConfig(BASE);
  assert.equal(config.nodePath, BASE.nodePath);
  assert.deepEqual(config.serviceArgs, BASE.serviceArgs);
  assert.equal(config.primaryCommand, "start");
  assert.equal(config.items.every((item) => typeof item.command === "string"), true);
});

test("a missing required path is rejected instead of producing a broken menu", () => {
  assert.throws(() => buildTrayConfig({ ...BASE, nodePath: "" }), /non-empty nodePath/);
  assert.throws(() => buildTrayConfig({ ...BASE, serviceArgs: [] }), /at least one service argument/);
  assert.throws(
    () => buildTrayConfig({ ...BASE, serviceArgs: [""] }),
    /every service argument must be a non-empty string/,
  );
  assert.throws(
    () => buildTrayConfig({ ...BASE, workingDirectory: undefined }),
    /non-empty workingDirectory/,
  );
});

test("menu items without a label or with an unknown window mode are rejected", () => {
  assert.throws(
    () => buildTrayConfig({ ...BASE, items: [{ label: "", command: "start", window: "normal" }] }),
    /needs a label/,
  );
  assert.throws(
    () => buildTrayConfig({ ...BASE, items: [{ label: "x", command: "", window: "normal" }] }),
    /needs a command/,
  );
  assert.throws(
    () => buildTrayConfig({ ...BASE, items: [{ label: "x", command: "start", window: "wat" }] }),
    /unknown window mode/,
  );
});

test("the default icon path is optional and null when omitted", () => {
  const config = buildTrayConfig({ ...BASE, iconPath: undefined });
  assert.equal(config.iconPath, null);
});
