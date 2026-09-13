// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskNotificationCard } from "./TaskNotificationCard";
import {
  parseTaskNotification,
  type TaskNotification,
} from "./task-notification";

function taskNotificationBlock({
  taskId = "task-123",
  toolUseId,
  outputFile,
  note,
  result,
  status = "completed",
  summary = "Summary text",
  usage,
}: {
  taskId?: string;
  toolUseId?: string;
  outputFile?: string;
  note?: string;
  result?: string;
  status?: string;
  summary?: string;
  usage?: string;
} = {}): string {
  const fields = [
    `<task-id>${taskId}</task-id>`,
    toolUseId === undefined ? null : `<tool-use-id>${toolUseId}</tool-use-id>`,
    outputFile === undefined
      ? null
      : `<output-file>${outputFile}</output-file>`,
    note === undefined ? null : `<note>${note}</note>`,
    result === undefined ? null : `<result>${result}</result>`,
    `<status>${status}</status>`,
    `<summary>${summary}</summary>`,
    usage === undefined ? null : `<usage>${usage}</usage>`,
  ].filter((field): field is string => field !== null);
  return `<task-notification>\n${fields.join("\n")}\n</task-notification>`;
}

function cardNotification(
  overrides: Partial<TaskNotification> = {},
): TaskNotification {
  return {
    taskId: "task-123",
    toolUseId: "tool-456",
    outputFile: null,
    status: "completed",
    summary: "Summary text",
    exitCode: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("parseTaskNotification", () => {
  it("parses required and optional fields, decodes XML entities, and reads exit code", () => {
    const usage = [
      "<total_tokens>1234</total_tokens>",
      "<tool_uses>144</tool_uses>",
      "<duration_ms>1848275</duration_ms>",
    ].join("");
    const text = taskNotificationBlock({
      toolUseId: "tool-456",
      outputFile: "C:\\workspace\\result.txt",
      note: "&lt;agent note&gt;",
      result: "Agent &amp; output",
      status: "failed",
      summary:
        "Background command &quot;pnpm test&quot; failed; exit code 2; &lt;details&gt;",
      usage,
    });

    expect(parseTaskNotification(text)).toEqual({
      taskId: "task-123",
      toolUseId: "tool-456",
      outputFile: "C:\\workspace\\result.txt",
      note: "<agent note>",
      result: "Agent & output",
      status: "failed",
      summary: 'Background command "pnpm test" failed; exit code 2; <details>',
      exitCode: 2,
    });
    expect(parseTaskNotification(text)).not.toHaveProperty("usage");
  });

  it("omits note and result when their XML tags are absent", () => {
    const parsed = parseTaskNotification(taskNotificationBlock());

    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("note");
    expect(parsed).not.toHaveProperty("result");
  });

  it("accepts task-notification blocks pasted with escaped angle brackets", () => {
    const text = taskNotificationBlock({
      summary: "Pasted block",
    }).replace(/[<>]/g, (character) => `\\${character}`);

    expect(parseTaskNotification(text)).toEqual({
      taskId: "task-123",
      toolUseId: null,
      outputFile: null,
      status: "completed",
      summary: "Pasted block",
      exitCode: null,
    });
  });

  it.each([
    ["surrounding text", `prefix ${taskNotificationBlock()} suffix`],
    [
      "unknown field",
      taskNotificationBlock().replace(
        "<status>",
        "<unknown>value</unknown>\n<status>",
      ),
    ],
    [
      "duplicate field",
      taskNotificationBlock().replace(
        "</status>",
        "</status>\n<status>failed</status>",
      ),
    ],
    [
      "malformed field",
      taskNotificationBlock().replace("</summary>", "</status>"),
    ],
    [
      "missing required field",
      taskNotificationBlock().replace("<summary>Summary text</summary>\n", ""),
    ],
  ])("returns null for %s", (_name, text) => {
    expect(parseTaskNotification(text)).toBeNull();
  });
});

describe("TaskNotificationCard", () => {
  it.each([
    ["completed", "Фоновая задача завершена"],
    ["failed", "Фоновая задача завершилась с ошибкой"],
    ["running", "Фоновая задача выполняется"],
    ["cancelled", "Фоновая задача остановлена"],
  ])("renders the %s status and summary", (status, title) => {
    render(
      <TaskNotificationCard
        notification={cardNotification({ status })}
        originalText="original task notification"
      />,
    );

    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText("Summary text")).toBeTruthy();
  });

  it("renders notification text as plain text and exposes details", () => {
    const unsafeSummary = '<img src=x onerror="window.pwned=1">safe text';
    const originalText = taskNotificationBlock({
      summary: unsafeSummary,
      usage:
        "<total_tokens>1234</total_tokens><tool_uses>144</tool_uses><duration_ms>1848275</duration_ms>",
    });
    const view = render(
      <TaskNotificationCard
        notification={cardNotification({
          taskId: "task-details",
          toolUseId: "tool-details",
          outputFile: "/workspace/result.txt",
          summary: unsafeSummary,
        })}
        originalText={originalText}
      />,
    );

    expect(view.container.querySelector("img, script")).toBeNull();
    expect(view.container.textContent).toContain(unsafeSummary);
    expect(view.container.textContent).toContain("task-details");
    expect(view.container.textContent).toContain("tool-details");
    expect(view.container.textContent).toContain("/workspace/result.txt");
    expect(view.container.textContent).toContain(originalText);
  });

  it.each([true, false])(
    "checks journal on demand and opens only a nonempty file: empty=%s",
    async (empty) => {
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response(empty ? "" : "log entry"));
      const open = vi.fn(() => true);
      render(
        <TaskNotificationCard
          threadId="thread-1"
          notification={cardNotification({
            result: "Actual answer",
            outputFile: "C:\\temp\\task.output",
          })}
          originalText="notification"
          onOpenLocalFileLink={open}
        />,
      );
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText("Подробности"));
      fireEvent.click(screen.getByRole("button", { name: "Открыть журнал" }));
      if (empty) {
        expect((await screen.findByRole("status")).textContent).toContain(
          "Журнал пуст — ответ находится",
        );
        expect(open).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(open).toHaveBeenCalledWith({
            path: "C:\\temp\\task.output",
            lineRange: null,
          }),
        );
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a missing journal without opening a tab and allows retry", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 404 }),
    );
    const open = vi.fn(() => true);
    render(
      <TaskNotificationCard
        threadId="thread-1"
        notification={cardNotification({ outputFile: "C:\\temp\\task.output" })}
        originalText="notification"
        onOpenLocalFileLink={open}
      />,
    );
    fireEvent.click(screen.getByText("Подробности"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть журнал" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Не удалось проверить журнал",
    );
    expect(open).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole("button", { name: "Открыть журнал" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("opens the answer in a separate panel without reading any file", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const open = vi.fn(() => true);
    render(
      <TaskNotificationCard
        threadId="thread-1"
        notification={cardNotification({
          result: "**Actual answer**",
          outputFile: "C:\\temp\\empty.output",
        })}
        originalText="notification"
        onOpenLocalFileLink={open}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Открыть результат" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Ответ подагента",
    });
    await waitFor(() =>
      expect(dialog.querySelector("strong")?.textContent).toBe("Actual answer"),
    );
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Ответ подагента" }),
      ).toBeNull(),
    );
  });

  it("opens the embedded result without reading the output journal", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    const view = render(
      <TaskNotificationCard
        notification={cardNotification({
          result: "Actual agent answer",
          outputFile: "C:\\temp\\empty.output",
        })}
        originalText="original notification"
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );
    const summary = screen.getByText("Результат в чате");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);
    fireEvent.click(summary);
    expect(details?.open).toBe(true);
    expect(details?.textContent).toContain("Actual agent answer");
    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Подробности"));
    fireEvent.click(screen.getByRole("button", { name: "Открыть журнал" }));
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      path: "C:\\temp\\empty.output",
      lineRange: null,
    });
    expect(view.container.querySelectorAll("button")).toHaveLength(2);
  });

  it("shows note in details and result in its own collapsed section as plain text", () => {
    const note = '<img src=x onerror="window.pwned=1">agent note';
    const result = "<script>window.pwned=2</script>agent result";
    const view = render(
      <TaskNotificationCard
        notification={cardNotification({ note, result })}
        originalText="original task notification"
      />,
    );

    const details = Array.from(view.container.querySelectorAll("details"));
    const detailsSection = details.find(
      (item) => item.querySelector("summary")?.textContent === "Подробности",
    );
    const resultSection = details.find(
      (item) =>
        item.querySelector("summary")?.textContent === "Результат в чате",
    );

    expect(detailsSection?.textContent).toContain(note);
    expect(resultSection?.textContent).toContain(result);
    expect(resultSection?.hasAttribute("open")).toBe(false);
    expect(view.container.querySelector("img, script")).toBeNull();
  });

  it("uses the subagent completion title for an Agent-finished summary", () => {
    const view = render(
      <TaskNotificationCard
        notification={cardNotification({
          summary: 'Agent "researcher" finished',
        })}
        originalText="original task notification"
      />,
    );

    expect(view.container.textContent).toContain("Подагент завершил ответ");
  });

  it.each(["C:\\workspace\\result.txt", "/workspace/result.txt"])(
    "opens an absolute local output path only after an explicit click: %s",
    (outputFile) => {
      const onOpenLocalFileLink = vi.fn(() => true);
      render(
        <TaskNotificationCard
          notification={cardNotification({ outputFile })}
          originalText="original task notification"
          onOpenLocalFileLink={onOpenLocalFileLink}
        />,
      );

      fireEvent.click(screen.getByText("Подробности"));
      const button = screen.getByRole("button", {
        name: "Открыть журнал",
      });
      expect(onOpenLocalFileLink).not.toHaveBeenCalled();

      fireEvent.click(button);

      expect(onOpenLocalFileLink).toHaveBeenCalledTimes(1);
      expect(onOpenLocalFileLink).toHaveBeenCalledWith({
        lineRange: null,
        path: outputFile,
      });
    },
  );

  it.each([
    "results/output.txt",
    "file:///workspace/result.txt",
    "https://example.com/result.txt",
  ])("does not offer an output action for non-local path %s", (outputFile) => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <TaskNotificationCard
        notification={cardNotification({ outputFile })}
        originalText="original task notification"
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    expect(screen.queryByRole("button", { name: "Открыть журнал" })).toBeNull();
    expect(onOpenLocalFileLink).not.toHaveBeenCalled();
  });

  it("does not offer an output action without a local-file handler", () => {
    render(
      <TaskNotificationCard
        notification={cardNotification({
          outputFile: "C:\\workspace\\result.txt",
        })}
        originalText="original task notification"
      />,
    );

    expect(screen.queryByRole("button", { name: "Открыть журнал" })).toBeNull();
  });
});
