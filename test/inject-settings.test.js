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
  assert.ok(tabs.includes('data-tab="about"'));
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
