import assert from "node:assert/strict";
import test from "node:test";

import {
  GITHUB_API_ORIGIN,
  compareVersions,
  fetchLatestRelease,
  isNewerVersion,
  normalizeRelease,
  parseVersion,
} from "../src/lib/app-update.js";

const RELEASE = {
  tag_name: "v1.2.0",
  name: "v1.2.0",
  html_url: "https://github.com/alexmelt2582/traedabby/releases/tag/v1.2.0",
  published_at: "2026-09-25T02:00:00Z",
  body: "## 本次更新\n\n- 支持检查新版本\n",
};

test("only a three part version is parsed", () => {
  assert.deepEqual(parseVersion("1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion("v1.2.3"), [1, 2, 3]);
  assert.deepEqual(parseVersion(" v1.2.3 "), [1, 2, 3]);
  assert.deepEqual(parseVersion("v1.2.3-beta.1"), [1, 2, 3]);
  for (const value of ["1.2", "1.2.3.4", "latest", "", null, undefined, {}, 42]) {
    assert.equal(parseVersion(value), null);
  }
});

test("an unparseable version is never reported as newer", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.1.9", "1.2.0"), -1);
  assert.equal(compareVersions("v1.2.0", "1.2.0"), 0);
  // A silent false here would show "已是最新" for a version nobody could read.
  assert.equal(compareVersions("nightly", "1.2.0"), null);
  assert.equal(compareVersions("1.2.0", "nightly"), null);
  assert.equal(isNewerVersion("nightly", "1.2.0"), false);
  assert.equal(isNewerVersion("1.2.0", "nightly"), false);
  assert.equal(isNewerVersion("1.2.0", "1.1.1"), true);
  assert.equal(isNewerVersion("1.1.1", "1.2.0"), false);
});

test("a release payload is reduced to the fields the panel renders", () => {
  assert.deepEqual(normalizeRelease(RELEASE), {
    version: "1.2.0",
    tag: "v1.2.0",
    title: "v1.2.0",
    notes: RELEASE.body,
    url: RELEASE.html_url,
    publishedAt: "2026-09-25T02:00:00.000Z",
  });
});

test("a payload without a usable version or address is rejected", () => {
  assert.equal(normalizeRelease(null), null);
  assert.equal(normalizeRelease({}), null);
  assert.equal(normalizeRelease({ ...RELEASE, tag_name: "nightly" }), null);
  assert.equal(normalizeRelease({ ...RELEASE, html_url: "" }), null);
});

test("the release address must be a github.com release page", () => {
  // This URL is what `/api/update/open` hands to the browser, so a tampered
  // payload must not be able to point it anywhere else.
  const rejected = [
    "https://example.com/alexmelt2582/traedabby/releases/tag/v1.2.0",
    "http://github.com/alexmelt2582/traedabby/releases/tag/v1.2.0",
    "https://github.com/alexmelt2582",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
  ];
  for (const url of rejected) {
    assert.equal(normalizeRelease({ ...RELEASE, html_url: url }), null, url);
  }
});

test("long release notes are bounded instead of streamed whole", () => {
  const notes = normalizeRelease({ ...RELEASE, body: "x".repeat(5000) }, { maxNotesLength: 100 });
  assert.equal(notes.notes.length, 100);
});

test("an unreadable publish date becomes null rather than an invalid date", () => {
  assert.equal(normalizeRelease({ ...RELEASE, published_at: "not a date" }).publishedAt, null);
  assert.equal(normalizeRelease({ ...RELEASE, published_at: undefined }).publishedAt, null);
});

test("the latest release is read from the repository's own endpoint", async () => {
  const calls = [];
  const release = await fetchLatestRelease({
    repo: "alexmelt2582/traedabby",
    requestJsonImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: RELEASE };
    },
  });
  assert.equal(release.version, "1.2.0");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GITHUB_API_ORIGIN}/repos/alexmelt2582/traedabby/releases/latest`);
  // The default of `requestJson` is POST, so a GET has to be asked for explicitly.
  assert.equal(calls[0].options.method, "GET");
});

test("an HTTP failure keeps a usable reason instead of returning no update", async () => {
  await assert.rejects(
    () =>
      fetchLatestRelease({
        repo: "alexmelt2582/traedabby",
        requestJsonImpl: async () => ({ ok: false, status: 403, json: null }),
      }),
    /HTTP 403.*频率限制/,
  );
  await assert.rejects(
    () =>
      fetchLatestRelease({
        repo: "alexmelt2582/traedabby",
        requestJsonImpl: async () => ({ ok: false, status: 500, json: null }),
      }),
    /HTTP 500/,
  );
});

test("a payload that cannot be parsed fails the check rather than reporting the latest", async () => {
  await assert.rejects(
    () =>
      fetchLatestRelease({
        repo: "alexmelt2582/traedabby",
        requestJsonImpl: async () => ({ ok: true, status: 200, json: { tag_name: "nightly" } }),
      }),
    /无法解析/,
  );
});

test("an unset repository is refused before any request is made", async () => {
  let called = false;
  await assert.rejects(
    () =>
      fetchLatestRelease({
        repo: "",
        requestJsonImpl: async () => {
          called = true;
          return { ok: true, status: 200, json: RELEASE };
        },
      }),
    /未配置 GitHub 仓库/,
  );
  assert.equal(called, false);
});
