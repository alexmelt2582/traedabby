/**
 * Guards the credit expiry reminder.
 *
 * The panel has no DOM and no build step, so most of this is asserted against the
 * sources: a dropped field or a mistyped selector would otherwise only show up on
 * a user's machine. The reminder's arithmetic is the one part worth running for
 * real, so `expiringCredits` is lifted out of the injected source and evaluated.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const injectSource = read("src/ui/inject.js");
const daemonSource = read("src/daemon.js");

/** Returns the body of a top-level function declared inside `setup()`. */
function functionBody(signature) {
  const match = injectSource.match(new RegExp(`${signature}\\s*\\{([\\s\\S]*?)\\n  \\}`));
  assert.ok(match, `${signature} was not found`);
  return match[1];
}

/** The same, for a top-level function in the daemon. */
function daemonBody(signature) {
  const match = daemonSource.match(new RegExp(`${signature}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${signature} was not found`);
  return match[1];
}

/**
 * Evaluates a self-contained helper straight out of the injected source.
 *
 * The script is a single IIFE with no exports, so the function is sliced out of
 * the text. Only helpers that touch nothing else in the panel can be loaded this
 * way, which is exactly why `expiringCredits` was written as a pure function.
 */
function loadHelper(signature) {
  const match = injectSource.match(new RegExp(`${signature}\\s*\\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `${signature} was not found`);
  return new Function(`return (${match[0]})`)();
}

const expiringCredits = loadHelper(
  "function expiringCredits\\(segments, reminderDays, now = Date\\.now\\(\\)\\)",
);

const DAY = 86400000;
const NOW = Date.parse("2026-09-30T00:00:00.000Z");
const at = (days) => new Date(NOW + days * DAY).toISOString();
const segment = (remaining, days) => ({ source: "赠送", remaining, expiresAt: at(days) });

test("only segments inside the reminder window are flagged", () => {
  const flagged = expiringCredits(
    [segment(100, 0.5), segment(200, 3), segment(300, 7)],
    7,
    NOW,
  );
  assert.deepEqual(flagged.map((entry) => entry.remaining), [100, 200, 300]);
});

test("the window ends at the threshold, and one millisecond past it is out", () => {
  const onEdge = { source: "赠送", remaining: 10, expiresAt: new Date(NOW + 7 * DAY).toISOString() };
  const past = { source: "赠送", remaining: 10, expiresAt: new Date(NOW + 7 * DAY + 1).toISOString() };
  assert.deepEqual(expiringCredits([onEdge], 7, NOW), [onEdge]);
  assert.deepEqual(expiringCredits([past], 7, NOW), []);
  // A wider threshold is what brings it back in, so the number really is the knob.
  assert.deepEqual(expiringCredits([past], 30, NOW), [past]);
});

test("an already expired segment is stale data, not a reminder", () => {
  // It would otherwise pin a permanent red dot on an account whose numbers simply
  // have not been refreshed yet.
  assert.deepEqual(expiringCredits([segment(50, -1), segment(50, -30)], 30, NOW), []);
});

test("segments with nothing left or no expiry never count", () => {
  const never = { source: "长期", remaining: 500, expiresAt: null };
  const noDate = { source: "未知", remaining: 500 };
  assert.deepEqual(expiringCredits([never, noDate], 30, NOW), []);
  assert.deepEqual(
    expiringCredits([segment(0, 1), segment(-5, 1), segment("abc", 1)], 30, NOW),
    [],
  );
});

test("the flagged segments come back soonest first", () => {
  const flagged = expiringCredits([segment(1, 6), segment(2, 1), segment(3, 14)], 30, NOW);
  assert.deepEqual(flagged.map((entry) => entry.remaining), [2, 1, 3]);
});

test("a missing segment list is empty, not an error", () => {
  for (const value of [undefined, null, [], "nope", 42, {}]) {
    assert.deepEqual(expiringCredits(value, 7, NOW), []);
  }
});

test("the daemon publishes the threshold and the offered values together", () => {
  const payload = daemonBody("function checkinSettingsPayload\\(checkin\\)");
  assert.match(payload, /reminderDays: checkin\.reminderDays,/);
  assert.match(payload, /reminderOptions: \[\.\.\.CREDIT_REMINDER_DAYS\],/);
});

test("the check-in route saves the threshold with the rest of the card", () => {
  const route = daemonSource.match(/pathname === "\/api\/settings\/checkin"[\s\S]*?\n  \}/);
  assert.ok(route, "the check-in settings route was not found");
  assert.match(route[0], /reminderDays: body\.reminderDays/);
  assert.match(route[0], /normalizeCheckin\(/);
});

test("the settings card offers the threshold next to the check-in interval", () => {
  const markup = injectSource.match(/settingsPane\.innerHTML = `([\s\S]*?)`;/);
  assert.ok(markup, "the settings markup was not found");
  assert.ok(markup[1].includes("积分到期提醒"), "the reminder row is missing");
  assert.ok(
    markup[1].includes('<select class="te-select te-checkin-reminder"></select>'),
    "the reminder select must not hard-code its options",
  );
  assert.ok(
    markup[1].indexOf("te-checkin-interval") < markup[1].indexOf("te-checkin-reminder"),
    "the reminder belongs right after the interval it sits beside",
  );
  assert.ok(
    injectSource.includes("checkinReminder: settingsPane.querySelector(\".te-checkin-reminder\")"),
    "the reminder select is never looked up",
  );
});

test("the reminder select is filled, saved and applied without a rebuild", () => {
  const render = functionBody("function renderCheckin\\(checkin\\)");
  assert.ok(render.includes("checkin.reminderOptions"), "the offered values are ignored");
  assert.ok(render.includes("settingsUi.checkinReminder.value = String(checkin.reminderDays)"));
  assert.ok(render.includes("applyCreditReminderDays(checkin)"));
  const save = functionBody("async function saveCheckinConfig\\(\\)");
  assert.ok(save.includes("reminderDays: Number(settingsUi.checkinReminder.value)"));
  // The list paints before the settings are read, so a threshold that arrived
  // later has to repaint the rows already on screen.
  assert.ok(functionBody("function applyCreditReminderDays\\(checkin\\)").includes("repaintAccounts()"));
});

test("the credit icon sits left of switch and renew, on every account", () => {
  const render = functionBody(
    "function renderAccounts\\(accounts, currentAccountId, currentAccountState\\)",
  );
  const credits = render.indexOf('className = "te-icon-btn te-acc-credits"');
  assert.ok(credits >= 0, "the credit icon is missing");
  assert.ok(
    credits < render.indexOf('className = "te-icon-btn te-acc-switch"'),
    "the icon must be prepended before the switch button",
  );
  assert.ok(
    render.indexOf("ops.appendChild(creditsButton)") < render.indexOf("let action;"),
    "the icon is not appended before the current-account span, so the active row loses it",
  );
});

test("the red dot follows the reminder window, not the mere presence of credits", () => {
  const render = functionBody(
    "function renderAccounts\\(accounts, currentAccountId, currentAccountState\\)",
  );
  assert.ok(
    render.includes(
      "if (expiringCredits(accountCreditSegments(account), creditReminderDays).length)",
    ),
    "the dot is not gated on the threshold",
  );
  assert.ok(render.includes('dot.className = "te-cred-dot"'));
});

test("the popover puts the expiring block above the full breakdown", () => {
  const render = functionBody("function renderCreditPopover\\(account\\)");
  const urgent = render.indexOf('creditPopoverBlock("即将到期"');
  const all = render.indexOf('creditPopoverBlock("全部构成"');
  assert.ok(urgent >= 0 && all >= 0, "one of the two blocks is missing");
  assert.ok(urgent < all, "the expiring block must come first");
  // Only shown when something is actually expiring; the rest of the time the
  // popover is just the breakdown.
  assert.ok(render.includes("if (expiring.length) {"));
});

test("credit rows are written as text, and dates as a day", () => {
  const block = functionBody("function creditPopoverBlock\\(title, segments, \\{ urgent = false, note = \"\" \\} = \\{\\}\\)");
  assert.ok(block.includes("textContent"), "the rows are not rendered as text");
  assert.ok(!block.includes("innerHTML"), "remote credit sources must never be HTML");
  assert.ok(block.includes("formatNumber(segment.remaining)"), "the amount is not formatted");
  const day = functionBody("function creditDay\\(value\\)");
  assert.ok(day.includes("长期有效"), "a segment with no expiry has no wording");
});

test("the popover is anchored, dismissible, and closed by a repaint", () => {
  const toggle = functionBody("function toggleCreditPopover\\(button, account\\)");
  assert.ok(toggle.includes("creditPopoverAnchor = button"));
  assert.ok(toggle.includes("positionCreditPopover(button)"), "the popover is never placed");
  // A repaint detaches the icon the popover was anchored to, so it must not survive.
  const render = functionBody(
    "function renderAccounts\\(accounts, currentAccountId, currentAccountState\\)",
  );
  assert.ok(render.includes("closeCreditPopover()"));
  const close = functionBody("function closeCreditPopover\\(\\)");
  assert.ok(close.includes('setAttribute("aria-expanded", "false")'));
  assert.ok(close.includes("creditPopover.hidden = true"));
  assert.ok(injectSource.includes('document.addEventListener("keydown", handleCreditPopoverEscape)'));
  assert.ok(injectSource.includes('document.addEventListener("mousedown", handleCreditPopoverDismiss, true)'));
  assert.ok(functionBody("function positionCreditPopover\\(anchor\\)").includes("window.innerHeight"));
});

test("the popover scrolling its own content is not a reason to close it", () => {
  // The popover scrolls its own content once an account has more segments than
  // fit, and a capture-phase listener on the window sees that scroll too. Acting
  // on it closed the popover the moment its scrollbar moved, which made the
  // scrollbar impossible to drag.
  const handler = functionBody("function handleCreditPopoverScroll\\(event\\)");
  assert.ok(handler.includes("if (creditPopover.contains(event.target)) return;"));
  assert.ok(handler.includes("closeCreditPopover()"));
  assert.ok(injectSource.includes('window.addEventListener("scroll", handleCreditPopoverScroll, true)'));
  assert.ok(
    injectSource.includes('window.removeEventListener("scroll", handleCreditPopoverScroll, true)'),
    "the listener is never removed, so a re-injection would stack them",
  );
  // A scroll of the list behind it must still close it: a fixed-position popover
  // does not follow the row it was placed against.
  assert.ok(!injectSource.includes('window.addEventListener("scroll", closeCreditPopover, true)'));
});

test("clicking the icon toggles instead of falling through to a switch", () => {
  const handler = injectSource.match(/list\.addEventListener\("click", \(event\) => \{[\s\S]*?\n  \}\);/);
  assert.ok(handler, "the account list click handler was not found");
  assert.match(handler[0], /event\.target\.closest\("\.te-acc-credits"\)/);
  assert.ok(
    handler[0].indexOf(".te-acc-credits") < handler[0].indexOf(".te-acc-delete"),
    "the credit branch must come first, or the row eats the click",
  );
  assert.match(handler[0], /toggleCreditPopover\(creditsButton, account\)/);
});