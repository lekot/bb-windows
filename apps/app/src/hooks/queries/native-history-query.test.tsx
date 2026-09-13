// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  nativeHistoryQueryKey,
  useNativeHistory,
} from "./native-history-query";

type NativeHistoryMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  timestamp: string | null;
};

type NativeHistoryPage = {
  messages: NativeHistoryMessage[];
  metadata: {
    model: string | null;
    permissionMode: string | null;
    title: string | null;
  };
  nextCursor: string | null;
  revision: string | null;
  supported: boolean;
  truncated: boolean;
};

const mocks = vi.hoisted(() => ({
  nativeHistory: vi.fn(),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { nativeHistory: mocks.nativeHistory } },
}));

function message(
  id: string,
  timestamp: string | null,
  text = id,
): NativeHistoryMessage {
  return { id, role: "user", text, timestamp };
}

function page(
  messages: NativeHistoryMessage[],
  nextCursor: string | null,
  revision: string,
): NativeHistoryPage {
  return {
    messages,
    metadata: { model: null, permissionMode: null, title: null },
    nextCursor,
    revision,
    supported: true,
    truncated: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useNativeHistory", () => {
  beforeEach(() => {
    mocks.nativeHistory.mockReset();
  });

  it("automatically appends a polled head without dropping loaded older messages", async () => {
    const head = message("head", null);
    const older = message("older", null);
    const appended = message("external", null, "External native reply");
    mocks.nativeHistory
      .mockResolvedValueOnce(page([head], "older-cursor", "initial"))
      .mockResolvedValueOnce(page([older], null, "older-page"))
      .mockResolvedValue(page([head, appended], "head-cursor", "external-append"));
    focusManager.setFocused(true);
    const { wrapper } = createQueryClientTestHarness();
    const { result, unmount } = renderHook(
      () => useNativeHistory("automatic-poll", true),
      { wrapper },
    );
    try {
      await waitFor(() => expect(result.current.messages).toEqual([head]));
      await act(async () => { await result.current.loadOlder(); });
      expect(result.current.messages).toEqual([older, head]);
      await waitFor(
        () => expect(result.current.messages).toEqual([older, head, appended]),
        { timeout: 12_000, interval: 100 },
      );
      expect(result.current.hasOlder).toBe(false);
      expect(mocks.nativeHistory).toHaveBeenCalledTimes(3);
      expect(mocks.nativeHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ threadId: "automatic-poll", limit: 20 }),
      );
    } finally {
      unmount();
      focusManager.setFocused(undefined);
    }
  }, 20_000);

  it("refreshes on focus after suppressing background polling", async () => {
    const head = message("before-away", null);
    const appended = message("while-away", null);
    mocks.nativeHistory
      .mockResolvedValueOnce(page([head], "older", "before"))
      .mockResolvedValue(page([head, appended], "older", "after"));
    focusManager.setFocused(false);
    const { wrapper } = createQueryClientTestHarness();
    const { result, unmount } = renderHook(
      () => useNativeHistory("return-to-tab", true),
      { wrapper },
    );
    try {
      await waitFor(() => expect(result.current.messages).toEqual([head]));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10_200));
      });
      expect(mocks.nativeHistory).toHaveBeenCalledTimes(1);
      await act(async () => { focusManager.setFocused(true); });
      await waitFor(() => expect(result.current.messages).toEqual([head, appended]));
      expect(mocks.nativeHistory).toHaveBeenCalledTimes(2);
    } finally {
      unmount();
      focusManager.setFocused(undefined);
    }
  }, 20_000);

  it("requests the latest page and polls only while visible", async () => {
    const threadId = "thread-polling";
    mocks.nativeHistory.mockResolvedValueOnce(
      page([message("head-1", "2026-09-07T00:00:00Z")], "cursor-1", "rev-1"),
    );
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useNativeHistory(threadId, true), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data?.revision).toBe("rev-1"));

    expect(mocks.nativeHistory).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        limit: 20,
        signal: expect.any(AbortSignal),
        threadId,
      }),
    );

    const query = queryClient.getQueryCache().find({
      queryKey: nativeHistoryQueryKey(threadId),
    });
    if (query === undefined) throw new Error("Expected native history query");

    expect(query.options).toEqual(
      expect.objectContaining({
        refetchIntervalInBackground: false,
        refetchOnReconnect: "always",
        refetchOnWindowFocus: "always",
      }),
    );
    const queryOptions = query.options as typeof query.options & {
      refetchInterval?: (
        entry: typeof query,
      ) => number | false | undefined;
    };
    const refetchInterval = queryOptions.refetchInterval;
    if (typeof refetchInterval !== "function") {
      throw new Error("Expected dynamic native history polling");
    }
    expect(refetchInterval(query)).toBe(10_000);

    queryClient.setQueryData(nativeHistoryQueryKey(threadId), {
      ...page([], null, "rev-unsupported"),
      supported: false,
    });
    expect(refetchInterval(query)).toBe(false);
  });

  it("loads older pages lazily, deduplicates IDs, and keeps page order", async () => {
    const threadId = "thread-pages";
    const head = page(
      [
        message("message-2", "2026-09-07T00:02:00Z", "head two"),
        message("message-3", "2026-09-07T00:03:00Z"),
      ],
      "cursor-1",
      "rev-1",
    );
    const firstOlderPage = page(
      [
        message("message-1", "2026-09-07T00:01:00Z"),
        message("message-2", "2026-09-07T00:02:00Z", "duplicate two"),
      ],
      "cursor-2",
      "rev-2",
    );
    const secondOlderPage = page(
      [
        message("message-0", "2026-09-07T00:00:00Z"),
        message("message-1", "2026-09-07T00:01:00Z", "duplicate one"),
      ],
      null,
      "rev-3",
    );
    const refreshedHead = page(
      [
        message("message-3", "2026-09-07T00:03:00Z"),
        message("message-4", "2026-09-07T00:04:00Z"),
      ],
      null,
      "rev-4",
    );
    refreshedHead.nextCursor = "cursor-refreshed";
    mocks.nativeHistory
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(firstOlderPage)
      .mockResolvedValueOnce(secondOlderPage)
      .mockResolvedValueOnce(refreshedHead);

    const { result } = renderHook(
      () => useNativeHistory(threadId, true),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(result.current.messages[1]?.text).toBe("head two");
    expect(result.current.hasOlder).toBe(true);
    expect(mocks.nativeHistory).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ before: "cursor-1", limit: 20, threadId }),
    );

    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "message-0",
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(result.current.hasOlder).toBe(false);
    expect(mocks.nativeHistory).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ before: "cursor-2", limit: 20, threadId }),
    );

    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data?.revision).toBe("rev-4"));
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "message-0",
      "message-1",
      "message-2",
      "message-3",
      "message-4",
    ]);
    expect(result.current.hasOlder).toBe(false);
    expect(mocks.nativeHistory).toHaveBeenCalledTimes(4);
    expect(mocks.nativeHistory).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ limit: 20, threadId }),
    );
  });

  it("removes obsolete messages when a complete head overlaps an older snapshot", async () => {
    mocks.nativeHistory
      .mockResolvedValueOnce(page([message("old", null), message("kept", null)], "older", "v1"))
      .mockResolvedValueOnce(page([message("kept", null, "updated")], null, "v2"));
    const { result } = renderHook(() => useNativeHistory("truncated-overlap", true), {
      wrapper: createQueryClientTestHarness().wrapper,
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.messages).toEqual([message("kept", null, "updated")]));
    expect(result.current.hasOlder).toBe(false);
  });

  it("preserves loaded messages when an older-page read fails and supports retry", async () => {
    const threadId = "thread-older-error";
    const head = page(
      [message("head-1", "2026-09-07T00:01:00Z")],
      "cursor-1",
      "rev-1",
    );
    const older = page(
      [message("older-1", "2026-09-07T00:00:00Z")],
      null,
      "rev-2",
    );
    mocks.nativeHistory
      .mockResolvedValueOnce(head)
      .mockRejectedValueOnce(new Error("older read failed"))
      .mockResolvedValueOnce(older);

    const { result } = renderHook(
      () => useNativeHistory(threadId, true),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    let loadError: unknown;
    await act(async () => {
      try {
        await result.current.loadOlder();
      } catch (error) {
        loadError = error;
      }
    });
    expect(loadError).toMatchObject({ message: "older read failed" });
    await waitFor(() => {
      expect(result.current.olderError?.message).toBe("older read failed");
      expect(result.current.isLoadingOlder).toBe(false);
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "head-1",
    ]);
    expect(result.current.hasOlder).toBe(true);

    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "older-1",
      "head-1",
    ]);
    expect(result.current.olderError).toBeNull();
    expect(result.current.hasOlder).toBe(false);
  });

  it("uses the latest UUID occurrence for order and content", async () => {
    const threadId = "thread-duplicate-order";
    const head = page(
      [
        message("head-a", "2026-09-07T00:02:00Z"),
        message("shared", null, "head shared"),
        message("head-b", "2026-09-07T00:01:00Z"),
      ],
      "cursor-1",
      "rev-1",
    );
    const older = page(
      [
        message("shared", "2026-09-07T00:03:00Z", "older shared"),
        message("older-a", "2026-09-07T00:00:00Z"),
      ],
      null,
      "rev-2",
    );
    mocks.nativeHistory
      .mockResolvedValueOnce(head)
      .mockResolvedValueOnce(older);

    const { result } = renderHook(
      () => useNativeHistory(threadId, true),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(result.current.messages.map((item) => item.id)).toEqual([
      "older-a",
      "head-a",
      "shared",
      "head-b",
    ]);
    expect(result.current.messages[2]?.text).toBe("head shared");
  });

  it("keeps each thread's loaded pages isolated across thread switches", async () => {
    const threadA = "thread-a";
    const threadB = "thread-b";
    mocks.nativeHistory.mockImplementation(
      async ({ before, threadId }: { before?: string; threadId: string }) => {
        if (threadId === threadA) {
          return before === undefined
            ? page(
                [message("a-head", "2026-09-07T00:01:00Z")],
                "a-cursor",
                "a-head",
              )
            : page(
                [message("a-old", "2026-09-07T00:00:00Z")],
                null,
                "a-old",
              );
        }
        return page(
          [message("b-head", "2026-09-07T00:01:00Z")],
          "b-cursor",
          "b-head",
        );
      },
    );

    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string }) => useNativeHistory(threadId, true),
      {
        initialProps: { threadId: threadA },
        wrapper: createQueryClientTestHarness().wrapper,
      },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "a-old",
      "a-head",
    ]);

    rerender({ threadId: threadB });
    await waitFor(() => expect(result.current.data?.revision).toBe("b-head"));
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "b-head",
    ]);

    rerender({ threadId: threadA });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "a-old",
      "a-head",
    ]);
  });

  it("resets to a new latest page instead of merging across a head UUID gap", async () => {
    const threadId = "thread-head-gap";
    const initialHead = page(
      [
        message("old-head-1", "2026-09-07T00:01:00Z"),
        message("old-head-2", "2026-09-07T00:02:00Z"),
      ],
      "old-cursor",
      "rev-1",
    );
    const olderPage = page(
      [message("oldest", "2026-09-07T00:00:00Z")],
      null,
      "rev-2",
    );
    const newHead = page(
      [
        message("new-head-1", "2026-09-07T01:00:00Z"),
        message("new-head-2", "2026-09-07T01:01:00Z"),
      ],
      "new-cursor",
      "rev-3",
    );
    mocks.nativeHistory
      .mockResolvedValueOnce(initialHead)
      .mockResolvedValueOnce(olderPage)
      .mockResolvedValueOnce(newHead);

    const { result } = renderHook(
      () => useNativeHistory(threadId, true),
      { wrapper: createQueryClientTestHarness().wrapper },
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "oldest",
      "old-head-1",
      "old-head-2",
    ]);

    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() =>
      expect(result.current.messages.map((item) => item.id)).toEqual([
        "new-head-1",
        "new-head-2",
      ]),
    );
    expect(result.current.messages.map((item) => item.id)).toEqual([
      "new-head-1",
      "new-head-2",
    ]);
    expect(result.current.hasOlder).toBe(true);
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "oldest" }),
        expect.objectContaining({ id: "old-head-1" }),
      ]),
    );
    expect(mocks.nativeHistory).toHaveBeenCalledTimes(3);
    expect(mocks.nativeHistory).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ limit: 20, threadId }),
    );
  });
});
