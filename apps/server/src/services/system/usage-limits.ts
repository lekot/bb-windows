import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import type { SystemUsageLimitsQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

const PROVIDER_USAGE_STALE_FALLBACK_MS = 15 * 60_000;

interface CachedProviderUsage {
  fetchedAt: number;
  usage: Extract<ProviderUsage, { status: "ok" }>;
}

const providerUsageCache = new WeakMap<
  AppDeps,
  Map<string, CachedProviderUsage>
>();

async function loadProviderUsageWithCache(
  deps: AppDeps,
  key: string,
  load: () => Promise<ProviderUsage | null>,
): Promise<ProviderUsage | null> {
  let cache = providerUsageCache.get(deps);
  if (cache === undefined) {
    cache = new Map();
    providerUsageCache.set(deps, cache);
  }
  const now = Date.now();
  const cached = cache.get(key);
  const usage = await load();
  if (usage?.status === "ok") {
    cache.set(key, { fetchedAt: now, usage });
    return usage;
  }
  if (
    usage?.status === "error" &&
    cached !== undefined &&
    now - cached.fetchedAt < PROVIDER_USAGE_STALE_FALLBACK_MS
  ) {
    return cached.usage;
  }
  return usage;
}

export async function getProviderUsageLimits(
  deps: AppDeps,
  query: SystemUsageLimitsQuery,
): Promise<ProviderUsageResponse> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  const providers = (
    await listSystemProviderInfos(deps, { hostId, capability: "usage" })
  ).filter(
    (provider) =>
      query.providerId === undefined || provider.id === query.providerId,
  );
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider): Promise<[string, ProviderUsage] | null> => {
      if (!provider.maintenance.usage) return null;
      const usage = await loadProviderUsageWithCache(
        deps,
        `${hostId}:${provider.id}`,
        async () => {
          if (provider.id === "acp-zcode") {
            try {
              const quota = await callHostRetryableOnlineRpc(deps, {
                hostId,
                timeoutMs: COMMAND_TIMEOUT_MS,
                command: { type: "host.read_zcode_quota" },
              });
              if (quota.status === "missing") {
                return { status: "unauthenticated" };
              }
              if (quota.status === "unavailable") {
                return {
                  status: "error",
                  message: quota.reason,
                  planLabel: null,
                  accountEmail: null,
                };
              }
              const windows: ProviderUsageWindow[] = [];
              if (quota.fiveHour !== null) {
                windows.push({
                  label: "Current session",
                  usedPercent: quota.fiveHour.usedPercentage,
                  resetsAt: quota.fiveHour.nextResetTime,
                });
              }
              return {
                status: "ok",
                windows,
                planLabel: null,
                accountEmail: null,
              };
            } catch {
              return {
                status: "error",
                message: "GLM usage could not be loaded.",
                planLabel: null,
                accountEmail: null,
              };
            }
          }
          const bridgeLaunch = resolveBridgeLaunchForProviderId(
            deps,
            provider.id,
          );
          if (bridgeLaunch === null) return null;
          try {
            const result = await callHostRetryableOnlineRpc(deps, {
              hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "provider.usage",
                providerId: provider.id,
                bridgeLaunch,
              },
            });
            return result.supported ? result.usage : null;
          } catch {
            return {
              status: "error",
              message: "Provider usage could not be loaded.",
              planLabel: null,
              accountEmail: null,
            };
          }
        },
      );
      return usage === null ? null : [provider.id, usage];
    },
  );
  return Object.fromEntries(
    entries.filter((entry): entry is [string, ProviderUsage] => entry !== null),
  );
}
