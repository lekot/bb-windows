import { setThreadNativeResume } from "@bb/db";
import { describe, expect, it } from "vitest";
import { prepareTurnSubmitCommandPayload } from "../../src/services/threads/thread-commands.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { getThreadNativeResume } from "@bb/db";
import { nativeSessionForkDescriptor } from "../../src/services/threads/native-session-intent.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { textInput } from "../helpers/prompt-input.js";
import { withTestHarness } from "../helpers/test-app.js";
import { getEnvironment, getThread } from "@bb/db";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { adoptNativeSession } from "../../src/services/threads/native-session-intent.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";

function requireThreadRow(harness: Parameters<Parameters<typeof withTestHarness>[1]>[0], threadId: string) {
  const thread = getThread(harness.deps.db, threadId);
  if (!thread) throw new Error("thread not found");
  return thread;
}

function requireEnvironmentRow(harness: Parameters<Parameters<typeof withTestHarness>[1]>[0], threadId: string) {
  const thread = requireThreadRow(harness, threadId);
  const environment = thread.environmentId === null ? null : getEnvironment(harness.deps.db, thread.environmentId);
  if (!environment) throw new Error("environment not found");
  return environment;
}

const NATIVE_SESSION_ID = "01a07f45-4865-7be1-8c98-d56567822218";

const importedExecution = {
  model: "gpt-5.6-luna",
  permissionMode: "accept-edits",
  reasoningLevel: "low",
  serviceTier: "default",
  source: "client/turn/requested",
} as const;

async function seedResumedThread(
  harness: Awaited<Parameters<Parameters<typeof withTestHarness>[1]>[0]>,
  args: { storeIntent: boolean },
) {
  const { host, session } = seedHostSession(harness.deps, {
    id: "host-native-resume",
  });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/native-resume",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: NATIVE_SESSION_ID,
    threadId: thread.id,
  });
  if (args.storeIntent) {
    setThreadNativeResume(harness.deps.db, {
      threadId: thread.id,
      nativeResume: JSON.stringify({
        providerThreadId: NATIVE_SESSION_ID,
        baselineExecution: {
          model: importedExecution.model,
          permissionMode: importedExecution.permissionMode,
          reasoningLevel: importedExecution.reasoningLevel,
          serviceTier: importedExecution.serviceTier,
        },
      }),
    });
  }
  return { environment, host, session, thread };
}

describe("native session resume intent", () => {
  it("carries the original-session intent to a runtime that never saw the import", async () => {
    await withTestHarness({}, async (harness) => {
      const { environment, thread } = await seedResumedThread(harness, {
        storeIntent: true,
      });

      const submitCommand = await prepareTurnSubmitCommandPayload(
        harness.deps,
        {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        },
      );

      expect(submitCommand.resumeContext.nativeSession).toEqual({
        resumeOriginal: true,
        baselineExecution: expect.objectContaining({
          model: "gpt-5.6-luna",
          reasoningLevel: "low",
          permissionMode: "accept-edits",
        }),
      });
    });
  });

  it("keeps an ordinary thread free of a native session intent", async () => {
    await withTestHarness({}, async (harness) => {
      const { environment, thread } = await seedResumedThread(harness, {
        storeIntent: false,
      });

      const submitCommand = await prepareTurnSubmitCommandPayload(
        harness.deps,
        {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        },
      );

      expect(submitCommand.resumeContext.nativeSession).toBeNull();
    });
  });
});

describe("native session reprovisioning", () => {
  it("restores the original session when a failed first import is retried", async () => {
    await withTestHarness({}, async (harness) => {
      const { thread } = await seedResumedThread(harness, {
        storeIntent: true,
      });

      expect(
        nativeSessionForkDescriptor(harness.deps, thread.id),
      ).toEqual({
        resumeOriginal: true,
        sourceProviderThreadId: NATIVE_SESSION_ID,
      });
    });
  });

  it("leaves an ordinary thread without a fork descriptor to reprovision", async () => {
    await withTestHarness({}, async (harness) => {
      const { thread } = await seedResumedThread(harness, {
        storeIntent: false,
      });

      expect(nativeSessionForkDescriptor(harness.deps, thread.id)).toBeNull();
    });
  });
});

describe("unreadable native session records", () => {
  it("refuses the turn instead of resuming an imported session as an ordinary one", async () => {
    await withTestHarness({}, async (harness) => {
      const { environment, thread } = await seedResumedThread(harness, {
        storeIntent: true,
      });
      setThreadNativeResume(harness.deps.db, {
        threadId: thread.id,
        nativeResume: "{not json",
      });

      await expect(
        prepareTurnSubmitCommandPayload(harness.deps, {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        }),
      ).rejects.toMatchObject({ body: { code: "native_session_record_unreadable" } });
    });
  });

  it("refuses a record whose shape or session no longer matches the thread", async () => {
    await withTestHarness({}, async (harness) => {
      const { environment, thread } = await seedResumedThread(harness, {
        storeIntent: true,
      });
      setThreadNativeResume(harness.deps.db, {
        threadId: thread.id,
        nativeResume: JSON.stringify({ providerThreadId: NATIVE_SESSION_ID }),
      });

      await expect(
        prepareTurnSubmitCommandPayload(harness.deps, {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        }),
      ).rejects.toMatchObject({ body: { code: "native_session_record_unreadable" } });

      setThreadNativeResume(harness.deps.db, {
        threadId: thread.id,
        nativeResume: JSON.stringify({
          providerThreadId: "01a00000-0000-7000-8000-000000000000",
          baselineExecution: {
            model: "gpt-5.6-luna",
            permissionMode: "accept-edits",
            reasoningLevel: "low",
            serviceTier: "default",
          },
        }),
      });

      await expect(
        prepareTurnSubmitCommandPayload(harness.deps, {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread,
        }),
      ).rejects.toMatchObject({ body: { code: "native_session_record_unreadable" } });
    });
  });
});

describe("imported thread end to end", () => {
  it("records the intent through the real create path and replays it to a new runtime", async () => {
    await withTestHarness({}, async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-native-import",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const seededEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/native-import",
      });
      const created = await createThreadFromRequest(harness.deps, {
        environment: {
          type: "reuse",
          environmentId: seededEnvironment.id,
        },
        input: textInput("continue the imported session"),
        origin: "cli",
        projectId: project.id,
        providerId: "codex",
        nativeResumeSessionId: NATIVE_SESSION_ID,
        startedOnBehalfOf: null,
      });

      const stored = getThreadNativeResume(harness.deps.db, created.id);
      expect(stored).not.toBeNull();
      const record: unknown = JSON.parse(stored ?? "null");
      expect(record).toMatchObject({ providerThreadId: NATIVE_SESSION_ID });

      const environment = requireEnvironmentRow(harness, created.id);
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: NATIVE_SESSION_ID,
        sequenceStart: 500,
        threadId: created.id,
      });

      const submitCommand = await prepareTurnSubmitCommandPayload(
        harness.deps,
        {
          environment,
          execution: importedExecution,
          permissionEscalation: "ask",
          input: textInput("continue"),
          target: { mode: "start" },
          thread: requireThreadRow(harness, created.id),
        },
      );

      expect(submitCommand.resumeContext.nativeSession).toMatchObject({
        resumeOriginal: true,
      });
      const intent = submitCommand.resumeContext.nativeSession;
      expect(intent?.baselineExecution).toEqual({
        model: expect.any(String),
        permissionMode: expect.any(String),
        reasoningLevel: expect.any(String),
        serviceTier: expect.any(String),
      });
    });
  });
});

describe("native session adoption guards", () => {
  it("refuses to adopt while the thread is running", async () => {
    await withTestHarness({}, async (harness) => {
      const { thread } = await seedResumedThread(harness, {
        storeIntent: false,
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        threadId: thread.id,
        event: { type: "run.preparing" },
      });

      await expect(
        adoptNativeSession(harness.deps, {
          sessionId: NATIVE_SESSION_ID,
          threadId: thread.id,
        }),
      ).rejects.toMatchObject({
        body: { code: "native_session_adoption_unavailable" },
      });
      expect(getThreadNativeResume(harness.deps.db, thread.id)).toBeNull();
    });
  });

  it("refuses a session the thread does not run and writes nothing", async () => {
    await withTestHarness({}, async (harness) => {
      const { thread } = await seedResumedThread(harness, {
        storeIntent: false,
      });

      await expect(
        adoptNativeSession(harness.deps, {
          sessionId: "01a00000-0000-7000-8000-000000000000",
          threadId: thread.id,
        }),
      ).rejects.toMatchObject({
        body: { code: "native_session_adoption_unavailable" },
      });
      expect(getThreadNativeResume(harness.deps.db, thread.id)).toBeNull();
    });
  });

  it("writes nothing when the thread changes while the session is confirmed", async () => {
    await withTestHarness({}, async (harness) => {
      const { host, session, thread } = await seedResumedThread(harness, {
        storeIntent: false,
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: ({ command }) => {
          if (command.type !== "host.read_native_history") {
            throw new Error(`Unexpected host command ${command.type}`);
          }
          applyLoggedThreadLifecycleEvent(harness.deps, {
            threadId: thread.id,
            event: { type: "run.preparing" },
          });
          return {
            ok: true,
            result: {
              contextUsage: null,
              messages: [],
              metadata: {
                model: null,
                permissionMode: null,
                title: null,
              },
              nextCursor: null,
              revision: "1:2:3",
              truncated: false,
            },
          };
        },
      });

      await expect(
        adoptNativeSession(harness.deps, {
          sessionId: NATIVE_SESSION_ID,
          threadId: thread.id,
        }),
      ).rejects.toMatchObject({
        body: { code: "native_session_adoption_unavailable" },
      });
      expect(getThreadNativeResume(harness.deps.db, thread.id)).toBeNull();
    });
  });
});
