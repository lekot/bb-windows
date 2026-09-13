import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JsonValue } from "@bb/domain";

const { forkSessionMock, queryMock } = vi.hoisted(() => ({
  forkSessionMock: vi.fn(),
  queryMock: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: queryMock,
  forkSession: forkSessionMock,
  createSdkMcpServer: vi.fn(() => ({})),
  tool: vi.fn((_name, _desc, _schema, handler) => handler),
}));

import { CLAUDE_IDLE_QUERY_GRACE_MS, handleLine } from "../bridge.js";
import {
  experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { BridgeJsonRpcOutputMessage } from "@get-bb/plugin-sdk/provider-bridge/testing";

const NATIVE_SESSION_ID = "01a07f45-4865-7be1-8c98-d56567822218";

type CapturedCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    decisionReason?: string;
    requestId: string;
    signal: AbortSignal;
    toolUseID: string;
  },
) => Promise<{ behavior: string; message?: string }>;

interface CapturedQueryOptions {
  canUseTool?: CapturedCanUseTool;
  effort?: string;
  model?: string;
  permissionMode?: string;
  resume?: string;
  sandbox?: unknown;
  hooks?: Record<string, unknown>;
}

interface ControlledQuery {
  applyFlagSettings: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit(message: SDKMessage): void;
  finish(): void;
  initializationResult: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  setPermissionMode: ReturnType<typeof vi.fn>;
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
}

const tempDirs: string[] = [];
let previousConfigDir: string | undefined;

function createControlledQuery(): ControlledQuery {
  let finishNext: ((result: IteratorResult<SDKMessage>) => void) | undefined;
  const pending: IteratorResult<SDKMessage>[] = [];
  function push(result: IteratorResult<SDKMessage>): void {
    if (finishNext) {
      const resolve = finishNext;
      finishNext = undefined;
      resolve(result);
      return;
    }
    pending.push(result);
  }
  const iterator: AsyncIterator<SDKMessage> = {
    next: () => {
      const next = pending.shift();
      if (next) return Promise.resolve(next);
      return new Promise<IteratorResult<SDKMessage>>((resolve) => {
        finishNext = resolve;
      });
    },
    return: async () => {
      finishNext = undefined;
      return { value: undefined, done: true };
    },
  };
  return {
    applyFlagSettings: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => {
      push({ value: undefined, done: true });
    }),
    emit(message: SDKMessage): void {
      push({ value: message, done: false });
    },
    finish() {
      push({ value: undefined, done: true });
    },
    initializationResult: vi.fn().mockResolvedValue({ account: {}, models: [] }),
    setModel: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    [Symbol.asyncIterator]() {
      return iterator;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function flushFakeTimerWork(
  bridge: ReturnType<typeof createBridgeJsonRpcTestHarness>,
): Promise<void> {
  const flushed = bridge.flushWork();
  await vi.advanceTimersByTimeAsync(0);
  await flushed;
}

async function waitForFakeTimerResponse(
  bridge: ReturnType<typeof createBridgeJsonRpcTestHarness>,
  id: number,
): Promise<void> {
  const response = bridge.waitForResponse(id);
  await vi.advanceTimersByTimeAsync(0);
  await response;
}

async function drainPromptWithFakeTimers(): Promise<void> {
  const drained = drainPrompt();
  await vi.advanceTimersByTimeAsync(0);
  await drained;
}

async function drainPrompt(): Promise<void> {
  const call = queryMock.mock.calls.at(-1)?.[0];
  if (!isRecord(call)) throw new Error("Expected Claude SDK query call");
  const prompt = call.prompt;
  if (
    prompt === null ||
    typeof prompt !== "object" ||
    !(Symbol.asyncIterator in prompt)
  ) {
    throw new Error("Expected Claude prompt iterable");
  }
  await (
    prompt as AsyncIterable<unknown>
  )[Symbol.asyncIterator]().next();
}

function latestQueryOptions(): CapturedQueryOptions {
  const call = queryMock.mock.calls.at(-1)?.[0];
  if (!isRecord(call) || !isRecord(call.options)) {
    throw new Error("Expected Claude SDK query options");
  }
  return call.options as CapturedQueryOptions;
}

function nativeProjectDirectoryName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

interface TranscriptRecordArgs {
  effort?: string;
  isSidechain?: boolean;
  model?: string;
  permissionMode?: string;
  role: "user" | "assistant";
  sessionId?: string;
  uuid: string;
}

function transcriptRecord(args: TranscriptRecordArgs): string {
  const sessionId = args.sessionId ?? NATIVE_SESSION_ID;
  const base: Record<string, unknown> = {
    type: args.role,
    sessionId,
    uuid: args.uuid,
    isSidechain: args.isSidechain ?? false,
    timestamp: "2026-09-08T05:00:00.000Z",
    cwd: "/tmp/native",
    ...(args.permissionMode !== undefined
      ? { permissionMode: args.permissionMode }
      : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    message:
      args.role === "assistant"
        ? {
            role: "assistant",
            ...(args.model !== undefined ? { model: args.model } : {}),
            content: [{ type: "text", text: "reply" }],
          }
        : { role: "user", content: "prompt" },
  };
  return JSON.stringify(base);
}

interface SeedTranscriptArgs {
  lines: string[];
  sessionId?: string;
}

function seedNativeTranscript(args: SeedTranscriptArgs): { cwd: string } {
  const configDir = mkdtempSync(join(tmpdir(), "bb-claude-native-"));
  tempDirs.push(configDir);
  const cwd = mkdtempSync(join(tmpdir(), "bb-claude-cwd-"));
  tempDirs.push(cwd);
  const projectDir = join(
    configDir,
    "projects",
    nativeProjectDirectoryName(cwd),
  );
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, `${args.sessionId ?? NATIVE_SESSION_ID}.jsonl`),
    `${args.lines.join("\n")}\n`,
    "utf8",
  );
  process.env.CLAUDE_CONFIG_DIR = configDir;
  return { cwd };
}

function retainedTranscriptLines(): string[] {
  return [
    transcriptRecord({ role: "user", uuid: "u-1", permissionMode: "acceptEdits" }),
    transcriptRecord({
      role: "assistant",
      uuid: "a-1",
      model: "claude-sonnet-4-6",
      effort: "medium",
    }),
    transcriptRecord({ role: "user", uuid: "u-2", permissionMode: "dontAsk" }),
    transcriptRecord({
      role: "assistant",
      uuid: "a-2",
      model: "claude-opus-5",
      effort: "xhigh",
    }),
    transcriptRecord({
      role: "assistant",
      uuid: "a-sidechain",
      model: "claude-haiku-4-5",
      effort: "low",
      isSidechain: true,
    }),
    transcriptRecord({
      role: "user",
      uuid: "u-foreign",
      permissionMode: "bypassPermissions",
      sessionId: "99999999-4865-7be1-8c98-d56567822218",
    }),
  ];
}

interface ResumeArgs {
  bridge: ReturnType<typeof createBridgeJsonRpcTestHarness>;
  cwd: string;
  idleQueryReleaseEnabled?: boolean;
  model?: string;
  nativeOverrides?: Record<string, boolean>;
  permissionMode?: string;
  providerThreadId?: string;
  reasoningLevel?: string;
  requestId: number;
  resumeOriginal?: boolean;
  threadId: string;
}

function sendResume(args: ResumeArgs): void {
  const options: Record<string, JsonValue> = {
    permissionMode: args.permissionMode ?? "accept-edits",
    permissionScope: args.permissionMode === "full" ? "full" : "workspace",
    approvalReviewer: args.permissionMode === "full" ? null : "user",
    permissionEscalation: args.permissionMode === "full" ? null : "ask",
    instructions: "test",
    model: args.model ?? "claude-haiku-4-5",
    reasoningLevel: args.reasoningLevel ?? "low",
    providerOptions: {
      workflowsEnabled: false,
      ...(args.idleQueryReleaseEnabled === true
        ? { idleQueryReleaseEnabled: true }
        : {}),
    },
  };
  args.bridge.sendRequest(args.requestId, "thread/resume", {
    cwd: args.cwd,
    instructionMode: "append",
    options,
    providerThreadId: args.providerThreadId ?? NATIVE_SESSION_ID,
    threadId: args.threadId,
    ...(args.resumeOriginal === false ? {} : { resumeOriginal: true }),
    ...(args.nativeOverrides
      ? { nativeOverrides: args.nativeOverrides }
      : {
          nativeOverrides: {
            model: false,
            permissions: false,
            reasoningLevel: false,
            serviceTier: false,
          },
        }),
  });
}

function successResult(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    uuid: "00000000-0000-4000-8000-000000000004",
    session_id: NATIVE_SESSION_ID,
  } as unknown as SDKMessage;
}

function turnParams(args: { idle?: boolean }): Record<string, JsonValue> {
  return {
    threadId: "thread-native-idle",
    providerThreadId: NATIVE_SESSION_ID,
    clientRequestId: "creq_abcdefghjk",
    input: [{ type: "text", text: "continue" }],
    options: {
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "ask",
      instructions: "test",
      model: "claude-haiku-4-5",
      reasoningLevel: "low",
      providerOptions: {
        workflowsEnabled: false,
        ...(args.idle === true ? { idleQueryReleaseEnabled: true } : {}),
      },
    },
  };
}

function errorMessages(messages: BridgeJsonRpcOutputMessage[]): string[] {
  return messages.flatMap((message) => {
    if (!isRecord(message.error)) return [];
    return typeof message.error.message === "string"
      ? [message.error.message]
      : [];
  });
}

describe("thread/resume with resumeOriginal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    queryMock.mockImplementation(() => createControlledQuery());
  });

  afterEach(() => {
    vi.useRealTimers();
    if (previousConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restores the native model, permission mode and effort instead of bb defaults", async () => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-1" });
    await bridge.waitForResponse(1);

    const options = latestQueryOptions();
    expect(options.resume).toBe(NATIVE_SESSION_ID);
    expect(options.model).toBe("claude-opus-5");
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.effort).toBe("xhigh");
  });

  it("applies only the fields the user explicitly overrode", async () => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({
      bridge,
      cwd,
      requestId: 1,
      threadId: "thread-native-2",
      nativeOverrides: {
        model: true,
        permissions: false,
        reasoningLevel: false,
        serviceTier: false,
      },
    });
    await bridge.waitForResponse(1);

    const options = latestQueryOptions();
    expect(options.model).toBe("claude-haiku-4-5");
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.effort).toBe("xhigh");
  });

  it("keeps the retained settings when the attachment is discarded and resumed again", async () => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-3" });
    await bridge.waitForResponse(1);

    bridge.sendRequest(2, "thread/discard", {
      threadId: "thread-native-3",
      providerThreadId: NATIVE_SESSION_ID,
    });
    await bridge.waitForResponse(2);

    sendResume({ bridge, cwd, requestId: 3, threadId: "thread-native-3" });
    await bridge.waitForResponse(3);

    const options = latestQueryOptions();
    expect(options.model).toBe("claude-opus-5");
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.effort).toBe("xhigh");
  });

  it("keeps the retained settings across a real idle query release", async () => {
    vi.useFakeTimers();
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledQuery();
      queries.push(query);
      return query;
    });

    try {
      sendResume({
        bridge,
        cwd,
        idleQueryReleaseEnabled: true,
        requestId: 1,
        threadId: "thread-native-idle",
      });
      await waitForFakeTimerResponse(bridge, 1);

      bridge.sendRequest(2, "turn/start", turnParams({ idle: true }));
      await drainPromptWithFakeTimers();
      await waitForFakeTimerResponse(bridge, 2);
      queries[0]?.emit(successResult());
      await flushFakeTimerWork(bridge);

      await vi.advanceTimersByTimeAsync(CLAUDE_IDLE_QUERY_GRACE_MS - 1);
      expect(queries[0]?.close).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(queries[0]?.close).toHaveBeenCalledOnce();

      bridge.sendRequest(3, "turn/start", turnParams({ idle: true }));
      await flushFakeTimerWork(bridge);
      await drainPromptWithFakeTimers();

      expect(queries).toHaveLength(2);
      const options = latestQueryOptions();
      expect(options.resume).toBe(NATIVE_SESSION_ID);
      expect(options.model).toBe("claude-opus-5");
      expect(options.permissionMode).toBe("dontAsk");
      expect(options.effort).toBe("xhigh");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the retained model, effort and tool policy across the first turn", async () => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const queries: ControlledQuery[] = [];
    queryMock.mockImplementation(() => {
      const query = createControlledQuery();
      queries.push(query);
      return query;
    });

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-4" });
    await bridge.waitForResponse(1);

    bridge.sendRequest(2, "turn/start", {
      threadId: "thread-native-4",
      providerThreadId: NATIVE_SESSION_ID,
      clientRequestId: "creq_abcdefghjk",
      input: [{ type: "text", text: "continue" }],
      options: {
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        instructions: "test",
        model: "claude-haiku-4-5",
        reasoningLevel: "low",
        providerOptions: { workflowsEnabled: false },
      },
    });
    await bridge.flushWork();
    await drainPrompt();
    await bridge.flushWork();

    expect(queries[0]?.setModel).not.toHaveBeenCalled();
    expect(queries[0]?.applyFlagSettings).not.toHaveBeenCalled();
    expect(queries[0]?.setPermissionMode).not.toHaveBeenCalled();

    const canUseTool = latestQueryOptions().canUseTool;
    if (!canUseTool) throw new Error("Expected canUseTool");
    await expect(
      canUseTool(
        "Write",
        { file_path: "/tmp/out.txt", content: "x" },
        {
          decisionReason: "Claude asked before writing",
          requestId: "creq_abcdefghjk",
          signal: new AbortController().signal,
          toolUseID: "tool-1",
        },
      ),
    ).resolves.toMatchObject({ behavior: "deny" });
  });

  it.each(["reasoning", "model", "permissions"] as const)("applies a changed %s selection on a warm native session", async (changed) => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);
    const query = createControlledQuery();
    queryMock.mockImplementation(() => query);
    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-hot", reasoningLevel: "medium", permissionMode: changed === "permissions" ? "full" : "accept-edits" });
    await bridge.waitForResponse(1);
    bridge.sendRequest(2, "turn/start", {
      threadId: "thread-native-hot",
      providerThreadId: NATIVE_SESSION_ID,
      clientRequestId: "creq_abcdefghjk",
      input: [{ type: "text", text: "continue" }],
      options: {
        permissionMode: "accept-edits",
        permissionScope: "workspace",
        approvalReviewer: "user",
        permissionEscalation: "ask",
        instructions: "test",
        model: changed === "model" ? "claude-opus-5[1m]" : "claude-haiku-4-5",
        reasoningLevel: changed === "reasoning" ? "low" : "medium",
        providerOptions: { workflowsEnabled: false },
      },
    });
    await bridge.flushWork();
    await drainPrompt();
    await bridge.flushWork();
    if (changed === "reasoning") {
      expect(query.setModel).not.toHaveBeenCalled();
      expect(query.applyFlagSettings).toHaveBeenCalledWith(expect.objectContaining({ effortLevel: "low" }));
    } else if (changed === "model") {
      expect(query.setModel).toHaveBeenCalledWith("claude-opus-5[1m]");
      expect(query.applyFlagSettings).not.toHaveBeenCalled();
    } else {
      expect(query.setPermissionMode).toHaveBeenCalledWith("acceptEdits");
      expect(query.setModel).not.toHaveBeenCalled();
      expect(query.applyFlagSettings).not.toHaveBeenCalled();
    }
  });

  it("fails closed when the native transcript cannot be read", async () => {
    const { cwd } = seedNativeTranscript({
      lines: retainedTranscriptLines(),
      sessionId: "77777777-4865-7be1-8c98-d56567822218",
    });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-5" });
    await bridge.waitForResponse(1);

    expect(queryMock).not.toHaveBeenCalled();
    expect(errorMessages(bridge.messages).join("\n")).toContain(
      "native Claude session",
    );
  });

  it("fails closed when the transcript has no permission mode to restore", async () => {
    const { cwd } = seedNativeTranscript({
      lines: [
        transcriptRecord({
          role: "assistant",
          uuid: "a-1",
          model: "claude-opus-5",
          effort: "high",
        }),
      ],
    });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-6" });
    await bridge.waitForResponse(1);

    expect(queryMock).not.toHaveBeenCalled();
    expect(errorMessages(bridge.messages).join("\n")).toContain(
      "its transcript records no permission mode",
    );
  });

  it("fails closed when the transcript has no reasoning effort to restore", async () => {
    const { cwd } = seedNativeTranscript({
      lines: [
        transcriptRecord({
          role: "user",
          uuid: "u-1",
          permissionMode: "dontAsk",
        }),
        transcriptRecord({
          role: "assistant",
          uuid: "a-1",
          model: "claude-opus-5",
        }),
      ],
    });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({ bridge, cwd, requestId: 1, threadId: "thread-native-8" });
    await bridge.waitForResponse(1);

    expect(queryMock).not.toHaveBeenCalled();
    expect(errorMessages(bridge.messages).join(" ")).toContain(
      "its transcript records no reasoning effort",
    );
  });

  it("relaxes only the field the user explicitly overrode", async () => {
    const { cwd } = seedNativeTranscript({
      lines: [
        transcriptRecord({
          role: "user",
          uuid: "u-1",
          permissionMode: "dontAsk",
        }),
        transcriptRecord({
          role: "assistant",
          uuid: "a-1",
          model: "claude-opus-5",
        }),
      ],
    });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({
      bridge,
      cwd,
      requestId: 1,
      threadId: "thread-native-9",
      nativeOverrides: {
        model: false,
        permissions: false,
        reasoningLevel: true,
        serviceTier: false,
      },
    });
    await bridge.waitForResponse(1);

    const options = latestQueryOptions();
    expect(options.model).toBe("claude-opus-5");
    expect(options.permissionMode).toBe("dontAsk");
    expect(options.effort).toBe("low");
  });

  it("needs no transcript when every retained field was overridden", async () => {
    const { cwd } = seedNativeTranscript({
      lines: retainedTranscriptLines(),
      sessionId: "77777777-4865-7be1-8c98-d56567822218",
    });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({
      bridge,
      cwd,
      requestId: 1,
      threadId: "thread-native-10",
      nativeOverrides: {
        model: true,
        permissions: true,
        reasoningLevel: true,
        serviceTier: false,
      },
    });
    await bridge.waitForResponse(1);

    const options = latestQueryOptions();
    expect(options.model).toBe("claude-haiku-4-5");
    expect(options.permissionMode).toBe("acceptEdits");
    expect(options.effort).toBe("low");
  });

  it("leaves an ordinary bb resume on bb settings", async () => {
    const { cwd } = seedNativeTranscript({ lines: retainedTranscriptLines() });
    const bridge = createBridgeJsonRpcTestHarness(handleLine);

    sendResume({
      bridge,
      cwd,
      requestId: 1,
      threadId: "thread-native-7",
      resumeOriginal: false,
    });
    await bridge.waitForResponse(1);

    const options = latestQueryOptions();
    expect(options.model).toBe("claude-haiku-4-5");
    expect(options.permissionMode).toBe("acceptEdits");
    expect(options.effort).toBe("low");
  });
});
