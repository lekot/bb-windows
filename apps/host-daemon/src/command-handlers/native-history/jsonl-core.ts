import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import {
  CommandDispatchError,
} from "../../command-dispatch-support.js";

export const MAX_CACHE_ENTRIES = 32;
export const MAX_SCAN_BYTES = 8 * 1024 * 1024;
export const INITIAL_READ_WINDOW_BYTES = 64 * 1024;
export const MAX_LINE_BYTES = 256 * 1024;
export const MAX_MESSAGE_TEXT_CHARS = 16 * 1024;
export const MAX_RESPONSE_TEXT_CHARS = 512 * 1024;
const CURSOR_ANCHOR_BYTES = 512;
const CURSOR_VERSION = 1;

export interface NativeHistoryMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  timestamp: string | null;
}

export interface NativeHistoryMetadata {
  title: string | null;
  model: string | null;
  permissionMode: string | null;
}

export interface NativeHistoryFileIdentity {
  fileId: string;
  revision: string;
}

interface NativeHistoryCursor {
  anchorHash: string;
  fileId: string;
  offset: number;
  sessionId: string;
  snapshotRevision: string;
  snapshotSize: number;
  version: number;
}

interface NativeHistoryLine {
  content: Buffer;
  startOffset: number;
}

interface CompleteNativeHistoryLines {
  firstCompleteLineStart: number | null;
  lines: NativeHistoryLine[];
}

export interface NativeHistoryPage {
  metadata: NativeHistoryMetadata;
  messages: NativeHistoryMessage[];
  nextOffset: number | null;
  payloadTruncated: boolean;
}

export interface JsonlRecordExtractors {
  messageFromRecord(
    record: Record<string, unknown>,
    position: { lineStartOffset: number },
  ): { message: NativeHistoryMessage | null; truncated: boolean };
  metadataFromRecord(
    record: Record<string, unknown>,
    metadata: NativeHistoryMetadata,
  ): NativeHistoryMetadata;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function boundedText(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_MESSAGE_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_MESSAGE_TEXT_CHARS), truncated: true };
}

export function emptyNativeHistoryMetadata(): NativeHistoryMetadata {
  return { title: null, model: null, permissionMode: null };
}

export function nativeHistoryFileIdentity(
  stat: Stats,
): NativeHistoryFileIdentity {
  const fileId = [stat.dev, stat.ino, stat.birthtimeMs].join(":");
  return {
    fileId,
    revision: [fileId, stat.ctimeMs, stat.mtimeMs, stat.size].join(":"),
  };
}

export function nativeHistoryCacheKey(args: {
  before: string | null;
  filePath: string;
  limit: number;
  revision: string;
}): string {
  return [args.filePath, args.revision, args.before ?? "latest", args.limit].join(
    "\u0000",
  );
}

export class NativeHistoryReadCache<T> {
  private readonly entries = new Map<string, T>();
  private readonly pending = new Map<string, Promise<T>>();

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  remember(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > MAX_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  forget(key: string): void {
    this.entries.delete(key);
  }

  async through(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(key);
    if (pending !== undefined) return pending;
    const operation = compute()
      .then((value) => {
        this.remember(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, operation);
    return operation;
  }
}

export function parseNativeHistoryLine(
  line: Buffer,
): Record<string, unknown> | null {
  if (line.length === 0 || line.length > MAX_LINE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(line.toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function completeLines(args: {
  buffer: Buffer;
  startOffset: number;
}): CompleteNativeHistoryLines {
  const finalNewline = args.buffer.lastIndexOf(0x0a);
  if (finalNewline < 0) {
    return { firstCompleteLineStart: null, lines: [] };
  }
  let lineStart = 0;
  if (args.startOffset > 0) {
    const firstNewline = args.buffer.indexOf(0x0a);
    if (firstNewline < 0) {
      return { firstCompleteLineStart: null, lines: [] };
    }
    lineStart = firstNewline + 1;
  }
  const lines: NativeHistoryLine[] = [];
  while (lineStart <= finalNewline) {
    const newline = args.buffer.indexOf(0x0a, lineStart);
    if (newline < 0 || newline > finalNewline) break;
    const contentEnd =
      newline > lineStart && args.buffer[newline - 1] === 0x0d
        ? newline - 1
        : newline;
    lines.push({
      content: args.buffer.subarray(lineStart, contentEnd),
      startOffset: args.startOffset + lineStart,
    });
    lineStart = newline + 1;
  }
  return {
    firstCompleteLineStart:
      lines[0] === undefined ? null : lines[0].startOffset,
    lines,
  };
}

export function collectNativeHistoryPage(args: {
  buffer: Buffer;
  extractors: JsonlRecordExtractors;
  limit: number;
  startOffset: number;
}): NativeHistoryPage {
  const complete = completeLines({
    buffer: args.buffer,
    startOffset: args.startOffset,
  });
  const { lines } = complete;
  const messages: Array<NativeHistoryMessage & { startOffset: number }> = [];
  const messageIds = new Set<string>();
  let responseTextChars = 0;
  let payloadTruncated = false;
  let metadata = emptyNativeHistoryMetadata();
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const record = parseNativeHistoryLine(line.content);
    if (record === null) continue;
    metadata = args.extractors.metadataFromRecord(record, metadata);
    const parsed = args.extractors.messageFromRecord(record, {
      lineStartOffset: line.startOffset,
    });
    payloadTruncated ||= parsed.truncated;
    if (parsed.message === null || messageIds.has(parsed.message.id)) continue;
    if (
      messages.length === args.limit ||
      responseTextChars + parsed.message.text.length > MAX_RESPONSE_TEXT_CHARS
    ) {
      payloadTruncated = true;
      break;
    }
    messageIds.add(parsed.message.id);
    responseTextChars += parsed.message.text.length;
    messages.push({ ...parsed.message, startOffset: line.startOffset });
  }
  const oldest = messages[messages.length - 1];
  const candidateNextOffset =
    oldest !== undefined
      ? oldest.startOffset > 0
        ? oldest.startOffset
        : null
      : complete.firstCompleteLineStart ??
        (args.startOffset > 0 ? args.startOffset : null);
  return {
    metadata,
    messages: messages
      .reverse()
      .map(({ startOffset: _startOffset, ...message }) => message),
    nextOffset:
      candidateNextOffset !== null && candidateNextOffset > 0
        ? candidateNextOffset
        : null,
    payloadTruncated,
  };
}

export async function readNativeHistoryPageBackward(args: {
  endOffset: number;
  extractors: JsonlRecordExtractors;
  filePath: string;
  limit: number;
}): Promise<{ changed: boolean; page: NativeHistoryPage }> {
  const handle = await fs.open(args.filePath, "r");
  try {
    let windowBytes = Math.min(INITIAL_READ_WINDOW_BYTES, args.endOffset);
    let changed = false;
    let page: NativeHistoryPage = {
      metadata: emptyNativeHistoryMetadata(),
      messages: [],
      nextOffset: args.endOffset > 0 ? args.endOffset : null,
      payloadTruncated: false,
    };
    while (windowBytes > 0) {
      const start = args.endOffset - windowBytes;
      const buffer = Buffer.alloc(windowBytes);
      const { bytesRead } = await handle.read(buffer, 0, windowBytes, start);
      if (bytesRead !== windowBytes) changed = true;
      page = collectNativeHistoryPage({
        buffer: buffer.subarray(0, bytesRead),
        extractors: args.extractors,
        limit: args.limit,
        startOffset: start,
      });
      if (
        page.messages.length === args.limit ||
        start === 0 ||
        windowBytes === Math.min(MAX_SCAN_BYTES, args.endOffset)
      ) {
        break;
      }
      windowBytes = Math.min(
        MAX_SCAN_BYTES,
        args.endOffset,
        windowBytes * 2,
      );
    }
    return { changed, page };
  } finally {
    await handle.close();
  }
}

function invalidCursor(message: string): never {
  throw new CommandDispatchError("native_history_cursor_invalid", message);
}

export function decodeNativeHistoryCursor(value: string): NativeHistoryCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!isRecord(parsed)) return invalidCursor("Native history cursor is invalid");
    const anchorHash = stringValue(parsed.anchorHash);
    const fileId = stringValue(parsed.fileId);
    const sessionId = stringValue(parsed.sessionId);
    const snapshotRevision = stringValue(parsed.snapshotRevision);
    const { offset, snapshotSize, version } = parsed;
    if (
      anchorHash === null ||
      fileId === null ||
      sessionId === null ||
      snapshotRevision === null ||
      typeof version !== "number" ||
      version !== CURSOR_VERSION ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      typeof snapshotSize !== "number" ||
      !Number.isSafeInteger(snapshotSize) ||
      snapshotSize < 0
    ) {
      return invalidCursor("Native history cursor is invalid");
    }
    return {
      anchorHash,
      fileId,
      offset,
      sessionId,
      snapshotRevision,
      snapshotSize,
      version,
    };
  } catch {
    return invalidCursor("Native history cursor is invalid");
  }
}

async function anchorHash(filePath: string, offset: number): Promise<string> {
  const byteCount = Math.min(CURSOR_ANCHOR_BYTES, offset);
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(
      buffer,
      0,
      byteCount,
      offset - byteCount,
    );
    if (bytesRead !== byteCount) {
      throw new CommandDispatchError(
        "native_history_cursor_invalid",
        "Native history changed before the requested cursor",
      );
    }
    return createHash("sha256").update(buffer).digest("base64url");
  } finally {
    await handle.close();
  }
}

async function validateCursor(args: {
  cursor: NativeHistoryCursor;
  filePath: string;
  identity: NativeHistoryFileIdentity;
  sessionId: string;
  size: number;
}): Promise<number> {
  if (
    args.cursor.sessionId !== args.sessionId ||
    args.cursor.fileId !== args.identity.fileId ||
    args.cursor.snapshotSize > args.size ||
    args.cursor.offset > args.size ||
    (args.cursor.snapshotSize === args.size &&
      args.cursor.snapshotRevision !== args.identity.revision)
  ) {
    return invalidCursor("Native history cursor no longer matches this transcript");
  }
  const currentAnchorHash = await anchorHash(args.filePath, args.cursor.offset);
  if (currentAnchorHash !== args.cursor.anchorHash) {
    return invalidCursor("Native history changed before the requested cursor");
  }
  return args.cursor.offset;
}

export async function encodeNativeHistoryCursor(args: {
  filePath: string;
  identity: NativeHistoryFileIdentity;
  offset: number | null;
  sessionId: string;
  snapshotRevision: string;
  snapshotSize: number;
}): Promise<string | null> {
  if (args.offset === null) return null;
  return Buffer.from(
    JSON.stringify({
      anchorHash: await anchorHash(args.filePath, args.offset),
      fileId: args.identity.fileId,
      offset: args.offset,
      sessionId: args.sessionId,
      snapshotRevision: args.snapshotRevision,
      snapshotSize: args.snapshotSize,
      version: CURSOR_VERSION,
    }),
  ).toString("base64url");
}

export async function readConsistentNativeHistoryFile<C>(args: {
  before: string | null;
  extractors: JsonlRecordExtractors;
  filePath: string;
  identity: NativeHistoryFileIdentity;
  limit: number;
  readLatestContextUsage: (args: {
    filePath: string;
    size: number;
  }) => Promise<{ changed: boolean; contextUsage: C }>;
  sessionId: string;
  size: number;
}): Promise<{
  contextUsage: C;
  metadata: NativeHistoryMetadata;
  messages: NativeHistoryMessage[];
  nextCursor: string | null;
  revision: string;
  truncated: boolean;
}> {
  let snapshot = args;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cursor =
      snapshot.before === null ? null : decodeNativeHistoryCursor(snapshot.before);
    const endOffset =
      cursor === null
        ? snapshot.size
        : await validateCursor({
            cursor,
            filePath: snapshot.filePath,
            identity: snapshot.identity,
            sessionId: snapshot.sessionId,
            size: snapshot.size,
          });
    const read = await readNativeHistoryPageBackward({
      endOffset,
      extractors: snapshot.extractors,
      filePath: snapshot.filePath,
      limit: snapshot.limit,
    });
    const context =
      cursor === null
        ? await snapshot.readLatestContextUsage({
            filePath: snapshot.filePath,
            size: snapshot.size,
          })
        : { changed: false, contextUsage: null as C };
    const after = await fs.stat(snapshot.filePath);
    const afterIdentity = nativeHistoryFileIdentity(after);
    if (
      !read.changed &&
      !context.changed &&
      afterIdentity.revision === snapshot.identity.revision
    ) {
      const nextCursor = await encodeNativeHistoryCursor({
        filePath: snapshot.filePath,
        identity: snapshot.identity,
        offset: read.page.nextOffset,
        sessionId: snapshot.sessionId,
        snapshotRevision: snapshot.identity.revision,
        snapshotSize: snapshot.size,
      });
      return {
        metadata: read.page.metadata,
        contextUsage: context.contextUsage,
        messages: read.page.messages,
        nextCursor,
        revision: snapshot.identity.revision,
        truncated: read.page.payloadTruncated || nextCursor !== null,
      };
    }
    snapshot = {
      ...snapshot,
      identity: afterIdentity,
      size: after.size,
    };
  }
  throw new CommandDispatchError(
    "native_history_changing",
    "Native transcript changed while it was being read; retry the request",
  );
}

export async function readJsonlTailLines(args: {
  filePath: string;
  size: number;
}): Promise<{
  changed: boolean;
  lines: NativeHistoryLine[];
}> {
  const byteCount = Math.min(MAX_SCAN_BYTES, args.size);
  if (byteCount === 0) return { changed: false, lines: [] };
  const startOffset = args.size - byteCount;
  const handle = await fs.open(args.filePath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, startOffset);
    const complete = completeLines({
      buffer: buffer.subarray(0, bytesRead),
      startOffset,
    });
    return { changed: bytesRead !== byteCount, lines: complete.lines };
  } finally {
    await handle.close();
  }
}

export async function readJsonlHeadLines(args: {
  byteCount: number;
  filePath: string;
}): Promise<NativeHistoryLine[]> {
  const handle = await fs.open(args.filePath, "r");
  try {
    const buffer = Buffer.alloc(args.byteCount);
    const { bytesRead } = await handle.read(buffer, 0, args.byteCount, 0);
    const complete = completeLines({
      buffer: buffer.subarray(0, bytesRead),
      startOffset: 0,
    });
    return complete.lines;
  } finally {
    await handle.close();
  }
}
