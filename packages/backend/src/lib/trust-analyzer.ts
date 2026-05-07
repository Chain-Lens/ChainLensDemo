/**
 * Trust analyzer — turns operational stats for an API listing into a
 * natural-language trust verdict via Claude on Bedrock. Security checks
 * (signatures, schema contracts, settlement) stay deterministic; this
 * module is purely advisory.
 */

import { invokeClaude, extractJSON, bedrockConfig } from "./bedrock-client.js";

export interface ListingStats {
  listingId: string;
  title: string;
  category: string;
  successRate: number;        // 0.0–1.0
  totalCalls: number;
  avgLatencyMs: number;
  recentLatencyMs?: number;   // last 24h, optional
  schemaMatchRate: number;    // 0.0–1.0
  failureCount: number;
  ageInDays: number;
}

export type TrustTier = "Bronze" | "Silver" | "Gold" | "Platinum";

export interface TrustAnalysis {
  trustScore: number;         // 0–100
  tier: TrustTier;
  summary: string;            // 2–3 sentences
  strengths: string[];
  concerns: string[];
  recommendation: string;
  modelId: string;
  generatedAt: string;
  latencyMs: number;
}

const SYSTEM_PROMPT = `You are an API quality analyst for ChainLens, an agent-native API marketplace.

Given operational stats for an API listing, generate a trust analysis with:
- A trust score (0-100) based on reliability, consistency, and maturity
- A tier (Bronze < 50, Silver 50-69, Gold 70-89, Platinum 90+)
- A 2-3 sentence summary in natural language
- 1-3 specific strengths (bullet point style)
- 1-3 specific concerns (bullet point style, can be empty if none)
- A recommendation for who should use this API

Be specific and data-driven. Reference actual numbers. Avoid generic platitudes.

Output ONLY valid JSON matching this schema:
{
  "trustScore": number,
  "tier": "Bronze" | "Silver" | "Gold" | "Platinum",
  "summary": string,
  "strengths": string[],
  "concerns": string[],
  "recommendation": string
}`;

interface RawVerdict {
  trustScore: number;
  tier: TrustTier;
  summary: string;
  strengths?: string[];
  concerns?: string[];
  recommendation: string;
}

export async function analyzeTrust(stats: ListingStats): Promise<TrustAnalysis> {
  const userPrompt = buildUserPrompt(stats);

  const { text, latencyMs } = await invokeClaude({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    maxTokens: 800,
  });

  const verdict = extractJSON<RawVerdict>(text);

  return {
    trustScore: verdict.trustScore,
    tier: verdict.tier,
    summary: verdict.summary,
    strengths: verdict.strengths ?? [],
    concerns: verdict.concerns ?? [],
    recommendation: verdict.recommendation,
    modelId: bedrockConfig.modelId,
    generatedAt: new Date().toISOString(),
    latencyMs,
  };
}

function buildUserPrompt(stats: ListingStats): string {
  const lines = [
    `Analyze this API listing:`,
    ``,
    `Title: ${stats.title}`,
    `Category: ${stats.category}`,
    `Age: ${stats.ageInDays} days on platform`,
    ``,
    `Performance:`,
    `- Success rate: ${(stats.successRate * 100).toFixed(1)}%`,
    `- Total calls: ${stats.totalCalls}`,
    `- Schema match rate: ${(stats.schemaMatchRate * 100).toFixed(1)}%`,
    `- Failure count: ${stats.failureCount}`,
    `- Average latency: ${stats.avgLatencyMs}ms`,
  ];
  if (stats.recentLatencyMs !== undefined) {
    lines.push(`- Recent (24h) latency: ${stats.recentLatencyMs}ms`);
  }
  lines.push(``, `Generate trust analysis. JSON only.`);
  return lines.join("\n");
}
