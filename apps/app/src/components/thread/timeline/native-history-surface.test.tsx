// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import { ThreadTimelineSurface } from "./ThreadTimelineSurface";
import { nativeMessageRows } from "./native-history-timeline";

const state = vi.hoisted(() => ({
  atBottom: false,
  isError: false as boolean,
  olderError: null as Error | null,
  scrollToBottom: vi.fn(),
  loadOlder: vi.fn().mockResolvedValue(undefined),
  messages: [
    {
      id: "native-1",
      role: "assistant" as const,
      text: "Initial native reply",
      timestamp: "2026-09-07T10:00:00Z",
    },
  ],
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
  useSystemProviderInfo: () => ({
    id: "claude-code",
    capabilities: { nativeHistoryReader: "claude-transcript" },
  }),
}));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThread: () => ({ data: { providerId: "claude-code" } }),
}));
vi.mock("@/hooks/queries/native-history-query", () => ({
  useNativeHistory: () => ({
    data: { supported: true },
    messages: state.messages,
    hasOlder: true,
    isLoadingOlder: false,
    loadOlder: state.loadOlder,
    isError: state.isError,
    olderError: state.olderError,
    isFetching: false,
  }),
}));
vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  useBottomAnchoredScroll: () => ({
    isAtBottom: state.atBottom,
    scrollToBottom: state.scrollToBottom,
  }),
}));
vi.mock("./useAutoLoadOlderRows.js", () => ({
  useAutoLoadOlderRows: ({
    onLoadOlderRows,
  }: {
    onLoadOlderRows: () => void;
  }) => ({
    sentinelRef: undefined,
    isAutoLoadEnabled: false,
    loadOlderRows: onLoadOlderRows,
  }),
}));
vi.mock("./ThreadTimelineRows.js", () => ({
  ThreadTimelineRows: ({ timelineRows }: { timelineRows: TimelineRow[] }) => (
    <div>
      {timelineRows.map((row) => (
        <p key={row.id}>{row.kind === "conversation" ? row.text : row.kind}</p>
      ))}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.isError = false;
  state.olderError = null;
  state.messages = [
    {
      id: "native-1",
      role: "assistant",
      text: "Initial native reply",
      timestamp: "2026-09-07T10:00:00Z",
    },
  ];
});

function surface(threadRuntimeDisplayStatus: "active" | "idle" = "idle") {
  return (
    <ThreadTimelineSurface
      activeThinking={null}
      isThreadTimelinePending={false}
      timelineError={false}
      showOngoingIndicator={false}
      timelineRows={nativeMessageRows("thread-1", [
        {
          id: "old-bb",
          role: "assistant",
          text: "Old bb reply",
          timestamp: "2026-09-07T09:00:00Z",
        },
      ])}
      threadId="thread-1"
      threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
      workspaceRootPath={undefined}
    />
  );
}

describe("unified native history surface", () => {
  it("uses the regular timeline and native older-page loader", () => {
    render(surface());
    expect(screen.getByText("Initial native reply")).toBeTruthy();
    expect(screen.queryByText("Old bb reply")).toBeNull();
    expect(screen.queryByText("История Claude")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Load older messages/ }),
    );
    expect(state.loadOlder).toHaveBeenCalledOnce();
  });
  it("announces a new native tail without scrolling a reader away", () => {
    const view = render(surface());
    state.messages = [
      ...state.messages,
      {
        id: "native-2",
        role: "assistant",
        text: "Later VS Code reply",
        timestamp: "2026-09-07T11:00:00Z",
      },
    ];
    view.rerender(surface());
    expect(state.scrollToBottom).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: /Есть новые сообщения/ }),
    );
    expect(state.scrollToBottom).toHaveBeenCalledOnce();
  });

  it("hides a transient native-history error while a new thread is starting", () => {
    state.messages = [];
    state.isError = true;
    render(surface("active"));
    expect(
      screen.queryByText("История исходной сессии пока недоступна. Показаны сообщения bb."),
    ).toBeNull();
  });

  it("shows a persistent native-history error after the thread becomes idle", () => {
    state.messages = [];
    state.isError = true;
    render(surface("idle"));
    expect(
      screen.getByText("История исходной сессии пока недоступна. Показаны сообщения bb."),
    ).toBeTruthy();
  });
});
