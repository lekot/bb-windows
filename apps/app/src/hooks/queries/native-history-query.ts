import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ThreadNativeHistoryResponse } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";

const NATIVE_HISTORY_PAGE_SIZE = 20;
const NATIVE_HISTORY_POLL_INTERVAL_MS = 10_000;

type NativeHistoryMessage = ThreadNativeHistoryResponse["messages"][number];

interface NativeHistoryRequest {
  before?: string;
  limit?: number;
  signal?: AbortSignal;
  threadId: string;
}

interface NativeHistoryStore {
  generation: number;
  initialized: boolean;
  isLoadingOlder: boolean;
  loadedOlder: boolean;
  messageIds: Set<string>;
  messages: NativeHistoryMessage[];
  nextCursor: string | null;
  olderError: Error | null;
}

export const nativeHistoryQueryKey = (threadId: string) =>
  ["thread-native-history", threadId] as const;

function requestNativeHistory(args: NativeHistoryRequest) {
  const request = {
    threadId: args.threadId,
    ...(args.before === undefined ? {} : { before: args.before }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.signal === undefined ? {} : { signal: args.signal }),
  };
  return sdk.threads.nativeHistory(request);
}

export const nativeHistoryQueryOptions = (threadId: string) => ({
  queryKey: nativeHistoryQueryKey(threadId),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    requestNativeHistory({
      limit: NATIVE_HISTORY_PAGE_SIZE,
      signal,
      threadId,
    }),
  staleTime: 0,
  retry: false as const,
});

function createNativeHistoryStore(): NativeHistoryStore {
  return {
    generation: 0,
    initialized: false,
    isLoadingOlder: false,
    loadedOlder: false,
    messageIds: new Set(),
    messages: [],
    nextCursor: null,
    olderError: null,
  };
}

function mergeMessages(
  ...messageLists: readonly NativeHistoryMessage[][]
): NativeHistoryMessage[] {
  const messagesById = new Map<string, NativeHistoryMessage>();
  for (let listIndex = messageLists.length - 1; listIndex >= 0; listIndex -= 1) {
    const messageList = messageLists[listIndex];
    for (
      let messageIndex = messageList.length - 1;
      messageIndex >= 0;
      messageIndex -= 1
    ) {
      const message = messageList[messageIndex];
      if (!messagesById.has(message.id)) {
        messagesById.set(message.id, message);
      }
    }
  }
  return Array.from(messagesById.values()).reverse();
}

function replaceMessages(
  store: NativeHistoryStore,
  messages: NativeHistoryMessage[],
): void {
  store.messages = messages;
  store.messageIds = new Set(messages.map((message) => message.id));
}

function readNextCursor(response: ThreadNativeHistoryResponse): string | null {
  if (!("nextCursor" in response)) return null;
  return typeof response.nextCursor === "string" ? response.nextCursor : null;
}

function resetStore(
  store: NativeHistoryStore,
  messages: NativeHistoryMessage[],
  nextCursor: string | null,
): void {
  replaceMessages(store, messages);
  store.nextCursor = nextCursor;
  store.loadedOlder = false;
  store.olderError = null;
  store.generation += 1;
}

function applyHeadResponse(
  store: NativeHistoryStore,
  response: ThreadNativeHistoryResponse,
): void {
  const nextCursor = readNextCursor(response);

  if (!store.initialized) {
    store.initialized = true;
    store.olderError = null;
    if (response.supported) {
      replaceMessages(store, mergeMessages(response.messages));
      store.nextCursor = nextCursor;
    } else {
      resetStore(store, [], null);
    }
    return;
  }

  if (!response.supported || response.messages.length === 0) {
    resetStore(store, [], response.supported ? nextCursor : null);
    return;
  }

  if (nextCursor === null && !response.truncated) {
    resetStore(store, mergeMessages(response.messages), null);
    return;
  }

  const hasOverlap = response.messages.some((message) =>
    store.messageIds.has(message.id),
  );
  if (store.messageIds.size > 0 && !hasOverlap) {
    resetStore(store, mergeMessages(response.messages), nextCursor);
    return;
  }

  replaceMessages(store, mergeMessages(store.messages, response.messages));
  if (!store.loadedOlder) {
    store.nextCursor = nextCursor;
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function useNativeHistory(threadId: string, enabled: boolean) {
  const query = useQuery({
    ...nativeHistoryQueryOptions(threadId),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.supported === false
        ? false
        : NATIVE_HISTORY_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    gcTime: 60_000,
  });

  const storesRef = useRef(new Map<string, NativeHistoryStore>());
  const store = useMemo(() => {
    const existing = storesRef.current.get(threadId);
    if (existing !== undefined) return existing;
    const created = createNativeHistoryStore();
    storesRef.current.set(threadId, created);
    return created;
  }, [threadId]);
  const [, setRenderVersion] = useState(0);

  useEffect(() => {
    if (query.data === undefined) return;
    applyHeadResponse(store, query.data);
    setRenderVersion((version) => version + 1);
  }, [query.data, store]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (
      !store.initialized ||
      store.nextCursor === null ||
      store.isLoadingOlder
    ) {
      return;
    }

    const cursor = store.nextCursor;
    const generation = store.generation;
    store.isLoadingOlder = true;
    store.olderError = null;
    setRenderVersion((version) => version + 1);

    try {
      const response = await requestNativeHistory({
        before: cursor,
        limit: NATIVE_HISTORY_PAGE_SIZE,
        threadId,
      });
      if (store.generation !== generation || store.nextCursor !== cursor) {
        return;
      }

      if (!response.supported) {
        store.nextCursor = null;
        return;
      }

      replaceMessages(store, mergeMessages(response.messages, store.messages));
      store.nextCursor = readNextCursor(response);
      store.loadedOlder = true;
    } catch (error) {
      const nextError = toError(error);
      store.olderError = nextError;
      throw nextError;
    } finally {
      store.isLoadingOlder = false;
      setRenderVersion((version) => version + 1);
    }
  }, [store, threadId]);

  return {
    ...query,
    messages: store.messages,
    hasOlder: store.initialized && store.nextCursor !== null,
    isLoadingOlder: store.isLoadingOlder,
    loadOlder,
    olderError: store.olderError,
  };
}
