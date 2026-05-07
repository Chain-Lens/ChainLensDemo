"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { parseUnits } from "viem";
import { useRegisterV3, type ListingMetadata } from "@/hooks/useRegisterV3";
import { apiClient } from "@/lib/api-client";
import InlineSpinner from "@/components/shared/InlineSpinner";

export type RegisterFormPrefill = {
  providerSlug?: string;
  name?: string;
  description?: string;
  tags?: string;
  website?: string;
  docs?: string;
  sourceAttestation?: string;
  directoryStatus?: "loaded" | "fallback" | "not_found" | "error";
  directoryMessage?: string;
};

type PreflightResult = {
  status: number | null;
  body: unknown;
  error: string | null;
  latencyMs: number;
  safety: {
    scanned: boolean;
    schemaValid: boolean | null;
    warnings: string[];
  };
};

type JsonSchemaLike = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchemaLike>;
  items?: JsonSchemaLike;
  additionalProperties?: boolean;
};

const SCHEMA_TEMPLATES = [
  {
    label: "Generic data",
    description: "Top-level object with a data object.",
    schema: {
      type: "object",
      required: ["data"],
      properties: {
        data: { type: "object" },
      },
    },
  },
  {
    label: "Price quote",
    description: "Symbol, numeric price, and currency fields.",
    schema: {
      type: "object",
      required: ["symbol", "price", "currency"],
      properties: {
        symbol: { type: "string" },
        price: { type: "number" },
        currency: { type: "string" },
        timestamp: { type: "string" },
      },
    },
  },
  {
    label: "List response",
    description: "Object with an items array.",
    schema: {
      type: "object",
      required: ["items"],
      properties: {
        items: {
          type: "array",
          items: { type: "object" },
        },
      },
    },
  },
  {
    label: "httpbin GET",
    description: "Shape returned by https://httpbin.org/get.",
    schema: {
      type: "object",
      required: ["args", "headers", "origin", "url"],
      properties: {
        args: { type: "object" },
        headers: { type: "object" },
        origin: { type: "string" },
        url: { type: "string" },
      },
    },
  },
] as const;

function formatSchema(schema: unknown) {
  return JSON.stringify(schema, null, 2);
}

function inferSchemaFromValue(value: unknown): JsonSchemaLike {
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : { type: "object" },
    };
  }
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const properties = Object.fromEntries(
      Object.entries(objectValue).map(([key, nested]) => [key, inferSchemaFromValue(nested)]),
    );
    return {
      type: "object",
      required: Object.keys(objectValue),
      properties,
    };
  }
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function schemaPreviewSummary(schemaText: string) {
  try {
    const parsed = JSON.parse(schemaText) as JsonSchemaLike;
    const type = Array.isArray(parsed.type) ? parsed.type.join(" | ") : (parsed.type ?? "object");
    const required = parsed.required?.length ?? 0;
    const propertyCount = parsed.properties ? Object.keys(parsed.properties).length : 0;
    return { type, required, propertyCount };
  } catch {
    return null;
  }
}

export default function RegisterForm({ prefill }: { prefill?: RegisterFormPrefill }) {
  const { address, isConnected } = useAccount();
  const { register, txHash, isPending, isConfirming, isConfirmed, listingId, error, reset } =
    useRegisterV3();

  const [name, setName] = useState(prefill?.name ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [endpoint, setEndpoint] = useState("");
  const [method, setMethod] = useState<"GET" | "POST">("GET");
  const [priceInUsdc, setPriceInUsdc] = useState("");
  const [tags, setTags] = useState(prefill?.tags ?? "");
  const [payoutOverride, setPayoutOverride] = useState("");
  const [outputSchemaText, setOutputSchemaText] = useState(
    formatSchema(SCHEMA_TEMPLATES[0].schema),
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightResult, setPreflightResult] = useState<PreflightResult | null>(null);
  const schemaSummary = schemaPreviewSummary(outputSchemaText);

  useEffect(() => {
    if (!prefill?.providerSlug) return;
    setName((current) => current || prefill.name || "");
    setDescription((current) => current || prefill.description || "");
    setTags((current) => current || prefill.tags || "");
  }, [prefill?.providerSlug, prefill?.name, prefill?.description, prefill?.tags]);

  if (!isConnected) {
    return (
      <div className="card text-center py-8">
        <p className="text-[var(--text2)]">Connect your wallet to register an API</p>
      </div>
    );
  }

  if (isConfirmed && listingId !== null) {
    return (
      <div className="card text-center py-8 space-y-3">
        <h3 className="text-xl font-semibold text-[var(--green)]">Listing Registered on-chain ✓</h3>
        <p className="text-[var(--text2)]">
          Listing <code className="text-[var(--cyan)]">#{listingId.toString()}</code> is now
          discoverable by agents.
        </p>
        {txHash && <p className="font-mono text-xs text-[var(--text3)] break-all">tx: {txHash}</p>}
        <button type="button" onClick={reset} className="btn-secondary">
          Register another
        </button>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address) return;

    let outputSchema: unknown;
    setFormError(null);

    try {
      outputSchema = JSON.parse(outputSchemaText);
    } catch {
      setFormError("Output schema must be valid JSON.");
      return;
    }

    if (!outputSchema || typeof outputSchema !== "object" || Array.isArray(outputSchema)) {
      setFormError("Output schema must be a JSON object.");
      return;
    }

    const atomic = parseUnits(priceInUsdc || "0", 6);
    const payout = (payoutOverride.trim() as `0x${string}`) || (address as `0x${string}`);

    const metadata: ListingMetadata = {
      name: name.trim(),
      description: description.trim(),
      endpoint: endpoint.trim(),
      method,
      pricing: {
        amount: atomic.toString(),
        unit: "per_call",
      },
      output_schema: outputSchema,
      ...(tags.trim()
        ? {
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }
        : {}),
    };

    register({ payout, metadata });
  }

  async function handlePreflight() {
    setFormError(null);
    setPreflightResult(null);

    let outputSchema: unknown;
    try {
      outputSchema = JSON.parse(outputSchemaText);
    } catch {
      setFormError("Output schema must be valid JSON before self-test.");
      return;
    }

    if (!endpoint.trim()) {
      setFormError("Endpoint URL is required before self-test.");
      return;
    }

    setPreflightLoading(true);
    try {
      const result = await apiClient.post<PreflightResult>("/seller/preflight", {
        endpoint: endpoint.trim(),
        method,
        output_schema: outputSchema,
      });
      setPreflightResult(result);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Self-test request failed.");
    } finally {
      setPreflightLoading(false);
    }
  }

  function applySchemaFromResponseBody() {
    if (preflightResult?.body === undefined) return;
    setOutputSchemaText(formatSchema(inferSchemaFromValue(preflightResult.body)));
    setFormError(null);
  }

  const submitting = isPending || isConfirming;
  const canSubmit =
    !submitting &&
    name.trim() &&
    description.trim() &&
    endpoint.trim() &&
    priceInUsdc &&
    outputSchemaText.trim();

  return (
    <form onSubmit={handleSubmit} className="card space-y-6">
      {prefill?.providerSlug && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] p-4 text-sm text-[var(--text2)] leading-relaxed">
          <p className="mb-1 font-medium text-[var(--text)]">
            {prefill.directoryStatus === "loaded"
              ? "Imported from the open provider directory"
              : "Prefilled from the provider slug"}
          </p>
          <p>
            Provider slug{" "}
            <code className="mx-1 text-[var(--accent)]">{prefill.providerSlug}</code>
            was passed in the URL. Review the details below, then add your executable
            endpoint, price, output schema, and payout address.
          </p>
          {prefill.directoryMessage && (
            <p className="mt-2 text-xs text-[var(--text3)]">{prefill.directoryMessage}</p>
          )}
          {prefill.directoryStatus === "loaded" && (
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {prefill.website && (
                <a
                  href={prefill.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[var(--accent)] hover:underline"
                >
                  Website: {prefill.website}
                </a>
              )}
              {prefill.docs && (
                <a
                  href={prefill.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[var(--accent)] hover:underline"
                >
                  Docs: {prefill.docs}
                </a>
              )}
              {prefill.sourceAttestation && (
                <a
                  href={prefill.sourceAttestation}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-[var(--accent)] hover:underline sm:col-span-2"
                >
                  Source attestation: {prefill.sourceAttestation}
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[linear-gradient(135deg,rgba(88,166,255,0.08),rgba(63,185,80,0.05))] p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text3)]">Seller Setup</p>
        <h2 className="mt-2 text-xl font-semibold text-[var(--text)]">
          Register a paid API in two steps
        </h2>
        <div className="mt-3 grid gap-3 text-sm text-[var(--text2)] sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="font-medium text-[var(--text)]">1. Describe the API</p>
            <p className="mt-1">
              Name, endpoint, method, and price tell the gateway how to call your API.
            </p>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <p className="font-medium text-[var(--text)]">2. Describe the response</p>
            <p className="mt-1">
              The schema is the shape buyers should expect, not a literal response value.
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">Step 1</p>
          <h3 className="mt-1 text-lg font-semibold text-[var(--text)]">API basics</h3>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text2)]">API Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            placeholder="e.g. TSLA Stock Price"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text2)]">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input min-h-[80px]"
            placeholder="What does your API return?"
            required
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text2)]">Endpoint URL</label>
          <input
            type="url"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="input"
            placeholder="https://api.example.com/tsla"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text2)]">
              HTTP Method
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "GET" | "POST")}
              className="input"
            >
              <option value="GET">GET (inputs become query params)</option>
              <option value="POST">POST (inputs become JSON body)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--text2)]">
              Price (USDC per call)
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={priceInUsdc}
              onChange={(e) => setPriceInUsdc(e.target.value)}
              className="input"
              placeholder="0.05"
              required
            />
          </div>
        </div>

        <details className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
          <summary className="cursor-pointer list-none text-sm font-medium text-[var(--text)]">
            Advanced options
          </summary>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text2)]">
                Tags <span className="text-[var(--text3)]">(comma-separated, optional)</span>
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="input"
                placeholder="finance, stocks, real-time"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--text2)]">
                Payout address{" "}
                <span className="text-[var(--text3)]">
                  (optional, defaults to connected wallet)
                </span>
              </label>
              <input
                type="text"
                value={payoutOverride}
                onChange={(e) => setPayoutOverride(e.target.value)}
                className="input font-mono text-sm"
                placeholder={address}
                pattern="^0x[a-fA-F0-9]{40}$"
              />
            </div>
          </div>
        </details>
      </section>

      <section className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--text3)]">Step 2</p>
          <h3 className="mt-1 text-lg font-semibold text-[var(--text)]">Response schema</h3>
          <p className="mt-2 text-sm text-[var(--text2)]">
            Think of the schema as a response contract. If your browser shows
            <code className="mx-1 rounded bg-[var(--bg)] px-1 py-0.5 text-xs">
              {'{"price":123.45,"symbol":"TSLA"}'}
            </code>
            then the schema should describe the field types, like
            <code className="mx-1 rounded bg-[var(--bg)] px-1 py-0.5 text-xs">
              {
                '{"type":"object","required":["price","symbol"],"properties":{"price":{"type":"number"},"symbol":{"type":"string"}}}'
              }
            </code>
            , not the exact values.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="text-xs text-[var(--text3)]">Top-level type</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">
              {schemaSummary?.type ?? "Invalid JSON"}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="text-xs text-[var(--text3)]">Required fields</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">
              {schemaSummary?.required ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
            <div className="text-xs text-[var(--text3)]">Declared properties</div>
            <div className="mt-1 text-sm font-medium text-[var(--text)]">
              {schemaSummary?.propertyCount ?? 0}
            </div>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--text2)]">
            Output Schema <span className="text-[var(--red)]">(required)</span>
          </label>
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            {SCHEMA_TEMPLATES.map((template) => (
              <button
                key={template.label}
                type="button"
                onClick={() => {
                  setOutputSchemaText(formatSchema(template.schema));
                  setPreflightResult(null);
                }}
                className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--bg2)]"
              >
                <span className="block text-sm font-medium text-[var(--text)]">
                  {template.label}
                </span>
                <span className="mt-1 block text-xs text-[var(--text3)]">
                  {template.description}
                </span>
              </button>
            ))}
          </div>
          <textarea
            value={outputSchemaText}
            onChange={(e) => setOutputSchemaText(e.target.value)}
            className="input min-h-[220px] font-mono text-xs"
            spellCheck={false}
            placeholder='{"type":"object","required":["data"],"properties":{"data":{"type":"object"}}}'
            required
          />
          <p className="mt-1 text-xs text-[var(--text3)]">
            Tip: run a self-test first, then use the last response to draft this schema
            automatically.
          </p>
        </div>
      </section>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg3)] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text)]">Schema Self-Test</p>
            <p className="text-xs text-[var(--text3)]">
              Calls your endpoint through the backend preflight route and checks injection scan +
              output schema before you register.
            </p>
          </div>
          <button
            type="button"
            onClick={handlePreflight}
            disabled={preflightLoading || !endpoint.trim() || !outputSchemaText.trim()}
            className="btn-secondary"
          >
            {preflightLoading ? "Running self-test..." : "Run self-test"}
          </button>
        </div>

        {preflightResult && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text3)]">HTTP Status</div>
                <div className="mt-1 text-sm text-[var(--text)]">
                  {preflightResult.status ?? "none"}
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text3)]">Latency</div>
                <div className="mt-1 text-sm text-[var(--text)]">
                  {preflightResult.latencyMs} ms
                </div>
              </div>
              <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="text-xs text-[var(--text3)]">Schema Valid</div>
                <div className="mt-1 text-sm text-[var(--text)]">
                  {preflightResult.safety.schemaValid === null
                    ? "n/a"
                    : preflightResult.safety.schemaValid
                      ? "true"
                      : "false"}
                </div>
              </div>
            </div>

            {preflightResult.error && (
              <p className="text-sm text-[var(--red)]">{preflightResult.error}</p>
            )}

            <div className="rounded-xl border border-[rgba(63,185,80,0.28)] bg-[rgba(63,185,80,0.08)] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--green)]">
                    Next Step
                  </p>
                  <p className="mt-1 text-sm font-medium text-[var(--text)]">
                    Turn this response into a schema draft
                  </p>
                  <p className="mt-1 text-xs text-[var(--text2)]">
                    Use the last self-test response to overwrite the schema box above with a
                    generated draft.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={applySchemaFromResponseBody}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--green)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_rgba(63,185,80,0.22)] transition hover:brightness-110"
                >
                  Use response to draft schema
                </button>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-[var(--text3)]">Warnings</div>
              <pre className="overflow-auto rounded-lg bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
                {JSON.stringify(preflightResult.safety.warnings, null, 2)}
              </pre>
            </div>

            <div>
              <div className="mb-1 text-xs text-[var(--text3)]">Response Body</div>
              <pre className="overflow-auto rounded-lg bg-[var(--bg)] p-3 font-mono text-xs text-[var(--text)]">
                {JSON.stringify(preflightResult.body, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {formError && <p className="text-sm text-[var(--red)]">{formError}</p>}
      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full btn-primary inline-flex items-center justify-center gap-2 py-3"
      >
        {(isPending || isConfirming) && <InlineSpinner size={14} />}
        {isPending
          ? "Confirm in wallet…"
          : isConfirming
            ? "Waiting for confirmation…"
            : "Register on-chain"}
      </button>

      <p className="text-center font-mono text-xs text-[var(--text3)]">Seller: {address}</p>
    </form>
  );
}
