import { describe, expect, it } from "vitest";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { threadDesktopRegisterResponseSchema } from "@bb/server-contract";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedEnvironment, seedHostSession, seedProjectWithSource, seedThread, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const zcodeDeclaration: PluginProviderDeclaration = {
  id: "desktop-register-test",
  displayName: "Desktop register test",
  maintenance: { health: false, usage: false, installation: false },
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["full"],
    reasoningLevels: ["medium"],
    experimental_nativeHistoryReader: "zcode-sqlite",
  },
  composerActions: [],
};

const nonZcodeDeclaration: PluginProviderDeclaration = {
  ...zcodeDeclaration,
  id: "desktop-register-non-zcode",
  capabilities: { ...zcodeDeclaration.capabilities, experimental_nativeHistoryReader: undefined },
};

async function postJson(harness: { app: { request: (path: string, init?: RequestInit) => Promise<Response> | Response } }, path: string, body: unknown) {
  return await harness.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("desktop register public route", () => {
  it("returns supported:false for a non-ZCode provider", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "non-zcode-plugin", declaration: nonZcodeDeclaration }] },
      async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-register-non-zcode" });
        const response = await postJson(harness, `/api/v1/threads/${thread.id}/desktop-register`, { apply: true });
        expect(response.status).toBe(200);
        const body = threadDesktopRegisterResponseSchema.parse(await response.json());
        expect(body.supported).toBe(false);
        expect(body.reason).toContain("ZCode provider");
      },
    );
  });

  it("forwards the explicit apply command with the original workspace", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "zcode-plugin", declaration: zcodeDeclaration }] },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/register-test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-register-test" });
        const providerThreadId = "sess_2f4f8b7e-a38b-4216-929d-22274ef1ed90";
        seedThreadRuntimeState(harness.deps, { environmentId: environment.id, threadId: thread.id, providerThreadId });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle(request) {
            if (request.command.type === "host.register_zcode_desktop_task") {
              expect(request.command).toEqual({
                type: "host.register_zcode_desktop_task",
                sessionId: providerThreadId,
                cwd: "C:/register-test",
                title: expect.any(String),
                apply: true,
              });
              return {
                ok: true,
                result: {
                  status: "registered",
                  title: "Register test",
                  workspacePath: "C:\\register-test",
                  provider: "glm",
                  backupPath: "C:\\register-test\\tasks-index.sqlite.bb-backup-test",
                },
              };
            }
            return { ok: false, errorCode: "UNEXPECTED", errorMessage: "unexpected" };
          },
        });
        try {
          const response = await postJson(harness, `/api/v1/threads/${thread.id}/desktop-register`, { apply: true });
          expect(response.status).toBe(200);
          const body = threadDesktopRegisterResponseSchema.parse(await response.json());
          expect(body).toEqual({
            supported: true,
            nativeSessionId: providerThreadId,
            outcome: {
              status: "registered",
              title: "Register test",
              workspacePath: "C:\\register-test",
              provider: "glm",
              backupPath: "C:\\register-test\\tasks-index.sqlite.bb-backup-test",
            },
            reason: null,
          });
        } finally {
          responder.unregister();
        }
      },
    );
  });

  it("runs a read-only preflight by default and surfaces host rejections", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "zcode-plugin", declaration: zcodeDeclaration }] },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/preflight-test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-register-test" });
        const providerThreadId = "sess_2f4f8b7e-a38b-4216-929d-22274ef1ed91";
        seedThreadRuntimeState(harness.deps, { environmentId: environment.id, threadId: thread.id, providerThreadId });
        let apply = false;
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle(request) {
            if (request.command.type === "host.register_zcode_desktop_task") {
              expect(request.command.apply).toBe(apply);
              return apply
                ? {
                    ok: true,
                    result: {
                      status: "rejected",
                      reason: "Workspace mismatch: the native session belongs to C:/other, but this thread runs in C:/preflight-test",
                    },
                  }
                : {
                    ok: true,
                    result: {
                      status: "preflight_ok",
                      title: "Preflight test",
                      workspacePath: "C:\\preflight-test",
                      provider: "glm",
                      mode: "build",
                      model: "zai/glm-5.3",
                      createdAt: 1788779406621,
                      updatedAt: 1788923731869,
                    },
                  };
            }
            return { ok: false, errorCode: "UNEXPECTED", errorMessage: "unexpected" };
          },
        });
        try {
          const preflight = await postJson(harness, `/api/v1/threads/${thread.id}/desktop-register`, { apply: false });
          expect(preflight.status).toBe(200);
          const preflightBody = threadDesktopRegisterResponseSchema.parse(await preflight.json());
          expect(preflightBody.outcome.status).toBe("preflight_ok");

          apply = true;
          const rejected = await postJson(harness, `/api/v1/threads/${thread.id}/desktop-register`, { apply: true });
          expect(rejected.status).toBe(200);
          const rejectedBody = threadDesktopRegisterResponseSchema.parse(await rejected.json());
          expect(rejectedBody.outcome).toEqual({
            status: "rejected",
            reason: "Workspace mismatch: the native session belongs to C:/other, but this thread runs in C:/preflight-test",
          });
          expect(rejectedBody.reason).toContain("Workspace mismatch");
        } finally {
          responder.unregister();
        }
      },
    );
  });
});
