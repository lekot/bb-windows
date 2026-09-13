import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Dirent, Stats } from "node:fs";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
} from "../../command-dispatch-support.js";
import {
  boundedText,
  isRecord,
  nativeHistoryCacheKey,
  nativeHistoryFileIdentity,
  NativeHistoryReadCache,
  numberValue,
  parseNativeHistoryLine,
  readConsistentNativeHistoryFile,
  readJsonlHeadLines,
  readJsonlTailLines,
  stringValue,
  type JsonlRecordExtractors,
  type NativeHistoryMetadata,
} from "./jsonl-core.js";

const CODEX_HEAD_SCAN_BYTES = 256 * 1024;

type NativeHistoryResult = HostDaemonOnlineRpcResult<"host.read_native_history">;
type CodexHistoryCommandInput = {
  before: string | null;
  cwd: string;
  limit: number;
  sessionId: string;
};

interface NativeHistoryContextUsage {
  usedTokens: number;
  observedAt: string | null;
  model: string | null;
  contextWindow: number | null;
}

const rolloutCache = new NativeHistoryReadCache<string>();
const historyCache = new NativeHistoryReadCache<NativeHistoryResult>();

function codexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  if (!configured) return path.join(os.homedir(), ".codex");
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(os.homedir(), configured);
}

async function listDirectories(parent: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => path.join(parent, entry.name));
}

async function listMatchingRollouts(
  directory: string,
  suffix: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(suffix),
    )
    .map((entry) => path.join(directory, entry.name));
}

async function rolloutCandidates(sessionId: string): Promise<string[]> {
  const suffix = `-${sessionId}.jsonl`;
  const home = codexHome();
  const matches: string[] = [];
  const sessionsRoot = path.join(home, "sessions");
  matches.push(...(await listMatchingRollouts(sessionsRoot, suffix)));
  matches.push(
    ...(await listMatchingRollouts(path.join(home, "archived_sessions"), suffix)),
  );
  for (const yearDir of await listDirectories(sessionsRoot)) {
    for (const monthDir of await listDirectories(yearDir)) {
      for (const dayDir of await listDirectories(monthDir)) {
        matches.push(...(await listMatchingRollouts(dayDir, suffix)));
      }
    }
  }
  return matches;
}

function sameDirectoryPath(left: string, right: string): boolean {
  const normalizedLeft = path.normalize(left).replaceAll("/", "\\");
  const normalizedRight = path.normalize(right).replaceAll("/", "\\");
  const trailing = (value: string) =>
    value.length > 3 && value.endsWith("\\") ? value.slice(0, -1) : value;
  return (
    trailing(normalizedLeft).toLowerCase() ===
    trailing(normalizedRight).toLowerCase()
  );
}

async function rolloutMatchesRequest(
  filePath: string,
  command: CodexHistoryCommandInput,
): Promise<boolean> {
  const lines = await readJsonlHeadLines({
    byteCount: CODEX_HEAD_SCAN_BYTES,
    filePath,
  });
  for (const line of lines) {
    const record = parseNativeHistoryLine(line.content);
    if (record === null || record.type !== "session_meta") continue;
    const payload = isRecord(record.payload) ? record.payload : null;
    if (payload === null) return false;
    const id = stringValue(payload.id) ?? stringValue(payload.session_id);
    if (id !== command.sessionId) return false;
    const cwd = stringValue(payload.cwd);
    if (cwd !== null && !sameDirectoryPath(cwd, command.cwd)) return false;
    return true;
  }
  return false;
}

async function findCodexRollout(
  command: CodexHistoryCommandInput,
): Promise<string> {
  const cacheKey = `${command.sessionId}\u0000${path.normalize(command.cwd).toLowerCase()}`;
  const cached = rolloutCache.get(cacheKey);
  if (cached !== undefined) {
    try {
      if (await rolloutMatchesRequest(cached, command)) return cached;
    } catch {
      rolloutCache.forget(cacheKey);
    }
    rolloutCache.forget(cacheKey);
  }
  const candidates = await rolloutCandidates(command.sessionId);
  const stats = await Promise.all(
    candidates.map(async (file) => {
      try {
        return { file, mtimeMs: (await fs.stat(file)).mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  stats.sort((a, b) => (b?.mtimeMs ?? 0) - (a?.mtimeMs ?? 0));
  for (const entry of stats) {
    if (entry === null) continue;
    if (await rolloutMatchesRequest(entry.file, command)) {
      rolloutCache.remember(cacheKey, entry.file);
      return entry.file;
    }
  }
  throw new CommandDispatchError(
    "native_history_missing",
    "Native Codex rollout was not found for this session and cwd",
  );
}

function textFromCodexContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      if (
        item.type !== "input_text" &&
        item.type !== "output_text" &&
        item.type !== "text"
      ) {
        return [];
      }
      const value = stringValue(item.text);
      return value === null ? [] : [value];
    })
    .join("");
  return text.length === 0 ? null : text;
}

const CODEX_SANDBOX_MODES = new Map<string, string>([
  ["danger-full-access", "full"],
  ["workspace-write", "accept-edits"],
]);

function codexPermissionMode(payload: Record<string, unknown>): string | null {
  const sandbox = isRecord(payload.sandbox_policy)
    ? stringValue(payload.sandbox_policy.type)
    : null;
  if (sandbox === null) return null;
  if (
    sandbox === "workspace-write" &&
    stringValue(payload.approvals_reviewer) === "auto_review"
  ) {
    return "auto";
  }
  return CODEX_SANDBOX_MODES.get(sandbox) ?? sandbox;
}

function isInjectedUserRecord(payload: Record<string, unknown>): boolean {
  const passthrough = isRecord(payload.internal_chat_message_metadata_passthrough)
    ? payload.internal_chat_message_metadata_passthrough
    : null;
  const kinds = passthrough === null ? null : passthrough.content_item_kinds;
  if (!Array.isArray(kinds)) return false;
  return !kinds.some(
    (kind) => typeof kind === "string" && kind.startsWith("user."),
  );
}

function codexRecordExtractors(sessionId: string): JsonlRecordExtractors {
  return {
    messageFromRecord(
      record,
      position,
    ): {
      message: NativeHistoryResult["messages"][number] | null;
      truncated: boolean;
    } {
      if (record.type !== "response_item") {
        return { message: null, truncated: false };
      }
      const payload = isRecord(record.payload) ? record.payload : null;
      if (
        payload === null ||
        payload.type !== "message" ||
        (payload.role !== "user" && payload.role !== "assistant")
      ) {
        return { message: null, truncated: false };
      }
      if (payload.role === "user" && isInjectedUserRecord(payload)) {
        return { message: null, truncated: false };
      }
      const id = stringValue(payload.id) ?? `pos:${sessionId}:${position.lineStartOffset}`;
      const text = textFromCodexContent(payload.content);
      if (text === null) {
        return { message: null, truncated: false };
      }
      const bounded = boundedText(text);
      return {
        message: {
          id,
          role: payload.role,
          text: bounded.text,
          timestamp: stringValue(record.timestamp),
        },
        truncated: bounded.truncated,
      };
    },
    metadataFromRecord(record, metadata): NativeHistoryMetadata {
      if (record.type === "turn_context") {
        const payload = isRecord(record.payload) ? record.payload : null;
        const permissionMode =
          metadata.permissionMode ??
          (payload === null ? null : codexPermissionMode(payload));
        const turnModel = payload === null ? null : stringValue(payload.model);
        const model = metadata.model === null ? turnModel : metadata.model;
        if (
          permissionMode !== metadata.permissionMode ||
          model !== metadata.model
        ) {
          return { ...metadata, model, permissionMode };
        }
      }
      if (record.type === "event_msg") {
        const payload = isRecord(record.payload) ? record.payload : null;
        if (payload !== null && payload.type === "thread_settings_applied") {
          const settings = isRecord(payload.thread_settings)
            ? payload.thread_settings
            : null;
          const model =
            settings === null ? null : stringValue(settings.model);
          if (metadata.model === null && model !== null) {
            return { ...metadata, model };
          }
        }
      }
      return metadata;
    },
  };
}

type CodexTokenCountParseResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "usage"; contextUsage: NativeHistoryContextUsage };

function tokenCountUsage(payload: Record<string, unknown>): CodexTokenCountParseResult {
  const info = isRecord(payload.info) ? payload.info : null;
  if (info === null) return { kind: "missing" };
  const usage = isRecord(info.last_token_usage) ? info.last_token_usage : null;
  if (usage === null) return { kind: "missing" };
  const total = numberValue(usage.total_tokens);
  if (usage.total_tokens !== undefined && total === null) return { kind: "invalid" };
  if (total !== null) {
    const contextWindow = numberValue(info.model_context_window);
    return {
      kind: "usage",
      contextUsage: {
        usedTokens: total,
        observedAt: null,
        model: null,
        contextWindow: contextWindow === 0 ? null : contextWindow,
      },
    };
  }
  const values = [usage.input_tokens, usage.output_tokens];
  let usedTokens = 0;
  let hasComponents = false;
  for (const value of values) {
    if (value === undefined) continue;
    hasComponents = true;
    const counted = numberValue(value);
    if (counted === null) return { kind: "invalid" };
    usedTokens += counted;
  }
  if (!hasComponents) return { kind: "missing" };
  const contextWindow = numberValue(info.model_context_window);
  return {
    kind: "usage",
    contextUsage: {
      usedTokens,
      observedAt: null,
      model: null,
      contextWindow: contextWindow === 0 ? null : contextWindow,
    },
  };
}

async function readHeadModel(filePath: string): Promise<string | null> {
  const lines = await readJsonlHeadLines({
    byteCount: CODEX_HEAD_SCAN_BYTES,
    filePath,
  });
  let model: string | null = null;
  for (const line of lines) {
    const record = parseNativeHistoryLine(line.content);
    if (record === null || record.type !== "event_msg") continue;
    const payload = isRecord(record.payload) ? record.payload : null;
    if (payload === null || payload.type !== "thread_settings_applied") continue;
    const settings = isRecord(payload.thread_settings)
      ? payload.thread_settings
      : null;
    const candidate = settings === null ? null : stringValue(settings.model);
    if (candidate !== null) model = candidate;
  }
  return model;
}

async function readLatestCodexContextUsage(args: {
  filePath: string;
  size: number;
}): Promise<{
  changed: boolean;
  contextUsage: NativeHistoryContextUsage | null;
}> {
  const tail = await readJsonlTailLines({
    filePath: args.filePath,
    size: args.size,
  });
  for (let index = tail.lines.length - 1; index >= 0; index -= 1) {
    const line = tail.lines[index];
    if (line === undefined) continue;
    const record = parseNativeHistoryLine(line.content);
    if (record === null || record.type !== "event_msg") continue;
    const payload = isRecord(record.payload) ? record.payload : null;
    if (payload === null || payload.type !== "token_count") continue;
    const parsed = tokenCountUsage(payload);
    if (parsed.kind === "usage") {
      return {
        changed: tail.changed,
        contextUsage: {
          ...parsed.contextUsage,
          observedAt: stringValue(record.timestamp),
        },
      };
    }
    if (parsed.kind === "invalid") {
      return { changed: tail.changed, contextUsage: null };
    }
  }
  return { changed: tail.changed, contextUsage: null };
}

export async function readNativeCodexHistory(
  command: CodexHistoryCommandInput,
): Promise<NativeHistoryResult> {
  if (!path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError(
      "invalid_path",
      "Native history cwd must be absolute",
    );
  }
  const filePath = await findCodexRollout(command);
  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new CommandDispatchError(
        "native_history_missing",
        "Native Codex rollout was not found for this session and cwd",
      );
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CommandDispatchError(
      "native_history_missing",
      "Native Codex rollout was not found for this session and cwd",
    );
  }
  const identity = nativeHistoryFileIdentity(stat);
  const key = nativeHistoryCacheKey({
    before: command.before,
    filePath,
    limit: command.limit,
    revision: identity.revision,
  });
  return historyCache.through(key, async () => {
    const result = await readConsistentNativeHistoryFile({
      before: command.before,
      extractors: codexRecordExtractors(command.sessionId),
      filePath,
      identity,
      limit: command.limit,
      readLatestContextUsage: (contextArgs) =>
        readLatestCodexContextUsage(contextArgs),
      sessionId: command.sessionId,
      size: stat.size,
    });
    if (command.before !== null) return result;
    const headModel = await readHeadModel(filePath);
    const model = result.metadata.model ?? headModel;
    if (model === null) return result;
    return {
      ...result,
      metadata: {
        ...result.metadata,
        model: result.metadata.model ?? model,
      },
      contextUsage:
        result.contextUsage === null
          ? null
          : {
              ...result.contextUsage,
              model: result.contextUsage.model ?? model,
            },
    };
  });
}
