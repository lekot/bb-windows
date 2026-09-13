import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Stats } from "node:fs";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../command-dispatch-support.js";
import {
  boundedText,
  isRecord,
  nativeHistoryCacheKey,
  nativeHistoryFileIdentity,
  NativeHistoryReadCache,
  parseNativeHistoryLine,
  readConsistentNativeHistoryFile,
  readJsonlTailLines,
  stringValue,
  type JsonlRecordExtractors,
  type NativeHistoryMessage,
  type NativeHistoryMetadata,
} from "./native-history/jsonl-core.js";

type NativeClaudeHistoryCommand = CommandOf<
  "host.read_native_claude_history"
>;
type NativeClaudeHistoryResult = HostDaemonOnlineRpcResult<
  "host.read_native_claude_history"
>;

interface NativeClaudeContextUsage {
  usedTokens: number;
  observedAt: string | null;
  model: string | null;
}

type NativeClaudeContextUsageParseResult =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "usage"; contextUsage: NativeClaudeContextUsage };

const historyCache = new NativeHistoryReadCache<NativeClaudeHistoryResult>();

function nativeClaudeDirectory(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) return path.join(os.homedir(), ".claude");
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(os.homedir(), configured);
}

function nativeClaudeProjectDirectoryName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function nativeClaudeTranscriptPath(command: NativeClaudeHistoryCommand): string {
  if (!path.isAbsolute(command.cwd)) {
    throw new CommandDispatchError(
      "invalid_path",
      "Native history cwd must be absolute",
    );
  }
  return path.join(
    nativeClaudeDirectory(),
    "projects",
    nativeClaudeProjectDirectoryName(command.cwd),
    `${command.sessionId}.jsonl`,
  );
}

function recordBelongsToSession(
  record: Record<string, unknown>,
  sessionId: string,
): boolean {
  return record.isSidechain !== true && record.sessionId === sessionId;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((item) => {
      if (!isRecord(item) || item.type !== "text") return [];
      const value = stringValue(item.text);
      return value === null ? [] : [value];
    })
    .join("");
  return text.length === 0 ? null : text;
}

function claudeRecordExtractors(sessionId: string): JsonlRecordExtractors {
  return {
    messageFromRecord(
      record,
    ): {
      message: NativeHistoryMessage | null;
      truncated: boolean;
    } {
      if (
        !recordBelongsToSession(record, sessionId) ||
        (record.type !== "user" && record.type !== "assistant")
      ) {
        return { message: null, truncated: false };
      }
      const message = isRecord(record.message) ? record.message : null;
      if (message === null || message.role !== record.type) {
        return { message: null, truncated: false };
      }
      const text = textFromContent(message.content);
      const id = stringValue(record.uuid) ?? stringValue(message.id);
      if (text === null || id === null) {
        return { message: null, truncated: false };
      }
      const bounded = boundedText(text);
      return {
        message: {
          id,
          role: record.type,
          text: bounded.text,
          timestamp: stringValue(record.timestamp),
        },
        truncated: bounded.truncated,
      };
    },
    metadataFromRecord(record, metadata) {
      if (!recordBelongsToSession(record, sessionId)) return metadata;
      const message = isRecord(record.message) ? record.message : null;
      return {
        title:
          metadata.title ??
          stringValue(record.customTitle) ??
          stringValue(record.title),
        model:
          metadata.model ??
          nativeModelValue(record.model) ??
          (message === null ? null : nativeModelValue(message.model)),
        permissionMode:
          metadata.permissionMode ?? stringValue(record.permissionMode),
      };
    },
  };
}

function contextUsageFromRecord(
  record: Record<string, unknown>,
  sessionId: string,
): NativeClaudeContextUsageParseResult {
  if (!recordBelongsToSession(record, sessionId) || record.type !== "assistant") {
    return { kind: "missing" };
  }
  const message = isRecord(record.message) ? record.message : null;
  if (message === null || message.role !== "assistant") {
    return { kind: "missing" };
  }
  if (record.model === "<synthetic>" || message.model === "<synthetic>") {
    return { kind: "missing" };
  }
  const usage = isRecord(message.usage)
    ? message.usage
    : isRecord(record.usage)
      ? record.usage
      : null;
  if (usage === null) return { kind: "missing" };
  const values = [
    usage.input_tokens,
    usage.cache_read_input_tokens,
    usage.cache_creation_input_tokens,
  ];
  let hasUsage = false;
  let usedTokens = 0;
  for (const value of values) {
    if (value === undefined) continue;
    hasUsage = true;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      return { kind: "invalid" };
    }
    usedTokens += value;
    if (!Number.isSafeInteger(usedTokens)) return { kind: "invalid" };
  }
  if (!hasUsage) return { kind: "missing" };
  return {
    kind: "usage",
    contextUsage: {
      usedTokens,
      observedAt: stringValue(record.timestamp),
      model: stringValue(record.model) ?? stringValue(message.model),
    },
  };
}

async function readLatestClaudeContextUsage(args: {
  filePath: string;
  sessionId: string;
  size: number;
}): Promise<{ changed: boolean; contextUsage: NativeClaudeContextUsage | null }> {
  const tail = await readJsonlTailLines({
    filePath: args.filePath,
    size: args.size,
  });
  let latest: NativeClaudeContextUsageParseResult | null = null;
  for (let index = tail.lines.length - 1; index >= 0; index -= 1) {
    const line = tail.lines[index];
    if (line === undefined) continue;
    const record = parseNativeHistoryLine(line.content);
    if (record === null) continue;
    if (recordBelongsToSession(record, args.sessionId) && record.type === "system" && record.subtype === "compact_boundary") {
      const boundaryTime = stringValue(record.timestamp);
      const sampleTime = latest?.kind === "usage" ? latest.contextUsage.observedAt : null;
      if (latest?.kind === "invalid") return { changed: tail.changed, contextUsage: null };
      if (latest?.kind === "usage" && sampleTime !== null && boundaryTime !== null && Date.parse(sampleTime) >= Date.parse(boundaryTime)) {
        return { changed: tail.changed, contextUsage: latest.contextUsage };
      }
      const metadata = isRecord(record.compactMetadata) ? record.compactMetadata : null;
      const postTokens = metadata?.postTokens;
      return {
        changed: tail.changed,
        contextUsage: typeof postTokens === "number" && Number.isSafeInteger(postTokens) && postTokens >= 0
          ? { usedTokens: postTokens, observedAt: boundaryTime, model: null } : null,
      };
    }
    const parsedUsage = contextUsageFromRecord(record, args.sessionId);
    if (latest === null && parsedUsage.kind !== "missing") latest = parsedUsage;
  }
  return { changed: tail.changed, contextUsage: latest?.kind === "usage" ? latest.contextUsage : null };
}

function nativeModelValue(value: unknown): string | null {
  const model = stringValue(value);
  return model === "<synthetic>" ? null : model;
}

function metadataFromTailLines(
  lines: ReadonlyArray<{ content: Buffer }>,
  sessionId: string,
): NativeHistoryMetadata {
  let title: string | null = null;
  let model: string | null = null;
  let permissionMode: string | null = null;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const record = parseNativeHistoryLine(line.content);
    if (record === null) continue;
    if (!recordBelongsToSession(record, sessionId)) continue;
    const message = isRecord(record.message) ? record.message : null;
    title ??= stringValue(record.customTitle) ?? stringValue(record.title);
    model ??=
      nativeModelValue(record.model) ??
      (message === null ? null : nativeModelValue(message.model));
    permissionMode ??= stringValue(record.permissionMode);
    if (
      title !== null &&
      model !== null &&
      permissionMode !== null
    ) {
      break;
    }
  }
  return { title, model, permissionMode };
}

export async function readNativeClaudeHistory(
  command: NativeClaudeHistoryCommand,
): Promise<NativeClaudeHistoryResult> {
  const filePath = nativeClaudeTranscriptPath(command);
  let stat: Stats;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      throw new CommandDispatchError(
        "native_history_missing",
        "Native Claude transcript was not found for this session and cwd",
      );
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw new CommandDispatchError(
      "native_history_missing",
      "Native Claude transcript was not found for this session and cwd",
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
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const isLastAttempt = attempt === 1;
      const attemptStat =
        attempt === 0 ? stat : await fs.stat(filePath);
      const attemptIdentity = nativeHistoryFileIdentity(attemptStat);

      const result = await readConsistentNativeHistoryFile({
        before: command.before,
        extractors: claudeRecordExtractors(command.sessionId),
        filePath,
        identity: attemptIdentity,
        limit: command.limit,
        readLatestContextUsage: (contextArgs) =>
          readLatestClaudeContextUsage({
            ...contextArgs,
            sessionId: command.sessionId,
          }),
        sessionId: command.sessionId,
        size: attemptStat.size,
      });

      const postPageStat = await fs.stat(filePath);
      const postPageIdentity = nativeHistoryFileIdentity(postPageStat);
      if (postPageIdentity.revision !== result.revision) {
        if (isLastAttempt) {
          throw new CommandDispatchError(
            "native_history_changing",
            "Native Claude transcript changed while it was being read; retry the request",
          );
        }
        continue;
      }

      const tail = await readJsonlTailLines({
        filePath,
        size: postPageStat.size,
      });

      const postTailStat = await fs.stat(filePath);
      const postTailIdentity = nativeHistoryFileIdentity(postTailStat);
      if (
        postTailIdentity.revision !== result.revision ||
        tail.changed
      ) {
        if (isLastAttempt) {
          throw new CommandDispatchError(
            "native_history_changing",
            "Native Claude transcript changed while it was being read; retry the request",
          );
        }
        continue;
      }

      const tailMetadata = metadataFromTailLines(
        tail.lines,
        command.sessionId,
      );
      return {
        ...result,
        metadata: {
          title: tailMetadata.title ?? result.metadata.title,
          model: tailMetadata.model ?? result.metadata.model,
          permissionMode:
            tailMetadata.permissionMode ??
            result.metadata.permissionMode,
        },
      };
    }
    throw new CommandDispatchError(
      "native_history_changing",
      "Native Claude transcript changed while it was being read; retry the request",
    );
  });
}
