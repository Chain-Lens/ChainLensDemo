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

const PREMIUM_PROMPT = `You are a senior market analyst for ChainLens, an agent-native API marketplace. A seller paid 0.5 USDC for an in-depth analysis of their listing.

Output a SINGLE JSON object — nothing else, no prose, no markdown fences. The schema is strict; do NOT invent fields, do NOT change types, do NOT extend enums.

REQUIRED SCHEMA (every field required):
{
  "trend": "growing" | "stable" | "declining",       // pick exactly one of these three strings, lowercase
  "trendStrength": "weak" | "moderate" | "strong",   // pick exactly one of these three strings, lowercase
  "insight": "...",                                   // 4-6 sentences, single string
  "forecast": "...",                                  // 3-5 sentences with specific numerical targets, single string
  "competitivePositioning": "...",                    // 3-4 sentences, single string
  "pricingAnalysis": "...",                           // 2-3 sentences, single string
  "opportunities": ["...", "...", "..."],             // array of 3-5 concrete tactical strings
  "riskFactors": ["...", "..."],                      // array of 2-3 concrete risk strings
  "actionPlan": {
    "thisWeek": ["...", "..."],                       // 1-3 immediate items
    "thisMonth": ["...", "..."]                       // 1-3 larger initiatives
  },
  "buyerNote": "..."                                  // 1-2 sentences from a buyer's perspective
}

Hard rules — violating ANY of these breaks the integration:
- "trend" MUST be one of "growing" / "stable" / "declining". Never "bullish", "rising", or any synonym.
- "trendStrength" MUST be one of "weak" / "moderate" / "strong". Never a number, never another word.
- All string fields are plain prose — no nested JSON, no bullet markers like "- " or "1.".
- Quote specific numbers from the input (call counts, %, USDC) wherever possible.
- Each "opportunities" / "riskFactors" item is ONE concrete sentence (e.g. "Reduce p99 latency from 312ms to under 200ms by caching the TSLA snapshot for 60s"). No generic advice.
- Take positions; do not hedge with "may" / "might" / "could".

Output the JSON object only. No leading text, no trailing text, no fences.`;

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
