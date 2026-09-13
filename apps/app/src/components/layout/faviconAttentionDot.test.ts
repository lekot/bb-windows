import { describe, expect, it } from "vitest";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";

type FaviconSidebarThread = Parameters<
  typeof shouldShowFaviconAttentionDot
>[0]["sidebarThreads"][number];

function makeSidebarThread(
  overrides: Partial<FaviconSidebarThread> = {},
): FaviconSidebarThread {
  return {
    id: "thr_sidebar",
    originKind: null,
    parentThreadId: null,
    hasPendingInteraction: false,
    lastReadAt: 10,
    latestAttentionAt: 20,
    visibility: "visible",
    ...overrides,
  };
}

const BASE_ARGS = {
  currentThreadHasPendingInteraction: false,
  isDocumentVisible: true,
  isThreadView: false,
  thread: null,
  sidebarThreads: [] as FaviconSidebarThread[],
};

describe("shouldShowFaviconAttentionDot", () => {
  it("ignores unread side-chat threads hidden from the sidebar", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [makeSidebarThread({ visibility: "hidden" })],
      }),
    ).toBe(false);
  });

  it("shows the dot for a visible unread sidebar thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread(),
          makeSidebarThread({ lastReadAt: 30 }),
          makeSidebarThread({ visibility: "hidden" }),
        ],
      }),
    ).toBe(true);
  });

  it("does not show unread attention for the currently viewed thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        currentThreadId: "thr_sidebar",
        thread: { lastReadAt: 10, latestAttentionAt: 20 },
        sidebarThreads: [makeSidebarThread()],
      }),
    ).toBe(false);
  });

  it("shows unread attention for the viewed thread while the browser tab is hidden", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isDocumentVisible: false,
        isThreadView: true,
        currentThreadId: "thr_sidebar",
        thread: { lastReadAt: 10, latestAttentionAt: 20 },
        sidebarThreads: [makeSidebarThread()],
      }),
    ).toBe(true);
  });

  it("uses the current thread directly while hidden when its sidebar row is unavailable", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isDocumentVisible: false,
        isThreadView: true,
        currentThreadId: "thr_current",
        thread: { lastReadAt: 10, latestAttentionAt: 20 },
        sidebarThreads: [],
      }),
    ).toBe(true);
  });

  it("shows unread attention for another thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        currentThreadId: "thr_current",
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [makeSidebarThread({ lastReadAt: 5 })],
      }),
    ).toBe(true);
  });

  it("shows background pending attention while viewing another thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [
          makeSidebarThread({
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("shows background pending attention when no thread is focused", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread({
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("shows the dot when the in-view thread is blocked on input but absent from the sidebar (archived/side-chat)", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [],
        currentThreadHasPendingInteraction: true,
      }),
    ).toBe(true);
  });

  it("ignores the in-view pending flag when not viewing a thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: false,
        currentThreadHasPendingInteraction: true,
        sidebarThreads: [makeSidebarThread({ lastReadAt: 30 })],
      }),
    ).toBe(false);
  });

  it("ignores pending interactions on background side-chat threads", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        sidebarThreads: [
          makeSidebarThread({
            visibility: "hidden",
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(false);
  });

  it("shows the dot when a viewed parent has a delegated child waiting on the user", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        currentThreadId: "thr_parent",
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [
          makeSidebarThread({
            id: "thr_child",
            parentThreadId: "thr_parent",
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(true);
  });

  it("ignores a pending fork of the viewed thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        currentThreadId: "thr_parent",
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [
          makeSidebarThread({
            id: "thr_fork",
            originKind: "fork",
            parentThreadId: "thr_parent",
            lastReadAt: 30,
            latestAttentionAt: 20,
            hasPendingInteraction: true,
          }),
        ],
      }),
    ).toBe(false);
  });

  it("shows an unread result from a fork of the viewed thread", () => {
    expect(
      shouldShowFaviconAttentionDot({
        ...BASE_ARGS,
        isThreadView: true,
        currentThreadId: "thr_parent",
        thread: { lastReadAt: 30, latestAttentionAt: 20 },
        sidebarThreads: [
          makeSidebarThread({
            id: "thr_fork",
            originKind: "fork",
            parentThreadId: "thr_parent",
            hasPendingInteraction: false,
            lastReadAt: 10,
            latestAttentionAt: 20,
          }),
        ],
      }),
    ).toBe(true);
  });
});
