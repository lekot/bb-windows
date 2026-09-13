import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseConnection } from "better-sqlite3";
import type { Stats } from "node:fs";
import { readZcodeImageArtifact, type ZcodeImageArtifact } from "./zcode-artifact.js";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
} from "../../command-dispatch-support.js";
import {
  boundedText,
  isRecord,
  nativeHistoryFileIdentity,
  NativeHistoryReadCache,
  numberValue,
  stringValue,
  MAX_MESSAGE_TEXT_CHARS,
  MAX_RESPONSE_TEXT_CHARS,
  type NativeHistoryFileIdentity,
} from "./jsonl-core.js";

const ZCODE_CURSOR_VERSION = 1;
const ZCODE_SCAN_CHUNK = 100;

type NativeHistoryResult = HostDaemonOnlineRpcResult<"host.read_native_history">;
type NativeHistoryMessage = NativeHistoryResult["messages"][number];
type NativeHistoryContextUsage = NonNullable<
  NativeHistoryResult["contextUsage"]
>;

interface ZcodeHistoryCommandInput {
  before: string | null;
  cwd: string;
  limit: number;
  sessionId: string;
};

interface ZcodeCursor {
  messageId: string;
  sessionId: string;
  timeCreated: number;
  version: number;
}

interface ZcodeMessageRow {
  data: string;
  id: string;
  time_created: number;
}

const historyCache = new NativeHistoryReadCache<NativeHistoryResult>();

const ZCODE_MODES = new Map<string, string>([["yolo", "accept-edits"]]);

function zcodeCliDirectory(): string {
  const configured = process.env.ZCODE_ACP_CONFIG_PATH?.trim();
  if (configured && configured.length > 0) {
    return path.dirname(configured);
  }
  return path.join(os.homedir(), ".zcode", "cli");
}

export function zcodeDbFile(): string {
  return path.join(zcodeCliDirectory(), "db", "db.sqlite");
}

function openZcodeDatabase(file: string): DatabaseConnection {
  try {
    return new Database(file, { fileMustExist: true, readonly: true });
  } catch (error) {
    const code = isRecord(error) && typeof error.code === "string"
      ? error.code
      : null;
    if (code === "SQLITE_CANTOPEN" || code === "ENOENT") {
      throw new CommandDispatchError(
        "native_history_missing",
        "Native ZCode history database was not found for this configuration",
      );
    }
    throw new CommandDispatchError(
      "native_history_unavailable",
      "Native ZCode history database could not be opened",
    );
  }
}

export async function readNativeZcodeImage(command: {
  cwd: string;
  sessionId: string;
  messageId: string;
  attachmentId: string;
}): Promise<ZcodeImageArtifact> {
  const db = openZcodeDatabase(zcodeDbFile());
  let artifactUri: string;
  let mimeType: string;
  try {
    const row = db.prepare(`
      SELECT s.directory, p.data, m.data AS messageData
      FROM part p
      JOIN message m ON m.id = p.message_id AND m.session_id = p.session_id
      JOIN session s ON s.id = p.session_id
      WHERE p.id = ? AND m.id = ? AND s.id = ?
    `).get(command.attachmentId, command.messageId, command.sessionId);
    const missing = () => new CommandDispatchError("native_history_missing", "Native attachment was not found for this session and message");
    if (!isRecord(row) || typeof row.directory !== "string" ||
      path.normalize(row.directory).replaceAll("/", "\\").toLowerCase() !== path.normalize(command.cwd).replaceAll("/", "\\").toLowerCase() ||
      typeof row.data !== "string" || typeof row.messageData !== "string") throw missing();
    let part: unknown;
    let message: unknown;
    try {
      part = JSON.parse(row.data);
      message = JSON.parse(row.messageData);
    } catch { throw missing(); }
    if (visibleZcodeMessage(message) === null || !isRecord(part) || part.type !== "file" ||
      typeof part.url !== "string" || typeof part.mime !== "string" ||
      !/^image\/(png|jpeg|webp|gif)$/.test(part.mime)) throw missing();
    artifactUri = part.url;
    mimeType = part.mime;
  } finally {
    db.close();
  }
  const image = await readZcodeImageArtifact({ cliDirectory: zcodeCliDirectory(), sessionId: command.sessionId, uri: artifactUri });
  if (image.mimeType !== mimeType) throw new CommandDispatchError("native_history_unavailable", "Native attachment media type does not match its record");
  return image;
}

function invalidCursor(message: string): never {
  throw new CommandDispatchError("native_history_cursor_invalid", message);
}

function decodeZcodeCursor(value: string): ZcodeCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) return invalidCursor("Native history cursor is invalid");
    const messageId = stringValue(parsed.messageId);
    const sessionId = stringValue(parsed.sessionId);
    const { timeCreated, version } = parsed;
    if (
      messageId === null ||
      sessionId === null ||
      typeof version !== "number" ||
      version !== ZCODE_CURSOR_VERSION ||
      typeof timeCreated !== "number" ||
      !Number.isSafeInteger(timeCreated)
    ) {
      return invalidCursor("Native history cursor is invalid");
    }
    return { messageId, sessionId, timeCreated, version };
  } catch {
    return invalidCursor("Native history cursor is invalid");
  }
}

function encodeZcodeCursor(args: {
  messageId: string;
  sessionId: string;
  timeCreated: number;
}): string {
  return Buffer.from(
    JSON.stringify({
      messageId: args.messageId,
      sessionId: args.sessionId,
      timeCreated: args.timeCreated,
      version: ZCODE_CURSOR_VERSION,
    }),
  ).toString("base64url");
}

function isoTimestamp(value: unknown): string | null {
  const time = isRecord(value) ? value : null;
  const candidate =
    time !== null
      ? numberValue(time.completed) ?? numberValue(time.created)
      : numberValue(value);
  if (candidate === null) return null;
  const date = new Date(candidate);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function visibleZcodeMessage(data: unknown): {
  role: "user" | "assistant";
  kind: string | null;
  mode: string | null;
  modelId: string | null;
  providerId: string | null;
  tokens: Record<string, unknown> | null;
  time: Record<string, unknown> | null;
} | null {
  if (!isRecord(data)) return null;
  if (data.role !== "user" && data.role !== "assistant") return null;
  const semantics = isRecord(data.semantics) ? data.semantics : null;
  if (semantics !== null) {
    if (semantics.transcriptVisibility !== "visible") return null;
    const kind = stringValue(semantics.kind);
    if (kind === null) return null;
    if (data.role === "user" && kind !== "user_prompt") {
      return null;
    }
    if (data.role === "assistant" && kind !== "assistant_response") {
      return null;
    }
  }
  return {
    role: data.role,
    kind: null,
    mode: stringValue(data.mode),
    modelId: stringValue(data.modelID),
    providerId: stringValue(data.providerID),
    tokens: isRecord(data.tokens) ? data.tokens : null,
    time: isRecord(data.time) ? data.time : null,
  };
}

function zcodeModelReference(message: {
  modelId: string | null;
  providerId: string | null;
}): string | null {
  if (message.modelId === null) return null;
  return message.providerId === null
    ? message.modelId
    : `${message.providerId}/${message.modelId}`;
}

const SYSTEM_INSTRUCTIONS_PREFIX =
  /^<system_instructions>[\s\S]*?<\/system_instructions>\s*/;

function zcodeMessageText(
  db: DatabaseConnection,
  messageId: string,
): { text: string | null; truncated: boolean } {
  const parts = db
    .prepare(
      "SELECT data FROM part WHERE message_id = ? ORDER BY id",
    )
    .all(messageId) as Array<{ data: string }>;
  let text = "";
  for (const part of parts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(part.data);
    } catch {
      continue;
    }
    if (!isRecord(parsed) || parsed.type !== "text") continue;
    if (parsed.synthetic === true) continue;
    const value = stringValue(parsed.text);
    if (value === null) continue;
    text += value;
    if (text.length > MAX_MESSAGE_TEXT_CHARS * 2) break;
  }
  text = text.replace(SYSTEM_INSTRUCTIONS_PREFIX, "");
  if (text.trim().length === 0) return { text: null, truncated: false };
  return boundedText(text);
}

function readZcodePage(
  db: DatabaseConnection,
  command: ZcodeHistoryCommandInput,
): {
  messages: NativeHistoryMessage[];
  nextCursor: string | null;
  payloadTruncated: boolean;
} {
  const anchor =
    command.before === null ? null : decodeZcodeCursor(command.before);
  if (anchor !== null) {
    if (anchor.sessionId !== command.sessionId) {
      return invalidCursor("Native history cursor no longer matches this session");
    }
    const row = db
      .prepare(
        "SELECT time_created FROM message WHERE id = ? AND session_id = ?",
      )
      .get(anchor.messageId, command.sessionId) as
      | { time_created: number }
      | undefined;
    if (row === undefined || row.time_created !== anchor.timeCreated) {
      return invalidCursor("Native history cursor no longer matches this session");
    }
  }

  const selectRows = db.prepare(
    `SELECT id, time_created, data FROM message
      WHERE session_id = ?
        AND (? IS NULL OR time_created < ? OR (time_created = ? AND id < ?))
      ORDER BY time_created DESC, id DESC
      LIMIT ?`,
  );
  const messages: NativeHistoryMessage[] = [];
  const messageIds = new Set<string>();
  let payloadTruncated = false;
  let budgetExceeded = false;
  let hasOlderVisible = false;
  let responseTextChars = 0;
  let scanTime: number | null = anchor === null ? null : anchor.timeCreated;
  let scanId: string | null = anchor === null ? null : anchor.messageId;
  let exhausted = false;

  while (
    !exhausted &&
    !budgetExceeded &&
    !hasOlderVisible &&
    messages.length <= command.limit
  ) {
    const rows = selectRows.all(
      command.sessionId,
      scanTime,
      scanTime,
      scanTime,
      scanId,
      ZCODE_SCAN_CHUNK,
    ) as ZcodeMessageRow[];
    if (rows.length < ZCODE_SCAN_CHUNK) exhausted = true;
    for (const row of rows) {
      scanTime = row.time_created;
      scanId = row.id;
      let data: unknown;
      try {
        data = JSON.parse(row.data);
      } catch {
        continue;
      }
      const visible = visibleZcodeMessage(data);
      if (visible === null) continue;
      if (messageIds.has(row.id)) continue;
      const text = zcodeMessageText(db, row.id);
      const images: NonNullable<NativeHistoryMessage["images"]> = [];
      const imageRows = db.prepare(`
        SELECT id, json_extract(data, '$.mime') AS mime FROM part
        WHERE message_id = ? AND session_id = ?
          AND CASE WHEN json_valid(data) THEN
            json_extract(data, '$.type') = 'file'
            AND json_extract(data, '$.mime') IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
          ELSE 0 END
        ORDER BY id LIMIT 17
      `).all(row.id, command.sessionId);
      for (const image of imageRows) {
        if (!isRecord(image) || typeof image.id !== "string" || image.id.length > 256) continue;
        const mimeType = image.mime;
        if (mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp" || mimeType === "image/gif") images.push({ id: image.id, mimeType });
      }
      if (images.length > 16) { images.length = 16; payloadTruncated = true; }
      if (text.text === null && images.length === 0) continue;
      const messageText = text.text ?? "";
      const messageCost = messageText.length + JSON.stringify(images).length;
      if (messages.length === command.limit) {
        hasOlderVisible = true;
        break;
      }
      payloadTruncated ||= text.truncated;
      if (
        messages.length === command.limit ||
        responseTextChars + messageCost > MAX_RESPONSE_TEXT_CHARS
      ) {
        payloadTruncated = true;
        budgetExceeded =
          responseTextChars + messageCost > MAX_RESPONSE_TEXT_CHARS;
        break;
      }
      messageIds.add(row.id);
      responseTextChars += messageCost;
      messages.push({
        id: row.id,
        role: visible.role,
        text: messageText,
        images,
        timestamp: isoTimestamp(visible.time),
      });
    }
  }

  if (messages.length === 0) {
    return { messages: [], nextCursor: null, payloadTruncated };
  }
  const oldest = messages[messages.length - 1];
  const oldestRow = db
    .prepare("SELECT time_created FROM message WHERE id = ?")
    .get(oldest.id) as { time_created: number } | undefined;
  if (oldestRow === undefined) {
    return invalidCursor("Native history changed while it was being read");
  }
  const hasOlder = hasOlderVisible || budgetExceeded;
  const nextCursor = hasOlder
    ? encodeZcodeCursor({
        messageId: oldest.id,
        sessionId: command.sessionId,
        timeCreated: oldestRow.time_created,
      })
    : null;
  return {
    messages: messages.reverse(),
    nextCursor,
    payloadTruncated: payloadTruncated || nextCursor !== null,
  };
}

function zcodeUsageFromTokens(
  tokens: Record<string, unknown>,
): { kind: "missing" } | { kind: "invalid" } | { kind: "usage"; usedTokens: number } {
  const input = tokens.input;
  if (input === undefined) return { kind: "missing" };
  const inputTokens = numberValue(input);
  if (inputTokens === null) return { kind: "invalid" };
  const output = tokens.output;
  const outputTokens =
    output === undefined ? 0 : numberValue(output);
  if (outputTokens === null) return { kind: "invalid" };
  return { kind: "usage", usedTokens: inputTokens + outputTokens };
}

function readZcodeUsageAndMetadata(
  db: DatabaseConnection,
  sessionId: string,
  title: string | null,
): {
  contextUsage: NativeHistoryContextUsage | null;
  metadata: NativeHistoryResult["metadata"];
} {
  const rows = db
    .prepare(
      `SELECT data FROM message
        WHERE session_id = ?
        ORDER BY time_created DESC, id DESC
        LIMIT 100`,
    )
    .all(sessionId) as Array<{ data: string }>;
  let model: string | null = null;
  let permissionMode: string | null = null;
  for (const row of rows) {
    let data: unknown;
    try {
      data = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (!isRecord(data) || data.role !== "assistant") continue;
    const visible = visibleZcodeMessage(data);
    if (visible === null) continue;
    if (model === null) model = visible.modelId;
    if (permissionMode === null && visible.mode !== null) {
      permissionMode = ZCODE_MODES.get(visible.mode) ?? null;
    }
    if (visible.tokens === null) continue;
    const parsed = zcodeUsageFromTokens(visible.tokens);
    if (parsed.kind === "missing") continue;
    if (parsed.kind === "invalid") {
      return {
        contextUsage: null,
        metadata: { title, model, permissionMode },
      };
    }
    if (parsed.usedTokens === 0 && numberValue(visible.time?.completed) === null) continue;
    return {
      contextUsage: {
        usedTokens: parsed.usedTokens,
        observedAt: isoTimestamp(visible.time),
        model: zcodeModelReference(visible),
        contextWindow: null,
      },
      metadata: { title, model, permissionMode },
    };
  }
  return { contextUsage: null, metadata: { title, model, permissionMode } };
}

export async function readNativeZcodeHistory(
  command: ZcodeHistoryCommandInput,
): Promise<NativeHistoryResult> {
  if (!path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError(
      "invalid_path",
      "Native history cwd must be absolute",
    );
  }
  const file = zcodeDbFile();
  let stat: Stats;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new CommandDispatchError(
        "native_history_missing",
        "Native ZCode history database was not found for this configuration",
      );
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CommandDispatchError(
      "native_history_missing",
      "Native ZCode history database was not found for this configuration",
    );
  }
  const db = openZcodeDatabase(file);
  const dataVersion = readZcodeDataVersion(db);
  const walIdentity = await zcodeWalIdentity(file);
  const identity = zcodeHistoryIdentity(stat, walIdentity, dataVersion);
  const key = [
    file,
    identity.revision,
    command.sessionId,
    path.normalize(command.cwd).toLowerCase(),
    command.before ?? "latest",
    command.limit,
  ].join("\u0000");
  const cached = historyCache.get(key);
  if (cached !== undefined) {
    db.close();
    return cached;
  }
  try {
    return await historyCache.through(key, async () => {
      const readSnapshot = db.transaction((): NativeHistoryResult => {
        const session = db
          .prepare("SELECT title, directory FROM session WHERE id = ?")
          .get(command.sessionId) as
          | { title: string | null; directory: string }
          | undefined;
        if (session === undefined) {
          throw new CommandDispatchError(
            "native_history_missing",
            "Native ZCode session was not found in the history database",
          );
        }
        if (
          session.directory.replaceAll("/", "\\").toLowerCase() !==
          path.normalize(command.cwd).replaceAll("/", "\\").toLowerCase()
        ) {
          throw new CommandDispatchError(
            "native_history_missing",
            "Native ZCode session belongs to a different directory",
          );
        }
        const page = readZcodePage(db, command);
        if (command.before !== null) {
          return {
            contextUsage: null,
            metadata: {
              title: stringValue(session.title),
              model: null,
              permissionMode: null,
            },
            messages: page.messages,
            nextCursor: page.nextCursor,
            revision: identity.revision,
            truncated: page.payloadTruncated,
          };
        }
        const usage = readZcodeUsageAndMetadata(
          db,
          command.sessionId,
          stringValue(session.title),
        );
        return {
          contextUsage: usage.contextUsage,
          metadata: usage.metadata,
          messages: page.messages,
          nextCursor: page.nextCursor,
          revision: identity.revision,
          truncated: page.payloadTruncated,
        };
      });
      return readSnapshot();
    });
  } finally {
    db.close();
  }
}

function readZcodeDataVersion(db: DatabaseConnection): number {
  const row = db.pragma("data_version", { simple: true });
  return typeof row === "number" ? row : 0;
}

async function zcodeWalIdentity(file: string): Promise<string> {
  try {
    const stat = await fs.stat(`${file}-wal`);
    return nativeHistoryFileIdentity(stat).revision;
  } catch {
    return "no-wal";
  }
}

function zcodeHistoryIdentity(
  stat: Stats,
  walIdentity: string,
  dataVersion: number,
): NativeHistoryFileIdentity {
  const base = nativeHistoryFileIdentity(stat);
  return {
    fileId: base.fileId,
    revision: [base.revision, walIdentity, dataVersion].join(":"),
  };
}
