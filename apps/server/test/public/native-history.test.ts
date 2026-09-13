import { setThreadNativeResume } from "@bb/db";
import { threadNativeHistoryResponseSchema } from "@bb/server-contract";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const declaration: PluginProviderDeclaration = {
  id: "native-history-test",
  displayName: "Native history test",
  maintenance: { health: false, usage: false, installation: false },
  capabilities: {
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    fork: "none",
    supportsManualCompaction: false,
    supportsThreadArchive: false,
    supportsThreadRename: false,
    permissionModes: ["accept-edits", "full"],
    reasoningLevels: ["medium"],
    experimental_nativeHistoryReader: "zcode-sqlite",
  },
  composerActions: [],
};

const harnessOptions = {
  extraProviders: [{ pluginId: "native-history-test-plugin", declaration }],
};

describe("native history public route", () => {
  it("returns an empty history while a new bb session has no native identity", async () => {
    await withTestHarness(harnessOptions, async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "C:/fresh-session",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: declaration.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/native-history`,
      );
      expect(response.status).toBe(200);
      expect(
        threadNativeHistoryResponseSchema.parse(await response.json()),
      ).toMatchObject({
        supported: true,
        messages: [],
        metadata: { sessionOrigin: "bb" },
      });
    });
  });

  it("treats a not-yet-written transcript as empty for a new bb session", async () => {
    await withTestHarness(harnessOptions, async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "C:/fresh-session",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: declaration.id,
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        providerThreadId: "sess_fresh-session",
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: false,
          errorCode: "native_history_missing",
          errorMessage: "Transcript is not written yet",
        }),
      });

      try {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/native-history`,
        );
        expect(response.status).toBe(200);
        expect(
          threadNativeHistoryResponseSchema.parse(await response.json()),
        ).toMatchObject({
          supported: true,
          messages: [],
          metadata: { sessionOrigin: "bb" },
        });
        expect(responder.requests).toHaveLength(1);
      } finally {
        responder.unregister();
      }
    });
  });

  it("marks permission metadata as native only for a resumed session", async () => {
    await withTestHarness(harnessOptions, async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "C:/resumed-session",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: declaration.id,
      });
      const providerThreadId = "sess_resumed-session";
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        providerThreadId,
      });
      setThreadNativeResume(harness.deps.db, {
        threadId: thread.id,
        nativeResume: JSON.stringify({
          providerThreadId,
          baselineExecution: {
            model: "glm-5.3",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
        }),
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: true,
          result: {
            contextUsage: null,
            messages: [],
            metadata: {
              model: "glm-5.3",
              permissionMode: "acceptEdits",
              title: null,
            },
            nextCursor: null,
            revision: "1:2:3",
            truncated: false,
          },
        }),
      });

      try {
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/native-history`,
        );
        expect(response.status).toBe(200);
        expect(
          threadNativeHistoryResponseSchema.parse(await response.json()),
        ).toMatchObject({
          supported: true,
          metadata: {
            permissionMode: "acceptEdits",
            sessionOrigin: "native",
          },
        });
      } finally {
        responder.unregister();
      }
    });
  });
});
