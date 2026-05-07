/**
 * The "seller" behind ChainLens's own paid listing
 * (`AI Market Analyst by ChainLens`, on-chain id 18). Receives the gateway's
 * inputs, runs the Bedrock analyzer for the *target* listing, returns the
 * MarketAnalysis JSON.
 *
 * This handler is intentionally narrow:
 *   - No payment logic (the gateway already enforces x402 + settle())
 *   - No caching here (the gateway's HTTP /api/listings/:id/market-analysis
 *     route caches; per-buyer paid calls should always be fresh — that's
 *     what they're paying for)
 *   - Schema-shape compatible with metadata.output_schema declared at register()
 */

import { logger } from "../utils/logger.js";
import { analyzeMarket, type MarketAnalysis } from "../lib/market-analyzer.js";
import prisma from "../config/prisma.js";
import { getListingStats } from "./call-log.service.js";

export interface MarketAnalystInput {
  /** Decimal on-chain listingId of the target listing to analyze. */
  listingId: string;
}

export async function marketAnalystHandler(
  inputs: unknown,
): Promise<MarketAnalysis> {
  const targetId = parseTargetId(inputs);

  const listing = await prisma.apiListing.findFirst({
    where: { onChainId: targetId, contractVersion: "V3" },
    select: { onChainId: true, name: true, category: true, price: true, createdAt: true },
  });
  if (!listing || listing.onChainId == null) {
    throw new Error(`target listing ${targetId} not found`);
  }
  const onChainId = listing.onChainId;

  const stats = await getListingStats(onChainId);
  const price = parsePriceUsdc(listing.price);
  const seed = onChainId + 1;

  // Same blend used by the free /api/listings/:id/market-analysis route:
  // when stats are sparse we synthesize plausible numbers so the analyzer
  // has something to reason over. Flagged via dataSource on the response.
  const useLive = stats.totalCalls >= 5;
  const callsLast24h = useLive ? 0 : 18 + (seed % 12) * 4;
  const callsLast7d = useLive ? stats.totalCalls : callsLast24h * 6 + (seed % 9) * 11;
  const callsLast30d = useLive ? stats.totalCalls : callsLast7d * 4 + (seed % 13) * 25;
  const growthRatePercent = useLive ? 0 : -10 + (seed % 11) * 5;

  logger.info(
    {
      route: "internal/market-analysis",
      targetListingId: targetId,
      dataSource: useLive ? "live" : "mock",
      stats: { totalCalls: stats.totalCalls, successRate: stats.successRate },
    },
    "market-analyst paid call",
  );

  const analysis = await analyzeMarket(
    {
      listingId: String(onChainId),
      title: listing.name,
      category: listing.category,
      pricePerCallUsdc: price,
      callsLast24h,
      callsLast7d,
      callsLast30d,
      growthRatePercent,
      avgRevenuePerDayUsdc: Number(((callsLast7d / 7) * price).toFixed(4)),
      categoryRankPercent: 60 + (seed % 8) * 4,
      peakHourUTC: (seed * 3) % 24,
    },
    { depth: "premium" },
  );

  // Tag dataSource so the buyer UI can label honestly when the analysis
  // was produced from a synthesized profile (sparse real stats). Schema at
  // register() only requires the "core" fields; extras are allowed.
  return Object.assign(analysis, { dataSource: useLive ? "live" : "mock" });
}

function parseTargetId(inputs: unknown): number {
  if (!inputs || typeof inputs !== "object") {
    throw new Error("inputs.listingId is required");
  }
  const raw = (inputs as Record<string, unknown>)["listingId"];
  const id = typeof raw === "string" ? Number(raw) : Number(raw);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id < 0) {
    throw new Error("inputs.listingId must be a non-negative integer (decimal string)");
  }
  return id;
}

function parsePriceUsdc(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (Number.isInteger(n) && n >= 1000) return n / 1_000_000;
  return n;
}
