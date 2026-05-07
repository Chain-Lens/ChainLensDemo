/**
 * AWS Bedrock client wrapper — invokes Claude on Bedrock and returns the
 * model's text + measured latency. Kept deliberately small so the analyzer
 * modules stay focused on prompt construction; transport and retries (if
 * we add them later) live here.
 *
 * Auth: we let the AWS SDK resolve credentials via its default chain
 * (env vars > shared config > IRSA, etc). In Docker we pass
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY through env_file.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const REGION = process.env["AWS_REGION"] || "us-east-2";
const MODEL_ID =
  process.env["BEDROCK_MODEL_ID"] ||
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

const client = new BedrockRuntimeClient({ region: REGION });

export interface InvokeParams {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

export interface InvokeResult {
  text: string;
  latencyMs: number;
}

export async function invokeClaude(params: InvokeParams): Promise<InvokeResult> {
  const start = Date.now();

  const body = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: params.maxTokens ?? 1000,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const responseText = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(responseText);
  const text: string = parsed?.content?.[0]?.text ?? "";

  return { text, latencyMs: Date.now() - start };
}

/**
 * Claude sometimes wraps JSON in ```json fences or adds a one-line preamble
 * even when told "JSON only". Greedy match the outermost {...} so a trailing
 * "}" inside a string field still parses correctly.
 */
export function extractJSON<T = unknown>(text: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in model response");
  return JSON.parse(match[0]) as T;
}

export const bedrockConfig = {
  region: REGION,
  modelId: MODEL_ID,
};

/**
 * One-shot startup probe — logs whether AWS credentials are present so a
 * misconfigured deploy is visible at boot rather than on first request.
 * Does NOT call Bedrock (no IAM round-trip needed to detect "missing").
 */
export function hasAwsCredentials(): boolean {
  return Boolean(
    process.env["AWS_ACCESS_KEY_ID"] && process.env["AWS_SECRET_ACCESS_KEY"],
  );
}
