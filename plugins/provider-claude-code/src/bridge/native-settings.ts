import { closeSync, fstatSync, openSync, readSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  claudePermissionModeSchema,
  type ClaudePermissionMode,
} from "../interactive-contract.js";
import type { ClaudeSdkReasoningEffort } from "./sdk-session.js";

const NATIVE_SESSION_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SYNTHETIC_MODEL_PATTERN = /^<.*>$/;
const INITIAL_SCAN_BYTES = 256 * 1024;
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_LINE_BYTES = 256 * 1024;
const MAX_SNAPSHOT_ATTEMPTS = 2;

const claudeSdkEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export interface ClaudeNativeSessionSettings {
  effort: ClaudeSdkReasoningEffort | null;
  model: string | null;
  permissionMode: ClaudePermissionMode | null;
}

export type ClaudeNativeSessionSettingsResult =
  | { kind: "settings"; settings: ClaudeNativeSessionSettings }
  | { kind: "unreadable"; reason: string };

export interface ReadClaudeNativeSessionSettingsArgs {
  cwd: string;
  env: NodeJS.ProcessEnv;
  sessionId: string;
}

interface ScanState {
  effort: ClaudeSdkReasoningEffort | null;
  model: string | null;
  permissionMode: ClaudePermissionMode | null;
}

type ScanOutcome =
  | { kind: "scanned"; state: ScanState }
  | { kind: "changed" }
  | { kind: "rejected"; reason: string };

interface FileIdentity {
  dev: number;
  ino: number;
  mtimeMs: number;
  size: number;
}

class UnrecognizedNativeFieldError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function nativeClaudeDirectory(env: NodeJS.ProcessEnv): string {
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  if (!configured) return path.join(homedir(), ".claude");
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(homedir(), configured);
}

function nativeClaudeProjectDirectoryName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function nativeClaudeTranscriptPath(
  args: ReadClaudeNativeSessionSettingsArgs,
): string | null {
  if (!path.isAbsolute(args.cwd)) return null;
  if (!NATIVE_SESSION_ID_PATTERN.test(args.sessionId)) return null;
  return path.join(
    nativeClaudeDirectory(args.env),
    "projects",
    nativeClaudeProjectDirectoryName(args.cwd),
    `${args.sessionId}.jsonl`,
  );
}

function fileIdentity(stats: Stats): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeMs === right.mtimeMs &&
    left.size === right.size
  );
}

function isComplete(state: ScanState): boolean {
  return (
    state.effort !== null &&
    state.model !== null &&
    state.permissionMode !== null
  );
}

function emptyScanState(): ScanState {
  return { effort: null, model: null, permissionMode: null };
}

function usableRecord(
  record: Record<string, unknown>,
  sessionId: string,
): boolean {
  return (
    record.isSidechain !== true &&
    record.isApiErrorMessage !== true &&
    record.sessionId === sessionId
  );
}

function applyRecord(
  state: ScanState,
  record: Record<string, unknown>,
  sessionId: string,
): void {
  if (!usableRecord(record, sessionId)) return;

  if (state.permissionMode === null && !isAbsent(record.permissionMode)) {
    const parsed = claudePermissionModeSchema.safeParse(record.permissionMode);
    if (!parsed.success) {
      throw new UnrecognizedNativeFieldError(
        `it records an unrecognized permission mode ${JSON.stringify(record.permissionMode)}`,
      );
    }
    state.permissionMode = parsed.data;
  }

  if (state.effort === null && !isAbsent(record.effort)) {
    const parsed = claudeSdkEffortSchema.safeParse(record.effort);
    if (!parsed.success) {
      throw new UnrecognizedNativeFieldError(
        `it records an unrecognized reasoning effort ${JSON.stringify(record.effort)}`,
      );
    }
    state.effort = parsed.data;
  }

  if (state.model === null && isRecord(record.message)) {
    const model = record.message.model;
    if (!isAbsent(model)) {
      if (typeof model !== "string" || model.length === 0) {
        throw new UnrecognizedNativeFieldError(
          "it records an unusable model identifier",
        );
      }
      if (!SYNTHETIC_MODEL_PATTERN.test(model)) {
        state.model = model;
      }
    }
  }
}

function scanText(args: { sessionId: string; text: string }): ScanOutcome {
  const state = emptyScanState();
  const lines = args.text.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line === undefined || line.length === 0) continue;
    if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    try {
      applyRecord(state, parsed, args.sessionId);
    } catch (error) {
      if (error instanceof UnrecognizedNativeFieldError) {
        return { kind: "rejected", reason: error.message };
      }
      throw error;
    }
    if (isComplete(state)) break;
  }
  return { kind: "scanned", state };
}

function readWindow(args: {
  byteCount: number;
  handle: number;
  size: number;
}): string | null {
  const start = Math.max(0, args.size - args.byteCount);
  const length = args.size - start;
  const buffer = Buffer.alloc(length);
  const bytesRead = readSync(args.handle, buffer, 0, length, start);
  if (bytesRead !== length) return null;
  const text = buffer.toString("utf8");
  if (start === 0) return text;
  const firstNewline = text.indexOf("\n");
  return firstNewline < 0 ? "" : text.slice(firstNewline + 1);
}

function scanHandle(args: {
  handle: number;
  sessionId: string;
  size: number;
}): ScanOutcome {
  if (args.size === 0) return { kind: "scanned", state: emptyScanState() };
  let scanBytes = Math.min(INITIAL_SCAN_BYTES, args.size);
  let outcome: ScanOutcome = { kind: "scanned", state: emptyScanState() };
  while (scanBytes > 0) {
    const text = readWindow({
      byteCount: scanBytes,
      handle: args.handle,
      size: args.size,
    });
    if (text === null) return { kind: "changed" };
    outcome = scanText({ sessionId: args.sessionId, text });
    if (outcome.kind !== "scanned") return outcome;
    if (isComplete(outcome.state)) return outcome;
    if (scanBytes >= Math.min(MAX_SCAN_BYTES, args.size)) return outcome;
    scanBytes = Math.min(MAX_SCAN_BYTES, args.size, scanBytes * 4);
  }
  return outcome;
}

export function readClaudeNativeSessionSettings(
  args: ReadClaudeNativeSessionSettingsArgs,
): ClaudeNativeSessionSettingsResult {
  const filePath = nativeClaudeTranscriptPath(args);
  if (filePath === null) {
    return {
      kind: "unreadable",
      reason: "bb cannot locate its transcript from this workspace and id",
    };
  }

  let handle: number;
  try {
    handle = openSync(filePath, "r");
  } catch {
    return {
      kind: "unreadable",
      reason: "bb found no transcript for it in this workspace",
    };
  }

  try {
    for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
      let before: Stats;
      try {
        before = fstatSync(handle);
      } catch {
        return {
          kind: "unreadable",
          reason: "its transcript could not be read",
        };
      }
      if (!before.isFile()) {
        return { kind: "unreadable", reason: "its transcript is not a file" };
      }

      let outcome: ScanOutcome;
      try {
        outcome = scanHandle({
          handle,
          sessionId: args.sessionId,
          size: before.size,
        });
      } catch {
        return {
          kind: "unreadable",
          reason: "its transcript could not be read",
        };
      }
      if (outcome.kind === "rejected") {
        return { kind: "unreadable", reason: outcome.reason };
      }

      let after: Stats;
      try {
        after = fstatSync(handle);
      } catch {
        return {
          kind: "unreadable",
          reason: "its transcript could not be read",
        };
      }
      if (
        outcome.kind === "scanned" &&
        sameFileIdentity(fileIdentity(before), fileIdentity(after))
      ) {
        return { kind: "settings", settings: outcome.state };
      }
    }
    return {
      kind: "unreadable",
      reason: "its transcript kept changing while bb was reading it",
    };
  } finally {
    closeSync(handle);
  }
}
