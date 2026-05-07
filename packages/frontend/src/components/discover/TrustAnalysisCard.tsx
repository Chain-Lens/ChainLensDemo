import { fetchTrustAnalysis, type TrustTier } from "@/lib/ai-analysis-api";
import { AiAnalystHeader, AiError, AiSkeleton } from "./AiAnalystShared";

const SUBTITLE = "Reliability + maturity verdict from Claude on Bedrock. Advisory only — settlement and schema gates remain deterministic.";

export const TrustAnalysisSkeleton = () => (
  <AiSkeleton title="Trust Analysis" subtitle={SUBTITLE} />
);

export default async function TrustAnalysisCard({ listingId }: { listingId: string }) {
  const result = await fetchTrustAnalysis(listingId);

  if (!result.ok) {
    return <AiError title="Trust Analysis" subtitle={SUBTITLE} message={result.error} />;
  }

  const a = result.data;
  return (
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <AiAnalystHeader
        title="Trust Analysis"
        subtitle={SUBTITLE}
        modelId={a.modelId}
        generatedAt={a.generatedAt}
        latencyMs={a.latencyMs}
        dataSource={a.dataSource}
        cached={a.cached}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto,1fr] sm:items-center">
        <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-3 sm:flex-col sm:gap-1">
          <div className="text-3xl font-bold text-[var(--text)]">{a.trustScore}</div>
          <TierBadge tier={a.tier} />
        </div>
        <p className="text-sm leading-relaxed text-[var(--text2)]">{a.summary}</p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Section title="Strengths" items={a.strengths} tone="green" />
        <Section title="Concerns" items={a.concerns} tone="red" emptyText="No notable concerns identified." />
      </div>

      <div className="mt-4 rounded border border-[var(--border)] bg-[var(--bg)] p-3">
        <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
          Recommendation
        </div>
        <p className="mt-1 text-sm text-[var(--text)]">{a.recommendation}</p>
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: TrustTier }) {
  const styles: Record<TrustTier, string> = {
    Bronze: "border-[#a0673c] text-[#c5895c]",
    Silver: "border-[#9aa6b2] text-[#c8d1da]",
    Gold: "border-[#d4a04f] text-[#e6b96a]",
    Platinum: "border-[#9b88e8] text-[#b9a9f3]",
  };
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${styles[tier]}`}
    >
      {tier}
    </span>
  );
}

function Section({
  title,
  items,
  tone,
  emptyText,
}: {
  title: string;
  items: string[];
  tone: "green" | "red";
  emptyText?: string;
}) {
  const dot = tone === "green" ? "bg-[var(--green)]" : "bg-[var(--red)]";
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">{title}</div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--text3)]">
          {emptyText ?? "Nothing to show."}
        </p>
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
