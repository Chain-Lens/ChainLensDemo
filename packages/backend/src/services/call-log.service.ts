/**
 * CallLog service — every `/api/market/call/:id` that reaches the listing
 * stage gets one row here. Rows feed per-listing stats + the ranking score
 * used by chain-lens.discover in Phase 2b.
 *
 * Writes are fire-and-forget from the request handler: a DB flake must not
 * block a successful settlement. Callers `void logCall(...).catch(...)`.
 */

import prisma from "../config/prisma.js";

export interface CallLogInput {
  listingId: number;
  buyer: string;
  success: boolean;
  sellerStatus?: number | null;
  latencyMs: number;
  amount: string;
  jobRef: string;
  settleTxHash?: string | null;
  errorReason?: string | null;
  warningCount?: number | null;
}

export interface ListingStats {
  /** [0.0, 1.0] — pure empirical: successes / totalCalls. 0 when totalCalls=0. */
  successRate: number;
  /** Average latency (ms) across successful calls only. Failed calls often
   *  hit the 30s seller timeout and would pollute the signal. */
  avgLatencyMs: number;
  /** Total calls in the active window. */
  totalCalls: number;
  /** Successful calls in the window — exposed for Laplace smoothing in
   *  scoreListing without needing rate × total rounding tricks. */
  successes: number;
  /** Wall-clock of the most recent call (success or fail). */
  lastCalledAt: Date | null;
  /** Window the stats were computed over, in days. */
  windowDays: number;
}

export const DEFAULT_WINDOW_DAYS = 30;

/**
 * Insert a call-log row. Normalises buyer to lowercase so the index hits
 * consistently regardless of caller casing.
 */
export async function logCall(input: CallLogInput): Promise<void> {
  await prisma.callLog.create({
    data: {
      listingId: input.listingId,
      buyer: input.buyer.toLowerCase(),
      success: input.success,
      sellerStatus: input.sellerStatus ?? null,
      latencyMs: input.latencyMs,
      amount: input.amount,
      jobRef: input.jobRef,
      settleTxHash: input.settleTxHash ?? null,
      errorReason: input.errorReason ?? null,
      warningCount: input.warningCount ?? null,
    },
  });
}

export async function getListingStats(
  listingId: number,
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<ListingStats> {
  const since = windowStart(windowDays);
  const rows = await prisma.callLog.findMany({
    where: { listingId, createdAt: { gte: since } },
    select: { success: true, latencyMs: true, createdAt: true },
  });
  return aggregateRows(rows, windowDays);
}

/**
 * Batch variant for the listings index — one SQL round trip regardless of
 * how many listings we're rendering. Returns a map keyed by listingId;
 * listings with no calls in the window get a zeroed ListingStats entry.
 */
export async function getListingsStats(
  listingIds: number[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
): Promise<Map<number, ListingStats>> {
  const result = new Map<number, ListingStats>();
  if (listingIds.length === 0) return result;

  const since = windowStart(windowDays);
  const rows = await prisma.callLog.findMany({
    where: {
      listingId: { in: listingIds },
      createdAt: { gte: since },
    },
    select: {
      listingId: true,
      success: true,
      latencyMs: true,
      createdAt: true,
    },
  });
  const byListing = new Map<number, RawRow[]>();
  for (const r of rows) {
    const list = byListing.get(r.listingId) ?? [];
    list.push({ success: r.success, latencyMs: r.latencyMs, createdAt: r.createdAt });
    byListing.set(r.listingId, list);
  }
  for (const id of listingIds) {
    result.set(id, aggregateRows(byListing.get(id) ?? [], windowDays));
  }
  return result;
}

/**
 * Breakdown of recent failures keyed by errorReason. Used by the inspect
 * endpoint so agents and admins can see *why* a listing is flaky — a pile
 * of `seller_5xx` tells a very different story from `seller_timeout`.
 */
export interface RecentErrors {
  windowDays: number;
  totalFailures: number;
  /** errorReason → count. "unknown" bucket catches nulls (should be rare). */
  breakdown: Record<string, number>;
}

export const DEFAULT_ERROR_WINDOW_DAYS = 7;

export async function getRecentErrors(
  listingId: number,
  windowDays: number = DEFAULT_ERROR_WINDOW_DAYS,
): Promise<RecentErrors> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await prisma.callLog.findMany({
    where: {
      listingId,
      success: false,
      createdAt: { gte: since },
    },
    select: { errorReason: true },
  });
  return aggregateErrors(rows, windowDays);
}

// Exported for unit tests — pure function.
export function aggregateErrors(
  rows: { errorReason: string | null }[],
  windowDays: number,
): RecentErrors {
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const key = r.errorReason ?? "unknown";
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }
  return {
    windowDays,
    totalFailures: rows.length,
    breakdown,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Thompson sampling — Beta(1+successes, 1+failures) posterior score
// ──────────────────────────────────────────────────────────────────────

/** Box-Muller transform: standard normal from two U(0,1) samples. */
function normalRandom(rng: () => number): number {
  let u: number;
  do {
    u = rng();
  } while (u === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Marsaglia-Tsang rejection sampler for Gamma(shape, rate=1), shape > 0.
 * For shape < 1 uses the standard reduction: Gamma(α) = Gamma(α+1) × U^(1/α).
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, rng) * Math.pow(rng(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = normalRandom(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Sample from Beta(alpha, beta) via ratio of two independent Gamma samples.
 * Exported for unit testing; production callers should use scoreListing.
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number = Math.random): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Thompson-sampling score: draw once from Beta(1+successes, 1+failures).
 *
 * Why Thompson over Laplace + log-volume:
 *   - Naturally balances exploration vs exploitation without a hand-tuned
 *     volume exponent.
 *   - Cold start: Beta(1,1) = Uniform(0,1) → expected 0.5, same as before.
 *   - High evidence: posterior concentrates around the true rate.
 *   - Still stochastic → weighted shuffle in market.routes stays meaningful.
 *
 * Optional rng for unit tests; defaults to Math.random in production.
 * Signature is backward-compatible with all callers.
 */
export function scoreListing(stats: ListingStats, rng: () => number = Math.random): number {
  const alpha = 1 + stats.successes;
  const beta = 1 + (stats.totalCalls - stats.successes);
  return sampleBeta(alpha, beta, rng);
}

// ──────────────────────────────────────────────────────────────────────
// Admin-only raw log access
// ──────────────────────────────────────────────────────────────────────
//
// Public stats endpoints strip `buyer` so wallet addresses aren't leaked
// to the world. Admin triage ("why is listing #7 constantly failing?")
// needs the raw rows with buyer visible — that's what this exposes.
// Access control happens at the route layer (requireAdmin middleware).

export interface CallLogFilter {
  listingId: number;
  onlyFailures?: boolean;
  since?: Date;
  limit?: number;
  offset?: number;
}

export interface CallLogPage {
  items: Array<{
    id: string;
    listingId: number;
    buyer: string;
    success: boolean;
    sellerStatus: number | null;
    latencyMs: number;
    amount: string;
    jobRef: string;
    settleTxHash: string | null;
    errorReason: string | null;
    createdAt: Date;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export async function listCallLogs(filter: CallLogFilter): Promise<CallLogPage> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  const where = {
    listingId: filter.listingId,
    ...(filter.onlyFailures ? { success: false } : {}),
    ...(filter.since ? { createdAt: { gte: filter.since } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.callLog.count({ where }),
  ]);
  return { items, total, limit, offset };
}

// ---------- internals (exported for tests) ----------

export interface RawRow {
  success: boolean;
  latencyMs: number;
  createdAt: Date;
}

/** Cold-start prior — matches the Beta(1,1) used by scoreListing (uniform,
 *  expected value 0.5). 0% would imply "this listing is known to fail," which
 *  is the wrong signal for a brand-new listing with zero observations. */
export const COLD_START_SUCCESS_RATE = 0.5;

export function aggregateRows(rows: RawRow[], windowDays: number): ListingStats {
  if (rows.length === 0) {
    return {
      successRate: COLD_START_SUCCESS_RATE,
      avgLatencyMs: 0,
      totalCalls: 0,
      successes: 0,
      lastCalledAt: null,
      windowDays,
    };
  }
  const successRows = rows.filter((r) => r.success);
  const successes = successRows.length;
  const successRate = successes / rows.length;
  const avgLatencyMs = successes
    ? Math.round(successRows.reduce((sum, r) => sum + r.latencyMs, 0) / successes)
    : 0;
  const lastCalledAt = rows.reduce(
    (max, r) => (r.createdAt > max ? r.createdAt : max),
    rows[0]!.createdAt,
  );
  return {
    successRate,
    avgLatencyMs,
    totalCalls: rows.length,
    successes,
    lastCalledAt,
    windowDays,
  };
}

function windowStart(windowDays: number): Date {
  return new Date(Date.now() - windowDays * 86_400_000);
}

// ──────────────────────────────────────────────────────────────────────
// Retention rollup — keeps the raw CallLog table bounded at ~90 days
// ──────────────────────────────────────────────────────────────────────

export const DEFAULT_RETAIN_DAYS = 90;

export interface DayRollup {
  listingId: number;
  date: Date;
  totalCalls: number;
  successes: number;
  avgLatencyMs: number;
  errorBreakdown: Record<string, number>;
}

type RollupRow = {
  listingId: number;
  createdAt: Date;
  success: boolean;
  latencyMs: number;
  errorReason: string | null;
};

/** Pure: group raw rows into per-(listingId, UTC day) aggregates. */
export function groupByListingDay(rows: RollupRow[]): DayRollup[] {
  const map = new Map<string, { entry: DayRollup; latencySum: number }>();
  for (const r of rows) {
    const dateStr = r.createdAt.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const key = `${r.listingId}:${dateStr}`;
    if (!map.has(key)) {
      map.set(key, {
        entry: {
          listingId: r.listingId,
          date: new Date(`${dateStr}T00:00:00.000Z`),
          totalCalls: 0,
          successes: 0,
          avgLatencyMs: 0,
          errorBreakdown: {},
        },
        latencySum: 0,
      });
    }
    const slot = map.get(key)!;
    slot.entry.totalCalls++;
    if (r.success) {
      slot.entry.successes++;
      slot.latencySum += r.latencyMs;
    } else {
      const k = r.errorReason ?? "unknown";
      slot.entry.errorBreakdown[k] = (slot.entry.errorBreakdown[k] ?? 0) + 1;
    }
  }
  return [...map.values()].map(({ entry, latencySum }) => ({
    ...entry,
    avgLatencyMs: entry.successes > 0 ? Math.round(latencySum / entry.successes) : 0,
  }));
}

/**
 * Rollup raw CallLog rows older than `retainDays` into CallLogDailyRollup,
 * then delete the originals. Safe to run repeatedly — upsert is idempotent.
 *
 * Returns the number of distinct (listingId, date) buckets rolled up and
 * the number of raw rows deleted.
 */
export async function rollupAndPruneCallLogs(
  retainDays: number = DEFAULT_RETAIN_DAYS,
): Promise<{ rolledUp: number; pruned: number }> {
  const threshold = windowStart(retainDays);

  const oldRows = await prisma.callLog.findMany({
    where: { createdAt: { lt: threshold } },
    select: {
      listingId: true,
      createdAt: true,
      success: true,
      latencyMs: true,
      errorReason: true,
    },
  });

  if (oldRows.length === 0) return { rolledUp: 0, pruned: 0 };

  const rollups = groupByListingDay(oldRows);

  for (const r of rollups) {
    await prisma.callLogDailyRollup.upsert({
      where: { listingId_date: { listingId: r.listingId, date: r.date } },
      create: {
        listingId: r.listingId,
        date: r.date,
        totalCalls: r.totalCalls,
        successes: r.successes,
        avgLatencyMs: r.avgLatencyMs,
        errorBreakdown: r.errorBreakdown,
      },
      update: {
        totalCalls: r.totalCalls,
        successes: r.successes,
        avgLatencyMs: r.avgLatencyMs,
        errorBreakdown: r.errorBreakdown,
      },
    });
  }

  const { count: pruned } = await prisma.callLog.deleteMany({
    where: { createdAt: { lt: threshold } },
  });

  return { rolledUp: rollups.length, pruned };
}
