/**
 * ListingsRepository — narrows Prisma down to the queries the listings
 * search service actually needs. Lets the route be tested with a
 * hand-rolled fake (no Prisma generate, no DB) and gives us a single
 * place to evolve the storage backend later (e.g. read-replica, cache
 * layer) without touching service or route code.
 */

import type { PrismaClient } from "@prisma/client";

export interface DirectoryTrustSignal {
  providerSlug: string;
  verified: boolean;
  sourceRepoUrl: string | null;
  sourcePrUrl: string | null;
  reviewedAt: Date | null;
  lastSyncedAt: Date | null;
}

export interface ApprovedListingRow {
  onChainId: number;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  category: string;
  sellerAddress: string;
  directory?: DirectoryTrustSignal;
}

export interface ListingsSearchFilter {
  q?: string;
  tag?: string;
}

export type ListingsOrder = "latest" | "unordered";

/** Subset of `ApiStatus` returned by approval lookups. The string union
 *  matches Prisma's enum values so the route layer can pass it through
 *  without re-mapping. `null` = no row exists yet (listener hasn't
 *  ingested the on-chain registration). */
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | null;

export interface ListingsRepository {
  /** Total V3 rows regardless of approval status — used for the
   *  "X on-chain listings found, but none approved" hint on the empty
   *  state in /discover. */
  countV3(): Promise<number>;

  /** APPROVED V3 rows matching `filter`. `latest` orders by onChainId
   *  desc; `unordered` lets the service apply its own ranking. */
  findApproved(filter: ListingsSearchFilter, order: ListingsOrder): Promise<ApprovedListingRow[]>;

  /** Admin approval state for a single V3 listing. `null` distinguishes
   *  "row exists, not approved" (PENDING/etc.) from "row missing
   *  entirely" (UNLISTED — listener hasn't seen this id yet). */
  findApprovalStatus(onChainId: number): Promise<ApprovalStatus>;

  findDirectoryTrust(onChainId: number): Promise<DirectoryTrustSignal | null>;
}

export class PrismaListingsRepository implements ListingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async countV3(): Promise<number> {
    return this.prisma.apiListing.count({ where: { contractVersion: "V3" } });
  }

  async findApproved(
    filter: ListingsSearchFilter,
    order: ListingsOrder,
  ): Promise<ApprovedListingRow[]> {
    const rows = await this.prisma.apiListing.findMany({
      where: {
        contractVersion: "V3",
        status: "APPROVED",
        // Hide ChainLens-internal listings (e.g. the AI Market Analyst SaaS,
        // listing #18) from the public catalog. They're real on-chain
        // listings — settle()-able by direct ID — but they shouldn't show up
        // in /discover, marketplace search, SDK/MCP discover, etc., because
        // they're not generic APIs that a buyer would shop for.
        endpoint: { not: { startsWith: "internal://" } },
        ...(filter.q
          ? {
              OR: [
                { name: { contains: filter.q, mode: "insensitive" as const } },
                { description: { contains: filter.q, mode: "insensitive" as const } },
              ],
            }
          : {}),
        ...(filter.tag ? { category: { equals: filter.tag, mode: "insensitive" as const } } : {}),
      },
      ...(order === "latest" ? { orderBy: { onChainId: "desc" as const } } : {}),
    });

    // Drop rows missing the on-chain id — they shouldn't exist for V3
    // but the schema marks the column nullable for legacy compatibility.
    const typedRows = rows
      .filter((r): r is typeof r & { onChainId: number } => typeof r.onChainId === "number")
      .map((r) => ({
        onChainId: r.onChainId,
        name: r.name,
        description: r.description,
        endpoint: r.endpoint,
        price: r.price,
        category: r.category,
        sellerAddress: r.sellerAddress,
      }));
    const signals = await this.findDirectoryTrustByListingIds(typedRows.map((r) => r.onChainId));

    return typedRows.map((row) => ({
      ...row,
      ...(signals.has(row.onChainId) ? { directory: signals.get(row.onChainId) } : {}),
    }));
  }

  async findApprovalStatus(onChainId: number): Promise<ApprovalStatus> {
    const row = await this.prisma.apiListing.findUnique({
      where: { contractVersion_onChainId: { contractVersion: "V3", onChainId } },
      select: { status: true },
    });
    return (row?.status as ApprovalStatus) ?? null;
  }

  async findDirectoryTrust(onChainId: number): Promise<DirectoryTrustSignal | null> {
    const signals = await this.findDirectoryTrustByListingIds([onChainId]);
    return signals.get(onChainId) ?? null;
  }

  private async findDirectoryTrustByListingIds(ids: number[]): Promise<Map<number, DirectoryTrustSignal>> {
    if (ids.length === 0) return new Map();

    const drafts = await this.prisma.providerDraft.findMany({
      where: {
        listingOnChainId: { in: ids },
        directoryVerified: true,
      },
      select: {
        listingOnChainId: true,
        providerSlug: true,
        directoryVerified: true,
        sourceRepoUrl: true,
        sourcePrUrl: true,
        reviewedAt: true,
        lastSyncedAt: true,
      },
    });

    const signals = new Map<number, DirectoryTrustSignal>();
    for (const draft of drafts) {
      if (typeof draft.listingOnChainId !== "number") continue;
      signals.set(draft.listingOnChainId, {
        providerSlug: draft.providerSlug,
        verified: draft.directoryVerified,
        sourceRepoUrl: draft.sourceRepoUrl,
        sourcePrUrl: draft.sourcePrUrl,
        reviewedAt: draft.reviewedAt,
        lastSyncedAt: draft.lastSyncedAt,
      });
    }

    return signals;
  }
}
