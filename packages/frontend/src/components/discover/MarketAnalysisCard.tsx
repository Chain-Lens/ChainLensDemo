import {
  fetchMarketAnalysis,
  type MarketAnalysis,
  type MarketTrend,
  type TrendStrength,
} from "@/lib/ai-analysis-api";
import { AiAnalystHeader, AiError, AiSkeleton } from "./AiAnalystShared";

const SUBTITLE = "Forward-looking market read from Claude on Bedrock. Insight, forecast, and seller opportunities — not a price oracle.";

export const MarketAnalysisSkeleton = () => (
  <AiSkeleton title="Market Analysis" subtitle={SUBTITLE} />
);

type ViewProps = {
  analysis: MarketAnalysis;
  /** Hide the "For buyers" block — useful when the seller is reading their
   *  own paid analysis (which is for them, not their buyers). */
  omitBuyerNote?: boolean;
};

/** Presentational component — no fetching. Use this from any client/server
 *  context once you already have the analysis object (e.g. from a paid call). */
export function MarketAnalysisView({ analysis: a, omitBuyerNote = false }: ViewProps) {
  const isPremium =
    !!a.competitivePositioning ||
    !!a.pricingAnalysis ||
    (a.riskFactors && a.riskFactors.length > 0) ||
    !!a.actionPlan;

  return (
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <AiAnalystHeader
        title={isPremium ? "Market Analysis · Premium" : "Market Analysis"}
        subtitle={SUBTITLE}
        modelId={a.modelId}
        generatedAt={a.generatedAt}
        latencyMs={a.latencyMs}
        dataSource={a.dataSource}
        cached={a.cached}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto,1fr] sm:items-center">
        <TrendChip trend={a.trend} strength={a.trendStrength} />
        <p className="text-sm leading-relaxed text-[var(--text2)]">{a.insight}</p>
      </div>

      <div className="mt-4 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">Forecast</div>
        <p className="mt-1 text-sm text-[var(--text)]">{a.forecast}</p>
      </div>

      {a.competitivePositioning && (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
            Competitive positioning
          </div>
          <p className="mt-1 text-sm text-[var(--text2)]">{a.competitivePositioning}</p>
        </div>
      )}

      {a.pricingAnalysis && (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
          <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
            Pricing analysis
          </div>
          <p className="mt-1 text-sm text-[var(--text2)]">{a.pricingAnalysis}</p>
        </div>
      )}

      <div className={`mt-4 grid gap-3 ${omitBuyerNote ? "" : "sm:grid-cols-2"}`}>
        <Bullets
          title="Opportunities"
          items={a.opportunities}
          dot="bg-[var(--accent)]"
          emptyText="No specific opportunities flagged."
        />
        {!omitBuyerNote && (
          <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
              For buyers
            </div>
            <p className="mt-1 text-sm text-[var(--text2)]">{a.buyerNote}</p>
          </div>
        )}
      </div>

      {a.riskFactors && a.riskFactors.length > 0 && (
        <Bullets
          title="Risk factors"
          items={a.riskFactors}
          dot="bg-[var(--red)]"
          className="mt-4"
        />
      )}

      {a.actionPlan && (a.actionPlan.thisWeek.length > 0 || a.actionPlan.thisMonth.length > 0) && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Bullets
            title="Action plan · this week"
            items={a.actionPlan.thisWeek}
            dot="bg-[var(--green)]"
          />
          <Bullets
            title="Action plan · this month"
            items={a.actionPlan.thisMonth}
            dot="bg-[var(--accent)]"
          />
        </div>
      )}
    </div>
  );
}

/** Server Component — fetches the free /api/listings/:id/market-analysis route. */
export default async function MarketAnalysisCard({ listingId }: { listingId: string }) {
  const result = await fetchMarketAnalysis(listingId);

  if (!result.ok) {
    return <AiError title="Market Analysis" subtitle={SUBTITLE} message={result.error} />;
  }
  return <MarketAnalysisView analysis={result.data} />;
}

function Bullets({
  title,
  items,
  dot,
  emptyText,
  className,
}: {
  title: string;
  items: string[];
  dot: string;
  emptyText?: string;
  className?: string;
}) {
  return (
    <div className={`rounded border border-[var(--border)] bg-[var(--bg)] p-3 ${className ?? ""}`}>
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--text3)]">{emptyText ?? "—"}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-xs text-[var(--text2)]">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TrendChip({ trend, strength }: { trend: MarketTrend; strength: TrendStrength }) {
  const trendColor: Record<MarketTrend, string> = {
    growing: "border-[var(--green)] text-[var(--green)] bg-[var(--green-dim)]",
    stable: "border-[var(--border2)] text-[var(--text2)]",
    declining: "border-[var(--red)] text-[var(--red)]",
  };
  const arrow: Record<MarketTrend, string> = {
    growing: "▲",
    stable: "→",
    declining: "▼",
  };
  return (
    <div className="flex flex-col items-start gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 sm:items-center">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.12em] ${trendColor[trend]}`}>
        {arrow[trend]} {trend}
      </span>
      <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--text3)]">
        {strength} signal
      </span>
    </div>
  );
}
