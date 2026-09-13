import { describe, expect, it } from "vitest";
import type {
  ThreadNativeHistoryResponse,
  TimelineRow,
} from "@bb/server-contract";
import { timelineRowSchema } from "@bb/server-contract";
import {
  mergeNativeTimeline,
  nativeMessageRows,
} from "./native-history-timeline";

const threadId = "thread-1";
it("keeps native image identity in lazy attachment URLs", () => {
  const rows = nativeMessageRows(threadId, [{
    id: "message&1",
    role: "user",
    text: "",
    timestamp: null,
    images: [{ id: "part+1", mimeType: "image/png" }],
  }]);
  expect(timelineRowSchema.safeParse(rows[0]).success).toBe(true);
  expect(rows[0]).toMatchObject({
    text: "",
    attachments: {
      imageUrls: ["/api/v1/threads/thread-1/native-image/content?messageId=message%261&attachmentId=part%2B1"],
      webImages: 1,
    },
  });
});

function message(
  id: string,
  role: "user" | "assistant",
  time: number,
  text = id,
): ThreadNativeHistoryResponse["messages"][number] {
  return { id, role, text, timestamp: new Date(time).toISOString() };
}
function local(
  id: string,
  role: "user" | "assistant",
  time: number,
): Extract<TimelineRow, { kind: "conversation" }> {
  const row = nativeMessageRows(threadId, [message(id, role, time)])[0];
  if (row === undefined || row.kind !== "conversation") {
    throw new Error("Expected a native conversation row");
  }
  return {
    ...row,
    id,
    sourceSeqStart: time,
    sourceSeqEnd: time,
  };
}
function merge(
  messages: ThreadNativeHistoryResponse["messages"],
  rows: TimelineRow[],
  running = false,
) {
  return mergeNativeTimeline({ threadId, messages, rows, running });
}

describe("native history timeline", () => {
  it("anchors work after its own repeated native prompt without changing recorded times", () => {
    const prompt = (id: string, time: number, turnId: string): TimelineRow => ({
      ...local(id, "user", time), text: "+", turnId,
    });
    const work = (id: string, time: number): TimelineRow => ({
      id, threadId, turnId: id, kind: "turn", sourceSeqStart: 1, sourceSeqEnd: 2,
      startedAt: time, createdAt: time, status: "completed", summaryCount: 1,
      completedAt: time + 40, children: null,
    });
    const first = work("turn1", 100);
    const second = work("turn2", 300);
    const rows = merge(
      [message("u1", "user", 105, "+"), message("a1", "assistant", 150), message("u2", "user", 305, "+"), message("a2", "assistant", 350)],
      [prompt("p1", 95, "turn1"), first, prompt("p2", 295, "turn2"), second],
    );
    expect(rows.map(row => row.id)).toEqual(["thread-1:native:u1", "turn1", "thread-1:native:a1", "thread-1:native:u2", "turn2", "thread-1:native:a2"]);
    expect(first.startedAt).toBe(100);
    expect(second.startedAt).toBe(300);
  });
  it("preserves lazy completed turn details when native messages replace local conversation", () => {
    const turn: TimelineRow = {
      id: "bb-work", threadId, turnId: "turn-1", kind: "turn",
      sourceSeqStart: 2, sourceSeqEnd: 5, startedAt: 150, createdAt: 150,
      status: "completed", summaryCount: 2, completedAt: 190, children: null,
    };
    expect(timelineRowSchema.safeParse(turn).success).toBe(true);
    const rows = merge(
      [message("u", "user", 101), message("a", "assistant", 201)],
      [local("bb-u", "user", 100), turn, local("bb-a", "assistant", 200)],
    );
    expect(rows.map(row => row.id)).toEqual(["thread-1:native:u", "bb-work", "thread-1:native:a"]);
    expect(rows[1]).toBe(turn);
  });
  it("renders native messages as regular conversation rows with no editable bb sequence", () => {
    const rows = nativeMessageRows(threadId, [
      message("u", "user", 10),
      message("a", "assistant", 20, "**bold**\n```ts\n1\n```"),
    ]);
    for (const row of rows)
      expect(timelineRowSchema.safeParse(row).success).toBe(true);
    expect(rows[1]).toMatchObject({
      kind: "conversation",
      text: "**bold**\n```ts\n1\n```",
      sourceSeqEnd: 0,
    });
  });
  it("places the later VS Code reply after the bb exchange without duplicating it", () => {
    const rows = merge(
      [
        message("u", "user", 101),
        message("a", "assistant", 201),
        message("vsc-u", "user", 300),
        message("vsc-a", "assistant", 400),
      ],
      [local("bb-u", "user", 100), local("bb-a", "assistant", 202)],
    );
    expect(rows.map((row) => row.id)).toEqual(
      ["u", "a", "vsc-u", "vsc-a"].map((id) => `${threadId}:native:${id}`),
    );
  });
  it("keeps repeated user text when it has distinct native identities", () => {
    const rows = merge(
      [message("u1", "user", 1, "+"), message("u2", "user", 2, "+")],
      [],
    );
    expect(rows).toHaveLength(2);
  });
  it("uses one live bb tail while the transcript catches up", () => {
    const rows = merge(
      [
        message("old", "assistant", 10),
        message("u", "user", 101),
        message("partial", "assistant", 110),
      ],
      [local("bb-u", "user", 100), local("bb-a", "assistant", 120)],
      true,
    );
    expect(rows.map((row) => row.id)).toEqual([
      `${threadId}:native:old`,
      "bb-u",
      "bb-a",
    ]);
  });
  it("does not discard a completed bb answer before it appears in the transcript", () => {
    expect(
      merge(
        [message("u", "user", 101)],
        [local("bb-u", "user", 100), local("bb-a", "assistant", 120)],
      ).map((row) => row.id),
    ).toEqual(["bb-u", "bb-a"]);
  });
  it("does not bring older bb conversations into the current native page", () => {
    expect(
      merge(
        [message("recent", "assistant", 300)],
        [local("old", "user", 1)],
      ).map((row) => row.id),
    ).toEqual([`${threadId}:native:recent`]);
  });
  it("keeps the original timeline when native history is empty", () => {
    const rows = [local("bb", "user", 1)];
    expect(merge([], rows)).toBe(rows);
  });
});
