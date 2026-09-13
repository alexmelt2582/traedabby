import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptIcubesValue,
  encryptIcubesValue,
  parseIcubesValue,
} from "../src/lib/trae-crypto.js";

test("iCube encryption round-trips UTF-8 JSON", () => {
  const value = {
    accessToken: "token-value",
    nickname: "测试账号",
    nested: { userId: "1026288307407252" },
  };
  const encrypted = encryptIcubesValue(value);
  assert.doesNotMatch(encrypted, /token-value|测试账号/);
  assert.deepEqual(JSON.parse(decryptIcubesValue(encrypted)), value);
});

test("parseIcubesValue accepts plaintext JSON and encrypted JSON", () => {
  assert.deepEqual(parseIcubesValue('{"a":1}'), { a: 1 });
  assert.deepEqual(parseIcubesValue(encryptIcubesValue({ a: 2 })), { a: 2 });
});
