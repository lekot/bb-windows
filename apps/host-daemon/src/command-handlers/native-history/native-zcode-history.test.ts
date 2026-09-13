import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseConnection } from "better-sqlite3";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readNativeZcodeHistory, readNativeZcodeImage } from "./zcode.js";
import { probeNativeHistory } from "./probe-native-history.js";

const SESSION_ID = "sess_a9ec5047-0492-4bc2-b7ba-baeb4867ac23";

let cliDir: string;
let dbFile: string;
let db: DatabaseConnection;
let previousConfigPath: string | undefined;
let messageCounter = 0;
let partCounter = 0;

const DDL = `
CREATE TABLE session (
  id text primary key,
  title text not null,
  directory text not null,
  time_created integer not null,
  time_updated integer not null
);
CREATE TABLE message (
  id text primary key,
  session_id text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);
CREATE TABLE part (
  id text primary key,
  message_id text not null,
  session_id text not null,
  time_created integer not null,
  time_updated integer not null,
  data text not null
);
CREATE INDEX message_session_time_created_id_idx
  on message(session_id, time_created, id);
CREATE INDEX part_message_id_id_idx on part(message_id, id);
`;

function insertSession(args: { title?: string } = {}): void {
  db.prepare(
    "INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
  ).run(SESSION_ID, args.title ?? "Test chat", "C:/tmp", 1786620000000, 1786620900000);
}

function insertMessage(args: {
  data: Record<string, unknown>;
  timeCreated: number;
}): string {
  messageCounter += 1;
  const id = `msg_test${messageCounter.toString().padStart(4, "0")}_${messageCounter}`;
  db.prepare(
    "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
  ).run(id, SESSION_ID, args.timeCreated, args.timeCreated, JSON.stringify(args.data));
  return id;
}

function insertPart(
  messageId: string,
  data: Record<string, unknown>,
): void {
  partCounter += 1;
  db.prepare(
    "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    `part_test${partCounter}`,
    messageId,
    SESSION_ID,
    1786620000000,
    1786620000000,
    JSON.stringify(data),
  );
}

function userMessage(text: string): Record<string, unknown> {
  return {
    role: "user",
    time: { created: 1786620800000 },
    semantics: {
      origin: "real_user",
      kind: "user_prompt",
      uiVisibility: "visible",
      providerVisibility: "visible",
      transcriptVisibility: "visible",
    },
  };
}

function assistantMessage(args: {
  text: string;
  modelId?: string;
  providerId?: string;
  mode?: string;
  tokens?: Record<string, unknown>;
  completed?: number;
}): Record<string, unknown> {
  return {
    role: "assistant",
    time: { created: 1786620810000, completed: args.completed ?? 1786620820000 },
    modelID: args.modelId ?? "GLM-5.3",
    ...(args.providerId === undefined ? {} : { providerID: args.providerId }),
    variant: "max",
    mode: args.mode ?? "yolo",
    ...(args.tokens === undefined ? {} : { tokens: args.tokens }),
    semantics: {
      origin: "agent_runtime",
      kind: "assistant_response",
      uiVisibility: "visible",
      providerVisibility: "visible",
      transcriptVisibility: "visible",
    },
  };
}

function command(args: {
  before?: string | null;
  limit?: number;
} = {}): Parameters<typeof readNativeZcodeHistory>[0] {
  return {
    before: args.before ?? null,
    cwd: "C:/tmp",
    limit: args.limit ?? 20,
    sessionId: SESSION_ID,
  };
}

function recreateDatabase(): void {
  db.close();
  db = new Database(dbFile);
  db.exec(`
    DROP TABLE IF EXISTS part;
    DROP TABLE IF EXISTS message;
    DROP TABLE IF EXISTS session;
  `);
  db.exec(DDL);
}

describe("readNativeZcodeHistory", () => {
  it("preserves image-only messages without embedding image payloads in history", async () => {
    insertSession();
    const messageId = insertMessage({ data: userMessage(""), timeCreated: 1786620800000 });
    for (let index = 0; index < 20; index += 1) {
      insertPart(messageId, { type: "file", mime: "application/pdf", url: "ignored" });
    }
    insertPart(messageId, { type: "file", mime: "image/png", url: "data:image/png;base64,aGVsbG8=" });
    const result = await readNativeZcodeHistory(command());
    expect(result.messages).toEqual([
      expect.objectContaining({ id: messageId, text: "", images: [{ id: "part_test21", mimeType: "image/png" }] }),
    ]);
    expect(JSON.stringify(result.messages)).not.toContain("aGVsbG8=");
    expect(result.nextCursor).toBeNull();
    await expect(readNativeZcodeImage({
      cwd: "C:/tmp", sessionId: SESSION_ID, messageId, attachmentId: "part_test21",
    })).resolves.toEqual({ mimeType: "image/png", base64: "aGVsbG8=" });
  });

  it("binds image reads to the exact session, cwd and visible message", async () => {
    insertSession();
    const messageId = insertMessage({ data: userMessage(""), timeCreated: 1786620800000 });
    const artifactId = "tool-result-5c8fb381-534c-4008-a7b3-54f9a0f9e1d3";
    insertPart(messageId, { type: "file", mime: "image/png", url: `zcode-artifact://${SESSION_ID}/${artifactId}` });
    const artifactDirectory = path.join(cliDir, "artifacts", SESSION_ID);
    await fs.mkdir(artifactDirectory, { recursive: true });
    await fs.writeFile(path.join(artifactDirectory, `prompt-${artifactId}.txt`), "data:image/png;base64,aGVsbG8=");
    const request = { cwd: "C:/tmp", sessionId: SESSION_ID, messageId, attachmentId: `part_test${partCounter}` };
    await expect(readNativeZcodeImage(request)).resolves.toEqual({ mimeType: "image/png", base64: "aGVsbG8=" });
    await expect(readNativeZcodeImage({ ...request, cwd: "C:/other" })).rejects.toThrow("not found");
    await expect(readNativeZcodeImage({ ...request, messageId: "other-message" })).rejects.toThrow("not found");
    await expect(readNativeZcodeImage({ ...request, sessionId: "sess_other" })).rejects.toThrow("not found");
    db.prepare("UPDATE message SET data = ? WHERE id = ?").run(JSON.stringify({ role: "user", semantics: { transcriptVisibility: "hidden" } }), messageId);
    await expect(readNativeZcodeImage(request)).rejects.toThrow("not found");
  });

  beforeAll(async () => {
    cliDir = await fs.mkdtemp(path.join(os.tmpdir(), "zcode-cli-"));
    dbFile = path.join(cliDir, "db", "db.sqlite");
    await fs.mkdir(path.dirname(dbFile), { recursive: true });
    db = new Database(dbFile);
    db.exec(DDL);
    previousConfigPath = process.env.ZCODE_ACP_CONFIG_PATH;
    process.env.ZCODE_ACP_CONFIG_PATH = path.join(cliDir, "config.json");
  });

  afterAll(async () => {
    db.close();
    if (previousConfigPath === undefined) {
      delete process.env.ZCODE_ACP_CONFIG_PATH;
    } else {
      process.env.ZCODE_ACP_CONFIG_PATH = previousConfigPath;
    }
    await fs.rm(cliDir, { force: true, recursive: true });
  });

  beforeEach(() => {
    recreateDatabase();
    messageCounter = 0;
    partCounter = 0;
  });

  it("reads visible prompt and assistant text and skips hidden records", async () => {
    insertSession({ title: "Заголовок чата" });
    const hidden = insertMessage({
      data: {
        role: "user",
        time: { created: 1786620700000 },
        semantics: {
          origin: "real_user",
          kind: "user_prompt",
          transcriptVisibility: "hidden",
        },
      },
      timeCreated: 1786620700000,
    });
    insertPart(hidden, { type: "text", text: "hidden text" });
    const first = insertMessage({ data: userMessage("Привет"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Привет" });
    insertPart(first, { type: "reasoning", text: "не показывать" });
    const second = insertMessage({
      data: assistantMessage({ text: "Ответ" }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "step-start" });
    insertPart(second, { type: "text", text: "Ответ" });
    insertPart(second, { type: "text", text: " продолжение" });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({ role: "user", text: "Привет" });
    expect(result.messages[1]).toMatchObject({
      role: "assistant",
      text: "Ответ продолжение",
      timestamp: new Date(1786620820000).toISOString(),
    });
    expect(result.metadata.title).toBe("Заголовок чата");
  });

  it("reports usage, model and mapped permission mode from the last assistant", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Вопрос"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Вопрос" });
    const second = insertMessage({
      data: assistantMessage({
        text: "Ответ",
        modelId: "GLM-5.3-Flash",
        providerId: "builtin:zai-coding-plan",
        tokens: { input: 900, output: 100, cache: { read: 500, write: 50 } },
      }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.contextUsage).toEqual({
      usedTokens: 1000,
      observedAt: new Date(1786620820000).toISOString(),
      model: "builtin:zai-coding-plan/GLM-5.3-Flash",
      contextWindow: null,
    });
    expect(result.metadata.model).toBe("GLM-5.3-Flash");
    expect(result.metadata.permissionMode).toBe("accept-edits");
  });

  it("counts the current context window, not cache on top of it", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Вопрос"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Вопрос" });
    const second = insertMessage({
      data: assistantMessage({
        text: "Ответ",
        modelId: "GLM-5.3",
        tokens: {
          total: 474030,
          input: 473587,
          output: 443,
          reasoning: 0,
          cache: { read: 472640, write: 0 },
        },
      }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.contextUsage?.usedTokens).toBe(474030);
  });

  it.each([false, true])("distinguishes placeholder zero usage from completed zero: %s", async (completed) => {
    insertSession();
    insertMessage({ data: assistantMessage({ text: "previous", tokens: { input: 900, output: 100 } }), timeCreated: 1786620810000 });
    const pending = assistantMessage({ text: "", tokens: { input: 0, output: 0 } });
    pending.time = completed ? { created: 1786620830000, completed: 1786620840000 } : { created: 1786620830000 };
    insertMessage({ data: pending, timeCreated: 1786620830000 });
    const result = await readNativeZcodeHistory(command());
    expect(result.contextUsage?.usedTokens).toBe(completed ? 0 : 1000);
    expect(result.contextUsage?.observedAt).toBe(new Date(completed ? 1786620840000 : 1786620820000).toISOString());
  });

  it.each(["build", "edit", "plan"])(
    "reports no permission mode for the %s work mode instead of exposing it as permissions",
    async (mode) => {
      insertSession();
      const first = insertMessage({ data: userMessage("Вопрос"), timeCreated: 1786620800000 });
      insertPart(first, { type: "text", text: "Вопрос" });
      const second = insertMessage({
        data: assistantMessage({ text: "Ответ", mode }),
        timeCreated: 1786620810000,
      });
      insertPart(second, { type: "text", text: "Ответ" });

      const result = await readNativeZcodeHistory(command());

      expect(result.metadata.permissionMode).toBeNull();
    },
  );

  it("maps yolo to accept-edits, never to full", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Вопрос"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Вопрос" });
    const second = insertMessage({
      data: assistantMessage({ text: "Ответ", mode: "yolo" }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.metadata.permissionMode).toBe("accept-edits");
  });

  it("shows messages from pre-semantics sessions by role and text", async () => {
    insertSession();
    const legacyUser = insertMessage({
      data: { role: "user", time: { created: 1786620800000 } },
      timeCreated: 1786620800000,
    });
    insertPart(legacyUser, { type: "text", text: "Старый вопрос" });
    const legacyAssistant = insertMessage({
      data: { role: "assistant", time: { created: 1786620810000 } },
      timeCreated: 1786620810000,
    });
    insertPart(legacyAssistant, { type: "text", text: "Старый ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages.map((message) => message.text)).toEqual([
      "Старый вопрос",
      "Старый ответ",
    ]);
  });

  it("strips the leading bb system-instructions prefix and hides synthetic parts", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Инструкции не показывать"), timeCreated: 1786620800000 });
    insertPart(first, {
      type: "text",
      text: "<system_instructions>\nТы работаешь в bb.\n</system_instructions>\n",
    });
    insertPart(first, { type: "text", text: "Инструкции не показывать" });
    insertPart(first, {
      type: "text",
      text: "synthetic part",
      synthetic: true,
    });
    const second = insertMessage({
      data: assistantMessage({ text: "Ответ" }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages.map((message) => message.text)).toEqual([
      "Инструкции не показывать",
      "Ответ",
    ]);
  });

  it("drops a user message that is only the system-instructions prefix", async () => {
    insertSession();
    const onlyPrefix = insertMessage({
      data: userMessage("неважно"),
      timeCreated: 1786620800000,
    });
    insertPart(onlyPrefix, {
      type: "text",
      text: "<system_instructions>только инструкции</system_instructions>",
    });
    const second = insertMessage({
      data: assistantMessage({ text: "Ответ" }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages.map((message) => message.text)).toEqual(["Ответ"]);
  });

  it("returns null usage for malformed token data", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Вопрос"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Вопрос" });
    const second = insertMessage({
      data: assistantMessage({
        text: "Ответ",
        tokens: { input: "many", cache: { read: 5 } },
      }),
      timeCreated: 1786620810000,
    });
    insertPart(second, { type: "text", text: "Ответ" });

    const result = await readNativeZcodeHistory(command());

    expect(result.contextUsage).toBeNull();
    expect(result.metadata.model).toBe("GLM-5.3");
  });

  it("paginates with keyset cursors and invalidates them after compaction", async () => {
    insertSession();
    for (let index = 0; index < 5; index += 1) {
      const id = insertMessage({
        data:
          index % 2 === 0
            ? userMessage(`Сообщение ${index}`)
            : assistantMessage({ text: `Ответ ${index}` }),
        timeCreated: 1786620800000 + index * 1000,
      });
      insertPart(id, {
        type: "text",
        text: index % 2 === 0 ? `Сообщение ${index}` : `Ответ ${index}`,
      });
    }

    const latest = await readNativeZcodeHistory(command({ limit: 2 }));
    expect(latest.messages).toHaveLength(2);
    expect(latest.messages.map((message) => message.text)).toEqual([
      "Ответ 3",
      "Сообщение 4",
    ]);
    expect(latest.nextCursor).not.toBeNull();
    expect(latest.truncated).toBe(true);

    const older = await readNativeZcodeHistory({
      ...command({ limit: 2 }),
      before: latest.nextCursor,
    });
    expect(older.messages.map((message) => message.text)).toEqual([
      "Ответ 1",
      "Сообщение 2",
    ]);
    expect(older.contextUsage).toBeNull();

    db.prepare("DELETE FROM message WHERE time_created <= ?").run(1786620803000);
    db.prepare("DELETE FROM part WHERE message_id NOT IN (SELECT id FROM message)").run();
    await expect(
      readNativeZcodeHistory({ ...command({ limit: 2 }), before: latest.nextCursor }),
    ).rejects.toMatchObject({ code: "native_history_cursor_invalid" });
  });

  it("does not offer an empty page for older synthetic-only records", async () => {
    insertSession();
    const hidden = insertMessage({ data: userMessage("hidden"), timeCreated: 1786620700000 });
    insertPart(hidden, { type: "text", text: "hidden", synthetic: true });
    const first = insertMessage({ data: userMessage("first"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "first" });
    const second = insertMessage({ data: assistantMessage({ text: "second" }), timeCreated: 1786620810000 });
    insertPart(second, { type: "text", text: "second" });
    const result = await readNativeZcodeHistory(command({ limit: 2 }));
    expect(result.messages.map(message => message.text)).toEqual(["first", "second"]);
    expect(result.nextCursor).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it("reports a missing session", async () => {
    await expect(readNativeZcodeHistory(command())).rejects.toMatchObject({
      code: "native_history_missing",
    });
  });

  it("skips messages whose data is not valid JSON", async () => {
    insertSession();
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    ).run("msg_broken", SESSION_ID, 1786620750000, 1786620750000, "{not json");
    const good = insertMessage({ data: userMessage("Привет"), timeCreated: 1786620800000 });
    insertPart(good, { type: "text", text: "Привет" });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text).toBe("Привет");
  });

  it("truncates oversized message text", async () => {
    insertSession();
    const big = insertMessage({
      data: assistantMessage({ text: "ignored" }),
      timeCreated: 1786620810000,
    });
    insertPart(big, { type: "text", text: "y".repeat(40 * 1024) });

    const result = await readNativeZcodeHistory(command());

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.text.length).toBe(16 * 1024);
    expect(result.truncated).toBe(true);
  });

  it("does not return another session's cached page when paging parameters match", async () => {
    insertSession({ title: "Первая сессия" });
    const first = insertMessage({ data: userMessage("Из первой"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Из первой" });

    db.prepare(
      "INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)",
    ).run(
      "sess_b9ec5047-0492-4bc2-b7ba-baeb4867ac99",
      "Вторая сессия",
      "C:/tmp",
      1786620000000,
      1786620900000,
    );
    const secondSessionId = "sess_b9ec5047-0492-4bc2-b7ba-baeb4867ac99";
    messageCounter += 1;
    const secondMessageId = `msg_other_${messageCounter}`;
    db.prepare(
      "INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)",
    ).run(
      secondMessageId,
      secondSessionId,
      1786620800000,
      1786620800000,
      JSON.stringify(userMessage("Из второй")),
    );
    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      `part_other_${messageCounter}`,
      secondMessageId,
      secondSessionId,
      1786620800000,
      1786620800000,
      JSON.stringify({ type: "text", text: "Из второй" }),
    );

    const firstResult = await readNativeZcodeHistory(command({ limit: 1 }));
    const secondResult = await readNativeZcodeHistory({
      ...command({ limit: 1 }),
      sessionId: secondSessionId,
    });

    expect(firstResult.messages[0]?.text).toBe("Из первой");
    expect(firstResult.metadata.title).toBe("Первая сессия");
    expect(secondResult.messages[0]?.text).toBe("Из второй");
    expect(secondResult.metadata.title).toBe("Вторая сессия");
  });

  it("refreshes appended and edited text while the writer retains its WAL", async () => {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    insertSession();
    const first = insertMessage({ data: userMessage("first"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "first" });
    db.pragma("wal_checkpoint(TRUNCATE)");
    const initial = await readNativeZcodeHistory(command());
    const baseStat = await fs.stat(dbFile);

    const second = insertMessage({ data: userMessage("second"), timeCreated: 1786620801000 });
    insertPart(second, { type: "text", text: "second" });
    const appended = await readNativeZcodeHistory(command());
    expect(appended.messages.map((message) => message.text)).toEqual(["first", "second"]);
    expect(appended.revision).not.toBe(initial.revision);

    db.prepare("UPDATE part SET data = ? WHERE message_id = ?").run(
      JSON.stringify({ type: "text", text: "edited" }),
      second,
    );
    const edited = await readNativeZcodeHistory(command());
    expect(edited.messages.map((message) => message.text)).toEqual(["first", "edited"]);
    expect(edited.revision).not.toBe(appended.revision);
    const finalStat = await fs.stat(dbFile);
    expect(finalStat.size).toBe(baseStat.size);
    expect(finalStat.mtimeMs).toBe(baseStat.mtimeMs);
    expect((await fs.stat(`${dbFile}-wal`)).size).toBeGreaterThan(0);
  });

  it("keeps the unread tail signature stable after unrelated database writes", async () => {
    db.pragma("journal_mode = WAL");
    db.pragma("wal_autocheckpoint = 0");
    insertSession();
    const first = insertMessage({ data: userMessage("first"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "first" });
    const probe = () => probeNativeHistory({
      type: "host.probe_native_history",
      items: [{ reader: "zcode-sqlite", cwd: "C:/tmp", sessionId: SESSION_ID }],
    });
    const before = await probe();
    expect(before.items[0]?.status).toBe("ok");
    db.prepare("INSERT INTO session (id, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?)")
      .run("unrelated", "Other chat", "C:/other", 1786620800000, 1786620800000);
    expect(await probe()).toEqual(before);
    db.prepare("UPDATE part SET data = ? WHERE message_id = ?").run(
      JSON.stringify({ type: "text", text: "changed" }), first,
    );
    expect(await probe()).not.toEqual(before);
  });

  it("rejects a session that belongs to a different directory", async () => {
    insertSession();
    const first = insertMessage({ data: userMessage("Привет"), timeCreated: 1786620800000 });
    insertPart(first, { type: "text", text: "Привет" });

    await expect(
      readNativeZcodeHistory({ ...command(), cwd: "C:/other/project" }),
    ).rejects.toMatchObject({ code: "native_history_missing" });
  });
});
