import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { experimental_createBridgeJsonRpcTestHarness as createBridgeJsonRpcTestHarness } from "@get-bb/plugin-sdk/provider-bridge/testing";
import { handleLine } from "./bridge.js";
import {
  FULL_ACCESS_SESSION_OPTIONS,
  stubFakeCodexAppServer,
} from "./fake-codex-app-server-harness.js";

const THREAD_ID = "thr_resume_hydration";
const PROVIDER_THREAD_ID = "codex-resume-hydration";

let harness: ReturnType<typeof createBridgeJsonRpcTestHarness>;
let workspaceDir: string;
let codexHome: string;
let requestLogPath: string;

function writeNativeRollout(): void {
  const dayDir = join(codexHome, "sessions", "2026", "09", "08");
  mkdirSync(dayDir, { recursive: true });
  const rollout = [
    JSON.stringify({
      timestamp: "2026-09-08T03:39:45.000Z",
      type: "session_meta",
      payload: { id: PROVIDER_THREAD_ID, cwd: workspaceDir },
    }),
    JSON.stringify({
      timestamp: "2026-09-08T03:39:49.888Z",
      type: "turn_context",
      payload: {
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
      },
    }),
    "",
  ].join(String.fromCharCode(10));
  writeFileSync(
    join(
      dayDir,
      "rollout-2026-09-08T03-39-45-" + PROVIDER_THREAD_ID + ".jsonl",
    ),
    rollout,
    "utf8",
  );
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-codex-resume-hydration-"));
  codexHome = mkdtempSync(join(tmpdir(), "bb-codex-hydration-home-"));
  vi.stubEnv("CODEX_HOME", codexHome);
  requestLogPath = join(workspaceDir, "requests.jsonl");
  const scriptPath = join(workspaceDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify({ requestLogPath }), "utf8");
  stubFakeCodexAppServer(scriptPath);
  harness = createBridgeJsonRpcTestHarness(handleLine);
});

afterEach(async () => {
  const cleanupId = 993_001;
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

it("excludes turn history when it resumes a Codex thread", async () => {
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    options: { ...FULL_ACCESS_SESSION_OPTIONS },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();

  const requests = readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(requests).toContainEqual({
    method: "thread/resume",
    params: expect.objectContaining({ excludeTurns: true }),
  });
});

it("preserves native settings when resuming the original Codex session", async () => {
  writeNativeRollout();
  harness.sendRequest(1, "thread/resume", {
    threadId: THREAD_ID,
    providerThreadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    instructionMode: "append",
    resumeOriginal: true,
    options: {
      ...FULL_ACCESS_SESSION_OPTIONS,
      model: "test-model-must-not-override",
    },
  });
  expect((await harness.waitForResponse(1)).error).toBeUndefined();
  const requests = readFileSync(requestLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const resumed = requests.filter(
    (request) => request.method === "thread/resume",
  );
  expect(resumed).toHaveLength(1);
  expect(resumed[0].params).toEqual({
    threadId: PROVIDER_THREAD_ID,
    cwd: workspaceDir,
    excludeTurns: true,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "read-only",
  });
  expect(
    requests.some(
      (request) =>
        request.method === "thread/start" || request.method === "thread/fork",
    ),
  ).toBe(false);
});
