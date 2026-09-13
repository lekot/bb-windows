import type { ThreadListEntry } from "@bb/domain";
import { isSidebarProjectThread } from "@bb/client-core";
import { isThreadRead, type ThreadReadState } from "@bb/client-core";

type FaviconSidebarThread = ThreadReadState &
  Pick<
    ThreadListEntry,
    | "hasPendingInteraction"
    | "id"
    | "originKind"
    | "parentThreadId"
    | "visibility"
  >;

interface ShouldShowFaviconAttentionDotArgs {
  currentThreadHasPendingInteraction: boolean;
  currentThreadId?: string | null;
  isDocumentVisible: boolean;
  isThreadView: boolean;
  sidebarThreads: readonly FaviconSidebarThread[];
  thread: ThreadReadState | null | undefined;
}

function isUnreadSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && !isThreadRead(thread);
}

function isPendingSidebarThread(thread: FaviconSidebarThread): boolean {
  return isSidebarProjectThread(thread) && thread.hasPendingInteraction;
}

function isPendingDelegatedChildOfCurrentThread(
  thread: FaviconSidebarThread,
  currentThreadId: string,
): boolean {
  return (
    thread.parentThreadId === currentThreadId &&
    thread.originKind === null &&
    thread.hasPendingInteraction
  );
}

function isPendingForkOfCurrentThread(
  thread: FaviconSidebarThread,
  currentThreadId: string,
): boolean {
  return (
    thread.parentThreadId === currentThreadId &&
    thread.originKind === "fork" &&
    thread.hasPendingInteraction
  );
}

export function shouldShowFaviconAttentionDot({
  currentThreadHasPendingInteraction,
  currentThreadId,
  isDocumentVisible,
  isThreadView,
  sidebarThreads,
  thread,
}: ShouldShowFaviconAttentionDotArgs): boolean {
  const sidebarNeedsAttention = sidebarThreads.some(
    (candidate) =>
      !(
        isThreadView &&
        isDocumentVisible &&
        currentThreadId != null &&
        candidate.id === currentThreadId
      ) &&
      (isUnreadSidebarThread(candidate) ||
        (isPendingSidebarThread(candidate) &&
          !(
            currentThreadId != null &&
            isPendingForkOfCurrentThread(candidate, currentThreadId)
          ))),
  );

  if (isThreadView) {
    const hiddenCurrentThreadNeedsAttention =
      !isDocumentVisible && Boolean(thread && !isThreadRead(thread));
    const childNeedsAttention =
      currentThreadId != null &&
      sidebarThreads.some((candidate) =>
        isPendingDelegatedChildOfCurrentThread(candidate, currentThreadId),
      );
    return (
      currentThreadHasPendingInteraction ||
      hiddenCurrentThreadNeedsAttention ||
      childNeedsAttention ||
      sidebarNeedsAttention
    );
  }

  return sidebarNeedsAttention;
}
