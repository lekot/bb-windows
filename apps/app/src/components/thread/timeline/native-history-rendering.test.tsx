// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ThreadTimelineRows } from "./ThreadTimelineRows";
import { nativeMessageRows } from "./native-history-timeline";

describe("native messages in the bb renderer", () => {
  it("renders a native task notification as a service card", () => {
    const rows = nativeMessageRows("thread-native", [{
      id: "notification", role: "user", timestamp: null,
      text: '<task-notification><task-id>b5i5iohg7</task-id><status>completed</status><summary>Build completed (exit code 0)</summary></task-notification>',
    }]);
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}><MemoryRouter>
        <ThreadTimelineRows timelineRows={rows} threadRuntimeDisplayStatus="idle" workspaceRootPath={undefined} />
      </MemoryRouter></QueryClientProvider>,
    );
    expect(markup).toContain('aria-label="Уведомление фоновой задачи"');
    expect(markup).toContain("Фоновая задача завершена");
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open");
  });
  it("renders Markdown and user messages without exposing unsupported rewind actions", () => {
    const rows = nativeMessageRows("thread-native", [
      {
        id: "u",
        role: "user",
        text: "User request",
        timestamp: "2026-09-07T10:00:00Z",
      },
      {
        id: "a",
        role: "assistant",
        text: "**Native answer** with `code`",
        timestamp: "2026-09-07T10:00:01Z",
      },
    ]);
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadTimelineRows
            timelineRows={rows}
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
            onForkMessage={vi.fn()}
            onEditMessage={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(markup).toContain("User request");
    expect(markup).toContain("<strong>Native answer</strong>");
    expect(markup).not.toContain("**Native answer**");
    expect(markup).not.toContain('aria-label="Edit message"');
    expect(markup).not.toContain('aria-label="Fork');
  });
});
