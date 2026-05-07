/**
 * Market analyzer — generates a natural-language read on a listing's
 * market dynamics. Two depth modes:
 *
 *   "standard"  — short verdict (used by the free /api/listings/:id route)
 *   "premium"   — long, action-oriented verdict (used by the paid x402
 *                 self-listing #18 — sellers buying their own analysis)
 *
 * Forward-looking commentary is the exact place LLMs earn their keep;
 * correctness checks remain deterministic elsewhere.
 */

import { invokeClaude, extractJSON, bedrockConfig } from "./bedrock-client.js";

export interface MarketStats {
  listingId: string;
  title: string;
  category: string;
  pricePerCallUsdc: number;
  callsLast24h: number;
  callsLast7d: number;
  callsLast30d: number;
  growthRatePercent: number;       // week-over-week
  avgRevenuePerDayUsdc: number;
  categoryRankPercent: number;     // 0-100, higher is better
  peakHourUTC?: number;            // 0-23
}

export type MarketTrend = "growing" | "stable" | "declining";
export type TrendStrength = "weak" | "moderate" | "strong";
export type AnalysisDepth = "standard" | "premium";

export interface MarketAnalysis {
  trend: MarketTrend;
  trendStrength: TrendStrength;
  insight: string;
  forecast: string;
  opportunities: string[];
  buyerNote: string;
  /** Premium-only fields. Optional so the lean schema check on the on-chain
   *  metadata still passes for both depth modes. */
  competitivePositioning?: string;
  pricingAnalysis?: string;
  riskFactors?: string[];
  actionPlan?: { thisWeek: string[]; thisMonth: string[] };
  modelId: string;
  generatedAt: string;
  latencyMs: number;
}

const STANDARD_PROMPT = `You are a market analyst for ChainLens, an agent-native API marketplace.

Given market stats for an API listing, generate market analysis with:
- Trend direction (growing/stable/declining) and strength
- A 2-3 sentence insight referencing specific numbers
- A forward-looking forecast (next 1-2 weeks)
- 1-3 specific opportunities for the seller
- A short note for potential buyers

Be data-driven. Reference actual numbers. Don't hedge with "may" / "could" too much - take a position.

Output ONLY valid JSON:
{
  "trend": "growing" | "stable" | "declining",
  "trendStrength": "weak" | "moderate" | "strong",
  "insight": string,
  "forecast": string,
  "opportunities": string[],
  "buyerNote": string
}`;

const PREMIUM_PROMPT = `You are a senior market analyst for ChainLens, an agent-native API marketplace. The seller has paid 0.5 USDC for an in-depth analysis of their own listing — give them money's worth.

Generate a thorough analysis with:
- Trend direction (growing/stable/declining) and strength
- A 4-6 sentence insight that references specific numbers, computes derived metrics where useful (e.g. revenue per call, daily call rate, trend slope), and identifies the single most important narrative for this listing right now.
- A concrete forward-looking forecast for the next 1-2 weeks. Quote specific numerical targets (e.g. "expect 350-420 calls next week" / "revenue trending toward X USDC/day"). Avoid generic hedging.
- A "competitivePositioning" paragraph (3-4 sentences) explaining where the listing stands relative to its category — quote the rank percent, infer what top performers likely do differently, and state where this listing has the largest gap to close.
- A "pricingAnalysis" paragraph (2-3 sentences) on whether the current price is too low / right / too high given volume + category, with a specific suggested adjustment if warranted.
- 3-5 tactical "opportunities" — each item must be a concrete action the seller can do this week (not generic advice). Example good: "Reduce avg latency to <200ms by adding response caching for repeated TSLA snapshots — current 312ms is the median in your tier; top performers average 180ms." Example bad: "Improve performance."
- 2-3 "riskFactors" — concrete things that could derail growth or revenue. Be specific about which metric would move first.
- An "actionPlan" with two timeframes: thisWeek (1-3 items, immediate) and thisMonth (1-3 items, larger initiatives).
- Keep "buyerNote" to 1-2 sentences — useful for the seller to understand how the listing reads to a buyer.

Be specific. Quote numbers. Take positions. The seller is paying for judgment, not platitudes.

Output ONLY valid JSON, exactly this schema:
{
  "trend": "growing" | "stable" | "declining",
  "trendStrength": "weak" | "moderate" | "strong",
  "insight": string,
  "forecast": string,
  "competitivePositioning": string,
  "pricingAnalysis": string,
  "opportunities": string[],
  "riskFactors": string[],
  "actionPlan": { "thisWeek": string[], "thisMonth": string[] },
  "buyerNote": string
}`;

interface RawVerdict {
  trend: MarketTrend;
  trendStrength: TrendStrength;
  insight: string;
  forecast: string;
  opportunities?: string[];
  buyerNote: string;
  competitivePositioning?: string;
  pricingAnalysis?: string;
  riskFactors?: string[];
  actionPlan?: { thisWeek?: string[]; thisMonth?: string[] };
}

export interface AnalyzeMarketOptions {
  depth?: AnalysisDepth;
}

export async function analyzeMarket(
  stats: MarketStats,
  opts: AnalyzeMarketOptions = {},
): Promise<MarketAnalysis> {
  const depth: AnalysisDepth = opts.depth ?? "standard";
  const isPremium = depth === "premium";
  const userPrompt = buildUserPrompt(stats);

  const { text, latencyMs } = await invokeClaude({
    systemPrompt: isPremium ? PREMIUM_PROMPT : STANDARD_PROMPT,
    userPrompt,
    // Premium asks for 5+ paragraphs + arrays — give Claude room. The
    // standard mode stays at 800 to keep the free route latency reasonable.
    maxTokens: isPremium ? 1800 : 800,
  });

  const verdict = extractJSON<RawVerdict>(text);

  return {
    trend: verdict.trend,
    trendStrength: verdict.trendStrength,
    insight: verdict.insight,
    forecast: verdict.forecast,
    opportunities: verdict.opportunities ?? [],
    buyerNote: verdict.buyerNote,
    ...(verdict.competitivePositioning ? { competitivePositioning: verdict.competitivePositioning } : {}),
    ...(verdict.pricingAnalysis ? { pricingAnalysis: verdict.pricingAnalysis } : {}),
    ...(verdict.riskFactors ? { riskFactors: verdict.riskFactors } : {}),
    ...(verdict.actionPlan
      ? {
          actionPlan: {
            thisWeek: verdict.actionPlan.thisWeek ?? [],
            thisMonth: verdict.actionPlan.thisMonth ?? [],
          },
        }
      : {}),
    modelId: bedrockConfig.modelId,
    generatedAt: new Date().toISOString(),
    latencyMs,
  };
}

function buildUserPrompt(stats: MarketStats): string {
  const sign = stats.growthRatePercent > 0 ? "+" : "";
  const lines = [
    `Analyze this API listing's market dynamics:`,
    ``,
    `Title: ${stats.title}`,
    `Category: ${stats.category}`,
    `Price: ${stats.pricePerCallUsdc} USDC per call`,
    ``,
    `Volume:`,
    `- Last 24h: ${stats.callsLast24h} calls`,
    `- Last 7d: ${stats.callsLast7d} calls`,
    `- Last 30d: ${stats.callsLast30d} calls`,
    `- Growth rate (WoW): ${sign}${stats.growthRatePercent}%`,
    ``,
    `Revenue:`,
    `- Avg revenue/day: ${stats.avgRevenuePerDayUsdc} USDC`,
    ``,
    `Position:`,
    `- Category rank: top ${100 - stats.categoryRankPercent}%`,
  ];
  if (stats.peakHourUTC !== undefined) {
    lines.push(`- Peak demand hour: ${stats.peakHourUTC}:00 UTC`);
  }
  lines.push(``, `Generate market analysis. JSON only.`);
  return lines.join("\n");
}
