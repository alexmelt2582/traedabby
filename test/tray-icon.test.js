import assert from "node:assert/strict";
import test from "node:test";

import { buildTrayIco, trayIconExpectations, trayIconPixel } from "../src/lib/tray-icon.js";

test("the generated icon is a valid single-image ico container", () => {
  const ico = buildTrayIco({ size: 32 });
  const expected = trayIconExpectations(32);
  assert.equal(ico.length, expected.totalBytes);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt8(6), 32);
  assert.equal(ico.readUInt8(7), 32);
  assert.equal(ico.readUInt16LE(10), 1);
  assert.equal(ico.readUInt16LE(12), 32);
  assert.equal(ico.readUInt32LE(14), expected.imageBytes);
  assert.equal(ico.readUInt32LE(18), expected.imageOffset);
});

test("the embedded bitmap header describes a 32bpp image with a mask", () => {
  const ico = buildTrayIco({ size: 32 });
  const base = trayIconExpectations(32).imageOffset;
  assert.equal(ico.readUInt32LE(base), 40);
  assert.equal(ico.readInt32LE(base + 4), 32);
  assert.equal(ico.readInt32LE(base + 8), 64);
  assert.equal(ico.readUInt16LE(base + 12), 1);
  assert.equal(ico.readUInt16LE(base + 14), 32);
  assert.equal(ico.readUInt32LE(base + 16), 0);
  assert.equal(ico.readUInt32LE(base + 20), 32 * 32 * 4);
});

test("the ico size matches the documented formula for several sizes", () => {
  for (const size of [16, 32, 48]) {
    const ico = buildTrayIco({ size });
    assert.equal(ico.length, trayIconExpectations(size).totalBytes);
    assert.equal(ico.readUInt8(6), size);
  }
});

test("unsupported icon sizes are rejected", () => {
  assert.throws(() => buildTrayIco({ size: 8 }), /unsupported icon size/);
  assert.throws(() => buildTrayIco({ size: 512 }), /unsupported icon size/);
  assert.throws(() => buildTrayIco({ size: 32.5 }), /unsupported icon size/);
});

test("the mark draws two overlapping squares and leaves the corners empty", () => {
  assert.deepEqual(trayIconPixel(0, 0, 32), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(trayIconPixel(31, 31, 32), { r: 0, g: 0, b: 0, a: 0 });
  const back = trayIconPixel(5, 18, 32);
  const front = trayIconPixel(26, 22, 32);
  assert.equal(back.a, 0xff);
  assert.equal(front.a, 0xff);
  assert.notDeepEqual(back, front);
  assert.equal(back.r < front.r, true);
});

test("pixels outside the canvas are transparent instead of throwing", () => {
  assert.deepEqual(trayIconPixel(-1, 5, 32), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(trayIconPixel(5, 200, 32), { r: 0, g: 0, b: 0, a: 0 });
});
