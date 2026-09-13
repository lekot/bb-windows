import fs from "node:fs/promises";
import type * as fsTypes from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import { readNativeClaudeHistory } from "./native-claude-history.js";

const sessionId = "05aaff59-3729-424f-a6a1-6ce58cf2cff3";
const tempDirs: string[] = [];
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;

function projectDirectory(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function transcriptFixture(args: {
  cwd?: string;
  lines: string[];
}): Promise<CommandOf<"host.read_native_claude_history">> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-native-history-"));
  tempDirs.push(root);
  process.env.CLAUDE_CONFIG_DIR = root;
  const cwd = args.cwd ?? "C:/WS/accounting_suite";
  const directory = path.join(root, "projects", projectDirectory(cwd));
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, `${sessionId}.jsonl`),
    args.lines.join("\n"),
    "utf8",
  );
  return {
    type: "host.read_native_claude_history",
    before: null,
    cwd,
    limit: 20,
    sessionId,
  };
}

afterEach(async () => {
  if (originalClaudeConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir;
  }
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) {
      await fs.rm(directory, { force: true, recursive: true });
    }
  }
});

describe("readNativeClaudeHistory", () => {
  it("keeps only complete user and assistant text rows in chronological order", async () => {
    const command = await transcriptFixture({
      lines: [
        JSON.stringify({
          type: "user",
          sessionId,
          uuid: "u-1",
          timestamp: "2026-09-07T00:00:00.000Z",
          customTitle: "Accounting review",
          permissionMode: "acceptEdits",
          message: { role: "user", content: "Review this ledger" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: "a-tools",
          message: {
            role: "assistant",
            model: "claude-fable-5",
            content: [{ type: "tool_use", name: "Read" }],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId,
          uuid: "u-tool-result",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "private output" }],
          },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: "a-sidechain",
          isSidechain: true,
          customTitle: "Do not use this title",
          message: { role: "assistant", content: "hidden" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: "a-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Superseded text" }],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "1bd80348-6b1c-4926-90ba-7ae1d4f495c3",
          customTitle: "Wrong session",
          message: { role: "user", content: "Do not expose this" },
        }),
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: "a-1",
          timestamp: "2026-09-07T00:01:00.000Z",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Ledger is balanced." }],
          },
        }),
        "{\"type\":\"assistant\"",
      ],
    });

    await expect(readNativeClaudeHistory(command)).resolves.toEqual({
      revision: expect.any(String),
      nextCursor: null,
      contextUsage: null,
      messages: [
        {
          id: "u-1",
          role: "user",
          text: "Review this ledger",
          timestamp: "2026-09-07T00:00:00.000Z",
        },
        {
          id: "a-1",
          role: "assistant",
          text: "Ledger is balanced.",
          timestamp: "2026-09-07T00:01:00.000Z",
        },
      ],
      metadata: {
        title: "Accounting review",
        model: "claude-fable-5",
        permissionMode: "acceptEdits",
      },
      truncated: false,
    });
  });

  it("fails clearly when the saved native session has no matching transcript", async () => {
    const command = await transcriptFixture({ lines: [] });
    await fs.rm(
      path.join(
        process.env.CLAUDE_CONFIG_DIR ?? "",
        "projects",
        projectDirectory(command.cwd),
        `${sessionId}.jsonl`,
      ),
    );

    await expect(readNativeClaudeHistory(command)).rejects.toMatchObject({
      code: "native_history_missing",
    } satisfies Partial<CommandDispatchError>);
  });

  it("reads the latest main assistant usage from the bounded tail independently of the message page", async () => {
    const usageRecord = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: "a-usage",
      timestamp: "2026-09-07T08:26:14.293Z",
      message: {
        role: "assistant",
        model: "claude-fable-5-1",
        content: [{ type: "text", text: "Usage-bearing response" }],
        usage: {
          input_tokens: 32,
          cache_read_input_tokens: 492077,
          cache_creation_input_tokens: 701,
        },
      },
    });
    const newerRecords = Array.from({ length: 20 }, (_, index) =>
      JSON.stringify({
        type: "assistant",
        sessionId,
        uuid: `a-newer-${index}`,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `Newer response ${index}` }],
        },
      }),
    );
    const command = await transcriptFixture({
      lines: [usageRecord, ...newerRecords, ""],
    });

    const latest = await readNativeClaudeHistory(command);
    expect(latest.messages).toHaveLength(20);
    expect(latest.messages[0]).toMatchObject({ id: "a-newer-0" });
    expect(latest.contextUsage).toEqual({
      usedTokens: 492810,
      observedAt: "2026-09-07T08:26:14.293Z",
      model: "claude-fable-5-1",
    });

    const older = await readNativeClaudeHistory({
      ...command,
      before: latest.nextCursor,
    });
    expect(older.contextUsage).toBeNull();
  });

  it("uses post-compact tokens instead of preserved old usage and accepts newer samples", async () => {
    const usage = (timestamp: string, tokens: number) => ({
      type: "assistant", sessionId, uuid: timestamp, timestamp,
      message: { role: "assistant", usage: { input_tokens: tokens }, content: [] },
    });
    const boundary = {
      type: "system", subtype: "compact_boundary", sessionId,
      timestamp: "2026-09-08T05:34:49.151Z", compactMetadata: { postTokens: 11251 },
    };
    const old = usage("2026-09-08T05:27:49.898Z", 909814);
    for (const preserved of [false, true]) {
      const fixture = await transcriptFixture({ lines: [
        JSON.stringify(old), JSON.stringify(boundary), ...(preserved ? [JSON.stringify(old)] : []), "",
      ] });
      expect((await readNativeClaudeHistory(fixture)).contextUsage).toEqual({
        usedTokens: 11251, observedAt: boundary.timestamp, model: null,
      });
    }
    const fresh = await transcriptFixture({ lines: [JSON.stringify(boundary), JSON.stringify(usage("2026-09-08T05:35:00.000Z", 12000)), ""] });
    expect((await readNativeClaudeHistory(fresh)).contextUsage?.usedTokens).toBe(12000);
    const missing = await transcriptFixture({ lines: [JSON.stringify(old), JSON.stringify({ ...boundary, compactMetadata: {} }), ""] });
    expect((await readNativeClaudeHistory(missing)).contextUsage).toBeNull();
  });

  it("keeps explicit zero usage and rejects malformed or overflowing usage without using an older sample", async () => {
    const olderUsage = {
      type: "assistant",
      sessionId,
      uuid: "a-older-usage",
      message: {
        role: "assistant",
        usage: { input_tokens: 42 },
      },
    };
    const zero = await transcriptFixture({
      lines: [
        JSON.stringify(olderUsage),
        JSON.stringify({
          ...olderUsage,
          uuid: "a-zero-usage",
          message: {
            ...olderUsage.message,
            usage: { input_tokens: 0, cache_read_input_tokens: 0 },
          },
        }),
        "",
      ],
    });
    await expect(readNativeClaudeHistory(zero)).resolves.toMatchObject({
      contextUsage: { usedTokens: 0, observedAt: null, model: null },
    });

    const malformed = await transcriptFixture({
      lines: [
        JSON.stringify(olderUsage),
        JSON.stringify({
          ...olderUsage,
          uuid: "a-negative-usage",
          message: {
            ...olderUsage.message,
            usage: { input_tokens: -1 },
          },
        }),
        "",
      ],
    });
    await expect(readNativeClaudeHistory(malformed)).resolves.toMatchObject({
      contextUsage: null,
    });

    const overflow = await transcriptFixture({
      lines: [
        JSON.stringify(olderUsage),
        JSON.stringify({
          ...olderUsage,
          uuid: "a-overflow-usage",
          message: {
            ...olderUsage.message,
            usage: {
              input_tokens: Number.MAX_SAFE_INTEGER,
              cache_read_input_tokens: 1,
            },
          },
        }),
        "",
      ],
    });
    await expect(readNativeClaudeHistory(overflow)).resolves.toMatchObject({
      contextUsage: null,
    });
  });

  it("refreshes a cached snapshot only after a partial trailing row is completed", async () => {
    const completedAssistant = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: "a-completed",
      timestamp: "2026-09-07T00:01:00.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed after append" }],
      },
    });
    const partialAssistant = completedAssistant.slice(0, -12);
    const command = await transcriptFixture({
      lines: [
        JSON.stringify({
          type: "user",
          sessionId,
          uuid: "u-cached",
          message: { role: "user", content: "Initial message" },
        }),
        partialAssistant,
      ],
    });
    const transcriptPath = path.join(
      process.env.CLAUDE_CONFIG_DIR ?? "",
      "projects",
      projectDirectory(command.cwd),
      `${sessionId}.jsonl`,
    );

    const initial = await readNativeClaudeHistory(command);
    const cached = await readNativeClaudeHistory(command);
    expect(cached).toEqual(initial);
    expect(initial.messages).toEqual([
      expect.objectContaining({ id: "u-cached", text: "Initial message" }),
    ]);

    await fs.appendFile(
      transcriptPath,
      `${completedAssistant.slice(partialAssistant.length)}\n`,
      "utf8",
    );

    const updated = await readNativeClaudeHistory(command);
    expect(updated.revision).not.toBe(initial.revision);
    expect(updated.messages).toEqual([
      expect.objectContaining({ id: "u-cached", text: "Initial message" }),
      expect.objectContaining({
        id: "a-completed",
        text: "Completed after append",
      }),
    ]);
    expect(
      updated.messages.filter((message) => message.id === "a-completed"),
    ).toHaveLength(1);
  });

  it("pages backward with an append-safe cursor and rejects invalidated cursors", async () => {
    const records = [
      ["u-1", "user", "First"],
      ["a-1", "assistant", "Second"],
      ["u-2", "user", "Third"],
      ["a-2", "assistant", "Fourth"],
    ].map(([uuid, role, text]) =>
      JSON.stringify({
        type: role,
        sessionId,
        uuid,
        message: { role, content: text },
      }),
    );
    const command = await transcriptFixture({ lines: [...records, ""] });
    const transcriptPath = path.join(
      process.env.CLAUDE_CONFIG_DIR ?? "",
      "projects",
      projectDirectory(command.cwd),
      `${sessionId}.jsonl`,
    );
    const latest = await readNativeClaudeHistory({ ...command, limit: 2 });
    expect(latest.messages.map((message) => message.id)).toEqual([
      "u-2",
      "a-2",
    ]);
    expect(latest.nextCursor).not.toBeNull();

    await fs.appendFile(
      transcriptPath,
      `${JSON.stringify({
        type: "user",
        sessionId,
        uuid: "u-appended",
        message: { role: "user", content: "Newer append" },
      })}\n`,
      "utf8",
    );

    const older = await readNativeClaudeHistory({
      ...command,
      before: latest.nextCursor,
      limit: 2,
    });
    expect(older.messages.map((message) => message.id)).toEqual([
      "u-1",
      "a-1",
    ]);
    expect(older.nextCursor).toBeNull();

    await fs.truncate(transcriptPath, 1);
    await expect(
      readNativeClaudeHistory({
        ...command,
        before: latest.nextCursor,
        limit: 2,
      }),
    ).rejects.toMatchObject({ code: "native_history_cursor_invalid" });
  });

  it("keeps a text record crossing the bounded scan boundary reachable", async () => {
    const boundaryRecord = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: "a-boundary",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Boundary message" }],
      },
    });
    const emptyToolRecord = {
      type: "user",
      sessionId,
      uuid: "tool-oversized",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: "" }],
      },
    };
    const scanLimit = 8 * 1024 * 1024;
    const toolLineBytes = scanLimit - 65;
    const emptyToolLine = JSON.stringify(emptyToolRecord);
    const toolLine = JSON.stringify({
      ...emptyToolRecord,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            content: "x".repeat(toolLineBytes - Buffer.byteLength(emptyToolLine)),
          },
        ],
      },
    });
    expect(Buffer.byteLength(toolLine)).toBe(toolLineBytes);

    const command = await transcriptFixture({
      lines: [boundaryRecord, toolLine, ""],
    });
    const latest = await readNativeClaudeHistory(command);
    expect(latest.messages).toEqual([]);
    expect(latest.nextCursor).not.toBeNull();

    const older = await readNativeClaudeHistory({
      ...command,
      before: latest.nextCursor,
    });
    expect(older.messages).toEqual([
      expect.objectContaining({ id: "a-boundary", text: "Boundary message" }),
    ]);
  });

  it("pages past an oversized unterminated tool line", async () => {
    const olderRecord = JSON.stringify({
      type: "user",
      sessionId,
      uuid: "u-before-tool",
      message: { role: "user", content: "Older text remains reachable" },
    });
    const oversizedToolLine = JSON.stringify({
      type: "user",
      sessionId,
      uuid: "tool-unterminated",
      message: {
        role: "user",
        content: [
          { type: "tool_result", content: "x".repeat(8 * 1024 * 1024) },
        ],
      },
    });
    const command = await transcriptFixture({
      lines: [olderRecord, oversizedToolLine],
    });

    const latest = await readNativeClaudeHistory(command);
    expect(latest.messages).toEqual([]);
    expect(latest.nextCursor).not.toBeNull();

    const older = await readNativeClaudeHistory({
      ...command,
      before: latest.nextCursor,
    });
    expect(older.messages).toEqual([
      expect.objectContaining({
        id: "u-before-tool",
        text: "Older text remains reachable",
      }),
    ]);
  });

  it("finds sparse metadata beyond the message page window", async () => {
    const metadataRecord = JSON.stringify({
      type: "user",
      sessionId,
      uuid: "u-meta",
      customTitle: "Sparse session title",
      model: "claude-sonnet-4-5",
      permissionMode: "acceptEdits",
      message: { role: "user", content: "metadata carrier" },
    });
    const fillerLine = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: `a-filler`,
      message: { role: "assistant", content: "f".repeat(200) },
    });
    const fillers: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      fillers.push(JSON.parse(fillerLine.replace('"a-filler"', `"a-filler-${index}"`)) === null ? "" : JSON.stringify({
        type: "assistant",
        sessionId,
        uuid: `a-filler-${index}`,
        message: { role: "assistant", content: "f".repeat(200) },
      }));
    }
    const recentMessages = [
      JSON.stringify({
        type: "user",
        sessionId,
        uuid: "u-recent-1",
        message: { role: "user", content: "Recent one" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        uuid: "a-recent-2",
        message: { role: "assistant", content: "Recent two" },
      }),
    ];
    const command = await transcriptFixture({
      lines: [metadataRecord, ...fillers, ...recentMessages, ""],
    });

    const result = await readNativeClaudeHistory(command);
    expect(result.messages).toHaveLength(20);
    expect(result.messages.at(-1)?.id).toBe("a-recent-2");
    expect(result.messages.at(-2)?.id).toBe("u-recent-1");
    expect(result.metadata.title).toBe("Sparse session title");
    expect(result.metadata.model).toBe("claude-sonnet-4-5");
    expect(result.metadata.permissionMode).toBe("acceptEdits");
  });

  it("fills only missing metadata fields from the tail scan", async () => {
    const oldTitle = JSON.stringify({
      type: "user",
      sessionId,
      uuid: "u-old-title",
      customTitle: "Old title only",
      message: { role: "user", content: "old" },
    });
    const fillers: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      fillers.push(
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: `a-f-${index}`,
          message: { role: "assistant", content: "f".repeat(200) },
        }),
      );
    }
    const recentWithModel = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: "a-recent-model",
      model: "claude-haiku-4",
      message: { role: "assistant", content: "recent model" },
    });
    const command = await transcriptFixture({
      lines: [oldTitle, ...fillers, recentWithModel, ""],
    });

    const result = await readNativeClaudeHistory(command);
    expect(result.metadata.model).toBe("claude-haiku-4");
    expect(result.metadata.title).toBe("Old title only");
  });

  it("rejects metadata from a different session in the tail scan", async () => {
    const otherSessionMetadata = JSON.stringify({
      type: "user",
      sessionId: "other-session-id",
      uuid: "u-other",
      customTitle: "Other session title",
      permissionMode: "bypassPermissions",
      isSidechain: true,
      message: { role: "user", content: "other" },
    });
    const fillers: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      fillers.push(
        JSON.stringify({
          type: "assistant",
          sessionId,
          uuid: `a-fill-${index}`,
          message: { role: "assistant", content: "f".repeat(200) },
        }),
      );
    }
    const command = await transcriptFixture({
      lines: [otherSessionMetadata, ...fillers, ""],
    });

    const result = await readNativeClaudeHistory(command);
    expect(result.metadata.title).toBeNull();
    expect(result.metadata.permissionMode).toBeNull();
  });

  it("older page metadata takes precedence from tail, not from the older page window", async () => {
    const oldMetadata = JSON.stringify({
      type: "user",
      sessionId,
      uuid: "u-old-meta",
      customTitle: "Old page title",
      permissionMode: "acceptEdits",
      message: { role: "user", content: "old metadata" },
    });
    const records: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      records.push(
        JSON.stringify({
          type: "user",
          sessionId,
          uuid: `u-${index}`,
          message: { role: "user", content: `Page message ${index}` },
        }),
      );
    }
    const newMetadata = JSON.stringify({
      type: "assistant",
      sessionId,
      uuid: "a-new-meta",
      customTitle: "Newest title",
      permissionMode: "bypassPermissions",
      message: { role: "assistant", content: "new metadata" },
    });
    const command = await transcriptFixture({
      lines: [oldMetadata, ...records, newMetadata, ""],
    });

    const latest = await readNativeClaudeHistory({ ...command, limit: 2 });
    expect(latest.metadata.title).toBe("Newest title");
    expect(latest.metadata.permissionMode).toBe("bypassPermissions");
    expect(latest.nextCursor).not.toBeNull();

    const older = await readNativeClaudeHistory({
      ...command,
      limit: 2,
      before: latest.nextCursor,
    });
    expect(older.metadata.title).toBe("Newest title");
    expect(older.metadata.permissionMode).toBe("bypassPermissions");
  });

  it("throws when the transcript keeps changing across attempts", async () => {
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId,
        uuid: "u-base",
        message: { role: "user", content: "Base" },
      }),
    ];
    const command = await transcriptFixture({ lines });
    const transcriptPath = path.join(
      process.env.CLAUDE_CONFIG_DIR ?? "",
      "projects",
      projectDirectory(command.cwd),
      `${sessionId}.jsonl`,
    );

    let callCount = 0;
    const originalStat = fs.stat;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(
      async (
        target: fsTypes.PathLike,
        opts?: fsTypes.StatOptions,
      ) => {
        const result = await originalStat(target, opts);
        if (typeof target === "string" && target === transcriptPath) {
          callCount += 1;
          if (callCount > 1) {
            await fs.appendFile(
              transcriptPath,
              `${JSON.stringify({
                type: "user",
                sessionId,
                uuid: `u-injected-${callCount}`,
                message: { role: "user", content: "x".repeat(50) },
              })}\n`,
              "utf8",
            );
          }
        }
        return result;
      },
    );

    try {
      await expect(readNativeClaudeHistory(command)).rejects.toMatchObject({
        code: "native_history_changing",
      });
    } finally {
      statSpy.mockRestore();
    }
  });

  it("does not replace the native model with a synthetic service record", async () => {
    const command = await transcriptFixture({ lines: [
      JSON.stringify({ type: "assistant", sessionId, uuid: "a-real-model", timestamp: "2026-09-08T07:00:00Z", message: { role: "assistant", model: "claude-opus-5", content: "reply", usage: { input_tokens: 120, cache_read_input_tokens: 880 } } }),
      JSON.stringify({ type: "assistant", sessionId, uuid: "a-service", message: { role: "assistant", model: "<synthetic>", content: "service notice", usage: { input_tokens: 0, cache_read_input_tokens: 0 } } }),
      "",
    ] });
    const result = await readNativeClaudeHistory({ ...command, limit: 1 });
    expect(result.metadata.model).toBe("claude-opus-5");
    expect(result.contextUsage).toEqual({ usedTokens: 1000, observedAt: "2026-09-08T07:00:00Z", model: "claude-opus-5" });
    expect(result.messages.at(-1)?.text).toBe("service notice");
  });

  it("retries a single append between page and metadata reads without mixing revisions", async () => {
    const command = await transcriptFixture({ lines: [JSON.stringify({ type: "user", sessionId, uuid: "u-before", permissionMode: "acceptEdits", customTitle: "Before", message: { role: "user", content: "before" } }), ""] });
    const transcriptPath = path.join(process.env.CLAUDE_CONFIG_DIR ?? "", "projects", projectDirectory(command.cwd), `${sessionId}.jsonl`);
    const originalStat = fs.stat;
    let callCount = 0;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async (target: fsTypes.PathLike, opts?: fsTypes.StatOptions) => {
      const result = await originalStat(target, opts);
      if (target === transcriptPath && ++callCount === 3) {
        await fs.appendFile(transcriptPath, `${JSON.stringify({ type: "user", sessionId, uuid: "u-after", permissionMode: "bypassPermissions", customTitle: "After", message: { role: "user", content: "after" } })}\n`);
      }
      return result;
    });
    try {
      const result = await readNativeClaudeHistory(command);
      expect(callCount).toBeGreaterThan(4);
      expect(result.metadata).toMatchObject({ title: "After", permissionMode: "bypassPermissions" });
      expect(result.messages.at(-1)?.text).toBe("after");
    } finally {
      statSpy.mockRestore();
    }
  });
});
