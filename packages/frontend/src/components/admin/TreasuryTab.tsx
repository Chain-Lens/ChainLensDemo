"use client";

import { useEffect, useMemo } from "react";
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatUnits } from "viem";
import { baseSepolia } from "@chain-lens/shared";
import { chainLensMarketConfig } from "@/config/contracts";

/** Minimal ABI extracted from the ChainLensMarket — we only need the
 *  treasury getter, the claimable[address] read, and the claim() write. */
const treasuryAbi = [
  { inputs: [], name: "treasury", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "address" }], name: "claimable", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "claim", outputs: [], stateMutability: "nonpayable", type: "function" },
  { inputs: [], name: "serviceFeeBps", outputs: [{ type: "uint16" }], stateMutability: "view", type: "function" },
] as const;

function formatUsdc(amt: bigint): string {
  return `${formatUnits(amt, 6).replace(/\.?0+$/, "") || "0"} USDC`;
}

function shortenAddr(addr?: string): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function TreasuryTab() {
  const { address: connected } = useAccount();

  const { data: treasuryAddress, isLoading: loadingTreasury } = useReadContract({
    address: chainLensMarketConfig.address,
    abi: treasuryAbi,
    functionName: "treasury",
  });

  const { data: serviceFeeBps } = useReadContract({
    address: chainLensMarketConfig.address,
    abi: treasuryAbi,
    functionName: "serviceFeeBps",
  });

  const { data: claimable, refetch: refetchClaimable, isLoading: loadingClaim } = useReadContract({
    address: chainLensMarketConfig.address,
    abi: treasuryAbi,
    functionName: "claimable",
    args: treasuryAddress ? [treasuryAddress] : undefined,
    query: { enabled: !!treasuryAddress },
  });

  const { data: txHash, writeContract, isPending: isSending, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({
    hash: txHash, query: { enabled: !!txHash, gcTime: 0 },
  });

  // After the claim confirms on-chain, refresh the balance so the UI doesn't
  // show stale value. Run-once guard via deps.
  useEffect(() => { if (isConfirmed) refetchClaimable(); }, [isConfirmed, refetchClaimable]);

  const isTreasuryWallet = useMemo(
    () =>
      !!connected &&
      !!treasuryAddress &&
      connected.toLowerCase() === (treasuryAddress as string).toLowerCase(),
    [connected, treasuryAddress],
  );

  const balance = (claimable as bigint | undefined) ?? BigInt(0);
  const canClaim = isTreasuryWallet && balance > BigInt(0) && !isSending && !isConfirming;

  function handleClaim() {
    writeContract({
      address: chainLensMarketConfig.address,
      abi: treasuryAbi,
      functionName: "claim",
    });
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">ChainLens Treasury</h2>
            <p className="mt-1 max-w-xl text-xs text-[var(--text2)]">
              Pull-pattern claim balance accrued from <code className="font-mono">settle()</code>:
              service fee on every listing call (<strong>{(Number(serviceFeeBps ?? 0) / 100).toFixed(2)}%</strong>)
              plus seller revenue from the AI Market Analyst self-listing (#18).
            </p>
          </div>
          <span className="rounded-full border border-[var(--accent)] bg-[var(--accent-dim)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
            v3 ChainLensMarket
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
              Claimable balance
            </div>
            <div className="mt-2 text-3xl font-bold text-[var(--text)]">
              {loadingClaim ? "…" : formatUsdc(balance)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-[var(--text3)]">
              raw: {balance.toString()} (6-decimal atomic)
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">
              Treasury wallet
            </div>
            <div className="mt-2 break-all font-mono text-sm text-[var(--text)]">
              {loadingTreasury ? "loading…" : (treasuryAddress as string | undefined) ?? "—"}
            </div>
            <div className="mt-2 text-xs text-[var(--text3)]">
              Connected:{" "}
              <span className="font-mono">{shortenAddr(connected ?? undefined)}</span>{" "}
              {isTreasuryWallet ? (
                <span className="ml-1 rounded-full border border-[var(--green)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--green)]">
                  treasury
                </span>
              ) : (
                <span className="ml-1 rounded-full border border-[var(--border2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text3)]">
                  not treasury
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[var(--text2)]">
            {isTreasuryWallet
              ? balance > BigInt(0)
                ? `Claim transfers ${formatUsdc(balance)} USDC from the contract to ${shortenAddr(treasuryAddress as string)}.`
                : "Nothing to claim right now. Run a paid call first."
              : `Connect the treasury wallet (${shortenAddr(treasuryAddress as string)}) to claim.`}
          </div>
          <button
            type="button"
            onClick={handleClaim}
            disabled={!canClaim}
            className="btn-primary px-5 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSending
              ? "Confirm in wallet…"
              : isConfirming
                ? "Confirming on-chain…"
                : balance > BigInt(0)
                  ? `Claim ${formatUsdc(balance)}`
                  : "Claim"}
          </button>
        </div>

        {writeError && (
          <p className="mt-3 text-xs text-[var(--red)]">{writeError.message}</p>
        )}
        {txHash && (
          <p className="mt-3 text-xs text-[var(--text3)]">
            Tx:{" "}
            <a
              href={`${baseSepolia.blockExplorers.default.url}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[var(--accent)] underline underline-offset-2"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-8)}
            </a>
            {isConfirmed && <span className="ml-2 text-[var(--green)]">confirmed</span>}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg3)] p-4 text-xs text-[var(--text3)]">
        Note: ChainLens registered listing #18 (AI Market Analyst) with{" "}
        <code className="font-mono">payout = treasury</code>, so both the marketplace fee and the
        analyst's seller revenue accumulate against the same address. The claim pulls the unified
        balance.
      </div>
    </section>
  );
}
