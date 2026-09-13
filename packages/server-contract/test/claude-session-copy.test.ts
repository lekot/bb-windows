import { describe, expect, it } from "vitest";
import { createThreadRequestSchema } from "../src/api/threads.js";

const request = {
  projectId: "proj_test",
  providerId: "claude-code",
  origin: "cli",
  input: [{ type: "text", text: "Recall context without editing files" }],
  environment: { type: "project-default" },
  claudeSourceSessionId: "08a43925-7a0c-46a6-b6a4-a045b20976e6",
};

describe("external Claude session copy", () => {
  it("preserves an original resume and rejects ambiguous ownership modes", () => {
    const { claudeSourceSessionId, ...base } = request;
    const resume = { ...base, claudeResumeSessionId: claudeSourceSessionId };
    expect(createThreadRequestSchema.parse(resume).claudeResumeSessionId).toBe(claudeSourceSessionId);
    for (const override of [{ providerId: "codex" }, { claudeSourceSessionId }, { sourceThreadId: "thr_other" }, { sourceSeqEnd: 1 }, { claudeResumeSessionId: "bad" }]) {
      expect(createThreadRequestSchema.safeParse({ ...resume, ...override }).success).toBe(false);
    }
  });
  it("preserves the source session identifier", () => {
    expect(createThreadRequestSchema.parse(request).claudeSourceSessionId)
      .toBe(request.claudeSourceSessionId);
  });
  it.each([
    { providerId: "codex" },
    { claudeSourceSessionId: "invalid" },
    { originKind: "fork", sourceThreadId: "thr_other" },
  ])("rejects incompatible or invalid sources: %j", (override) => {
    expect(createThreadRequestSchema.safeParse({ ...request, ...override }).success).toBe(false);
  });
});
