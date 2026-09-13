import assert from "node:assert/strict";
import test from "node:test";

import { parseTraeAccountInsights } from "../src/lib/trae-insights.js";

function pack({
  productType,
  fastLimit = 0,
  fastUsed = 0,
  basicLimit = 0,
  basicUsed = 0,
  endTime = 1790783999,
  soloParallelLimit = 2,
  displayDesc = "免费",
} = {}) {
  return {
    display_desc: displayDesc,
    entitlement_base_info: {
      product_type: productType,
      end_time: endTime,
      quota: {
        premium_model_fast_request_limit: fastLimit,
        basic_usage_limit: basicLimit,
        solo_agent_parallel_limit: soloParallelLimit,
      },
    },
    usage: {
      premium_model_fast_amount: fastUsed,
      basic_usage_amount: basicUsed,
    },
    is_hide: false,
    status: 1,
  };
}

test("CN free plan exposes plan, fast usage, and reset state", () => {
  const insights = parseTraeAccountInsights({
    payStatus: {
      user_pay_identity_str: "Free",
      detail: { fast_request_per: 0, can_get_express_status: 0 },
    },
    usageResponse: {
      user_entitlement_pack_list: [pack({ productType: 0 })],
    },
    now: 1_800_000_000_000,
  });
  assert.equal(insights.plan, "Free");
  assert.equal(insights.quota.model, "fast_request");
  assert.equal(insights.quota.fastLimit, 0);
  assert.equal(insights.quota.fastUsed, 0);
  assert.equal(insights.quota.fastAvailable, 0);
  assert.equal(insights.quota.fastPerMonth, 0);
  assert.equal(insights.quota.soloParallelLimit, 2);
  assert.equal(insights.resetAt, new Date(1790784000 * 1000).toISOString());
});

test("v2 credits summary exposes the same remaining balance shown by TRAE", () => {
  const insights = parseTraeAccountInsights({
    payStatus: { user_pay_identity_str: "Free", detail: {} },
    usageResponse: {
      is_credits_billing: true,
      usage_summary: {
        total_amount: 5200,
        consumed_amount: 5050,
      },
      user_entitlement_pack_list: [
        pack({
          productType: 2,
          basicLimit: 0,
          displayDesc: "签到奖励",
        }),
        {
          ...pack({
            productType: 2,
            basicLimit: 0,
            displayDesc: "签到奖励",
          }),
          entitlement_base_info: {
            product_type: 2,
            end_time: 1791940585,
            quota: { credits_limit: 150 },
          },
          usage: { credits_amount: 0 },
        },
      ],
    },
  });
  assert.equal(insights.plan, "Free");
  assert.equal(insights.quota.model, "credits");
  assert.equal(insights.credits.total, 5200);
  assert.equal(insights.credits.used, 5050);
  assert.equal(insights.credits.remaining, 150);
  assert.equal(insights.quota.usageExhausted, false);
});

test("fast request remaining balance is derived from quota and usage", () => {
  const insights = parseTraeAccountInsights({
    payStatus: { user_pay_identity_str: "CNExpress", detail: {} },
    usageResponse: {
      user_entitlement_pack_list: [
        pack({
          productType: 100,
          fastLimit: 100,
          fastUsed: 20,
          displayDesc: "速通",
        }),
      ],
    },
  });
  assert.equal(insights.plan, "CNExpress");
  assert.equal(insights.quota.fastLimit, 100);
  assert.equal(insights.quota.fastUsed, 20);
  assert.equal(insights.quota.fastAvailable, 80);
  assert.equal(insights.quota.usageExhausted, false);
});

test("USD quota is exposed when no fast request balance exists", () => {
  const insights = parseTraeAccountInsights({
    payStatus: { user_pay_identity_str: "Pro" },
    usageResponse: {
      user_entitlement_pack_list: [
        pack({
          productType: 1,
          fastLimit: null,
          basicLimit: 50,
          basicUsed: 12,
        }),
      ],
    },
  });
  assert.equal(insights.plan, "Pro");
  assert.equal(insights.quota.model, "usd");
  assert.equal(insights.quota.basicUsage, 12);
  assert.equal(insights.quota.basicQuota, 50);
});

test("missing balance data remains unknown instead of inventing a value", () => {
  const insights = parseTraeAccountInsights({
    payStatus: null,
    usageResponse: { user_entitlement_pack_list: [] },
  });
  assert.equal(insights.plan, "未知套餐");
  assert.equal(insights.quota.model, "unknown");
  assert.equal(insights.quota.fastAvailable, null);
  assert.equal(insights.quota.basicQuota, null);
});
