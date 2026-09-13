import { extractThreadContextWindowUsage } from "@bb/thread-view";
import { clearTimelineOrderingContextCache } from "../../services/threads/timeline-context-order.js";
import path from "node:path";
import {
  getAppSettings,
  getThreadNativeResume,
  getThreadPluginMetadata,
  patchThreadPluginMetadata,
  getLatestCompletedThreadContextClearSequence,
  listContextWindowUsageRows,
  getLatestThreadSequence,
  getLatestStoredConversationOutlineSequence,
  listQueuedThreadMessages,
} from "@bb/db";
import type { Hono } from "hono";
import {
  PROMPT_HISTORY_ENTRY_LIMIT,
  threadEventTypeSchema,
  type ThreadEventType,
} from "@bb/domain";
import {
  publicApiRoutes,
  THREAD_EVENT_LIST_PAGE_SIZE,
  typedRoutes,
  type PublicApiSchema,
  type ThreadConversationOutlineResponse,
  type ThreadNativeHistoryResponse,
  type ThreadNativeImageQuery,
  type ThreadTimelineQuery,
} from "@bb/server-contract";
import type {
  AppDeps,
  LoggedWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
  requireReadyEnvironment,
} from "../../services/lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../../services/lib/lifecycle-api-errors.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  type DaemonFileReadResult,
  serveDaemonFileContent,
} from "../../services/hosts/daemon-file-response.js";
import { requireThreadStoragePath } from "../../services/threads/thread-storage.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import {
  toThreadEventWithMeta,
  buildThreadConversationOutlineProjectionKey,
  buildThreadTimelineWithProfile,
  buildTimelineTurnSummaryDetails,
  loadThreadConversationOutline,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  THREAD_TIMELINE_SEGMENT_LIMIT_MAX,
} from "../../services/threads/timeline.js";
import type {
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
} from "../../services/threads/timeline-pagination.js";
import { createSlowThreadTimelineBuildLogger } from "../../services/threads/timeline-build-log.js";
import {
  buildThreadTimelineCacheKey,
  buildThreadTimelineParamsKey,
  createThreadTimelineCache,
} from "../../services/threads/timeline-cache.js";
import { createTimelineLatestRowsCache } from "../../services/threads/timeline-latest-rows-cache.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "../../services/threads/timeline-output-truncation.js";
import { previewTimelineResponseOutputs } from "../../services/threads/timeline-output-preview.js";
import { computeTimelineRowDelta } from "@bb/server-contract";
import {
  findThreadEvent,
  getLastThreadOutput,
  listThreadEventRows,
} from "../../services/threads/thread-data.js";
import { getLastProviderThreadId } from "../../services/threads/thread-events.js";
import { listThreadPromptHistory } from "../../services/prompt-history.js";
import { tryResolveExistingThreadExecutionPlan } from "../../services/threads/thread-execution-plan.js";
import {
  parseBoundedPositiveOptionalInteger,
  parseInteger,
  parseOptionalInteger,
} from "../../services/lib/validation.js";
import { resolveProviderPlanCommand } from "../../services/providers/provider-plan-command.js";
import { parsePathKindInclusion } from "../path-list-inclusion.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
} from "../path-list-policy.js";
import { parseFileListLimit } from "../file-list-query.js";
import { parseSafeRelativeRoutePath } from "../relative-route-path.js";

function resolveThreadProviderDisplayName(
  deps: Pick<AppDeps, "providerRegistry">,
  providerId: string,
): string | undefined {
  return deps.providerRegistry.get(providerId)?.info.displayName;
}

function validateFilePath(filePath: string): void {
  if (
    filePath.startsWith("/") ||
    filePath.split("/").includes("..") ||
    filePath.split("\\").includes("..")
  ) {
    throw new ApiError(400, "invalid_request", "Invalid file path");
  }
}

interface ThreadStorageTarget {
  hostId: string;
  storagePath: string;
}

interface RequireThreadStorageTargetArgs {
  threadId: string;
}

const RAW_FILE_NO_STORE_CACHE_CONTROL = "no-store";
const RAW_FILE_HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const RAW_FILE_CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const GENERIC_HTML_PREVIEW_CSP = "sandbox allow-scripts";

const UNSUPPORTED_NATIVE_HISTORY: ThreadNativeHistoryResponse = {
  supported: false,
  revision: null,
  contextUsage: null,
  messages: [],
  nextCursor: null,
  metadata: {
    title: null,
    model: null,
    permissionMode: null,
  },
  truncated: false,
};

const EMPTY_BB_NATIVE_HISTORY: ThreadNativeHistoryResponse = {
  supported: true,
  revision: null,
  contextUsage: null,
  messages: [],
  nextCursor: null,
  metadata: {
    title: null,
    model: null,
    permissionMode: null,
    sessionOrigin: "bb",
  },
  truncated: false,
};

function parseThreadEventTypes(
  value: string | undefined,
): ThreadEventType[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((type) => {
    const parsed = threadEventTypeSchema.safeParse(type);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid event type");
    }
    return parsed.data;
  });
}

function parseThreadTimelineSegmentLimit(
  defaultLimit: number,
  rawLimit: string | undefined,
): number {
  const limit = parseOptionalInteger(rawLimit, "segmentLimit") ?? defaultLimit;
  if (limit <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "segmentLimit must be a positive integer",
    );
  }
  if (limit > THREAD_TIMELINE_SEGMENT_LIMIT_MAX) {
    throw new ApiError(
      400,
      "invalid_request",
      `segmentLimit must be less than or equal to ${THREAD_TIMELINE_SEGMENT_LIMIT_MAX}`,
    );
  }
  return limit;
}

function parseThreadTimelinePage(
  query: ThreadTimelineQuery,
): ThreadTimelinePageRequest {
  const hasBeforeAnchorSeq = query.beforeAnchorSeq !== undefined;
  const kind: ThreadTimelinePageKind = hasBeforeAnchorSeq ? "older" : "latest";
  const segmentLimit = parseThreadTimelineSegmentLimit(
    THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
    query.segmentLimit,
  );

  if (kind === "latest") {
    return {
      kind,
      segmentLimit,
    };
  }

  if (
    query.beforeAnchorSeq === undefined ||
    query.beforeAnchorId === undefined
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "beforeAnchorSeq and beforeAnchorId must be provided together",
    );
  }

  return {
    beforeCursor: {
      anchorSeq: parseInteger(query.beforeAnchorSeq, "beforeAnchorSeq"),
      anchorId: query.beforeAnchorId,
    },
    kind,
    segmentLimit,
  };
}

async function requireThreadStorageTarget(
  deps: WorkSessionDeps,
  args: RequireThreadStorageTargetArgs,
): Promise<ThreadStorageTarget> {
  const thread = requirePublicThread(deps.db, args.threadId);
  if (!thread.environmentId) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  const environment = requireEnvironment(deps.db, thread.environmentId);
  return {
    hostId: environment.hostId,
    storagePath: await requireThreadStoragePath(deps, {
      hostId: environment.hostId,
      threadId: thread.id,
    }),
  };
}

function isHtmlPreviewPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".html");
}

function assertHtmlPreviewSize(relativePath: string, sizeBytes: number): void {
  if (isHtmlPreviewPath(relativePath) && sizeBytes > HTML_PREVIEW_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "HTML preview exceeds the 5 MB limit",
      false,
    );
  }
}

function createRawFilePreviewResponse(
  result: DaemonFileReadResult,
  relativePath: string,
  ifNoneMatch: string | undefined,
): Response {
  assertHtmlPreviewSize(relativePath, result.sizeBytes);
  const headers = new Headers({
    "x-content-type-options": RAW_FILE_CONTENT_TYPE_OPTIONS,
  });
  const isHtml = isHtmlPreviewPath(relativePath);
  if (isHtml) {
    headers.set("cache-control", RAW_FILE_NO_STORE_CACHE_CONTROL);
    headers.set("content-security-policy", GENERIC_HTML_PREVIEW_CSP);
    headers.set("content-type", RAW_FILE_HTML_CONTENT_TYPE);
  }
  return createDaemonFileContentResponse(result, {
    headers,
    ifNoneMatch: isHtml ? undefined : ifNoneMatch,
  });
}

async function serveThreadStorageRawFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string,
  ifNoneMatch: string | undefined,
): Promise<Response> {
  const filePath = parseSafeRelativeRoutePath(rawPath);
  const target = await requireThreadStorageTarget(deps, { threadId });

  return serveDaemonFileContent(
    deps,
    {
      hostId: target.hostId,
      ...(!isHtmlPreviewPath(filePath.relativePath) ? { ifNoneMatch } : {}),
      path: path.join(target.storagePath, filePath.relativePath),
      rootPath: target.storagePath,
    },
    (result) =>
      createRawFilePreviewResponse(result, filePath.relativePath, ifNoneMatch),
  );
}

async function serveThreadWorktreeRawFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string,
  ifNoneMatch: string | undefined,
): Promise<Response> {
  const filePath = parseSafeRelativeRoutePath(rawPath);
  const thread = requirePublicThread(deps.db, threadId);
  if (!thread.environmentId) {
    throw new ApiError(409, "invalid_request", "Thread has no environment");
  }
  const environment = requireReadyEnvironment(deps.db, thread.environmentId);

  return serveDaemonFileContent(
    deps,
    {
      hostId: environment.hostId,
      ...(!isHtmlPreviewPath(filePath.relativePath) ? { ifNoneMatch } : {}),
      path: path.join(environment.path, filePath.relativePath),
      rootPath: environment.path,
    },
    (result) =>
      createRawFilePreviewResponse(result, filePath.relativePath, ifNoneMatch),
  );
}

export function registerThreadDataRoutes(app: Hono, deps: AppDeps): void {
  const { get, patch, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;
  const timelineCache = createThreadTimelineCache();
  const timelineLatestRowsCache = createTimelineLatestRowsCache();
  deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "thread" &&
      message.changes.includes("history-rewritten")
    ) {
      clearTimelineOrderingContextCache(deps.db);
      timelineCache.invalidateThread(message.id);
      timelineLatestRowsCache.invalidateThread(message.id);
    }
  });
  const slowTimelineBuildLogger = createSlowThreadTimelineBuildLogger({
    logger: deps.logger,
  });
  const conversationOutlineCache = new Map<
    string,
    ThreadConversationOutlineResponse["items"]
  >();
  const CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES = 128;

  get(routes.pluginMetadata.get, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const { metadata, corrupt } = getThreadPluginMetadata(
      deps.db,
      thread.id,
      query.pluginId,
    );
    if (corrupt) {
      deps.logger.warn(
        `Ignoring corrupt plugin metadata for thread ${thread.id}, plugin ${query.pluginId}`,
      );
    }
    return context.json(metadata);
  });

  patch(routes.pluginMetadata.update, (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const result = patchThreadPluginMetadata(deps.db, {
      threadId: thread.id,
      pluginId: payload.pluginId,
      set: payload.set ?? {},
      remove: payload.remove ?? [],
    });
    if (!result.ok) {
      throw new ApiError(
        413,
        "invalid_request",
        "pluginMetadata exceeds 256 KiB",
      );
    }
    if (result.replacedCorrupt) {
      deps.logger.warn(
        `Replaced corrupt plugin metadata for thread ${thread.id}, plugin ${payload.pluginId}`,
      );
    }
    return context.json(result.metadata);
  });

  get(routes.context, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const sequenceStart =
      getLatestCompletedThreadContextClearSequence(deps.db, {
        threadId: thread.id,
      }) ?? 0;
    const rows = listContextWindowUsageRows(deps.db, {
      threadId: thread.id,
      sequenceStart,
    });
    return context.json({
      usage: extractThreadContextWindowUsage(rows.map(toThreadEventWithMeta)),
    });
  });

  get(routes.timeline, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const page = parseThreadTimelinePage(query);
    const includeNestedRows = query.includeNestedRows === "true";
    const summaryOnly = query.summaryOnly === "true";

    const providerDisplayName = resolveThreadProviderDisplayName(
      deps,
      thread.providerId,
    );
    const includeDiagnosticOperations = getAppSettings(
      deps.db,
    ).showDiagnosticEvents;
    const maxSeq = getLatestThreadSequence(deps.db, {
      threadId: thread.id,
    });
    const eventBudget = deps.config.featureFlags.timelineWindowEventBudget;
    const keyArgs = {
      threadId: thread.id,
      status: thread.status,
      environmentId: thread.environmentId,
      providerDisplayName,
      page,
      includeNestedRows,
      summaryOnly,
      includeDiagnosticOperations,
    };
    const full = timelineCache.getOrBuild(
      thread.id,
      buildThreadTimelineCacheKey({ ...keyArgs, maxSeq }),
      () => {
        const { profile, response } = buildThreadTimelineWithProfile(
          deps.db,
          thread,
          {
            eventBudget,
            includeDiagnosticOperations,
            includeNestedRows,
            maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
            maxSeq,
            page,
            providerDisplayName,
            planCommand: resolveProviderPlanCommand(
              deps.providerRegistry,
              thread.providerId,
            ),
            summaryOnly,
          },
        );
        slowTimelineBuildLogger.log({ profile, threadId: thread.id });
        const truncated = truncateTimelineResponseOutputs(
          response,
          DEFAULT_MAX_INLINE_OUTPUT_CHARS,
        );
        return includeNestedRows
          ? truncated
          : previewTimelineResponseOutputs(truncated);
      },
    );

    const afterSequence = parseOptionalInteger(
      query.afterSequence,
      "afterSequence",
    );
    const paramsKey = buildThreadTimelineParamsKey(keyArgs);
    const previous =
      afterSequence === undefined
        ? undefined
        : timelineLatestRowsCache.get(thread.id, paramsKey, afterSequence);
    const delta =
      previous === undefined
        ? undefined
        : computeTimelineRowDelta(previous.rows, full.rows);
    timelineLatestRowsCache.set(thread.id, paramsKey, {
      maxSeq,
      rows: full.rows,
    });

    return context.json(
      delta === undefined ? full : { ...full, rows: [], delta },
    );
  });

  get(routes.conversationOutline, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));

    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
    const outlineSequence = getLatestStoredConversationOutlineSequence(
      deps.db,
      { threadId: thread.id },
    );
    const providerDisplayName = resolveThreadProviderDisplayName(
      deps,
      thread.providerId,
    );
    const cacheKey = JSON.stringify([
      thread.id,
      buildThreadConversationOutlineProjectionKey(
        thread,
        outlineSequence,
        providerDisplayName,
      ),
    ]);
    const cached = conversationOutlineCache.get(cacheKey);
    if (cached !== undefined) {
      conversationOutlineCache.delete(cacheKey);
      conversationOutlineCache.set(cacheKey, cached);
      return context.json({ items: cached, maxSeq });
    }
    const response = loadThreadConversationOutline(deps.db, thread, {
      maxSeq,
      outlineSequence,
      ...(providerDisplayName === undefined ? {} : { providerDisplayName }),
    });
    conversationOutlineCache.set(cacheKey, response.items);
    while (
      conversationOutlineCache.size > CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES
    ) {
      const oldest = conversationOutlineCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      conversationOutlineCache.delete(oldest);
    }
    return context.json(response);
  });

  get(routes.timelineTurnSummaryDetails, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const includeDiagnosticOperations = getAppSettings(
      deps.db,
    ).showDiagnosticEvents;
    return context.json(
      buildTimelineTurnSummaryDetails(deps.db, thread, {
        beforeCursor: query.beforeCursor,
        includeDiagnosticOperations,
        providerDisplayName: resolveThreadProviderDisplayName(
          deps,
          thread.providerId,
        ),
        turnId: query.turnId,
        sourceSeqStart: parseInteger(query.sourceSeqStart, "sourceSeqStart"),
        sourceSeqEnd: parseInteger(query.sourceSeqEnd, "sourceSeqEnd"),
      }),
    );
  });

  get(routes.output, (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    return context.json({
      output: getLastThreadOutput(deps.db, context.req.param("id")),
    });
  });

  get(routes.queuedMessages, (context) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    return context.json(
      listQueuedThreadMessages(deps.db, threadId).map(toThreadQueuedMessage),
    );
  });

  get(routes.promptHistory, (context, query) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_ENTRY_LIMIT,
      max: PROMPT_HISTORY_ENTRY_LIMIT,
      name: "limit",
      value: query.limit,
    });

    return context.json(
      listThreadPromptHistory(deps, {
        threadId,
        limit,
      }),
    );
  });

  get(routes.nativeHistory, async (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const resumesNativeSession =
      getThreadNativeResume(deps.db, thread.id) !== null;
    const reader = deps.providerRegistry.nativeHistoryReader(thread.providerId);
    if (reader === null) {
      return context.json(UNSUPPORTED_NATIVE_HISTORY);
    }
    if (thread.environmentId === null) {
      throw new ApiError(
        409,
        "native_history_unavailable",
        "Native history requires the thread's original environment",
      );
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (environment.path === null) {
      throw new ApiError(
        409,
        "native_history_unavailable",
        "Native history requires the thread's original workspace path",
      );
    }
    const sessionId = getLastProviderThreadId(deps, thread.id);
    if (sessionId === null) {
      if (!resumesNativeSession) {
        return context.json(EMPTY_BB_NATIVE_HISTORY);
      }
      throw new ApiError(
        409,
        "native_history_unavailable",
        "Native session identity is unavailable for this thread",
      );
    }
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: 20,
      max: 100,
      name: "limit",
      value: query.limit,
    });
    try {
      const result =
        reader === "claude-transcript"
          ? await callHostRetryableOnlineRpc(deps, {
              hostId: environment.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "host.read_native_claude_history",
                before: query.before ?? null,
                cwd: environment.path,
                limit,
                sessionId,
              },
            })
          : await callHostRetryableOnlineRpc(deps, {
              hostId: environment.hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "host.read_native_history",
                before: query.before ?? null,
                cwd: environment.path,
                limit,
                reader,
                sessionId,
              },
            });
      const hostContextUsage = result.contextUsage;
      const contextUsage =
        hostContextUsage === null
          ? null
          : {
              usedTokens: hostContextUsage.usedTokens,
              observedAt: hostContextUsage.observedAt,
              model: hostContextUsage.model,
              contextWindow:
                "contextWindow" in hostContextUsage &&
                typeof hostContextUsage.contextWindow === "number"
                  ? hostContextUsage.contextWindow
                  : null,
            };
      return context.json({
        supported: true,
        ...result,
        contextUsage,
        metadata: {
          ...result.metadata,
          sessionOrigin: resumesNativeSession ? "native" : "bb",
        },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.body.code === "native_history_missing"
      ) {
        if (!resumesNativeSession) {
          return context.json(EMPTY_BB_NATIVE_HISTORY);
        }
        throw new ApiError(
          404,
          "native_history_missing",
          "Native transcript was not found for this session and cwd",
        );
      }
      throw error;
    }
  });

  const readThreadNativeImage = async (
    threadId: string,
    query: ThreadNativeImageQuery,
  ) => {
    const thread = requirePublicThread(deps.db, threadId);
    if (
      deps.providerRegistry.nativeHistoryReader(thread.providerId) !==
      "zcode-sqlite"
    ) {
      throw new ApiError(
        404,
        "native_image_unavailable",
        "Native image reading is unavailable for this provider",
      );
    }
    if (thread.environmentId === null)
      throw new ApiError(
        409,
        "native_image_unavailable",
        "Native image requires the original environment",
      );
    const environment = requireEnvironment(deps.db, thread.environmentId);
    const sessionId = getLastProviderThreadId(deps, thread.id);
    if (environment.path === null || sessionId === null)
      throw new ApiError(
        409,
        "native_image_unavailable",
        "Native session identity or workspace is unavailable",
      );
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_native_image",
        cwd: environment.path,
        sessionId,
        messageId: query.messageId,
        attachmentId: query.attachmentId,
      },
    });
    return result;
  };

  get(routes.nativeImage, async (context, query) => {
    const result = await readThreadNativeImage(context.req.param("id"), query);
    context.header("Cache-Control", "no-store");
    return context.json(result);
  });

  get(routes.nativeImageContent, async (context, query) => {
    const result = await readThreadNativeImage(context.req.param("id"), query);
    return new Response(Uint8Array.from(Buffer.from(result.base64, "base64")), {
      headers: {
        "Content-Type": result.mimeType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  get(routes.nativeQuota, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const reader = deps.providerRegistry.nativeHistoryReader(thread.providerId);
    if (reader !== "zcode-sqlite") {
      return context.json({
        supported: false,
        status: "unavailable",
        fiveHour: null,
        toolCalls: null,
        fetchedAt: null,
        reason: null,
      });
    }
    if (thread.environmentId === null) {
      return context.json({
        supported: true,
        status: "unavailable",
        fiveHour: null,
        toolCalls: null,
        fetchedAt: null,
        reason: "Native quota requires the thread's original environment",
      });
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (environment.hostId === null) {
      return context.json({
        supported: true,
        status: "unavailable",
        fiveHour: null,
        toolCalls: null,
        fetchedAt: null,
        reason: "Native quota requires a connected host",
      });
    }
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "host.read_zcode_quota" },
    });
    if (result.status === "ok") {
      return context.json({
        supported: true,
        status: "ok",
        fiveHour: result.fiveHour,
        toolCalls: result.toolCalls,
        fetchedAt: result.fetchedAt,
        reason: null,
      });
    }
    return context.json({
      supported: true,
      status: result.status,
      fiveHour: null,
      toolCalls: null,
      fetchedAt: null,
      reason: result.reason,
    });
  });

  get(routes.desktopSync, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const reader = deps.providerRegistry.nativeHistoryReader(thread.providerId);
    if (reader !== "zcode-sqlite") {
      return context.json({
        supported: false,
        nativeSessionId: null,
        nativeHistoryStatus: "unavailable",
        lastNativeMessageAt: null,
        desktopStatus: "unavailable",
        desktopTitle: null,
        desktopWorkspacePath: null,
        reason: "Desktop sync diagnostics require the ZCode provider",
      });
    }
    const sessionId = getLastProviderThreadId(deps, thread.id);
    if (sessionId === null) {
      return context.json({
        supported: true,
        nativeSessionId: null,
        nativeHistoryStatus: "unavailable",
        lastNativeMessageAt: null,
        desktopStatus: "unavailable",
        desktopTitle: null,
        desktopWorkspacePath: null,
        reason: "Native session identity is unavailable for this thread",
      });
    }
    if (thread.environmentId === null) {
      return context.json({
        supported: true,
        nativeSessionId: sessionId,
        nativeHistoryStatus: "unavailable",
        lastNativeMessageAt: null,
        desktopStatus: "unavailable",
        desktopTitle: null,
        desktopWorkspacePath: null,
        reason: "Desktop sync requires the thread's original environment",
      });
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (environment.hostId === null) {
      return context.json({
        supported: true,
        nativeSessionId: sessionId,
        nativeHistoryStatus: "unavailable",
        lastNativeMessageAt: null,
        desktopStatus: "unavailable",
        desktopTitle: null,
        desktopWorkspacePath: null,
        reason: "Desktop sync requires a connected host",
      });
    }
    const [historyResult, desktopResult] = await Promise.allSettled([
      callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_native_history",
          before: null,
          cwd: environment.path ?? "",
          limit: 1,
          reader,
          sessionId,
        },
      }),
      callHostRetryableOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.check_zcode_desktop_registration",
          sessionId,
        },
      }),
    ]);
    const history =
      historyResult.status === "fulfilled" ? historyResult.value : null;
    const desktop =
      desktopResult.status === "fulfilled" ? desktopResult.value : null;
    const nativeHistoryStatus = history === null ? "unavailable" : "ok";
    const lastNativeMessageAt =
      history !== null && history.messages.length > 0
        ? (history.messages[history.messages.length - 1]?.timestamp ?? null)
        : null;
    const desktopStatus = desktop === null ? "unavailable" : desktop.status;
    const reason =
      desktop !== null && desktop.status === "unavailable"
        ? desktop.reason
        : history === null
          ? "Native history read failed"
          : null;
    return context.json({
      supported: true,
      nativeSessionId: sessionId,
      nativeHistoryStatus,
      lastNativeMessageAt,
      desktopStatus,
      desktopTitle:
        desktop !== null && desktop.status === "registered"
          ? desktop.title
          : null,
      desktopWorkspacePath:
        desktop !== null && desktop.status === "registered"
          ? desktop.workspacePath
          : null,
      reason,
    });
  });

  post(routes.desktopRegister, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const sessionId = getLastProviderThreadId(deps, thread.id);
    const unavailable = (reason: string) =>
      context.json({
        supported: true,
        nativeSessionId: sessionId,
        outcome: { status: "unavailable", reason },
        reason,
      });
    if (
      deps.providerRegistry.nativeHistoryReader(thread.providerId) !==
      "zcode-sqlite"
    ) {
      return context.json({
        supported: false,
        nativeSessionId: null,
        outcome: {
          status: "unavailable",
          reason: "Desktop registration requires the ZCode provider",
        },
        reason: "Desktop registration requires the ZCode provider",
      });
    }
    if (sessionId === null) {
      return unavailable(
        "Native session identity is unavailable for this thread",
      );
    }
    if (thread.environmentId === null) {
      return unavailable(
        "Desktop registration requires the thread's original environment",
      );
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (environment.hostId === null) {
      return unavailable("Desktop registration requires a connected host");
    }
    if (environment.path === null || environment.path.length === 0) {
      return unavailable(
        "Desktop registration requires the original workspace path",
      );
    }
    let result;
    try {
      result = await callHostOnlineRpc(deps, {
        hostId: environment.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.register_zcode_desktop_task",
          sessionId,
          cwd: environment.path,
          title: thread.title ?? thread.titleFallback ?? "bb native session",
          apply: payload.apply,
        },
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "host call failed";
      return unavailable(`Desktop registration host call failed: ${detail}`);
    }
    const reason =
      result.status === "rejected" || result.status === "unavailable"
        ? result.reason
        : null;
    return context.json({
      supported: true,
      nativeSessionId: sessionId,
      outcome: result,
      reason,
    });
  });

  get(routes.events, (context, query) => {
    requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      listThreadEventRows(deps.db, {
        threadId: context.req.param("id"),
        afterSeq: parseOptionalInteger(query.afterSeq, "afterSeq"),
        beforeSeq: parseOptionalInteger(query.beforeSeq, "beforeSeq"),
        limit: parseBoundedPositiveOptionalInteger({
          defaultValue: THREAD_EVENT_LIST_PAGE_SIZE,
          max: THREAD_EVENT_LIST_PAGE_SIZE,
          name: "limit",
          value: query.limit,
        }),
        order: query.order,
        types: parseThreadEventTypes(query.types),
      }),
    );
  });

  get(routes.eventWait, async (context, query) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);

    const afterSeq = parseOptionalInteger(query.afterSeq, "afterSeq");
    const waitMs = Math.min(
      parseOptionalInteger(query.waitMs, "waitMs") ?? 30_000,
      60_000,
    );
    const parsedEventType = threadEventTypeSchema.safeParse(query.type);
    if (!parsedEventType.success) {
      throw new ApiError(400, "invalid_request", "Invalid event type");
    }
    const eventType = parsedEventType.data;

    const findMatch = () =>
      findThreadEvent(deps.db, { threadId, type: eventType, afterSeq });

    const deadline = Date.now() + waitMs;
    let match = findMatch();
    while (!match) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const waiter = deps.hub.registerThreadEventWaiter(threadId, remaining);
      match = findMatch();
      if (match) {
        waiter.cancel();
        break;
      }
      await waiter.promise;
      match = findMatch();
    }

    if (!match) {
      return new Response(null, { status: 204 });
    }

    return context.json(match);
  });

  get(routes.defaultExecutionOptions, async (context) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    return context.json(
      (
        await tryResolveExistingThreadExecutionPlan(deps, {
          executionSource: "client/turn/requested",
          input: {},
          threadId,
        })
      )?.resolvedExecution ?? null,
    );
  });

  get(routes.worktreeFile, async (context) =>
    serveThreadWorktreeRawFile(
      deps,
      context.req.param("id"),
      context.req.param("filePath"),
      context.req.header("if-none-match"),
    ),
  );

  get(routes.storageFiles, async (context, query) => {
    const target = await requireThreadStorageTarget(deps, {
      threadId: context.req.param("id"),
    });
    const limit = parseFileListLimit(query.limit);

    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_files",
          path: target.storagePath,
          ...(query.query ? { query: query.query } : {}),
          limit,
          includeHidden: THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
        },
      });
      return context.json({
        files: result.files,
        truncated: result.truncated,
        storageRootPath: target.storagePath,
      });
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "ENOENT") {
        return context.json({
          files: [],
          truncated: false,
          storageRootPath: target.storagePath,
        });
      }
      throw error;
    }
  });

  get(routes.storageLocation, async (context) => {
    const target = await requireThreadStorageTarget(deps, {
      threadId: context.req.param("id"),
    });
    return context.json({
      hostId: target.hostId,
      storageRootPath: target.storagePath,
    });
  });

  get(routes.storageFile, async (context) =>
    serveThreadStorageRawFile(
      deps,
      context.req.param("id"),
      context.req.param("filePath"),
      context.req.header("if-none-match"),
    ),
  );

  get(routes.storagePaths, async (context, query) => {
    const target = await requireThreadStorageTarget(deps, {
      threadId: context.req.param("id"),
    });
    const limit = parseFileListLimit(query.limit);
    const inclusion = parsePathKindInclusion({
      includeFiles: query.includeFiles,
      includeDirectories: query.includeDirectories,
    });

    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: target.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_paths",
          path: target.storagePath,
          ...(query.query ? { query: query.query } : {}),
          limit,
          includeFiles: inclusion.includeFiles,
          includeDirectories: inclusion.includeDirectories,
          includeHidden: THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
        },
      });
      return context.json({
        paths: result.paths,
        truncated: result.truncated,
        storageRootPath: target.storagePath,
      });
    } catch (error) {
      if (error instanceof ApiError && error.body.code === "ENOENT") {
        return context.json({
          paths: [],
          truncated: false,
          storageRootPath: target.storagePath,
        });
      }
      throw error;
    }
  });

  get(routes.storageContent, async (context, query) => {
    validateFilePath(query.path);
    const target = await requireThreadStorageTarget(deps, {
      threadId: context.req.param("id"),
    });

    return serveDaemonFileContent(
      deps,
      {
        hostId: target.hostId,
        ifNoneMatch: context.req.header("if-none-match"),
        path: path.join(target.storagePath, query.path),
        rootPath: target.storagePath,
      },
      (result) =>
        createDaemonFileContentResponse(result, {
          ifNoneMatch: context.req.header("if-none-match"),
        }),
    );
  });

  get(routes.hostFileContent, async (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (!thread.environmentId) {
      throwThreadEnvironmentUnavailable(
        threadEnvironmentUnavailableDetails("never_attached", null),
      );
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);

    return serveDaemonFileContent(
      deps,
      {
        hostId: environment.hostId,
        ifNoneMatch: context.req.header("if-none-match"),
        path: query.path,
      },
      (result) =>
        createDaemonFileContentResponse(result, {
          ifNoneMatch: context.req.header("if-none-match"),
        }),
    );
  });
}
