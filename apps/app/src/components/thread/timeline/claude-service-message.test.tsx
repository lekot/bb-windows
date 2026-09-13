// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeServiceMessageCard } from "./ClaudeServiceMessageCard";
import {
  parseClaudeServiceMessage,
} from "./claude-service-message";
import {
  isNativeServiceMessage,
  parseNativeServiceMessage,
  type NativeServiceMessage,
} from "./native-service-message";
import { nativeMessageRows } from "./native-history-timeline";

const CONTEXT_SUMMARY_PREFIX =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";

function block(tag: string, body: string): string {
  return `<${tag}>${body}</${tag}>`;
}

function contextSummaryText(body: string): string {
  return `${CONTEXT_SUMMARY_PREFIX}\n\nSummary:\n${body}`;
}

function commandSequence(): string {
  return [
    block("local-command-caveat", "Running a local command"),
    block("command-name", "pnpm test"),
    block("command-message", "Running focused tests"),
    block("command-args", "--filter app"),
    block("local-command-stdout", "All focused tests passed"),
  ].join("\n");
}

function taskNotificationText(): string {
  return [
    "<task-notification>",
    "<task-id>task-1</task-id>",
    "<status>completed</status>",
    "<summary>Background task completed</summary>",
    "</task-notification>",
  ].join("\n");
}

afterEach(() => {
  cleanup();
});

describe("parseClaudeServiceMessage", () => {
  it("recognizes a complete local-command sequence", () => {
    const result = parseClaudeServiceMessage(commandSequence());

    expect(result).toEqual(
      expect.objectContaining({
        kind: "local-command",
      }),
    );
    expect(result?.title).toContain("pnpm test");
    expect(result?.body).toContain("All focused tests passed");
  });

  it.each([
    ["a standalone caveat", block("local-command-caveat", "Local caveat")],
    ["standalone stdout", block("local-command-stdout", "stdout text")],
    [
      "command metadata",
      [
        block("command-name", "pnpm test"),
        block("command-message", "Running focused tests"),
        block("command-args", "--filter app"),
      ].join("\n"),
    ],
  ])("recognizes %s", (_label, text) => {
    const result = parseClaudeServiceMessage(text);

    expect(result?.kind).toBe("local-command");
    expect(result?.title).toBeTruthy();
    expect(result?.body).toBeTruthy();
  });

  it("recognizes a complete and truncated ide_opened_file notice", () => {
    const complete = parseClaudeServiceMessage(
      block("ide_opened_file", "C:\\workspace\\src\\app.ts"),
    );
    const truncated = parseClaudeServiceMessage(
      "<ide_opened_file>/workspace/src/app.ts",
    );

    expect(complete).toEqual(
      expect.objectContaining({
        kind: "ide-file",
      }),
    );
    expect(complete?.body).toContain("C:\\workspace\\src\\app.ts");
    expect(truncated).toEqual(
      expect.objectContaining({
        kind: "ide-file",
      }),
    );
    expect(truncated?.body).toContain("/workspace/src/app.ts");
  });

  it("recognizes an anchored previous-context summary and keeps its body", () => {
    const body = "Earlier context with <plain>text</plain>.";
    const result = parseClaudeServiceMessage(contextSummaryText(body));

    expect(result).toEqual({
      kind: "context-summary",
      title: "Сводка предыдущего контекста",
      body,
    });
  });

  it("accepts an API-truncated context summary within the size limit", () => {
    const body = "context ".repeat(2_048);
    const result = parseClaudeServiceMessage(contextSummaryText(body));

    expect(result).toEqual(
      expect.objectContaining({
        kind: "context-summary",
        title: "Сводка предыдущего контекста",
      }),
    );
    expect(result?.body).toBe(body.trim());
  });

  it("tolerates whitespace and a lone backslash between pasted blocks", () => {
    const text = [
      block("local-command-caveat", "Caveat"),
      "\\",
      "\t",
      block("command-name", "pnpm test"),
      "\n\\",
      block("local-command-stdout", "Done"),
    ].join("\n");

    expect(parseClaudeServiceMessage(text)?.kind).toBe("local-command");
  });

  it("accepts escaped angle brackets around service tags", () => {
    const escaped = commandSequence().replace(
      /[<>]/g,
      (character) => `\\${character}`,
    );

    expect(parseClaudeServiceMessage(escaped)?.kind).toBe("local-command");
  });

  it.each([
    ["leading prose", `Before ${block("local-command-stdout", "output")}`],
    ["trailing prose", `${block("local-command-stdout", "output")} after`],
    [
      "unknown block",
      `${block("local-command-stdout", "output")}\n${block("unknown", "text")}`,
    ],
    [
      "duplicate block",
      `${block("local-command-stdout", "one")}\n${block("local-command-stdout", "two")}`,
    ],
    [
      "mixed command and ide notice",
      `${block("command-name", "pnpm test")}\n${block("ide_opened_file", "app.ts")}`,
    ],
    [
      "context prefix after prose",
      `Earlier note: ${contextSummaryText("not a service message")}`,
    ],
    [
      "ordinary user tag mention",
      "Please run <command-name>pnpm test</command-name> when ready.",
    ],
  ])("returns null for %s instead of swallowing prose", (_label, text) => {
    expect(parseClaudeServiceMessage(text)).toBeNull();
  });
});

describe("parseNativeServiceMessage", () => {
  it("renders Codex environment_context wrappers as service records", () => {
    const text =
      '<environment_context>\n<cwd>C:\\Source\\demo</cwd>\n<shell>Git Bash</shell>\n</environment_context>';
    const result = parseNativeServiceMessage(text);
    expect(result).not.toBeNull();
    expect(result?.providerLabel).toBe("Codex");
    expect(isNativeServiceMessage(text)).toBe(true);
  });
  it("keeps ordinary Codex user prose out of the service parser", () => {
    const text = "Проверь <environment_context> в документации, пожалуйста.";
    expect(parseNativeServiceMessage(text)).toBeNull();
    expect(isNativeServiceMessage(text)).toBe(false);
  });
  it("labels Claude records with the Claude provider label", () => {
    const result = parseNativeServiceMessage(
      block("command-name", "pnpm test"),
    );
    expect(result?.providerLabel).toBe("Claude");
  });
});

describe("ClaudeServiceMessageCard", () => {
  it("renders the Claude service heading, message, and collapsed original source without actions", () => {
    const message: NativeServiceMessage = {
      kind: "local-command",
      providerLabel: "Claude",
      title: "pnpm test",
      body: "All focused tests passed",
    };
    const originalText = commandSequence();
    const view = render(
      <ClaudeServiceMessageCard
        message={message}
        originalText={originalText}
      />,
    );

    expect(view.container.textContent).toContain(
      "Claude · служебное сообщение",
    );
    expect(view.container.textContent).toContain("pnpm test");
    expect(view.container.textContent).toContain("All focused tests passed");
    expect(view.container.textContent).toContain(originalText);

    const source = view.container.querySelector("details");
    expect(source).not.toBeNull();
    expect(source?.hasAttribute("open")).toBe(false);
    expect(view.container.querySelector("button, a")).toBeNull();
  });

  it("renders context summaries under a collapsed summary label as plain text", () => {
    const body = '<img src=x onerror="window.pwned=1">earlier context';
    const originalText = contextSummaryText(body);
    const view = render(
      <ClaudeServiceMessageCard
        message={{
          kind: "context-summary",
          providerLabel: "Claude",
          title: "Сводка предыдущего контекста",
          body,
        }}
        originalText={originalText}
      />,
    );

    expect(view.container.textContent).toContain(
      "Claude · служебное сообщение",
    );
    expect(view.container.textContent).toContain(
      "Сводка предыдущего контекста",
    );
    expect(view.container.textContent).toContain(body);
    expect(view.container.textContent).toContain(originalText);
    const summary = Array.from(view.container.querySelectorAll("details")).find(
      (item) =>
        item.querySelector("summary")?.textContent === "Показать сводку",
    );
    expect(summary).not.toBeNull();
    expect(summary?.hasAttribute("open")).toBe(false);
    expect(view.container.querySelector("img, script, button, a")).toBeNull();
  });
});

describe("native service-message projection", () => {
  it.each([
    ["Claude service message", commandSequence()],
    ["task notification", taskNotificationText()],
    ["context summary", contextSummaryText("Earlier context")],
  ])("projects a recognized %s to assistant while preserving raw text", (_label, text) => {
    const [row] = nativeMessageRows("thread-1", [
      {
        id: "native-1",
        role: "user",
        text,
        timestamp: "2026-09-07T00:00:00.000Z",
      },
    ]);

    expect(row).toMatchObject({
      role: "assistant",
      text,
      turnRequest: null,
    });
  });

  it("keeps an ordinary user mention as a user row", () => {
    const text = "Please run <command-name>pnpm test</command-name> when ready.";
    const [row] = nativeMessageRows("thread-1", [
      {
        id: "native-user",
        role: "user",
        text,
        timestamp: "2026-09-07T00:00:00.000Z",
      },
    ]);

    expect(row).toMatchObject({
      role: "user",
      text,
    });
  });
});
