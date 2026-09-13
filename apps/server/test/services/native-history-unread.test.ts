import { eq } from "drizzle-orm";
import { threads } from "@bb/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetNativeUnreadSweepStateForTests,
  runNativeHistoryUnreadSweep,
} from "../../src/services/threads/native-history-unread.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const probeMock = vi.hoisted(() => ({
  callHostRetryableOnlineRpc: vi.fn(),
}));

vi.mock("../../src/services/hosts/online-rpc.js", () => ({
  callHostRetryableOnlineRpc: probeMock.callHostRetryableOnlineRpc,
}));

function seedCodexThread(harness: TestAppHarness, suffix = ""): { threadId: string } {
  const { host } = seedHostSession(harness.deps, { id: `host-native-unread${suffix}` });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "C:/tmp/native-unread",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "C:/tmp/native-unread",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "01a07723-6432-7731-a5e9-5ce0affd6677",
    threadId: thread.id,
  });
  return { threadId: thread.id };
}

function readThread(harness: TestAppHarness, threadId: string) {
  return harness.deps.db
    .select({
      lastReadAt: threads.lastReadAt,
      latestAttentionAt: threads.latestAttentionAt,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
}

describe("runNativeHistoryUnreadSweep", () => {
  it.each([18, 26])("revisits every one of %i threads within each full cycle", async (total) => {
    await withTestHarness(async (harness) => {
      for (let index = 0; index < total; index += 1) seedCodexThread(harness, `-cycle-${index}`);
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({ items: [{ status: "missing" }] });
      for (let cycle = 0; cycle < 3; cycle += 1) {
        probeMock.callHostRetryableOnlineRpc.mockClear();
        for (let batch = 0; batch < Math.ceil(total / 25); batch += 1) await runNativeHistoryUnreadSweep(harness.deps);
        const visited = new Set(probeMock.callHostRetryableOnlineRpc.mock.calls.map((call) => call[1].hostId));
        expect(visited.size).toBe(total);
      }
    });
  });

  it("visits threads beyond the first bounded batch", async () => {
    await withTestHarness(async (harness) => {
      for (let index = 0; index < 26; index += 1) {
        seedCodexThread(harness, `-${index}`);
      }
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({ items: [{ status: "missing" }] });
      await runNativeHistoryUnreadSweep(harness.deps);
      expect(probeMock.callHostRetryableOnlineRpc).toHaveBeenCalledTimes(25);
      await runNativeHistoryUnreadSweep(harness.deps);
      const visited = new Set(probeMock.callHostRetryableOnlineRpc.mock.calls.map((call) => call[1].hostId));
      expect(visited.size).toBe(26);
    });
  });

  beforeEach(() => {
    probeMock.callHostRetryableOnlineRpc.mockReset();
    resetNativeUnreadSweepStateForTests();
  });

  it("marks an idle thread unread when the native tail is newer than the last read", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const before = readThread(harness, threadId);
      expect(before).toBeDefined();
      const nativeTimestamp = new Date(Date.now() + 60_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          {
            status: "ok",
            lastMessageTimestamp: nativeTimestamp,
            revision: "r1",
          },
        ],
      });

      await runNativeHistoryUnreadSweep(harness.deps);

      const after = readThread(harness, threadId);
      expect(after?.latestAttentionAt).toBeGreaterThan(
        before?.latestAttentionAt ?? 0,
      );
      expect(probeMock.callHostRetryableOnlineRpc).toHaveBeenCalledTimes(1);
      const command = probeMock.callHostRetryableOnlineRpc.mock.calls[0]?.[1]
        ?.command;
      expect(command).toMatchObject({
        type: "host.probe_native_history",
        items: [
          {
            reader: "codex-rollout",
            sessionId: "01a07723-6432-7731-a5e9-5ce0affd6677",
          },
        ],
      });
    });
  });

  it("does not bump attention when the native tail is not newer than the last read", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const before = readThread(harness, threadId);
      const staleTimestamp = new Date(Date.now() - 3_600_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          { status: "ok", lastMessageTimestamp: staleTimestamp, revision: "r1" },
        ],
      });

      await runNativeHistoryUnreadSweep(harness.deps);

      const after = readThread(harness, threadId);
      expect(after?.latestAttentionAt).toBe(before?.latestAttentionAt);
    });
  });

  it("ignores probe failures and missing sessions without touching the thread", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const before = readThread(harness, threadId);
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [{ status: "missing" }],
      });
      await runNativeHistoryUnreadSweep(harness.deps);
      probeMock.callHostRetryableOnlineRpc.mockRejectedValue(
        new Error("host offline"),
      );
      await expect(runNativeHistoryUnreadSweep(harness.deps)).resolves.toBeUndefined();

      const after = readThread(harness, threadId);
      expect(after?.latestAttentionAt).toBe(before?.latestAttentionAt);
    });
  });

  it("does not re-mark the same native tail on the next sweep", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const futureTimestamp = new Date(
        Date.now() + 3_600_000,
      ).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          {
            status: "ok",
            lastMessageTimestamp: futureTimestamp,
            revision: "r1",
          },
        ],
      });

      await runNativeHistoryUnreadSweep(harness.deps);
      const afterFirst = readThread(harness, threadId);
      expect(afterFirst?.latestAttentionAt).toBeGreaterThan(0);

      await runNativeHistoryUnreadSweep(harness.deps);
      await runNativeHistoryUnreadSweep(harness.deps);
      const afterThird = readThread(harness, threadId);
      expect(afterThird?.latestAttentionAt).toBe(afterFirst?.latestAttentionAt);
    });
  });

  it("does not re-mark an already-processed tail after a sweep restart", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const futureTimestamp = new Date(
        Date.now() + 3_600_000,
      ).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          {
            status: "ok",
            lastMessageTimestamp: futureTimestamp,
            revision: "r1",
          },
        ],
      });

      await runNativeHistoryUnreadSweep(harness.deps);
      const afterFirst = readThread(harness, threadId);

      const later = Date.now() + 10_000;
      harness.deps.db.update(threads).set({ lastReadAt: later }).where(eq(threads.id, threadId)).run();
      const clock = vi.spyOn(Date, "now").mockReturnValue(later + 10_000);
      try {
        resetNativeUnreadSweepStateForTests();
        await runNativeHistoryUnreadSweep(harness.deps);
        const afterRestart = readThread(harness, threadId);
        expect(afterRestart?.latestAttentionAt).toBe(afterFirst?.latestAttentionAt);
      } finally {
        clock.mockRestore();
      }
    });
  });

  it("marks unread again for a newer tail after the user read the thread", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const firstTail = new Date(Date.now() + 600_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          { status: "ok", lastMessageTimestamp: firstTail, revision: "r1" },
        ],
      });
      await runNativeHistoryUnreadSweep(harness.deps);
      const afterFirst = readThread(harness, threadId);
      expect(afterFirst?.latestAttentionAt).toBeGreaterThan(0);

      const readAt = Date.now();
      harness.deps.db
        .update(threads)
        .set({ lastReadAt: readAt, updatedAt: readAt })
        .where(eq(threads.id, threadId))
        .run();

      const newerTail = new Date(Date.now() + 1_200_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [
          { status: "ok", lastMessageTimestamp: newerTail, revision: "r2" },
        ],
      });
      await runNativeHistoryUnreadSweep(harness.deps);

      const afterNewTail = readThread(harness, threadId);
      expect(afterNewTail?.latestAttentionAt).toBeGreaterThan(
        afterFirst?.latestAttentionAt ?? 0,
      );
    });
  });

  it("marks unread for a new revision with the same tail timestamp", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const tail = new Date(Date.now() + 3_600_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [{ status: "ok", lastMessageTimestamp: tail, revision: "r1" }],
      });
      await runNativeHistoryUnreadSweep(harness.deps);
      const afterFirst = readThread(harness, threadId);
      expect(afterFirst?.latestAttentionAt).toBeGreaterThan(0);

      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [{ status: "ok", lastMessageTimestamp: tail, revision: "r2" }],
      });
      await runNativeHistoryUnreadSweep(harness.deps);

      const afterNewRevision = readThread(harness, threadId);
      expect(afterNewRevision?.latestAttentionAt).toBeGreaterThan(
        afterFirst?.latestAttentionAt ?? 0,
      );
    });
  });

  it("does not re-mark the same fingerprint when the server clock moves backwards", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const realNow = Date.now();
      const tail = new Date(realNow + 3_600_000).toISOString();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({
        items: [{ status: "ok", lastMessageTimestamp: tail, revision: "r1" }],
      });
      await runNativeHistoryUnreadSweep(harness.deps);
      const afterFirst = readThread(harness, threadId);

      const clock = vi.spyOn(Date, "now").mockReturnValue(realNow - 3_600_000);
      try {
        resetNativeUnreadSweepStateForTests();
        await runNativeHistoryUnreadSweep(harness.deps);
      } finally {
        clock.mockRestore();
      }

      const afterBackwards = readThread(harness, threadId);
      expect(afterBackwards?.latestAttentionAt).toBe(afterFirst?.latestAttentionAt);
    });
  });

  it("notifies about a changed fingerprint even when the native clock is behind the last read", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedCodexThread(harness);
      const now = Date.now();
      probeMock.callHostRetryableOnlineRpc.mockResolvedValue({ items: [{ status: "ok", lastMessageTimestamp: new Date(now - 60_000).toISOString(), revision: "r1" }] });
      await runNativeHistoryUnreadSweep(harness.deps);
      harness.deps.db.update(threads).set({ lastReadAt: now + 1000 }).where(eq(threads.id, threadId)).run();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + 2000);
      try {
        probeMock.callHostRetryableOnlineRpc.mockResolvedValue({ items: [{ status: "ok", lastMessageTimestamp: new Date(now - 120_000).toISOString(), revision: "r2" }] });
        await runNativeHistoryUnreadSweep(harness.deps);
        expect(readThread(harness, threadId)?.latestAttentionAt).toBe(now + 2000);
      } finally {
        clock.mockRestore();
      }
    });
  });
});
