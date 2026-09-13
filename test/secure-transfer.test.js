import assert from "node:assert/strict";
import test from "node:test";

import {
  createAccountsExport,
  openAccountsExport,
} from "../src/lib/secure-transfer.js";
import { extractAuthSnapshot, traeStorageKeys } from "../src/lib/trae-storage.js";

function snapshotForUser(userId) {
  return extractAuthSnapshot({
    [traeStorageKeys.USERTAG_KEY]: "encrypted-usertag",
    "iCubeAuthInfo://icube-dc:1360520616887347": "encrypted-device-key",
    "iCubeAuthInfo://icube.cloudide": JSON.stringify({
      userId,
      accessToken: `secret-token-${userId}`,
      account: { userId, username: `User ${userId}` },
    }),
    "iCubeServerData://icube.cloudide": JSON.stringify({
      account: { userId },
      entitlementInfo: { userId },
    }),
  });
}

test("encrypted account export round-trips without exposing tokens", async () => {
  const account = {
    account: { id: "acct_111111111111111111111111" },
    snapshot: snapshotForUser("1026288307407252"),
  };
  const exported = await createAccountsExport([account], "correct horse", {
    now: 100,
  });
  assert.doesNotMatch(exported.content, /secret-token/);

  const payload = await openAccountsExport(exported.content, "correct horse");
  assert.equal(payload.accounts.length, 1);
  assert.match(payload.accounts[0].snapshot.keys["iCubeAuthInfo://icube.cloudide"], /secret-token/);
});

test("account export rejects a wrong password and tampered ciphertext", async () => {
  const exported = await createAccountsExport(
    [
      {
        account: { id: "acct_111111111111111111111111" },
        snapshot: snapshotForUser("1026288307407252"),
      },
    ],
    "correct horse",
  );
  await assert.rejects(
    () => openAccountsExport(exported.content, "wrong password"),
    /密码错误|损坏/,
  );

  const envelope = JSON.parse(exported.content);
  const bytes = Buffer.from(envelope.data, "base64");
  bytes[0] ^= 0xff;
  envelope.data = bytes.toString("base64");
  await assert.rejects(
    () => openAccountsExport(JSON.stringify(envelope), "correct horse"),
    /密码错误|损坏/,
  );
});

test("account export enforces password length and a non-empty selection", async () => {
  await assert.rejects(
    () => createAccountsExport([], "long-enough"),
    /没有可导出/,
  );
  await assert.rejects(
    () =>
      createAccountsExport(
        [
          {
            account: { id: "acct_111111111111111111111111" },
            snapshot: snapshotForUser("1026288307407252"),
          },
        ],
        "short",
      ),
    /至少/,
  );
});
