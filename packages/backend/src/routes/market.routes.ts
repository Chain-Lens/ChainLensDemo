import { Router, Request, Response as ExpressResponse, NextFunction } from "express";
import { publicClient, walletClient, enqueueWrite } from "../config/viem.js";
import { logger } from "../utils/logger.js";
import prisma from "../config/prisma.js";
import {
  logCall,
  getListingStats,
  getListingsStats,
  getRecentErrors,
} from "../services/call-log.service.js";
import {
  marketAddress,
  usdcAddress,
  resolveMetadata,
  readListing,
} from "../services/market-chain.service.js";
import { PrismaListingsRepository } from "../repositories/listing.repository.js";
import { ListingsSearchService } from "../services/listings-search.service.js";
import { ListingDetailService } from "../services/listing-detail.service.js";
import {
  ListingCallService,
  wrapExternal,
  type CallResult,
} from "../services/listing-call.service.js";
import { FetchSellerCallClient } from "../services/seller-call.client.js";
import { RoutingSellerCallClient } from "../services/internal-sellers.js";
import { marketAnalystHandler } from "../services/market-analyst-seller.js";
import { OnChainSettlementService } from "../services/settlement.service.js";
import { parseListingsQuery } from "../utils/listings-query-parser.js";
import { parsePayment, makePaymentSignerRecovery, type PaymentAuth } from "../utils/payment.js";

const router = Router();

// ──────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────

const SELLER_TIMEOUT_MS = 30_000;

// ──────────────────────────────────────────────────────────────────────
// Listings search wiring — DIP entry point
// ──────────────────────────────────────────────────────────────────────
// The search service owns the read-path orchestration; the route below
// just parses the request and delegates. Construction happens at module
// load time so the cost is paid once. Tests instantiate the service
// directly with fakes — see services/listings-search.service.test.ts.

const listingsRepo = new PrismaListingsRepository(prisma);

const listingsSearchService = new ListingsSearchService(listingsRepo, getListingsStats);

const listingDetailService = new ListingDetailService(
  listingsRepo,
  readListing,
  resolveMetadata,
  getListingStats,
  getRecentErrors,
);

const settlementService = new OnChainSettlementService(
  walletClient,
  publicClient,
  enqueueWrite,
  marketAddress,
  logger,
);

export { listingDetailService, listingsSearchService };

// Compose the seller client so listings whose endpoint starts with
// `internal://<route>` are dispatched to in-process handlers (currently the
// AI Market Analyst SaaS — listing #18). Anything else hits the network as
// before. See services/internal-sellers.ts for the rationale.
const sellerClient = new RoutingSellerCallClient(
  new FetchSellerCallClient(SELLER_TIMEOUT_MS),
  { "market-analysis": marketAnalystHandler },
);

export const listingCallService = new ListingCallService({
  repo: listingsRepo,
  readListing,
  resolveMetadata,
  sellerClient,
  settlement: settlementService,
  signerRecovery: makePaymentSignerRecovery(publicClient, marketAddress, usdcAddress),
  logCall,
  logger,
});

// ──────────────────────────────────────────────────────────────────────
// GET /api/market/listings — read from indexed ApiListing mirror
// ──────────────────────────────────────────────────────────────────────
// Source of truth is `market-listener.service.ts`, which subscribes to
// ListingRegistered / ListingMetadataUpdated and mirrors V3 listings into
// the ApiListing table. We pre-filter at SQL level (status, q, tag, latest)
// and post-filter for stats- and price-derived predicates. The legacy
// per-request RPC scan was O(N) eth_calls per page load and dominated
// latency once listing counts grew past a handful.
//
// Trade-offs vs the legacy on-chain scan:
//   • `active` is not mirrored — the listener intentionally skips
//     ListingDeactivated/Reactivated. /call/:id remains the integrity
//     boundary (returns 410 for inactive). A briefly-deactivated listing
//     can show up here until the seller updates metadata.
//   • `tag` filter matches `category` (= meta.tags[0] at ingest). Tags
//     beyond the first aren't stored as a discrete column today.

router.get("/listings", async (req, res, next) => {
  try {
    const opts = parseListingsQuery(req);
    const result = await listingsSearchService.search(opts);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/listings/:id", async (req, res, next) => {
  try {
    const id = BigInt(req.params["id"] as string);
    const detail = await listingDetailService.getDetail(id);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

// ──────────────────────────────────────────────────────────────────────
// POST /api/market/call/:listingId  —  x402 proxy + settle
// ──────────────────────────────────────────────────────────────────────
// The orchestration (approval gate → seller call → response checks →
// settlement → call log) lives in ListingCallService. This handler is
// intentionally narrow: parse payment, run the service, map the typed
// result to an HTTP response. See services/listing-call.service.ts.

router.post(
  "/call/:listingId",
  async (req: Request, res: ExpressResponse, next: NextFunction) => {
    const body = req.body as { inputs?: unknown; payment?: unknown };
    let payment: PaymentAuth;
    try {
      payment = parsePayment(body?.payment);
    } catch (e) {
      res.status(400).json({
        error: "invalid payment",
        detail: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    const listingIdStr = req.params["listingId"] as string;
    try {
      const result = await listingCallService.execute({
        listingIdStr,
        inputs: body?.inputs ?? {},
        payment,
      });
      sendCallResult(res, listingIdStr, result);
    } catch (err) {
      next(err);
    }
  },
);

/** Maps the service's typed result union to an HTTP response. The status
 *  codes here are the public contract of /api/market/call/:listingId. */
export function sendCallResult(
  res: ExpressResponse,
  listingIdStr: string,
  result: CallResult,
): void {
  switch (result.kind) {
    case "bad_listing_id":
      res.status(400).json({ error: "listingId must be decimal" });
      return;
    case "not_approved":
      res.status(403).json({
        error: "listing not approved for execution",
        adminStatus: result.adminStatus,
      });
      return;
    case "listing_not_found":
      res.status(404).json({ error: "listing not found" });
      return;
    case "listing_inactive":
      res.status(410).json({ error: "listing inactive" });
      return;
    case "metadata_error":
      res.status(502).json({ error: "seller metadata unreachable", detail: result.detail });
      return;
    case "metadata_invalid":
      res.status(502).json({ error: "listing metadata missing `endpoint`" });
      return;
    case "amount_below_price":
      res.status(402).json({
        error: "amount below listing price",
        required: result.required,
        provided: result.provided,
      });
      return;
    case "payment_preflight_failed":
      res.status(412).json({
        error: "payment authorization failed preflight",
        detail: result.detail,
      });
      return;
    case "seller_call_failed":
      res.status(502).json({
        error: "seller call failed",
        endpoint: result.endpoint,
        method: result.method,
        detail: result.detail,
        ...(result.cause ? { cause: result.cause } : {}),
      });
      return;
    case "seller_non_2xx":
      res.status(502).json({
        error: "seller returned non-2xx",
        sellerStatus: result.status,
        sellerBody: result.body,
      });
      return;
    case "response_rejected":
      res.status(422).json({
        error: "seller response cannot be relayed",
        rejectionReason: result.rejectionReason,
        host: result.host,
      });
      return;
    case "schema_mismatch":
      res.status(422).json({
        error: "seller response failed schema validation",
        failure: { kind: "schema_mismatch", hint: result.reason, host: result.host },
      });
      return;
    case "settle_failed":
      res.status(500).json({
        error: "settlement submission failed",
        recoveredSigner: result.recoveredSigner,
        expectedBuyer: result.expectedBuyer,
        detail: result.detail,
        sellerBody: result.sellerBody,
      });
      return;
    case "ok": {
      const wrapped = wrapExternal(result.ok.body, result.ok.host, result.ok.listingId, result.ok.jobRef);
      res.status(200).json({
        listingId: result.ok.listingId,
        jobRef: result.ok.jobRef,
        settleTxHash: result.ok.settleTxHash,
        usdc: usdcAddress(),
        delivery: result.ok.delivery,
        safety: {
          trusted: false,
          scanned: true,
          schemaValid: result.ok.schemaValid,
          warnings: result.ok.warnings,
          clean: result.ok.warnings.length === 0,
        },
        untrusted_data: wrapped.data,
        envelope: wrapped.envelope,
      });
      return;
    }
  }
}

export default router;
