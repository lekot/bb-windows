import { describe, expect, it } from "vitest";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { threadNativeQuotaResponseSchema } from "@bb/server-contract";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedEnvironment, seedHostSession, seedProjectWithSource, seedThread, seedThreadRuntimeState } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const declaration: PluginProviderDeclaration = {
  id: "quota-test",
  displayName: "Quota test",
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

describe("native quota public route", () => {
  it("serves native images as JSON and binary using only the thread's session identity", async () => {
    await withTestHarness({ extraProviders: [{ pluginId: "quota-test-plugin", declaration }] }, async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/image-test" });
      const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "quota-test" });
      const providerThreadId = "sess_2f4f8b7e-a38b-4216-929d-22274ef1ed90";
      seedThreadRuntimeState(harness.deps, { environmentId: environment.id, threadId: thread.id, providerThreadId });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle(request) {
          expect(request.command).toEqual({ type: "host.read_native_image", cwd: "C:/image-test", sessionId: providerThreadId, messageId: "message-1", attachmentId: "part-1" });
          return { ok: true, result: { mimeType: "image/png", base64: "aGVsbG8=" } };
        },
      });
      try {
        const url = `/api/v1/threads/${thread.id}/native-image`;
        const query = "messageId=message-1&attachmentId=part-1";
        const json = await harness.app.request(`${url}?${query}`);
        expect(json.status).toBe(200);
        expect(await json.json()).toEqual({ mimeType: "image/png", base64: "aGVsbG8=" });
        const binary = await harness.app.request(`${url}/content?${query}`);
        expect(binary.status).toBe(200);
        expect(binary.headers.get("Content-Type")).toBe("image/png");
        expect(binary.headers.get("Cache-Control")).toBe("no-store");
        expect(binary.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(await binary.text()).toBe("hello");
        const invalid = await harness.app.request(`${url}?${query}&sessionId=other-session`);
        expect(invalid.status).toBe(400);
        expect(responder.requests).toHaveLength(2);
      } finally {
        responder.unregister();
      }
    });
  });

  it.each(["ok", "missing"] as const)("maps %s host quota through the real route and wire schemas", async (status) => {
    await withTestHarness({ extraProviders: [{ pluginId: "quota-test-plugin", declaration }] }, async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const environment = seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path: "C:/quota-test" });
      const thread = seedThread(harness.deps, { projectId: project.id, environmentId: environment.id, providerId: "quota-test" });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle(request) {
          expect(request.command).toEqual({ type: "host.read_zcode_quota" });
          return {
            ok: true,
            result: status === "missing" ? { status: "missing", reason: "No credentials" } : {
              status: "ok",
              fetchedAt: "2026-09-07T19:13:10.505Z",
              fiveHour: { usedPercentage: 50, remainingPercentage: 50, nextResetTime: "2026-09-07T21:44:03.428Z" },
              toolCalls: null,
            },
          };
        },
      });
      try {
        const response = await harness.app.request(`/api/v1/threads/${thread.id}/native-quota`);
        expect(response.status).toBe(200);
        const body = threadNativeQuotaResponseSchema.parse(await response.json());
        expect(body).toMatchObject({ supported: true, status });
        expect(body.fiveHour).toEqual(status === "ok" ? { usedPercentage: 50, remainingPercentage: 50, nextResetTime: "2026-09-07T21:44:03.428Z" } : null);
        expect(responder.requests).toHaveLength(1);
      } finally {
        responder.unregister();
      }
    });
  });

  it("does not read a quota for an unsupported provider or an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
      const thread = seedThread(harness.deps, { projectId: project.id, providerId: "codex" });
      const response = await harness.app.request(`/api/v1/threads/${thread.id}/native-quota`);
      expect(response.status).toBe(200);
      expect(threadNativeQuotaResponseSchema.parse(await response.json())).toMatchObject({ supported: false, status: "unavailable" });
      const missing = await harness.app.request("/api/v1/threads/thr_nonexistent/native-quota");
      expect(missing.status).toBe(404);
    });
  });
});
