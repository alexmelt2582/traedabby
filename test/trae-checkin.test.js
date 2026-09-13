import assert from "node:assert/strict";
import test from "node:test";

import {
  claimCheckin,
  fetchCheckinStatus,
  parseCheckinStatus,
  resolveCheckinReward,
} from "../src/lib/trae-checkin.js";

function snapshot(userId, token = `token-${userId}`, loginHost = "api.trae.cn") {
  return {
    keys: {
      "iCubeAuthInfo://icube.cloudide": JSON.stringify({
        accessToken: token,
        userId,
        loginHost,
      }),
    },
  };
}

function response(json, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json,
    text: JSON.stringify(json),
  };
}

test("check-in status parsing accepts flat and nested API responses", () => {
  const flat = parseCheckinStatus({
    json: {
      code: 0,
      checked_in: true,
      credits: 150,
      extra_credits: 50,
      enable: true,
    },
  });
  assert.equal(flat.checkedInToday, true);
  assert.equal(flat.credits, 150);
  assert.equal(flat.extraCredits, 50);

  const nested = parseCheckinStatus({
    json: {
      data: {
        code: 0,
        checked_in: false,
        credits: 100,
        enable: false,
      },
    },
  });
  assert.equal(nested.checkedInToday, false);
  assert.equal(nested.credits, 100);
  assert.equal(nested.enabled, false);

  const missing = parseCheckinStatus({ json: { code: 0, message: "" } });
  assert.equal(missing.credits, null);
  assert.equal(missing.extraCredits, null);
});

test("check-in reward uses total credits rather than the extra-credit component", () => {
  assert.equal(
    resolveCheckinReward({ credits: 150, extraCredits: 50 }),
    150,
  );
  assert.equal(resolveCheckinReward({ credits: null, extraCredits: 50 }, { credits: 150 }), 150);
  assert.equal(resolveCheckinReward(null, null), 0);
});

test("status requests use each account user id as its own device id", async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return response({ code: 0, checked_in: false, credits: 150, enable: true });
  };

  const first = await fetchCheckinStatus(snapshot("2504031931479881"), { request });
  const second = await fetchCheckinStatus(
    snapshot("2785506498980746", "token-2785506498980746", "api.trae.com.cn"),
    { request },
  );

  assert.equal(first.checkedInToday, false);
  assert.equal(second.checkedInToday, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[0].options.headers["x-device-id"], "2504031931479881");
  assert.equal(calls[1].options.headers["x-device-id"], "2785506498980746");
  assert.equal(
    new URL(calls[0].url).searchParams.get("did"),
    "2504031931479881",
  );
  assert.equal(
    new URL(calls[1].url).searchParams.get("did"),
    "2785506498980746",
  );
  assert.equal(new URL(calls[1].url).host, "api.trae.cn");
  assert.equal(
    calls[0].options.headers["x-device-id"] === calls[1].options.headers["x-device-id"],
    false,
  );
});

test("claim requests post to the claim endpoint with the account device id", async () => {
  let call = null;
  const result = await claimCheckin(snapshot("2504031931479881"), {
    request: async (url, options) => {
      call = { url, options };
      return response({ code: 0, message: "" });
    },
  });

  assert.equal(result.code, 0);
  assert.equal(
    call.url,
    "https://api.trae.cn/trae/api/v2/ug/checkin_credits/claim",
  );
  assert.equal(call.options.method, "POST");
  assert.deepEqual(call.options.body, {});
  assert.equal(call.options.headers["x-device-id"], "2504031931479881");
});

test("check-in APIs refuse to send a shared undefined device id", async () => {
  await assert.rejects(
    fetchCheckinStatus(snapshot(null), {
      request: async () => response({ code: 0, checked_in: false }),
    }),
    /missing a stable user id/,
  );
});

test("authentication failures are marked for one token refresh retry", async () => {
  await assert.rejects(
    fetchCheckinStatus(snapshot("2504031931479881"), {
      request: async () => response({ message: "expired" }, 404),
    }),
    (error) => error.authExpired === true && error.status === 404,
  );
});

test("claim API errors preserve the remote API code", async () => {
  await assert.rejects(
    claimCheckin(snapshot("2504031931479881"), {
      request: async () => response({ code: 1001, message: "当前设备已签到" }),
    }),
    (error) => error.apiCode === 1001 && /当前设备已签到/.test(error.message),
  );
});
