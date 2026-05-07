/**
 * AI Analyst routes — Bedrock-powered trust + market analysis for listings.
 *
 * Design notes:
 *  • Boundary: LLM produces *advisory* output only. Settlement, signature
 *    verification, schema enforcement, and admin gating remain deterministic
 *    (see listing-call.service.ts). A bad LLM verdict cannot route money.
 *  • Caching: 1h TTL in-memory; swap for Redis by replacing the cache impl.
 *  • Mock fallback: hackathon stage stats are sparse. When totalCalls < 5
 *    we synthesize a plausible profile so the demo still produces a verdict.
 *    Flagged with `dataSource: "mock"` so the frontend can label it honestly.
 */

import { Router, Request, Response, NextFunction } from "express";
import prisma from "../config/prisma.js";
import { logger } from "../utils/logger.js";
import { NotFoundError, BadRequestError, AppError } from "../utils/errors.js";
import { getListingStats } from "../services/call-log.service.js";
import {
  analyzeTrust,
  type ListingStats as TrustInput,
  type TrustAnalysis,
} from "../lib/trust-analyzer.js";
import {
  analyzeMarket,
  type MarketStats as MarketInput,
  type MarketAnalysis,
} from "../lib/market-analyzer.js";
import { InMemoryTTLCache } from "../lib/cache.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const trustCache = new InMemoryTTLCache<TrustAnalysis & { dataSource: DataSource }>();
const marketCache = new InMemoryTTLCache<MarketAnalysis & { dataSource: DataSource }>();

type DataSource = "live" | "mock" | "blended";

const router = Router();

// ──────────────────────────────────────────────────────────────────────
// GET /api/listings/:id/trust-analysis
// ──────────────────────────────────────────────────────────────────────

router.get("/:id/trust-analysis", async (req, res, next) => {
  try {
    const id = parseListingId(req);
    const cached = await trustCache.get(`trust:${id}`);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const listing = await loadListing(id);
    const { stats, dataSource } = await buildTrustInput(listing);

    let analysis: TrustAnalysis;
    try {
      analysis = await analyzeTrust(stats);
    } catch (err) {
      throw mapBedrockError(err);
    }

    const payload = { ...analysis, dataSource };
    await trustCache.set(`trust:${id}`, payload, CACHE_TTL_MS);
    res.json({ ...payload, cached: false });
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/listings/:id/market-analysis
// ──────────────────────────────────────────────────────────────────────

router.get("/:id/market-analysis", async (req, res, next) => {
  try {
    const id = parseListingId(req);
    const cached = await marketCache.get(`market:${id}`);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const listing = await loadListing(id);
    const { stats, dataSource } = await buildMarketInput(listing);

    let analysis: MarketAnalysis;
    try {
      analysis = await analyzeMarket(stats);
    } catch (err) {
      throw mapBedrockError(err);
    }

    const payload = { ...analysis, dataSource };
    await marketCache.set(`market:${id}`, payload, CACHE_TTL_MS);
    res.json({ ...payload, cached: false });
  } catch (err) {
    next(err);
  }
});

export default router;

// ──────────────────────────────────────────────────────────────────────
// Internals
// ──────────────────────────────────────────────────────────────────────

function parseListingId(req: Request): number {
  const raw = req.params["id"];
  const id = Number(raw);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id < 0) {
    throw new BadRequestError("listing id must be a non-negative integer");
  }
  return id;
}

interface DbListing {
  onChainId: number;
  name: string;
  category: string;
  price: string;
  createdAt: Date;
}

async function loadListing(onChainId: number): Promise<DbListing> {
  // V3 first; fall back to legacy rows that don't carry contractVersion so
  // pre-V3 demo listings still get analyzed.
  const row =
    (await prisma.apiListing.findFirst({
      where: { onChainId, contractVersion: "V3" },
      select: {
        onChainId: true,
        name: true,
        category: true,
        price: true,
        createdAt: true,
      },
    })) ??
    (await prisma.apiListing.findFirst({
      where: { onChainId },
      select: {
        onChainId: true,
        name: true,
        category: true,
        price: true,
        createdAt: true,
      },
    }));

  if (!row || row.onChainId == null) {
    throw new NotFoundError(`listing ${onChainId} not found`);
  }
  return row as DbListing;
}

const MIN_CALLS_FOR_LIVE = 5;

async function buildTrustInput(
  listing: DbListing,
): Promise<{ stats: TrustInput; dataSource: DataSource }> {
  const stats = await getListingStats(listing.onChainId);
  const ageInDays = Math.max(
    1,
    Math.floor((Date.now() - listing.createdAt.getTime()) / 86_400_000),
  );

  if (stats.totalCalls >= MIN_CALLS_FOR_LIVE) {
    return {
      stats: {
        listingId: String(listing.onChainId),
        title: listing.name,
        category: listing.category,
        successRate: stats.successRate,
        totalCalls: stats.totalCalls,
        avgLatencyMs: stats.avgLatencyMs,
        schemaMatchRate: stats.successRate, // proxy: settled calls passed schema gate
        failureCount: stats.totalCalls - stats.successes,
        ageInDays,
      },
      dataSource: "live",
    };
  }

  // MOCK_DATA: replace when prod stats available.
  // We seed deterministically from listingId so the demo verdict is stable
  // across reloads (within the cache window) and listing-to-listing variation
  // is visible.
  const seed = listing.onChainId + 1;
  const mocked: TrustInput = {
    listingId: String(listing.onChainId),
    title: listing.name,
    category: listing.category,
    successRate: 0.88 + (seed % 7) * 0.015, // 0.88–0.97
    totalCalls: 120 + (seed % 11) * 35,     // 120–470
    avgLatencyMs: 240 + (seed % 13) * 30,   // 240–600 ms
    recentLatencyMs: 220 + (seed % 9) * 25,
    schemaMatchRate: 0.96 + (seed % 4) * 0.01, // 0.96–0.99
    failureCount: 3 + (seed % 8),
    ageInDays,
  };
  return { stats: mocked, dataSource: "mock" };
}

async function buildMarketInput(
  listing: DbListing,
): Promise<{ stats: MarketInput; dataSource: DataSource }> {
  const stats = await getListingStats(listing.onChainId);
  const price = parsePriceUsdc(listing.price);

  if (stats.totalCalls >= MIN_CALLS_FOR_LIVE) {
    return {
      stats: {
        listingId: String(listing.onChainId),
        title: listing.name,
        category: listing.category,
        pricePerCallUsdc: price,
        callsLast24h: 0, // not tracked separately yet — windowed roll-ups TBD
        callsLast7d: stats.totalCalls, // 30d window today; treat as a floor
        callsLast30d: stats.totalCalls,
        growthRatePercent: 0,
        avgRevenuePerDayUsdc: (stats.totalCalls * price) / Math.max(stats.windowDays, 1),
        categoryRankPercent: 50,
      },
      dataSource: "blended",
    };
  }

  // MOCK_DATA: replace when prod stats available.
  const seed = listing.onChainId + 1;
  const callsLast24h = 18 + (seed % 12) * 4;
  const callsLast7d = callsLast24h * 6 + (seed % 9) * 11;
  const callsLast30d = callsLast7d * 4 + (seed % 13) * 25;
  const growthRatePercent = -10 + (seed % 11) * 5; // -10% .. +40%
  const mocked: MarketInput = {
    listingId: String(listing.onChainId),
    title: listing.name,
    category: listing.category,
    pricePerCallUsdc: price,
    callsLast24h,
    callsLast7d,
    callsLast30d,
    growthRatePercent,
    avgRevenuePerDayUsdc: Number(((callsLast7d / 7) * price).toFixed(4)),
    categoryRankPercent: 60 + (seed % 8) * 4, // 60-88
    peakHourUTC: (seed * 3) % 24,
  };
  return { stats: mocked, dataSource: "mock" };
}

/** USDC listings are stored as strings — frequently raw 6-decimal units.
 *  We accept both whole-USDC decimals ("0.05") and raw integers ("50000"). */
function parsePriceUsdc(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Heuristic: if the value is a large integer it's almost certainly raw
  // 6-decimal units. Decimals or small floats are already in USDC.
  if (Number.isInteger(n) && n >= 1000) return n / 1_000_000;
  return n;
}

function mapBedrockError(err: unknown): AppError {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "Bedrock invocation failed");
  if (/No JSON found/i.test(message)) {
    return new AppError("AI analysis temporarily unavailable", 500, "AI_PARSE_FAILED");
  }
  if (/credential|signature|access ?denied/i.test(message)) {
    return new AppError("AI analysis unavailable: auth failure", 500, "AI_AUTH_FAILED");
  }
  if (/throttl|rate/i.test(message)) {
    return new AppError("AI analysis throttled, retry shortly", 503, "AI_THROTTLED");
  }
  return new AppError("AI analysis temporarily unavailable", 500, "AI_FAILED");
}
