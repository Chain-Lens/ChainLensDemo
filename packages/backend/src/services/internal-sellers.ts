/**
 * Internal seller registry — lets ChainLens host its own paid listings
 * without an outbound HTTP hop.
 *
 * Mechanism: a listing's metadata.endpoint can be a sentinel of the form
 *   `internal://<route-name>`
 * The RoutingSellerCallClient intercepts those, dispatches to a registered
 * handler, and returns a SellerCallResult shaped exactly like an HTTP call.
 * Any other endpoint passes through to the wrapped HTTP client unchanged.
 *
 * Why a sentinel instead of a real https://chainlens.../api/internal/... URL:
 *   - No recursive call: gateway → nginx → backend → gateway = wasted hops + redirect risk
 *   - No accidental public exposure of the internal route through nginx
 *   - The handler can take the same in-process objects (no re-parse, no retry)
 *
 * Used by market.routes.ts which composes
 *   new RoutingSellerCallClient(new FetchSellerCallClient(...), { "market-analysis": ... })
 */

import type { SellerCallClient, SellerCallResult } from "./seller-call.client.js";

export type InternalSellerHandler = (
  inputs: unknown,
  ctx: { method: "GET" | "POST" },
) => Promise<unknown>;

const INTERNAL_PREFIX = "internal://";

export class RoutingSellerCallClient implements SellerCallClient {
  constructor(
    private readonly delegate: SellerCallClient,
    private readonly handlers: Record<string, InternalSellerHandler>,
  ) {}

  async call(
    endpoint: string,
    method: "GET" | "POST",
    inputs: unknown,
  ): Promise<SellerCallResult> {
    if (!endpoint.startsWith(INTERNAL_PREFIX)) {
      return this.delegate.call(endpoint, method, inputs);
    }

    const routeName = endpoint.slice(INTERNAL_PREFIX.length).split(/[/?#]/)[0];
    const handler = routeName ? this.handlers[routeName] : undefined;
    if (!handler) {
      return {
        ok: false,
        status: 502,
        body: { error: `unknown internal route: ${routeName || "<empty>"}` },
      };
    }

    try {
      const body = await handler(inputs, { method });
      return { ok: true, status: 200, body };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 500,
        body: { error: "internal seller failed", detail: message },
      };
    }
  }
}
