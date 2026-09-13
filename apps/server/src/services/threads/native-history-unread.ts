import { and, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { HostProbeNativeHistoryItem } from "@bb/host-daemon-contract";
import { environments, threads } from "@bb/db";
import type { DbNotifier } from "@bb/db";
import { noopNotifier } from "@bb/db";
import { markThreadAttentionRequested } from "@bb/db";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { getLastProviderThreadId } from "./thread-events.js";

const NATIVE_UNREAD_SWEEP_BATCH_LIMIT = 25;

type NativeUnreadSweepDeps = LoggedPendingInteractionWorkSessionDeps;

interface NativeUnreadCandidate {
  hostId: string;
  cwd: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
  nativeTailFingerprint: string | null;
  providerId: string;
  threadId: string;
}

interface NativeUnreadProbeEntry {
  candidate: NativeUnreadCandidate;
  item: HostProbeNativeHistoryItem;
}

let rotationOffset = 0;

export async function runNativeHistoryUnreadSweep(
  deps: NativeUnreadSweepDeps,
): Promise<void> {
  const readerProviders = deps.providerRegistry
    .list()
    .map((registration) => registration.info.id)
    .filter((providerId) => {
      const reader = deps.providerRegistry.nativeHistoryReader(providerId);
      return reader !== null && reader !== "claude-transcript";
    });
  if (readerProviders.length === 0) return;

  const candidates = await listNativeUnreadCandidates(deps, readerProviders);
  if (candidates.length === 0) {
    rotationOffset = 0;
    return;
  }

  const byHost = new Map<string, NativeUnreadProbeEntry[]>();
  for (const candidate of candidates) {
    const reader = deps.providerRegistry.nativeHistoryReader(
      candidate.providerId,
    );
    if (reader === null || reader === "claude-transcript") continue;
    const sessionId = getLastProviderThreadId(deps, candidate.threadId);
    if (sessionId === null) continue;
    const entry: NativeUnreadProbeEntry = {
      candidate,
      item: { cwd: candidate.cwd, reader, sessionId },
    };
    const group = byHost.get(candidate.hostId);
    if (group === undefined) {
      byHost.set(candidate.hostId, [entry]);
    } else {
      group.push(entry);
    }
  }

  const notifier = nativeUnreadNotifier(deps);
  for (const [hostId, group] of byHost) {
    let results: Array<{
      status: string;
      lastMessageTimestamp?: string | null;
      revision?: string;
    }>;
    try {
      const probed = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: 10_000,
        command: {
          type: "host.probe_native_history",
          items: group.map((entry) => entry.item),
        },
      });
      results = probed.items;
    } catch (error) {
      deps.logger.warn(
        { err: error, hostId },
        "Native history unread probe failed",
      );
      continue;
    }
    for (const [index, result] of results.entries()) {
      if (result.status !== "ok") continue;
      const entry = group[index];
      if (entry === undefined) continue;
      const fingerprint = `${entry.item.reader}:${entry.item.sessionId}:${result.revision ?? ""}`;
      const stored = entry.candidate.nativeTailFingerprint;
      if (stored === fingerprint) continue;
      const timestamp =
        result.lastMessageTimestamp === null ||
        result.lastMessageTimestamp === undefined
          ? NaN
          : Date.parse(result.lastMessageTimestamp);
      if (!Number.isFinite(timestamp)) continue;
      deps.db
        .update(threads)
        .set({ nativeTailFingerprint: fingerprint })
        .where(eq(threads.id, entry.candidate.threadId))
        .run();
      if (stored !== null) {
        markThreadAttentionRequested(deps.db, notifier, {
          threadId: entry.candidate.threadId,
        });
        continue;
      }
      if (timestamp <= entry.candidate.latestAttentionAt) continue;
      if (
        entry.candidate.lastReadAt !== null &&
        timestamp <= entry.candidate.lastReadAt
      ) {
        continue;
      }
      markThreadAttentionRequested(deps.db, notifier, {
        threadId: entry.candidate.threadId,
      });
    }
  }
}

async function listNativeUnreadCandidates(
  deps: NativeUnreadSweepDeps,
  readerProviders: readonly string[],
): Promise<NativeUnreadCandidate[]> {
  const where = and(
    isNull(threads.deletedAt),
    isNull(threads.archivedAt),
    eq(threads.status, "idle"),
    isNotNull(environments.path),
    isNotNull(environments.hostId),
    inArray(threads.providerId, [...readerProviders]),
  );
  const totalRow = await deps.db
    .select({ value: count() })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(where)
    .get();
  const total = totalRow?.value ?? 0;
  if (total === 0) return [];
  const offset = rotationOffset % total;
  const nextOffset = offset + NATIVE_UNREAD_SWEEP_BATCH_LIMIT;
  rotationOffset = nextOffset >= total ? 0 : nextOffset;
  const rows = await deps.db
    .select({
      hostId: environments.hostId,
      cwd: environments.path,
      lastReadAt: threads.lastReadAt,
      latestAttentionAt: threads.latestAttentionAt,
      nativeTailFingerprint: threads.nativeTailFingerprint,
      providerId: threads.providerId,
      threadId: threads.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(where)
    .orderBy(threads.id)
    .limit(NATIVE_UNREAD_SWEEP_BATCH_LIMIT)
    .offset(offset);
  return rows.flatMap((row) =>
    row.hostId === null || row.cwd === null
      ? []
      : [
          {
            hostId: row.hostId,
            cwd: row.cwd,
            lastReadAt: row.lastReadAt,
            latestAttentionAt: row.latestAttentionAt,
            nativeTailFingerprint: row.nativeTailFingerprint,
            providerId: row.providerId,
            threadId: row.threadId,
          },
        ],
  );
}

function nativeUnreadNotifier(deps: NativeUnreadSweepDeps): DbNotifier {
  return {
    ...noopNotifier,
    notifyThread(threadId, changes, metadata) {
      deps.hub.notifyThread(threadId, changes, metadata);
    },
  };
}

export function resetNativeUnreadSweepStateForTests(): void {
  rotationOffset = 0;
}
