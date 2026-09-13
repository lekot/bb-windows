import { getThreadNativeResume, setThreadNativeResume } from "@bb/db";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "@bb/domain";
import type { NativeSessionResumeIntent } from "@bb/host-daemon-contract";
import { z } from "zod";
import type { NativeHistoryReader } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { buildExecutionOptions } from "./thread-commands.js";
import { getLastProviderThreadId } from "./thread-events.js";
import type {
  LoggedWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";

const storedNativeResumeSchema = z
  .object({
    providerThreadId: z.string().min(1),
    baselineExecution: z
      .object({
        model: z.string().min(1),
        permissionMode: permissionModeSchema,
        reasoningLevel: reasoningLevelSchema,
        serviceTier: serviceTierSchema,
      })
      .strict(),
  })
  .strict();

export type NativeSessionBaselineExecution = z.infer<
  typeof storedNativeResumeSchema
>["baselineExecution"];

type StoredNativeResume = z.infer<typeof storedNativeResumeSchema>;

function unreadableRecord(threadId: string, detail: string): ApiError {
  return new ApiError(
    409,
    "native_session_record_unreadable",
    `Thread ${threadId} continues a native provider session, but bb cannot read the record of it (${detail}). Resuming would hand the session bb's own model and permissions instead of the ones it was imported with, so bb refuses the turn.`,
  );
}

function readStoredNativeResume(
  deps: Pick<WorkSessionDeps, "db">,
  threadId: string,
): StoredNativeResume | null {
  const stored = getThreadNativeResume(deps.db, threadId);
  if (stored === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw unreadableRecord(threadId, "it is not valid JSON");
  }
  const record = storedNativeResumeSchema.safeParse(parsed);
  if (!record.success) {
    throw unreadableRecord(
      threadId,
      record.error.issues
        .map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`)
        .join("; "),
    );
  }
  return record.data;
}

export function nativeSessionForkDescriptor(
  deps: Pick<WorkSessionDeps, "db">,
  threadId: string,
): { resumeOriginal: true; sourceProviderThreadId: string } | null {
  const record = readStoredNativeResume(deps, threadId);
  return record === null
    ? null
    : {
        resumeOriginal: true,
        sourceProviderThreadId: record.providerThreadId,
      };
}

export function readNativeSessionResumeIntent(
  deps: Pick<WorkSessionDeps, "db">,
  args: { providerThreadId: string; threadId: string },
): NativeSessionResumeIntent | null {
  const record = readStoredNativeResume(deps, args.threadId);
  if (record === null) return null;
  if (record.providerThreadId !== args.providerThreadId) {
    throw unreadableRecord(
      args.threadId,
      `it names session ${record.providerThreadId}, but the thread now runs ${args.providerThreadId}`,
    );
  }
  return { resumeOriginal: true, baselineExecution: record.baselineExecution };
}

export interface AdoptNativeSessionArgs {
  sessionId: string;
  threadId: string;
}

interface AdoptionSnapshot {
  environment: { hostId: string; path: string };
  execution: NativeSessionBaselineExecution;
  providerThreadId: string;
  reader: NativeHistoryReader;
}

function adoptionConflict(threadId: string, detail: string): ApiError {
  return new ApiError(
    409,
    "native_session_adoption_unavailable",
    `bb did not record the native session for thread ${threadId}: ${detail}.`,
  );
}

async function readAdoptionSnapshot(
  deps: LoggedWorkSessionDeps,
  args: AdoptNativeSessionArgs,
): Promise<AdoptionSnapshot> {
  const thread = requirePublicThread(deps.db, args.threadId);
  if (thread.status !== "idle") {
    throw adoptionConflict(
      args.threadId,
      `the thread is ${thread.status}; stop it first so the recorded settings match the session bb will resume`,
    );
  }
  const reader = deps.providerRegistry.nativeHistoryReader(thread.providerId);
  if (reader === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Provider ${thread.providerId} has no native sessions to adopt.`,
    );
  }
  const providerThreadId = getLastProviderThreadId(deps, args.threadId);
  if (providerThreadId !== args.sessionId) {
    throw adoptionConflict(
      args.threadId,
      `it continues native session ${providerThreadId ?? "none"}, not ${args.sessionId}`,
    );
  }
  if (thread.environmentId === null) {
    throw adoptionConflict(args.threadId, "it has no environment");
  }
  const environment = requireEnvironment(deps.db, thread.environmentId);
  if (environment.path === null) {
    throw adoptionConflict(args.threadId, "its environment has no workspace path");
  }
  const execution = await buildExecutionOptions(deps, {}, {
    threadId: args.threadId,
  });
  return {
    environment: { hostId: environment.hostId, path: environment.path },
    execution: {
      model: execution.model,
      permissionMode: execution.permissionMode,
      reasoningLevel: execution.reasoningLevel,
      serviceTier: execution.serviceTier,
    },
    providerThreadId,
    reader,
  };
}

export async function adoptNativeSession(
  deps: LoggedWorkSessionDeps,
  args: AdoptNativeSessionArgs,
): Promise<void> {
  const before = await readAdoptionSnapshot(deps, args);
  try {
    await callHostRetryableOnlineRpc(deps, {
      hostId: before.environment.hostId,
      timeoutMs: 15_000,
      command: {
        type: "host.read_native_history",
        before: null,
        cwd: before.environment.path,
        limit: 1,
        reader: before.reader,
        sessionId: args.sessionId,
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "native_history_missing") {
      throw adoptionConflict(
        args.threadId,
        `native session ${args.sessionId} was not found in ${before.environment.path}`,
      );
    }
    throw error;
  }
  const after = await readAdoptionSnapshot(deps, args);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw adoptionConflict(
      args.threadId,
      "the thread changed while bb was confirming the session; retry once it is idle again",
    );
  }
  setThreadNativeResume(deps.db, {
    threadId: args.threadId,
    nativeResume: JSON.stringify({
      providerThreadId: args.sessionId,
      baselineExecution: after.execution,
    }),
  });
}
