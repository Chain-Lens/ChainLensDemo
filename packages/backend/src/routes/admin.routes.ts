import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as adminService from "../services/admin.service.js";
import { requireAdmin, type AuthenticatedRequest } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import prisma from "../config/prisma.js";
import { scanResponse } from "../services/injection-filter.service.js";
import { assertSafeOutboundUrl } from "../utils/network.js";
import { BadRequestError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { listCallLogs } from "../services/call-log.service.js";

const router = Router();

router.use(requireAdmin);

const testApiSchema = z.object({
  payload: z.record(z.string(), z.unknown()).optional(),
  method: z.string().trim().min(1).optional(),
});

// GET /admin/apis - All listings with call counts
router.get("/apis", async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const apis = await prisma.apiListing.findMany({
      // Hide ChainLens-internal listings (e.g. AI Market Analyst SaaS) from
      // the admin "All APIs" view — they're not user-facing APIs and should
      // not be approval-gated by humans. Manage them via dedicated tooling.
      where: {
        contractVersion: "V3",
        NOT: { endpoint: { startsWith: "internal://" } },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        category: true,
        status: true,
        price: true,
        sellerAddress: true,
        contractVersion: true,
        onChainId: true,
        createdAt: true,
        _count: {
          select: {
            payments: true,
          },
        },
      },
    });
    res.json(apis);
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/apis/:id - Admin force-delete any listing
router.delete("/apis/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    await prisma.apiListing.delete({ where: { id: req.params["id"] as string } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /admin/apis/:id/test - Test seller endpoint
router.post(
  "/apis/:id/test",
  validate(testApiSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const api = await prisma.apiListing.findUnique({
        where: { id: req.params["id"] as string },
      });
      if (!api) throw new BadRequestError("Listing not found");

      const startedAt = Date.now();
      let status: number | null = null;
      let body: unknown = null;
      let error: string | null = null;

      try {
        const { payload: requestPayload, method: requestMethod } = req.body as z.infer<
          typeof testApiSchema
        >;
        const payload =
          requestPayload ?? (api.exampleRequest as Record<string, unknown> | null) ?? {};
        const hasBody = Object.keys(payload as object).length > 0;
        const method = requestMethod?.toUpperCase() || (hasBody ? "POST" : "GET");
        const safeUrl = await assertSafeOutboundUrl(api.endpoint);

        const fetchOptions: RequestInit = {
          method,
          signal: AbortSignal.timeout(8000),
          redirect: "error",
        };

        if (method !== "GET" && method !== "HEAD") {
          fetchOptions.headers = { "Content-Type": "application/json" };
          fetchOptions.body = JSON.stringify(payload);
        }

        const response = await fetch(safeUrl, fetchOptions);
        status = response.status;
        const text = await response.text();
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }

        const scan = scanResponse(body);
        if (!scan.clean) {
          error = scan.reason ?? "response_rejected";
        }
      } catch (err) {
        error = err instanceof Error ? err.message : "Request failed";
      }

      res.json({
        status,
        body,
        error,
        injectionFree: error === null,
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

const approveSchema = z.object({
  reason: z.string().optional(),
});

// POST /admin/apis/:id/approve
router.post(
  "/apis/:id/approve",
  validate(approveSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const result = await adminService.approve(
        req.params.id as string,
        req.adminAddress!,
        req.body.reason,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /admin/apis/:id/reject
router.post(
  "/apis/:id/reject",
  validate(approveSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await adminService.reject(req.params.id as string, req.adminAddress!, req.body.reason);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// GET /admin/call-logs — raw CallLog triage view for a single listing.
// Admin-only because rows carry `buyer` addresses (public responses
// aggregate only). Useful for answering "why is listing N flaky?" —
// filter by failures, pick a suspicious row, cross-reference jobRef
// against gateway logs.
const callLogsQuerySchema = z.object({
  listing_id: z.string().regex(/^\d+$/),
  only_failures: z.union([z.literal("true"), z.literal("false")]).optional(),
  since: z.string().datetime().optional().describe("ISO timestamp lower bound (inclusive)"),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

router.get("/call-logs", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = callLogsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "invalid_query",
        details: parsed.error.flatten(),
      });
      return;
    }
    const { listing_id, only_failures, since, limit, offset } = parsed.data;
    const page = await listCallLogs({
      listingId: Number(listing_id),
      onlyFailures: only_failures === "true",
      since: since ? new Date(since) : undefined,
      limit,
      offset,
    });
    res.json(page);
  } catch (err) {
    next(err);
  }
});

// GET /admin/sellers — distinct seller addresses with listing counts.
router.get("/sellers", async (_req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const distinct = await prisma.apiListing.findMany({
      distinct: ["sellerAddress"],
      select: { sellerAddress: true },
    });

    const items = await Promise.all(
      distinct.map(async (d) => {
        const address = d.sellerAddress as string;
        const listingCount = await prisma.apiListing.count({
          where: { sellerAddress: address },
        });
        return { address, listingCount };
      }),
    );
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

export default router;
