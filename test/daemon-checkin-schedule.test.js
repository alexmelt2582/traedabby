/**
 * Guards the check-in schedule against the mistakes that stay invisible.
 *
 * Nothing loads `src/daemon.js` in tests — importing it starts a real daemon — and
 * `npm run check` only runs `node --check`, which does not resolve imports. A
 * schedule that captured the start-up configuration, or a settings endpoint that
 * rebuilt it with `initialRun: true`, would therefore pass every other gate and
 * only surface on a user machine as "the setting does nothing" or "saving silently
 * claimed a reward". These assertions read the source for exactly those shapes.
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
  "daemon.js",
);
const source = fs.readFileSync(SOURCE_PATH, "utf8");

/** Returns the body of a function declared inside `main()`, ending at `\n  }`. */
function functionBody(signature) {
  const match = source.match(new RegExp(`${signature}\\s*\\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `${signature} was not found`);
  return match[1];
}

/** Returns the route block starting at a pathname check. */
function routeBlock(pathname) {
  const match = source.match(new RegExp(`pathname === "${pathname}"[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${pathname} was not found`);
  return match[0];
}

test("the check-in interval comes from the configuration, not a constant", () => {
  assert.ok(
    !source.includes("AUTO_CHECKIN_INTERVAL_MS"),
    "the hard-coded interval is back; the setting would silently stop mattering",
  );
  const body = functionBody("async function scheduleAutoCheckin\\(\\{ initialRun = false \\} = \\{\\}\\)");
  assert.ok(body.includes("config.checkin.intervalMinutes"));
});

test("automatic check-in is switched off by configuration, not by stopping the timer", () => {
  const body = functionBody("async function scheduleAutoCheckin\\(\\{ initialRun = false \\} = \\{\\}\\)");
  assert.ok(body.includes("if (!config.checkin.auto)"), "the master switch is not honoured");
  // Every rebuild schedules the interval; only the start-up path may fire at once.
  assert.ok(body.includes("if (initialRun)"), "the start-up run is no longer distinguished");
});

test("the settings endpoint rebuilds the schedule without claiming a reward", () => {
  const route = routeBlock("/api/settings/checkin");
  assert.ok(route.includes("saveAppConfig"), "the change is never persisted");
  assert.ok(
    route.includes("rescheduleAutoCheckin?.({ initialRun: false })"),
    "either the running timers are not rebuilt, or a settings save would check in immediately",
  );
});

test("the client-load trigger re-arms on disconnect", () => {
  const stateChange = source.match(/onStateChange: \(connected\) => \{([\s\S]*?)\n    \},/);
  assert.ok(stateChange, "onStateChange was not found");
  assert.ok(
    stateChange[1].includes("clientLoadCheckinDone = false"),
    "without the reset a TRAE restart would never be followed by a check-in",
  );
  assert.ok(
    stateChange[1].includes("clientLoadCheckinDone = true"),
    "without the flag every reconnect would trigger a sweep",
  );
  assert.ok(stateChange[1].includes("void runClientLoadCheckin()"));
});

test("the client-load trigger reads the switches when it fires, not when it was wired", () => {
  const body = functionBody("async function runClientLoadCheckin\\(\\)");
  assert.ok(
    body.includes("loadAppConfig(DATA_DIR)"),
    "a captured configuration would ignore a switch flipped while the daemon runs",
  );
  assert.ok(body.includes("config.checkin.auto"));
  assert.ok(body.includes("config.checkin.onClientLoad"));
});

test("the settings payload publishes the check-in state and the allowed intervals", () => {
  const route = routeBlock("/api/settings");
  assert.ok(
    route.includes("checkin: checkinSettingsPayload(config.checkin)"),
    "the panel has no way to render the current check-in setting",
  );
});

test("opening the panel still reconciles while automatic check-in is off", () => {
  const route = routeBlock("/api/accounts/panel-open");
  assert.ok(route.includes('reason: "panel"'), "the panel reconcile was removed");
  assert.ok(
    !route.includes("config.checkin"),
    "the master switch governs the automatic runs only; opening the panel is a user action",
  );
});

test("the signed-in account is adopted once, not on every reconnect", () => {
  const body = functionBody("async function adoptCurrentAccount\\(\\)");
  assert.ok(
    body.includes("if (adoptAttempted) return;"),
    "a retry on every reconnect could adopt an account the user removed by hand",
  );
  assert.ok(body.includes("resolveActiveAccount"), "the live identity is never checked");
});
