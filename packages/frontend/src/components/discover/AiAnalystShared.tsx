import type { DataSource } from "@/lib/ai-analysis-api";

export function AiAnalystHeader({
  title,
  subtitle,
  modelId,
  generatedAt,
  latencyMs,
  dataSource,
  cached,
}: {
  title: string;
  subtitle: string;
  modelId?: string;
  generatedAt?: string;
  latencyMs?: number;
  dataSource?: DataSource;
  cached?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-dim)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            AI Analyst
          </span>
          {dataSource === "mock" && (
            <span className="rounded-full border border-[var(--orange)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--orange)]">
              Demo data
            </span>
          )}
          {cached && (
            <span className="rounded-full border border-[var(--border2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text3)]">
              Cached
            </span>
          )}
        </div>
        <h2 className="mt-2 text-base font-semibold text-[var(--text)]">{title}</h2>
        <p className="mt-1 text-xs text-[var(--text3)]">{subtitle}</p>
      </div>
      {modelId && generatedAt && (
        <div className="text-right text-[10px] text-[var(--text3)]">
          <div className="font-mono">{shortenModel(modelId)}</div>
          <div>
            {formatTimeAgo(generatedAt)}
            {typeof latencyMs === "number" ? ` · ${latencyMs}ms` : ""}
          </div>
        </div>
      )}
    </div>
  );
}

export function AiSkeleton({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <AiAnalystHeader title={title} subtitle={subtitle} />
      <div className="mt-4 space-y-3">
        <SkeletonLine width="80%" />
        <SkeletonLine width="92%" />
        <SkeletonLine width="60%" />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <SkeletonBlock />
        <SkeletonBlock />
        <SkeletonBlock />
      </div>
    </div>
  );
}

export function AiError({
  title,
  subtitle,
  message,
}: {
  title: string;
  subtitle: string;
  message: string;
}) {
  return (
    <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4">
      <AiAnalystHeader title={title} subtitle={subtitle} />
      <p className="mt-3 text-xs text-[var(--red)]">{message}</p>
    </div>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 animate-pulse rounded bg-[var(--border2)]"
      style={{ width, opacity: 0.45 }}
    />
  );
}

function SkeletonBlock() {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="h-2 animate-pulse rounded bg-[var(--border2)]" style={{ opacity: 0.45 }} />
      <div
        className="mt-2 h-3 animate-pulse rounded bg-[var(--border2)]"
        style={{ width: "70%", opacity: 0.45 }}
      />
    </div>
  );
}

function shortenModel(id: string): string {
  // "us.anthropic.claude-sonnet-4-5-20250929-v1:0" → "claude-sonnet-4-5"
  const m = id.match(/claude-[a-z0-9-]+?-\d+(?:-\d+)?/);
  return m ? m[0] : id;
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
