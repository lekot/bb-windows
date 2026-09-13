import { describe, expect, it } from "vitest";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { threadDesktopSyncResponseSchema } from "@bb/server-contract";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedEnvironment, seedHostSession, seedProjectWithSource, seedThread, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const zcodeDeclaration: PluginProviderDeclaration = {
  id: "desktop-sync-test",
  displayName: "Desktop sync test",
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
  id: "desktop-sync-non-zcode",
  capabilities: { ...zcodeDeclaration.capabilities, experimental_nativeHistoryReader: undefined },
};

describe("desktop sync public route", () => {
  it("returns supported:false for a non-ZCode provider", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "non-zcode-plugin", declaration: nonZcodeDeclaration }] },
      async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-sync-non-zcode" });
        const response = await harness.app.request(`/api/v1/threads/${thread.id}/desktop-sync`);
        expect(response.status).toBe(200);
        const body = threadDesktopSyncResponseSchema.parse(await response.json());
        expect(body.supported).toBe(false);
        expect(body.reason).toContain("ZCode provider");
      },
    );
  });

  it("combines native history and desktop registration for a ZCode provider", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "zcode-plugin", declaration: zcodeDeclaration }] },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/sync-test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-sync-test" });
        const providerThreadId = "sess_2f4f8b7e-a38b-4216-929d-22274ef1ed90";
        seedThreadRuntimeState(harness.deps, { environmentId: environment.id, threadId: thread.id, providerThreadId });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle(request) {
            if (request.command.type === "host.read_native_history") {
              return {
                ok: true,
                result: {
                  contextUsage: null,
                  metadata: { title: null, model: null, permissionMode: null },
                  messages: [
                    { id: "msg_1", role: "assistant", text: "reply", timestamp: "2026-09-08T13:00:00.000Z" },
                  ],
                  nextCursor: null,
                  revision: "r1",
                  truncated: false,
                },
              };
            }
            if (request.command.type === "host.check_zcode_desktop_registration") {
              expect(request.command).toEqual({
                type: "host.check_zcode_desktop_registration",
                sessionId: providerThreadId,
              });
              return {
                ok: true,
                result: {
                  status: "registered",
                  title: "Sync test",
                  workspacePath: "C:\\sync-test",
                  provider: "glm",
                },
              };
            }
            return { ok: false, errorCode: "UNEXPECTED", errorMessage: "unexpected" };
          },
        });
        try {
          const response = await harness.app.request(`/api/v1/threads/${thread.id}/desktop-sync`);
          expect(response.status).toBe(200);
          const body = threadDesktopSyncResponseSchema.parse(await response.json());
          expect(body).toEqual({
            supported: true,
            nativeSessionId: providerThreadId,
            nativeHistoryStatus: "ok",
            lastNativeMessageAt: "2026-09-08T13:00:00.000Z",
            desktopStatus: "registered",
            desktopTitle: "Sync test",
            desktopWorkspacePath: "C:\\sync-test",
            reason: null,
          });
        } finally {
          responder.unregister();
        }
      },
    );
  });

  it("reports ok for an empty native session without messages", async () => {
    await withTestHarness(
      { extraProviders: [{ pluginId: "zcode-plugin", declaration: zcodeDeclaration }] },
      async (harness) => {
        const { host, session } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
        const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/empty-test" });
        const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "desktop-sync-test" });
        seedThreadRuntimeState(harness.deps, { environmentId: environment.id, threadId: thread.id, providerThreadId: "sess_empty-0000-0000-0000-000000000001" });
        const responder = registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle(request) {
            if (request.command.type === "host.read_native_history") {
              return {
                ok: true,
                result: {
                  contextUsage: null,
                  metadata: { title: null, model: null, permissionMode: null },
                  messages: [],
                  nextCursor: null,
                  revision: "r1",
                  truncated: false,
                },
              };
            }
            if (request.command.type === "host.check_zcode_desktop_registration") {
              return { ok: true, result: { status: "not_registered" } };
            }
            return { ok: false, errorCode: "UNEXPECTED", errorMessage: "unexpected" };
          },
        });
        try {
          const response = await harness.app.request(`/api/v1/threads/${thread.id}/desktop-sync`);
          expect(response.status).toBe(200);
          const body = threadDesktopSyncResponseSchema.parse(await response.json());
          expect(body.nativeHistoryStatus).toBe("ok");
          expect(body.lastNativeMessageAt).toBeNull();
          expect(body.desktopStatus).toBe("not_registered");
        } finally {
          responder.unregister();
        }
      },
    );
  });
});
