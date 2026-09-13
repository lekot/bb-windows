import type {
  ThreadNativeHistoryResponse,
  TimelineRow,
} from "@bb/server-contract";
import { isNativeServiceMessage } from "./native-service-message";

type NativeMessage = ThreadNativeHistoryResponse["messages"][number];

export function nativeMessageRows(
  threadId: string,
  messages: readonly NativeMessage[],
): TimelineRow[] {
  let previousTime = 0;
  return messages.map((message) => {
    const parsedTime =
      message.timestamp === null ? NaN : Date.parse(message.timestamp);
    const timestamp = Number.isFinite(parsedTime)
      ? Math.max(previousTime, parsedTime)
      : previousTime;
    previousTime = timestamp;
    const base = {
      id: `${threadId}:native:${message.id}`,
      threadId,
      turnId: null,
      sourceSeqStart: 0,
      sourceSeqEnd: 0,
      startedAt: timestamp,
      createdAt: timestamp,
      kind: "conversation" as const,
      text: message.text,
      attachments: message.images?.length ? {
        webImages: message.images.length,
        localImages: 0,
        localFiles: 0,
        imageUrls: message.images.map((image) =>
          `/api/v1/threads/${encodeURIComponent(threadId)}/native-image/content?${new URLSearchParams({ messageId: message.id, attachmentId: image.id })}`,
        ),
        localImagePaths: [],
        localFilePaths: [],
      } : null,
    };
    return message.role === "assistant" || isNativeServiceMessage(message.text)
      ? {
          ...base,
          role: "assistant",
          turnRequest: null,
        }
      : {
          ...base,
          role: "user",
          initiator: "user",
          senderThreadId: null,
          systemMessageKind: "unlabeled",
          systemMessageSubject: null,
          mentions: [],
          turnRequest: {
            isGrouped: false,
            kind: "message",
            status: "accepted",
          },
        };
  });
}

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" && row.children !== null ? flattenRows(row.children) : [row],
  );
}

export function mergeNativeTimeline(args: {
  threadId: string;
  messages: readonly NativeMessage[];
  rows: TimelineRow[];
  running: boolean;
}): TimelineRow[] {
  if (args.messages.length === 0) return args.rows;
  const native = nativeMessageRows(args.threadId, args.messages);
  const firstTime = native[0].startedAt;
  const lastTime = native[native.length - 1].startedAt;
  const flat = flattenRows(args.rows);
  const newestFirst = [...flat].reverse();
  const lastUser = newestFirst.find(
    (row) =>
      row.kind === "conversation" &&
      row.role === "user" &&
      !isNativeServiceMessage(row.text),
  );
  const lastConversation = newestFirst.find(
    (row) => row.kind === "conversation",
  );
  const hasLocalTail =
    args.running ||
    (lastConversation !== undefined && lastConversation.createdAt > lastTime);
  const boundary = hasLocalTail && lastUser ? lastUser.startedAt : Infinity;
  const nativePrompts = new Map<string, TimelineRow[]>();
  for (const row of native) {
    if (row.kind !== "conversation" || row.role !== "user") continue;
    const prompts = nativePrompts.get(row.text);
    if (prompts) prompts.push(row);
    else nativePrompts.set(row.text, [row]);
  }
  const ordering = new Map<string, number>();
  for (const row of flat) {
    if (row.kind === "conversation" || row.turnId === null) continue;
    const prompt = newestFirst.find(candidate =>
      candidate.kind === "conversation" && candidate.role === "user" &&
      candidate.turnId === row.turnId && candidate.startedAt <= row.startedAt,
    );
    if (prompt?.kind !== "conversation") continue;
    const matches = [...(nativePrompts.get(prompt.text) ?? [])]
      .sort((a, b) => Math.abs(a.startedAt - prompt.startedAt) - Math.abs(b.startedAt - prompt.startedAt));
    const anchor = matches[0];
    if (!anchor || Math.abs(anchor.startedAt - prompt.startedAt) > 60_000) continue;
    if (matches[1] && Math.abs(matches[1].startedAt - prompt.startedAt) === Math.abs(anchor.startedAt - prompt.startedAt)) continue;
    ordering.set(row.id, Math.max(row.startedAt, anchor.startedAt));
  }
  const orderTime = (row: TimelineRow) => ordering.get(row.id) ?? row.startedAt;
  const historical = flat.filter(
    (row) =>
      row.kind !== "conversation" &&
      orderTime(row) >= firstTime &&
      row.startedAt < boundary,
  );
  const localTail = args.rows.filter((row) => row.startedAt >= boundary);
  return [
    ...native.filter((row) => row.startedAt < boundary),
    ...historical,
    ...localTail,
  ].sort((left, right) => orderTime(left) - orderTime(right));
}
