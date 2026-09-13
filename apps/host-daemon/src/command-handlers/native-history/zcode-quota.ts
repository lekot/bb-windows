import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { type CommandOf } from "../../command-dispatch-support.js";
import { isRecord } from "./jsonl-core.js";

type ZcodeQuotaCommand = CommandOf<"host.read_zcode_quota">;
type ZcodeQuotaResult = HostDaemonOnlineRpcResult<"host.read_zcode_quota">;
type ZcodeQuotaOk = Extract<ZcodeQuotaResult, { status: "ok" }>;

const DEFAULT_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const QUOTA_TIMEOUT_MS = 15_000;
const QUOTA_CACHE_MS = 60_000;
const ZAI_ENDPOINT_HOSTS = new Set(["api.z.ai", "api.chatglm.site"]);

interface ZcodeLimitEntry {
  currentValue?: unknown;
  nextResetTime?: unknown;
  number?: unknown;
  percentage?: unknown;
  remaining?: unknown;
  type?: unknown;
  unit?: unknown;
  usage?: unknown;
}

let cachedEntry: {
  fetchedAtMs: number;
  key: string;
  result: ZcodeQuotaResult;
} | null = null;
const pendingFetches = new Map<string, Promise<ZcodeQuotaResult>>();

function zcodeConfigFile(): string {
  const configured = process.env.ZCODE_ACP_CONFIG_PATH?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  return path.join(os.homedir(), ".zcode", "cli", "config.json");
}

function quotaUrl(): string {
  return (
    process.env.ZCODE_BIGMODEL_USAGE_QUOTA_URL?.trim() ||
    process.env.BIGMODEL_USAGE_QUOTA_URL?.trim() ||
    DEFAULT_QUOTA_URL
  );
}

function envUsageApiKey(): string | null {
  const key =
    process.env.ZCODE_BIGMODEL_USAGE_API_KEY?.trim() ||
    process.env.BIGMODEL_USAGE_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function percentValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(100, value)
    : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function isoFromEpochMs(value: unknown): string | null {
  const ms = nonNegativeNumber(value);
  if (ms === null) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function isZaiEndpoint(value: unknown): boolean {
  const endpoint = stringValue(value);
  if (endpoint === null) return false;
  try {
    return ZAI_ENDPOINT_HOSTS.has(new URL(endpoint).hostname);
  } catch {
    return false;
  }
}

async function readSelectedZaiApiKey(): Promise<
  { kind: "ok"; apiKey: string } | { kind: "missing" } | { kind: "unavailable"; reason: string }
> {
  const configFile = zcodeConfigFile();
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    return { kind: "missing" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "unavailable",
      reason: "Native ZCode CLI configuration is not valid JSON",
    };
  }
  if (!isRecord(parsed)) {
    return {
      kind: "unavailable",
      reason: "Native ZCode CLI configuration has an unexpected shape",
    };
  }
  const model = stringValue(parsed.model);
  if (model === null || !model.includes("/")) {
    return {
      kind: "unavailable",
      reason: "Native ZCode CLI configuration has no selected provider",
    };
  }
  const providerId = model.split("/")[0];
  const providers = isRecord(parsed.provider) ? parsed.provider : null;
  const provider =
    providers !== null && providerId in providers && isRecord(providers[providerId])
      ? providers[providerId]
      : null;
  if (provider === null) {
    return {
      kind: "unavailable",
      reason: "The selected native provider is not configured",
    };
  }
  if (
    !isZaiEndpoint(provider.api) &&
    !isZaiEndpoint(
      isRecord(provider.options) ? provider.options.baseURL : undefined,
    )
  ) {
    return {
      kind: "unavailable",
      reason:
        "The selected native provider is not a Z.ai endpoint; its quota is not readable here",
    };
  }
  const options = isRecord(provider.options) ? provider.options : null;
  const apiKey = options === null ? null : stringValue(options.apiKey);
  if (apiKey === null) {
    return { kind: "missing" };
  }
  return { kind: "ok", apiKey };
}

function fiveHourFromLimits(
  limits: ZcodeLimitEntry[],
): ZcodeQuotaOk["fiveHour"] {
  const entry = limits.find(
    (limit) =>
      (limit.type === "TOKENS_LIMIT" || limit.type === "CREDIT_LIMIT") &&
      limit.unit === 3 &&
      limit.number === 5,
  );
  if (entry === undefined) return null;
  const used = percentValue(entry.percentage);
  if (used === null) return null;
  return {
    usedPercentage: used,
    remainingPercentage: Math.max(0, Math.min(100, 100 - used)),
    nextResetTime: isoFromEpochMs(entry.nextResetTime),
  };
}

function toolCallsFromLimits(
  limits: ZcodeLimitEntry[],
): ZcodeQuotaOk["toolCalls"] {
  const entry = limits.find(
    (limit) =>
      limit.type === "TIME_LIMIT" && limit.unit === 5 && limit.number === 1,
  );
  if (entry === undefined) return null;
  return {
    used: nonNegativeNumber(entry.currentValue),
    total: nonNegativeNumber(entry.usage),
    remaining: nonNegativeNumber(entry.remaining),
    percentage: percentValue(entry.percentage),
    nextResetTime: isoFromEpochMs(entry.nextResetTime),
  };
}

async function fetchQuota(apiKey: string): Promise<ZcodeQuotaResult> {
  let response: Response;
  try {
    response = await fetch(quotaUrl(), {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS),
    });
  } catch {
    return {
      status: "unavailable",
      reason: "Native quota endpoint could not be reached",
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      status: "missing",
      reason: "Native quota credentials were rejected",
    };
  }
  if (!response.ok) {
    return {
      status: "unavailable",
      reason: `Native quota endpoint returned HTTP ${response.status}`,
    };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: "unavailable",
      reason: "Native quota endpoint returned a non-JSON body",
    };
  }
  const body = isRecord(payload) ? payload : null;
  if (body === null || body.code !== 200 || body.success === false) {
    return {
      status: "unavailable",
      reason: "Native quota endpoint rejected the request",
    };
  }
  const data = isRecord(body.data) ? body.data : null;
  const rawLimits =
    data !== null && Array.isArray(data.limits) ? data.limits : [];
  const limits = rawLimits.filter(isRecord) as ZcodeLimitEntry[];
  return {
    status: "ok",
    fetchedAt: new Date().toISOString(),
    fiveHour: fiveHourFromLimits(limits),
    toolCalls: toolCallsFromLimits(limits),
  };
}

function quotaCacheKey(apiKey: string): string {
  return createHash("sha256")
    .update(`${apiKey}\u0000${quotaUrl()}\u0000personal`)
    .digest("base64url");
}

export async function readZcodeQuota(
  _command: ZcodeQuotaCommand,
): Promise<ZcodeQuotaResult> {
  const envKey = envUsageApiKey();
  let apiKey: string;
  if (envKey !== null) {
    apiKey = envKey;
  } else {
    const resolved = await readSelectedZaiApiKey();
    if (resolved.kind === "missing") {
      return {
        status: "missing",
        reason: "Native ZCode quota credentials were not found",
      };
    }
    if (resolved.kind === "unavailable") {
      return { status: "unavailable", reason: resolved.reason };
    }
    apiKey = resolved.apiKey;
  }
  const key = quotaCacheKey(apiKey);
  if (
    cachedEntry !== null &&
    cachedEntry.key === key &&
    Date.now() - cachedEntry.fetchedAtMs < QUOTA_CACHE_MS
  ) {
    return cachedEntry.result;
  }
  const pending = pendingFetches.get(key);
  if (pending !== undefined) {
    return pending;
  }
  const request = fetchQuota(apiKey)
    .then((result) => {
      cachedEntry = { fetchedAtMs: Date.now(), key, result };
      return result;
    })
    .finally(() => {
      pendingFetches.delete(key);
    });
  pendingFetches.set(key, request);
  return request;
}

export function resetZcodeQuotaCacheForTests(): void {
  cachedEntry = null;
  pendingFetches.clear();
}

export { DEFAULT_QUOTA_URL };
