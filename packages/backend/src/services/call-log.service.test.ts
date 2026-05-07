import { test, describe } from "node:test";
import * as assert from "node:assert/strict";
import {
  aggregateRows,
  aggregateErrors,
  scoreListing,
  sampleBeta,
  groupByListingDay,
  type RawRow,
} from "./call-log.service.js";

describe("aggregateRows", () => {
  test("cold start (no rows) uses the Beta(1,1) prior — successRate 0.5", () => {
    const s = aggregateRows([], 30);
    assert.deepEqual(s, {
      successRate: 0.5,
      avgLatencyMs: 0,
      totalCalls: 0,
      successes: 0,
      lastCalledAt: null,
      windowDays: 30,
    });
  });

  test("computes success rate over all rows", () => {
    const rows: RawRow[] = [
      { success: true, latencyMs: 100, createdAt: new Date("2026-04-20") },
      { success: true, latencyMs: 300, createdAt: new Date("2026-04-22") },
      { success: false, latencyMs: 9999, createdAt: new Date("2026-04-21") },
    ];
    const s = aggregateRows(rows, 30);
    assert.equal(Number(s.successRate.toFixed(4)), 0.6667);
    assert.equal(s.totalCalls, 3);
  });

  test("avg latency uses successes only — failures (timeouts) don't pollute", () => {
    const rows: RawRow[] = [
      { success: true, latencyMs: 100, createdAt: new Date("2026-04-20") },
      { success: true, latencyMs: 300, createdAt: new Date("2026-04-22") },
      // a 30s timeout should NOT pull avg up to 3.5k
      { success: false, latencyMs: 30_000, createdAt: new Date("2026-04-21") },
    ];
    const s = aggregateRows(rows, 30);
    assert.equal(s.avgLatencyMs, 200); // (100 + 300) / 2
  });

  test("avg latency is 0 when no successes", () => {
    const rows: RawRow[] = [
      { success: false, latencyMs: 500, createdAt: new Date("2026-04-22") },
      { success: false, latencyMs: 5000, createdAt: new Date("2026-04-21") },
    ];
    const s = aggregateRows(rows, 30);
    assert.equal(s.avgLatencyMs, 0);
    assert.equal(s.successRate, 0);
  });

  test("lastCalledAt is the max timestamp regardless of order", () => {
    const rows: RawRow[] = [
      { success: true, latencyMs: 100, createdAt: new Date("2026-04-10") },
      { success: false, latencyMs: 100, createdAt: new Date("2026-04-22") },
      { success: true, latencyMs: 100, createdAt: new Date("2026-04-15") },
    ];
    const s = aggregateRows(rows, 30);
    assert.equal(s.lastCalledAt?.toISOString(), new Date("2026-04-22").toISOString());
  });

  test("threads windowDays through verbatim", () => {
    assert.equal(aggregateRows([], 7).windowDays, 7);
    assert.equal(aggregateRows([], 90).windowDays, 90);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Thompson sampling tests — sampleBeta + scoreListing
// ──────────────────────────────────────────────────────────────────────

// Mulberry32 seeded PRNG — deterministic, same algorithm as market.routes.ts.
function mlb(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function avg(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function samples(alpha: number, beta_: number, n: number, seed: number): number[] {
  const rng = mlb(seed);
  return Array.from({ length: n }, () => sampleBeta(alpha, beta_, rng));
}

describe("sampleBeta", () => {
  test("all samples are in [0, 1]", () => {
    const xs = samples(3, 5, 300, 1);
    assert.ok(
      xs.every((x) => x >= 0 && x <= 1),
      "out-of-range sample found",
    );
  });

  test("Beta(1,1) = Uniform(0,1): mean ≈ 0.5", () => {
    const m = avg(samples(1, 1, 500, 2));
    assert.ok(Math.abs(m - 0.5) < 0.06, `mean ${m.toFixed(4)} not near 0.5`);
  });

  test("mean ≈ α/(α+β) for several parameter sets", () => {
    const cases: [number, number][] = [
      [2, 5],
      [10, 3],
      [50, 50],
      [0.5, 1.5],
    ];
    for (const [a, b] of cases) {
      const m = avg(samples(a, b, 500, 3));
      const expected = a / (a + b);
      assert.ok(
        Math.abs(m - expected) < 0.06,
        `Beta(${a},${b}) mean ${m.toFixed(4)} expected ${expected.toFixed(4)}`,
      );
    }
  });

  test("shape < 1 reduction path: Beta(0.5, 1.5) mean ≈ 0.25", () => {
    const m = avg(samples(0.5, 1.5, 500, 4));
    assert.ok(Math.abs(m - 0.25) < 0.06, `mean ${m.toFixed(4)} not near 0.25`);
  });
});

describe("scoreListing — Thompson sampling", () => {
  // scoreListing accepts an optional rng so tests are deterministic.
  function score(successes: number, totalCalls: number, seed: number): number {
    return scoreListing(
      {
        successRate: 0,
        avgLatencyMs: 0,
        totalCalls,
        successes,
        lastCalledAt: null,
        windowDays: 30,
      },
      mlb(seed),
    );
  }

  function scoreMean(successes: number, totalCalls: number, n: number, seed: number): number {
    return avg(Array.from({ length: n }, (_, i) => score(successes, totalCalls, seed + i)));
  }

  test("cold start (0/0): score is in [0, 1] and expected value ≈ 0.5", () => {
    // Beta(1,1) = Uniform(0,1) — no data, maximum uncertainty
    const m = scoreMean(0, 0, 300, 10);
    assert.ok(Math.abs(m - 0.5) < 0.06, `mean ${m.toFixed(4)}`);
  });

  test("higher success rate → higher expected score", () => {
    // Beta(91, 11) mean ≈ 0.89 vs Beta(11, 91) mean ≈ 0.11
    const highMean = scoreMean(90, 100, 200, 20);
    const lowMean = scoreMean(10, 100, 200, 220);
    assert.ok(highMean > lowMean, `high ${highMean.toFixed(3)} > low ${lowMean.toFixed(3)}`);
  });

  test("one failure on a 100-call listing barely moves expected score", () => {
    // Beta(101,1) mean=101/102 ≈ 0.990 vs Beta(100,2) mean=100/102 ≈ 0.980
    const perfect = scoreMean(100, 100, 300, 40);
    const oneFailure = scoreMean(99, 100, 300, 340);
    assert.ok(perfect > oneFailure);
    // delta < 2 % of the perfect mean — posterior absorbs one failure
    assert.ok(
      (perfect - oneFailure) / perfect < 0.02,
      `delta ${((perfect - oneFailure) / perfect).toFixed(4)} should be < 0.02`,
    );
  });

  test("established 80/100 listing outranks 1/1 rookie in expectation", () => {
    // Beta(81,21) mean ≈ 0.794 vs Beta(2,1) mean ≈ 0.667
    const established = scoreMean(80, 100, 300, 60);
    const rookie = scoreMean(1, 1, 300, 360);
    assert.ok(
      established > rookie,
      `established ${established.toFixed(3)} > rookie ${rookie.toFixed(3)}`,
    );
  });
});

describe("aggregateErrors", () => {
  test("empty rows → zero failures", () => {
    const r = aggregateErrors([], 7);
    assert.deepEqual(r, { windowDays: 7, totalFailures: 0, breakdown: {} });
  });

  test("buckets by errorReason with counts", () => {
    const r = aggregateErrors(
      [
        { errorReason: "seller_5xx" },
        { errorReason: "seller_5xx" },
        { errorReason: "seller_timeout" },
        { errorReason: "metadata_error" },
        { errorReason: "seller_5xx" },
      ],
      7,
    );
    assert.equal(r.totalFailures, 5);
    assert.deepEqual(r.breakdown, {
      seller_5xx: 3,
      seller_timeout: 1,
      metadata_error: 1,
    });
  });

  test("null errorReason falls into 'unknown' bucket", () => {
    const r = aggregateErrors(
      [{ errorReason: null }, { errorReason: null }, { errorReason: "seller_4xx" }],
      7,
    );
    assert.equal(r.breakdown["unknown"], 2);
    assert.equal(r.breakdown["seller_4xx"], 1);
  });

  test("threads windowDays verbatim", () => {
    assert.equal(aggregateErrors([], 1).windowDays, 1);
    assert.equal(aggregateErrors([], 30).windowDays, 30);
  });
});

describe("groupByListingDay", () => {
  test("empty rows → empty result", () => {
    assert.deepEqual(groupByListingDay([]), []);
  });

  test("groups by (listingId, UTC day)", () => {
    const rows = [
      {
        listingId: 1,
        createdAt: new Date("2026-01-10T08:00:00Z"),
        success: true,
        latencyMs: 100,
        errorReason: null,
      },
      {
        listingId: 1,
        createdAt: new Date("2026-01-10T20:00:00Z"),
        success: false,
        latencyMs: 500,
        errorReason: "seller_5xx",
      },
      {
        listingId: 1,
        createdAt: new Date("2026-01-11T05:00:00Z"),
        success: true,
        latencyMs: 200,
        errorReason: null,
      },
      {
        listingId: 2,
        createdAt: new Date("2026-01-10T12:00:00Z"),
        success: true,
        latencyMs: 300,
        errorReason: null,
      },
    ];
    const result = groupByListingDay(rows);
    assert.equal(result.length, 3); // listing1/day10, listing1/day11, listing2/day10

    const l1d10 = result.find(
      (r) => r.listingId === 1 && r.date.toISOString().startsWith("2026-01-10"),
    )!;
    assert.ok(l1d10, "listing1 day10 entry should exist");
    assert.equal(l1d10.totalCalls, 2);
    assert.equal(l1d10.successes, 1);
    assert.equal(l1d10.avgLatencyMs, 100); // only the success row
    assert.deepEqual(l1d10.errorBreakdown, { seller_5xx: 1 });

    const l1d11 = result.find(
      (r) => r.listingId === 1 && r.date.toISOString().startsWith("2026-01-11"),
    )!;
    assert.equal(l1d11.totalCalls, 1);
    assert.equal(l1d11.successes, 1);
    assert.equal(l1d11.avgLatencyMs, 200);
    assert.deepEqual(l1d11.errorBreakdown, {});

    const l2d10 = result.find((r) => r.listingId === 2)!;
    assert.equal(l2d10.totalCalls, 1);
    assert.equal(l2d10.successes, 1);
    assert.equal(l2d10.avgLatencyMs, 300);
  });

  test("avgLatencyMs is 0 when all calls failed", () => {
    const rows = [
      {
        listingId: 5,
        createdAt: new Date("2026-03-01T10:00:00Z"),
        success: false,
        latencyMs: 9999,
        errorReason: "seller_timeout",
      },
      {
        listingId: 5,
        createdAt: new Date("2026-03-01T11:00:00Z"),
        success: false,
        latencyMs: 8000,
        errorReason: "seller_timeout",
      },
    ];
    const [r] = groupByListingDay(rows);
    assert.equal(r.avgLatencyMs, 0);
    assert.equal(r.totalCalls, 2);
    assert.equal(r.successes, 0);
    assert.deepEqual(r.errorBreakdown, { seller_timeout: 2 });
  });

  test("null errorReason falls into 'unknown' bucket", () => {
    const rows = [
      {
        listingId: 3,
        createdAt: new Date("2026-02-15T00:00:00Z"),
        success: false,
        latencyMs: 1000,
        errorReason: null,
      },
    ];
    const [r] = groupByListingDay(rows);
    assert.deepEqual(r.errorBreakdown, { unknown: 1 });
  });

  test("midnight UTC boundary: two rows on either side of midnight split into separate days", () => {
    const rows = [
      {
        listingId: 1,
        createdAt: new Date("2026-05-01T23:59:59Z"),
        success: true,
        latencyMs: 50,
        errorReason: null,
      },
      {
        listingId: 1,
        createdAt: new Date("2026-05-02T00:00:01Z"),
        success: true,
        latencyMs: 60,
        errorReason: null,
      },
    ];
    const result = groupByListingDay(rows);
    assert.equal(result.length, 2);
    assert.ok(result.some((r) => r.date.toISOString().startsWith("2026-05-01")));
    assert.ok(result.some((r) => r.date.toISOString().startsWith("2026-05-02")));
  });
});
