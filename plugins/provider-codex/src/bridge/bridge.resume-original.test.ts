import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import type { ThreadEvent } from "@bb/domain";
import { experimental_assembleCapturedThreadEvents as assembleCapturedThreadEvents } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";

async function waitForTurnCompletions(count: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const events: ThreadEvent[] = assembleCapturedThreadEvents(
      harness.messages,
      "codex",
    );
    if (events.filter((event) => event.type === "turn/completed").length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for turn completion");
}

const THREAD_ID = "thr_resume_original";
const PROVIDER_THREAD_ID = "codex-resume-original";
const fakeAppServerPath = fileURLToPath(
  new URL("./fake-codex-app-server.mjs", import.meta.url),
);
const sessionOptions = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  model: "gpt-5.6-luna",
} as const;

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let codexHome: string;
let requestLogPath: string;

function writeNativeRollout(turnContextPayload: Record<string, unknown>): void {
  const dayDir = join(codexHome, "sessions", "2026", "09", "08");
  mkdirSync(dayDir, { recursive: true });
  writeFileSync(
    join(dayDir, `rollout-2026-09-08T03-39-45-${PROVIDER_THREAD_ID}.jsonl`),
    [
      JSON.stringify({
        timestamp: "2026-09-08T03:39:45.000Z",
        type: "session_meta",
        payload: { id: PROVIDER_THREAD_ID, cwd: workspaceDir },
      }),
      JSON.stringify({
        timestamp: "2026-09-08T03:39:49.888Z",
        type: "turn_context",
        payload: turnContextPayload,
      }),
      "",
    ].join("\n"),
    "utf8",
  );
}

function readOnlyTurnContext(): Record<string, unknown> {
  return {
    turn_id: "turn-1",
    cwd: workspaceDir,
    approval_policy: "never",
    approvals_reviewer: "user",
    sandbox_policy: { type: "read-only" },
    permission_profile: {
      type: "managed",
      file_system: {
        type: "restricted",
        entries: [
          {
            path: { type: "special", value: { kind: "root" } },
            access: "read",
          },
        ],
      },
      network: "restricted",
    },
    model: "gpt-5.6-luna",
  };
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-resume-original-"));
  codexHome = mkdtempSync(join(tmpdir(), "bb-codex-home-"));
  vi.stubEnv("CODEX_HOME", codexHome);
  requestLogPath = join(workspaceDir, "requests.jsonl");
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }), "utf8");
  vi.stubEnv("BB_CODEX_BRIDGE_APP_SERVER_COMMAND", process.execPath);
  vi.stubEnv(
    "BB_CODEX_BRIDGE_APP_SERVER_ARGS",
    JSON.stringify([fakeAppServerPath, scriptPath]),
  );
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 994_001;
  harness.sendRequest(cleanupId, "thread/stop", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    intent: "release",
    activeTurnId: null,
  });
  await harness.waitForResponse(cleanupId).catch(() => undefined);
  harness.restore();
  vi.unstubAllEnvs();
  rmSync(workspaceDir, { recursive: true, force: true });
  rmSync(codexHome, { recursive: true, force: true });
});

function loggedAppServerRequests(): Array<{
  method: string;
  params: Record<string, unknown>;
}> {
  return readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

it("restores the native sandbox and approval policy on an original resume", async () => {
  writeNativeRollout(readOnlyTurnContext());
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  const resume = loggedAppServerRequests().find(
    (request) => request.method === "thread/resume",
  );
  expect(resume).toBeDefined();
  expect(resume?.params).toEqual({
    threadId: PROVIDER_THREAD_ID,
    excludeTurns: true,
    cwd: workspaceDir,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "read-only",
  });
});

it("restores workspace-write roots and network access instead of widening them", async () => {
  const writableRoot = join(workspaceDir, "writable");
  writeNativeRollout({
    turn_id: "turn-1",
    cwd: workspaceDir,
    approval_policy: "on-request",
    approvals_reviewer: "auto_review",
    sandbox_policy: {
      type: "workspace-write",
      writable_roots: [writableRoot],
      network_access: false,
      exclude_tmpdir_env_var: true,
      exclude_slash_tmp: true,
    },
    permission_profile: { type: "disabled" },
  });
  harness.sendRequest(20, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(20)).error).toBeUndefined();

  const resume = loggedAppServerRequests().find(
    (request) => request.method === "thread/resume",
  );
  expect(resume?.params).toEqual({
    threadId: PROVIDER_THREAD_ID,
    excludeTurns: true,
    cwd: workspaceDir,
    approvalPolicy: "on-request",
    approvalsReviewer: "auto_review",
    sandbox: "workspace-write",
    config: {
      "sandbox_workspace_write.writable_roots": [writableRoot],
      "sandbox_workspace_write.network_access": false,
      "sandbox_workspace_write.exclude_tmpdir_env_var": true,
      "sandbox_workspace_write.exclude_slash_tmp": true,
    },
  });
});

it("fails the original resume instead of falling back to the machine default policy", async () => {
  harness.sendRequest(21, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: { ...sessionOptions },
  });
  const response = await harness.waitForResponse(21);
  expect(response.result).toBeUndefined();
  expect(response.error?.message ?? "").toMatch(
    /cannot restore its sandbox and approval policy/,
  );
  expect(
    loggedAppServerRequests().some(
      (request) => request.method === "thread/resume",
    ),
  ).toBe(false);
});

it("keeps bb construction settings on an ordinary resume", async () => {
  writeNativeRollout(readOnlyTurnContext());
  harness.sendRequest(2, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(2)).error).toBeUndefined();

  const resume = loggedAppServerRequests().find(
    (request) => request.method === "thread/resume",
  );
  expect(resume).toBeDefined();
  expect(resume?.params).toMatchObject({
    threadId: PROVIDER_THREAD_ID,
    excludeTurns: true,
    model: "gpt-5.6-luna",
  });
});

it("keeps native model and permissions on turns after an original resume until bb changes them explicitly", async () => {
  writeNativeRollout(readOnlyTurnContext());
  harness.sendRequest(3, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(3)).error).toBeUndefined();

  harness.sendRequest(4, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "hello", mentions: [] }],
    clientRequestId: "creq_abcdefghj2",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(4)).error).toBeUndefined();
  await waitForTurnCompletions(1);
  const firstTurn = loggedAppServerRequests().filter(
    (request) => request.method === "turn/start",
  );
  expect(firstTurn).toHaveLength(1);
  expect(firstTurn[0]?.params).toEqual({
    threadId: PROVIDER_THREAD_ID,
    input: expect.anything(),
  });

  harness.sendRequest(5, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "switch", mentions: [] }],
    clientRequestId: "creq_abcdefghj3",
    options: { ...sessionOptions, model: "gpt-5.6-mini" },
  });
  expect((await harness.waitForResponse(5)).error).toBeUndefined();
  await waitForTurnCompletions(2);
  const secondTurn = loggedAppServerRequests().filter(
    (request) => request.method === "turn/start",
  )[1];
  expect(secondTurn?.params).toEqual({
    threadId: PROVIDER_THREAD_ID,
    input: expect.anything(),
    model: "gpt-5.6-mini",
  });

  harness.sendRequest(6, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "back", mentions: [] }],
    clientRequestId: "creq_abcdefghj4",
    options: {
      ...sessionOptions,
      permissionMode: "accept-edits",
      permissionScope: "workspace",
      approvalReviewer: "user",
      permissionEscalation: "ask",
    },
  });
  expect((await harness.waitForResponse(6)).error).toBeUndefined();
  const thirdTurn = loggedAppServerRequests().filter(
    (request) => request.method === "turn/start",
  )[2];
  expect(thirdTurn?.params).toMatchObject({
    model: "gpt-5.6-luna",
    approvalPolicy: expect.any(String),
    sandboxPolicy: expect.anything(),
  });
  expect(thirdTurn?.params).not.toHaveProperty("effort");
  await waitForTurnCompletions(3);

  harness.sendRequest(9, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "think harder", mentions: [] }],
    clientRequestId: "creq_abcdefghj6",
    options: { ...sessionOptions, reasoningLevel: "high" },
  });
  expect((await harness.waitForResponse(9)).error).toBeUndefined();
  const fourthTurn = loggedAppServerRequests().filter(
    (request) => request.method === "turn/start",
  )[3];
  expect(fourthTurn?.params).toMatchObject({ effort: "high" });
});

it("passes bb settings on every turn after an ordinary resume", async () => {
  writeNativeRollout(readOnlyTurnContext());
  harness.sendRequest(7, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(7)).error).toBeUndefined();
  harness.sendRequest(8, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "hello", mentions: [] }],
    clientRequestId: "creq_abcdefghj5",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(8)).error).toBeUndefined();
  const turn = loggedAppServerRequests().find(
    (request) => request.method === "turn/start",
  );
  expect(turn?.params).toMatchObject({
    model: "gpt-5.6-luna",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
});

it("uses the bb policy on a real reconnect after the user changes permissions", async () => {
  writeNativeRollout(readOnlyTurnContext());
  harness.sendRequest(30, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(30)).error).toBeUndefined();

  harness.sendRequest(31, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "native policy turn", mentions: [] }],
    clientRequestId: "creq_rcnnct2345",
    options: { ...sessionOptions },
  });
  expect((await harness.waitForResponse(31)).error).toBeUndefined();
  await waitForTurnCompletions(1);
  expect(
    loggedAppServerRequests().filter(
      (request) => request.method === "thread/resume",
    ),
  ).toHaveLength(1);

  const explicitOptions = {
    ...sessionOptions,
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: "ask",
  } as const;
  harness.sendRequest(32, "turn/start", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    input: [{ type: "text", text: "after explicit change", mentions: [] }],
    clientRequestId: "creq_rcnnct2346",
    options: { ...explicitOptions },
  });
  expect((await harness.waitForResponse(32)).error).toBeUndefined();

  const resumes = loggedAppServerRequests().filter(
    (request) => request.method === "thread/resume",
  );
  expect(resumes).toHaveLength(2);
  expect(resumes[1]?.params).toMatchObject({
    threadId: PROVIDER_THREAD_ID,
    excludeTurns: true,
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  });
  expect(resumes[1]?.params.sandbox).not.toBe("read-only");
});
