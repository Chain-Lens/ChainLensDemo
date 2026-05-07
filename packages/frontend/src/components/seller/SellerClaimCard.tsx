"use client";

import { formatUsdcLabel } from "@/lib/format";
import InlineSpinner from "@/components/shared/InlineSpinner";

export default function SellerClaimCard({
  pendingAmount,
  isPending,
  isConfirming,
  isConfirmed,
  onClaim,
}: {
  pendingAmount: bigint;
  isPending: boolean;
  isConfirming: boolean;
  isConfirmed: boolean;
  onClaim: () => void;
}) {
  const hasPending = pendingAmount > BigInt(0);
  return (
    <div
      className={`card mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center ${
        hasPending ? "border-[rgba(63,185,80,0.4)] bg-[rgba(63,185,80,0.05)]" : ""
      }`}
    >
      <div>
        <p className="text-sm font-medium text-[var(--text2)]">Claimable Earnings</p>
        <p
          className={`mt-1 text-2xl font-bold ${
            hasPending ? "text-[var(--green)]" : "text-[var(--text3)]"
          }`}
        >
          {formatUsdcLabel(pendingAmount.toString())}
        </p>
        {isConfirmed && <p className="mt-1 text-xs text-[var(--green)]">Successfully claimed!</p>}
      </div>
      <button
        onClick={onClaim}
        disabled={!hasPending || isPending || isConfirming}
        className="btn-primary inline-flex items-center gap-2 px-6 py-2"
      >
        {(isPending || isConfirming) && <InlineSpinner size={12} />}
        {isPending ? "Confirm in wallet…" : isConfirming ? "Confirming…" : "Claim"}
      </button>
    </div>
  );
}
