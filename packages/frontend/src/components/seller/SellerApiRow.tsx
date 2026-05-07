"use client";

import { useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/shared/StatusBadge";
import { formatUsdcLabel } from "@/lib/format";
import type { SellerApi } from "@/hooks/useSellerApis";
import SellerEditForm, { type SellerPatch } from "./SellerEditForm";
import BuyMarketAnalysisButton from "./BuyMarketAnalysisButton";

// Don't show the "buy market analysis" CTA on the AI Market Analyst listing
// itself — it would let a seller buy an analysis of the analyst, which is
// nonsense and would also re-enter the same x402 path during the call.
const CHAINLENS_MARKET_ANALYST_LISTING_ID = 18;

export default function SellerApiRow({
  api,
  editable,
  onDelete,
  onEdit,
}: {
  api: SellerApi;
  editable: boolean;
  onDelete: (id: string) => void;
  onEdit: (id: string, patch: SellerPatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h3 className="truncate font-semibold text-[var(--text)]">{api.name}</h3>
          <StatusBadge status={api.status} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {api.status === "APPROVED" && typeof api.onChainId === "number" && (
            <Link
              href={`/discover/${api.onChainId}`}
              className="whitespace-nowrap text-xs font-medium text-[var(--cyan)] hover:underline"
            >
              View →
            </Link>
          )}
          {editable && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="whitespace-nowrap text-xs font-medium text-[var(--text3)] transition-colors hover:text-[var(--cyan)]"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => onDelete(api.id)}
            className="whitespace-nowrap text-xs font-medium text-[var(--text3)] transition-colors hover:text-[var(--red)]"
          >
            Delete
          </button>
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-[var(--text2)]">{api.description}</p>

      {api.endpoint && !editing && (
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-xs text-[var(--text3)]">Endpoint</span>
          <code className="truncate font-mono text-xs text-[var(--text2)]">{api.endpoint}</code>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="rounded border border-[var(--border2)] bg-[var(--bg3)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--text2)]">
          {api.category}
        </span>
        <span className="text-sm font-semibold text-[var(--green)]">
          {formatUsdcLabel(api.price)}
        </span>
        <span className="text-xs text-[var(--text3)]">{api._count.payments} sales</span>
        <span className="text-xs text-[var(--text3)]">
          {new Date(api.createdAt).toLocaleDateString()}
        </span>
        {api.status === "PENDING" && (
          <span className="text-xs font-medium text-[#e3b341]">Awaiting review</span>
        )}
      </div>

      {api.status === "REJECTED" && (
        <div className="rounded border border-[rgba(248,81,73,0.3)] bg-[rgba(248,81,73,0.1)] px-3 py-2 text-xs text-[var(--red)]">
          <span className="font-medium">Rejection reason: </span>
          {api.rejectionReason ?? "No reason provided"}
        </div>
      )}

      {editing && (
        <SellerEditForm
          api={api}
          onCancel={() => setEditing(false)}
          onSubmit={async (patch) => {
            await onEdit(api.id, patch);
            setEditing(false);
          }}
        />
      )}

      {!editing &&
        api.status === "APPROVED" &&
        typeof api.onChainId === "number" &&
        api.onChainId !== CHAINLENS_MARKET_ANALYST_LISTING_ID && (
          <BuyMarketAnalysisButton targetListingId={api.onChainId} />
        )}
    </div>
  );
}
