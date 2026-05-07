"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { formatUnits } from "viem";
import { baseSepolia } from "@chain-lens/shared";
import { useMarketPayment } from "@/hooks/useMarketPayment";
import InlineSpinner from "@/components/shared/InlineSpinner";
import type { ListingDetail } from "@/types/market";

type Props = {
  listing: ListingDetail;
};

function stringifyExample(value: unknown): string {
  if (value == null) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

function formatUsdcLabel(amount: string | undefined): string | null {
  if (!amount || !/^\d+$/.test(amount)) return null;
  return `${formatUnits(BigInt(amount), 6).replace(/\.?0+$/, "")} USDC`;
}

export default function MarketPurchaseCard({ listing }: Props) {
  const { isConnected } = useAccount();
  const { executePayment, step, error, result, isLoading } = useMarketPayment();
  const [inputsText, setInputsText] = useState(stringifyExample(listing.metadata?.example_request));
  const [inputError, setInputError] = useState<string | null>(null);

  const amount = listing.metadata?.pricing?.amount;
  const priceLabel = useMemo(() => {
    return formatUsdcLabel(amount);
  }, [amount]);

  const isPurchasable =
    listing.active &&
    listing.adminStatus === "APPROVED" &&
    !!listing.metadata?.endpoint &&
    !!amount &&
    /^\d+$/.test(amount);

  async function handleSubmit() {
    let parsedInputs: unknown = {};

    setInputError(null);

    try {
      parsedInputs = inputsText.trim() ? JSON.parse(inputsText) : {};
    } catch {
      setInputError("Inputs must be valid JSON.");
      return;
    }

    if (!isPurchasable || !amount) return;

    try {
      await executePayment({
        listingId: listing.listingId,
        amount,
        inputs: parsedInputs,
      });
    } catch {
      // hook state handles the message
    }
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Live Test Call</h2>
          <p className="mt-1 text-sm text-[var(--text2)]">
            Sign a USDC authorization, let the gateway execute the seller API, then settle on-chain
            only after a successful response.
          </p>
        </div>
        {priceLabel && (
          <div className="max-w-full rounded-lg border border-[var(--border)] bg-[var(--bg3)] px-3 py-2 text-right">
            <div className="text-xs text-[var(--text3)]">Price</div>
            <div className="break-all font-semibold leading-tight text-[var(--accent)]">
              {priceLabel}
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
          <div className="text-xs text-[var(--text3)]">Endpoint</div>
          <div className="mt-1 break-all font-mono text-xs text-[var(--text)]">
            {listing.metadata?.endpoint ?? "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-3">
          <div className="text-xs text-[var(--text3)]">Execution Status</div>
          <div className="mt-1 text-sm text-[var(--text)]">
            {listing.active ? "Active" : "Inactive"} · {listing.adminStatus}
          </div>
        </div>
      </div>

      <label className="mb-2 block text-sm font-medium text-[var(--text2)]">
        Request Inputs (JSON)
      </label>
      <textarea
        value={inputsText}
        onChange={(e) => setInputsText(e.target.value)}
        spellCheck={false}
        rows={12}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4 font-mono text-sm text-[var(--text)] outline-none transition focus:border-[var(--accent)]"
      />

      {inputError && <p className="mt-2 text-sm text-[var(--red)]">{inputError}</p>}

      {!isConnected && (
        <p className="mt-3 text-sm text-[var(--text2)]">
          Connect your wallet to sign the USDC authorization.
        </p>
      )}

      {!isPurchasable && (
        <p className="mt-3 text-sm text-[var(--red)]">
          This listing is not currently purchasable. It must be active, approved, and have a valid
          price and endpoint.
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!isConnected || !isPurchasable || isLoading}
        className="mt-4 w-full btn-primary inline-flex items-center justify-center gap-2 py-3 text-base disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading && <InlineSpinner size={14} />}
        {step === "signing"
          ? "Sign USDC authorization…"
          : step === "submitting"
            ? "Calling seller + settling…"
            : "Run Paid Test Call"}
      </button>

      {error && <p className="mt-3 text-sm text-[var(--red)]">{error}</p>}

      {result && (
        <div className="mt-5 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4 animate-fade-up">
          <div>
            <div className="text-xs text-[var(--text3)]">Settlement Tx</div>
            <a
              href={`${baseSepolia.blockExplorers.default.url}/tx/${result.settleTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block break-all font-mono text-sm text-[var(--accent)] underline underline-offset-2"
            >
              {result.settleTxHash}
            </a>
          </div>

          <div>
            <div className="text-xs text-[var(--text3)]">Job Ref</div>
            <div className="mt-1 break-all font-mono text-sm text-[var(--text)]">
              {result.jobRef}
            </div>
          </div>

          <div>
            <div className="text-xs text-[var(--text3)]">Seller Response</div>
            <pre className="mt-1 overflow-auto rounded-lg bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
              {JSON.stringify(result.untrusted_data, null, 2)}
            </pre>
          </div>

          <div>
            <div className="text-xs text-[var(--text3)]">Safety</div>
            <pre className="mt-1 overflow-auto rounded-lg bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
              {JSON.stringify(result.safety, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
}
