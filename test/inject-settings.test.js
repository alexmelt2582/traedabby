/**
 * Guards the settings tab against selector drift.
 *
 * The panel is a single string of injected code with no build step and no DOM in
 * tests, so a mistyped class name breaks the tab silently at run time on a user
 * machine. Reading the source and matching every queried selector against the
 * rendered markup catches that before it ships.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SOURCE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "ui",
  "inject.js",
);
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function paneTemplate(variable) {
  const match = source.match(new RegExp(`${variable}\\.innerHTML = \`([\\s\\S]*?)\`;`));
  assert.ok(match, `${variable}.innerHTML was not found`);
  return match[1];
}

function classTokens(markup) {
  const tokens = new Set();
  for (const match of markup.matchAll(/class="([^"]+)"/g)) {
    for (const token of match[1].split(/\s+/)) {
      if (token) tokens.add(token);
    }
  }
  return tokens;
}

function queriedSelectors(variable) {
  const selectors = [];
  for (const match of source.matchAll(
    new RegExp(`${variable}\\.querySelector(?:All)?\\("([^"]+)"\\)`, "g"),
  )) {
    selectors.push(match[1]);
  }
  return selectors;
}

test("the settings tab exists next to the account and about tabs", () => {
  const tabs = paneTemplate("tabs");
  assert.ok(tabs.includes('data-tab="account"'));
  assert.ok(tabs.includes('data-tab="settings"'), "the settings tab button is missing");
  assert.ok(tabs.includes('data-tab="about"'), "the about tab button is missing");
  assert.ok(tabs.includes("<span>关于</span>"), "the about tab label is missing");
  assert.ok(source.includes('settingsPane.dataset.pane = "settings"'));
});

test("every settings selector matches a class in the settings markup", () => {
  const tokens = classTokens(paneTemplate("settingsPane"));
  const selectors = queriedSelectors("settingsPane");
  assert.ok(selectors.length >= 8, `expected several selectors, saw ${selectors.length}`);
  for (const selector of selectors) {
    const name = selector.replace(/^\./, "");
    assert.equal(
      tokens.has(name),
      true,
      `settingsPane.querySelector("${selector}") has no matching element`,
    );
  }
});

test("both restart buttons share the class the settings code wires up", () => {
  const markup = paneTemplate("settingsPane");
  const occurrences = markup.split('class="te-secondary te-daemon-restart"').length - 1;
  assert.equal(occurrences, 2, "expected a restart button in both sections");
});

test("the pane is registered in the content area", () => {
  assert.ok(
    source.includes("content.append(accountPane, settingsPane, aboutPane)"),
    "the settings pane is not appended to the content area",
  );
});

/**
 * Returns the body of a top-level function in the injected source.
 *
 * The two-space closing brace is what ends a function declared inside `setup()`;
 * the nested blocks inside it are indented further.
 */
function functionBody(signature) {
  const match = source.match(new RegExp(`${signature}\\s*\\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `${signature} was not found`);
  return match[1];
}

test("the check-in section takes its interval list from the daemon", () => {
  const markup = paneTemplate("settingsPane");
  assert.ok(markup.includes("自动签到"), "the check-in section is missing");
  // Shipped empty on purpose: the allowed values belong to the daemon, and a second
  // hard-coded list here is exactly how the two would drift apart.
  assert.ok(
    markup.includes('<select class="te-select te-checkin-interval"></select>'),
    "the interval select must not hard-code its options",
  );
  assert.ok(functionBody("function renderCheckin\\(checkin\\)").includes("checkin.options"));
});

test("turning automatic check-in off disables its fields instead of hiding them", () => {
  const body = functionBody("function applyCheckinVisibility\\(auto\\)");
  assert.ok(body.includes("settingsUi.checkinInterval.disabled = !auto"));
  assert.ok(body.includes("settingsUi.checkinClientLoad.disabled = !auto"));
  // Disabled, not hidden: the saved interval has to stay readable while it is off.
  assert.ok(!body.includes("hidden"), "the fields must not be hidden while disabled");
});

test("saving the check-in settings applies without a restart banner", () => {
  const body = functionBody("async function saveCheckinConfig\\(\\)");
  assert.ok(body.includes('"/api/settings/checkin"'));
  assert.ok(
    !body.includes("RestartBanner"),
    "the daemon rebuilds its schedule in place, so a restart notice would be wrong",
  );
});

test("the about pane's check-in line follows the saved settings", () => {
  const markup = paneTemplate("aboutPane");
  assert.ok(markup.includes("te-feature-checkin"), "the about entry has no hook to update");
  assert.ok(
    !markup.includes("每天自动检查"),
    "the static wording must not promise a schedule the settings can change",
  );
  const body = functionBody("function applyAboutCheckinText\\(checkin\\)");
  assert.ok(body.includes("已关闭"), "the disabled wording is missing");
  assert.ok(body.includes("分钟检查"), "the enabled wording must name the real interval");
});

test("the empty state separates a failed adoption from having no accounts", () => {
  const body = functionBody("function renderAccounts\\(accounts, currentAccountId\\)");
  assert.ok(body.includes("暂无账号备份"));
  assert.ok(body.includes("adoptionError"), "the failure reason is never rendered");
  assert.ok(body.includes("te-adopt-retry"), "there is no way to retry after a failure");
});
