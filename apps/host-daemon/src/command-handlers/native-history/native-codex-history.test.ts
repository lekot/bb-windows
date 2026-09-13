import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readNativeCodexHistory } from "./codex.js";

const SESSION_ID = "01a07723-6432-7731-a5e9-5ce0affd6677";

let codexHome: string;
let projectDir: string;
let previousCodexHome: string | undefined;

function rolloutLine(record: Record<string, unknown>): string {
  return `${JSON.stringify(record)}\n`;
}

function messageItem(args: {
  id: string;
  role: string;
  text: string;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    timestamp: args.timestamp ?? "2026-09-06T14:33:27.166Z",
    ordinal: 1,
    type: "response_item",
    payload: {
      type: "message",
      id: args.id,
      role: args.role,
      content: [
        {
          type: args.role === "assistant" ? "output_text" : "input_text",
          text: args.text,
        },
      ],
    },
  };
}

function tokenCountEvent(args: {
  input?: number;
  cached?: number;
  cacheWrite?: number;
  window?: number;
  timestamp?: string;
}): Record<string, unknown> {
  return {
    timestamp: args.timestamp ?? "2026-09-06T14:40:00.000Z",
    ordinal: 2,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: args.input ?? 22003,
          cached_input_tokens: args.cached ?? 0,
          cache_write_input_tokens: args.cacheWrite ?? 0,
          output_tokens: 246,
          total_tokens: 22249,
        },
        model_context_window: args.window ?? 258400,
      },
    },
  };
}

async function writeRollout(lines: string[]): Promise<string> {
  const dayDir = path.join(codexHome, "sessions", "2026", "09", "06");
  await fs.mkdir(dayDir, { recursive: true });
  const file = path.join(
    dayDir,
    `rollout-2026-09-06T21-33-23-${SESSION_ID}.jsonl`,
  );
  await fs.writeFile(file, lines.map((line) => line.trim()).join("\n") + "\n");
  return file;
}

function sessionMeta(cwd: string): Record<string, unknown> {
  return {
    timestamp: "2026-09-06T14:33:23.000Z",
    ordinal: 0,
    type: "session_meta",
    payload: {
      id: SESSION_ID,
      cwd,
      originator: "Codex Desktop",
      cli_version: "0.153.2",
      source: "vscode",
    },
  };
}

function threadSettingsApplied(model: string): Record<string, unknown> {
  return {
    timestamp: "2026-09-06T14:33:24.000Z",
    ordinal: 0,
    type: "event_msg",
    payload: {
      type: "thread_settings_applied",
      thread_id: SESSION_ID,
      thread_settings: {
        model,
        model_provider_id: "openai",
        approval_policy: "on-request",
      },
    },
  };
}

function turnContext(sandboxType: string): Record<string, unknown> {
  return {
    timestamp: "2026-09-06T14:33:26.000Z",
    ordinal: 0,
    type: "turn_context",
    payload: {
      turn_id: "01a07723-651c-7df2-a2d5-19bd536d5c3e",
      cwd: projectDir,
      approval_policy: "on-request",
      sandbox_policy: { type: sandboxType },
    },
  };
}

describe("readNativeCodexHistory", () => {
  beforeAll(async () => {
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-project-"));
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
  });

  afterAll(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(codexHome, { force: true, recursive: true });
    await fs.rm(projectDir, { force: true, recursive: true });
  });

  beforeEach(async () => {
    await fs.rm(path.join(codexHome, "sessions"), {
      force: true,
      recursive: true,
    });
  });

  it("reads visible user and assistant messages and skips service roles", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(threadSettingsApplied("gpt-5.6-luna")),
      rolloutLine(turnContext("workspace-write")),
      rolloutLine(
        messageItem({ id: "msg_developer", role: "developer", text: "instructions" }),
      ),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Run the checks" })),
      rolloutLine({
        timestamp: "2026-09-06T14:34:00.000Z",
        ordinal: 3,
        type: "response_item",
        payload: { type: "reasoning", summary: [] },
      }),
      rolloutLine(
        messageItem({ id: "msg_a1", role: "assistant", text: "All checks pass" }),
      ),
      rolloutLine(tokenCountEvent({})),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.messages.map((message) => message.id)).toEqual([
      "msg_u1",
      "msg_a1",
    ]);
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      text: "All checks pass",
    });
    expect(result.metadata.model).toBe("gpt-5.6-luna");
    expect(result.metadata.permissionMode).toBe("accept-edits");
    expect(result.contextUsage).toMatchObject({
      usedTokens: 22249,
      contextWindow: 258400,
      model: "gpt-5.6-luna",
    });
    expect(result.nextCursor).not.toBeNull();
    const older = await readNativeCodexHistory({
      before: result.nextCursor,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });
    expect(older.messages).toEqual([]);
    expect(older.nextCursor).toBeNull();
  });

  it("maps danger-full-access to the full permission mode", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(turnContext("danger-full-access")),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.metadata.permissionMode).toBe("full");
  });

  it("keeps unknown sandbox types informational", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(turnContext("read-only")),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.metadata.permissionMode).toBe("read-only");
  });

  it("paginates backward with stable cursors and tolerates appends", async () => {
    const lines = [rolloutLine(sessionMeta(projectDir))];
    for (let index = 0; index < 6; index += 1) {
      lines.push(
        rolloutLine(
          messageItem({
            id: `msg_${index}`,
            role: index % 2 === 0 ? "user" : "assistant",
            text: `Message ${index}`,
            timestamp: `2026-09-06T15:0${index}:00.000Z`,
          }),
        ),
      );
    }
    await writeRollout(lines);

    const latest = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    expect(latest.messages.map((message) => message.id)).toEqual([
      "msg_4",
      "msg_5",
    ]);
    expect(latest.nextCursor).not.toBeNull();

    const older = await readNativeCodexHistory({
      before: latest.nextCursor,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    expect(older.messages.map((message) => message.id)).toEqual([
      "msg_2",
      "msg_3",
    ]);
    expect(older.contextUsage).toBeNull();

    const appended = [
      ...lines,
      rolloutLine(
        messageItem({
          id: "msg_6",
          role: "user",
          text: "Newer append",
          timestamp: "2026-09-06T16:00:00.000Z",
        }),
      ),
    ];
    await writeRollout(appended);
    const olderAfterAppend = await readNativeCodexHistory({
      before: latest.nextCursor,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    expect(olderAfterAppend.messages.map((message) => message.id)).toEqual([
      "msg_2",
      "msg_3",
    ]);
  });

  it("rejects a rollout from another project directory", async () => {
    await writeRollout([
      rolloutLine(sessionMeta("C:\\ somewhere-else")),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
    ]);

    await expect(
      readNativeCodexHistory({
        before: null,
        cwd: projectDir,
        limit: 20,
        sessionId: SESSION_ID,
      }),
    ).rejects.toMatchObject({ code: "native_history_missing" });
  });

  it("returns null usage when the latest token count is malformed", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
      rolloutLine({
        timestamp: "2026-09-06T15:00:00.000Z",
        ordinal: 9,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: -5,
              cached_input_tokens: 0,
            },
          },
        },
      }),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.contextUsage).toBeNull();
  });

  it("truncates oversized message text", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(
        messageItem({
          id: "msg_big",
          role: "assistant",
          text: "x".repeat(40 * 1024),
        }),
      ),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text.length).toBe(16 * 1024);
    expect(result.truncated).toBe(true);
  });

  it("throws invalid_path for a relative cwd", async () => {
    await expect(
      readNativeCodexHistory({
        before: null,
        cwd: "relative/path",
        limit: 20,
        sessionId: SESSION_ID,
      }),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("assigns stable position-based ids to messages without payload.id", async () => {
    const messageWithoutId = (role: string, text: string): Record<string, unknown> => ({
      timestamp: "2026-09-06T14:33:27.166Z",
      ordinal: 1,
      type: "response_item",
      payload: { type: "message", role, content: [{ type: "input_text", text }] },
    });
    const lines = [rolloutLine(sessionMeta(projectDir))];
    for (let index = 0; index < 4; index += 1) {
      lines.push(
        rolloutLine(
          messageWithoutId(
            index % 2 === 0 ? "user" : "assistant",
            "одинаковый текст",
          ),
        ),
      );
    }
    const file = await writeRollout(lines);

    const latest = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    expect(latest.messages).toHaveLength(2);
    const latestIds = latest.messages.map((message) => message.id);
    expect(new Set(latestIds).size).toBe(2);
    for (const id of latestIds) {
      expect(id.startsWith(`pos:${SESSION_ID}:`)).toBe(true);
    }

    const older = await readNativeCodexHistory({
      before: latest.nextCursor,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    const olderIds = older.messages.map((message) => message.id);
    expect(new Set(olderIds).size).toBe(2);
    expect(latestIds.some((id) => olderIds.includes(id))).toBe(false);

    const appended = [
      ...lines,
      rolloutLine(messageWithoutId("user", "новое сообщение")),
    ];
    await fs.writeFile(
      file,
      appended.map((line) => line.trim()).join("\n") + "\n",
    );
    const olderAfterAppend = await readNativeCodexHistory({
      before: latest.nextCursor,
      cwd: projectDir,
      limit: 2,
      sessionId: SESSION_ID,
    });
    expect(olderAfterAppend.messages.map((message) => message.id)).toEqual(
      olderIds,
    );
  });

  it.each([22249, 0])("prefers explicit total_tokens %s for the context sample", async (totalTokens) => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
      rolloutLine({
        timestamp: "2026-09-06T15:00:00.000Z",
        ordinal: 9,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 22003,
              cached_input_tokens: 500,
              cache_write_input_tokens: 0,
              output_tokens: 246,
              reasoning_output_tokens: 33,
              total_tokens: totalTokens,
            },
            model_context_window: 258400,
          },
        },
      }),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.contextUsage).toMatchObject({
      usedTokens: totalTokens,
      contextWindow: 258400,
    });
  });

  it("uses input plus output without counting cached or reasoning subsets twice", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
      rolloutLine({
        timestamp: "2026-09-06T15:00:00.000Z",
        ordinal: 9,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 1000,
              output_tokens: 70,
              reasoning_output_tokens: 30,
              cached_input_tokens: 200,
              cache_write_input_tokens: 50,
            },
          },
        },
      }),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.contextUsage).toMatchObject({
      usedTokens: 1070,
      contextWindow: null,
    });
  });

  it("reads the model from turn_context when settings were never applied", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine({
        timestamp: "2026-09-06T14:33:26.000Z",
        ordinal: 0,
        type: "turn_context",
        payload: {
          turn_id: "01a07723-651c-7df2-a2d5-19bd536d5c3e",
          cwd: projectDir,
          model: "gpt-5.3",
          approval_policy: "on-request",
          sandbox_policy: { type: "workspace-write" },
        },
      }),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "Go" })),
      rolloutLine(tokenCountEvent({})),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.metadata.model).toBe("gpt-5.3");
    expect(result.contextUsage?.model).toBe("gpt-5.3");
  });
  it("keeps real prompts with attachments and hides injected context, not just service roles", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(turnContext("workspace-write")),
      rolloutLine({
        timestamp: "2026-09-06T14:33:27.000Z",
        ordinal: 1,
        type: "response_item",
        payload: {
          type: "message",
          id: "msg_env",
          role: "user",
          content: [{ type: "input_text", text: "<environment_context><cwd>x</cwd></environment_context>" }],
          internal_chat_message_metadata_passthrough: {
            turn_id: "turn-1",
            content_item_kinds: ["plugins.recommendations", "environments.environment_context"],
          },
        },
      }),
      rolloutLine(
        messageItem({ id: "msg_legacy", role: "user", text: "Legacy prompt without metadata" }),
      ),
      rolloutLine({
        timestamp: "2026-09-06T14:33:28.000Z",
        ordinal: 2,
        type: "response_item",
        payload: {
          type: "message",
          id: "msg_real",
          role: "user",
          content: [
            { type: "input_text", text: "Describe this picture" },
            { type: "input_image", image_url: "data:image/png;base64,AAAA" },
          ],
          internal_chat_message_metadata_passthrough: {
            turn_id: "turn-2",
            content_item_kinds: ["user.text", "user.image"],
          },
        },
      }),
      rolloutLine(messageItem({ id: "msg_a1", role: "assistant", text: "A cat" })),
      rolloutLine({
        timestamp: "2026-09-06T14:33:29.000Z",
        ordinal: 3,
        type: "response_item",
        payload: {
          type: "message",
          id: "msg_abort",
          role: "user",
          content: [{ type: "input_text", text: "<turn_aborted>The user interrupted</turn_aborted>" }],
          internal_chat_message_metadata_passthrough: {
            turn_id: "turn-3",
            content_item_kinds: ["generic.turn_aborted"],
          },
        },
      }),
      rolloutLine(tokenCountEvent({})),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.messages.map((message) => message.id)).toEqual([
      "msg_legacy",
      "msg_real",
      "msg_a1",
    ]);
    expect(result.messages[1]).toMatchObject({
      role: "user",
      text: "Describe this picture",
    });
  });

  it("reports the latest turn model and distinguishes auto review from user approval", async () => {
    await writeRollout([
      rolloutLine(sessionMeta(projectDir)),
      rolloutLine(threadSettingsApplied("gpt-5.3")),
      rolloutLine({
        timestamp: "2026-09-06T14:33:26.000Z",
        ordinal: 0,
        type: "turn_context",
        payload: {
          turn_id: "turn-1",
          cwd: projectDir,
          model: "gpt-5.3",
          approval_policy: "on-request",
          approvals_reviewer: "user",
          sandbox_policy: { type: "workspace-write" },
        },
      }),
      rolloutLine(messageItem({ id: "msg_u1", role: "user", text: "First" })),
      rolloutLine({
        timestamp: "2026-09-06T14:35:00.000Z",
        ordinal: 0,
        type: "turn_context",
        payload: {
          turn_id: "turn-2",
          cwd: projectDir,
          model: "gpt-5.6-luna",
          approval_policy: "on-request",
          approvals_reviewer: "auto_review",
          sandbox_policy: { type: "workspace-write" },
        },
      }),
      rolloutLine(
        messageItem({ id: "msg_u2", role: "user", text: "Second", timestamp: "2026-09-06T14:35:01.000Z" }),
      ),
      rolloutLine(tokenCountEvent({})),
    ]);

    const result = await readNativeCodexHistory({
      before: null,
      cwd: projectDir,
      limit: 20,
      sessionId: SESSION_ID,
    });

    expect(result.metadata.model).toBe("gpt-5.6-luna");
    expect(result.metadata.permissionMode).toBe("auto");
    expect(result.contextUsage?.model).toBe("gpt-5.6-luna");
  });
});
