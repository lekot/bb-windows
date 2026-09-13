import { describe, expect, it } from "vitest";
import { createThreadRequestSchema } from "../src/api/threads.js";

const baseRequest = {
  projectId: "proj_test",
  providerId: "codex",
  origin: "cli",
  input: [{ type: "text", text: "Continue the original native session" }],
  environment: { type: "project-default" },
};

const codexNativeId = "01a07723-6432-7731-a5e9-5ce0affd6677";
const zcodeNativeId = "sess_a9ec5047-0492-4bc2-b7ba-baeb4867ac23";

describe("native session resume", () => {
  it("accepts provider-native resume identifiers for non-claude providers", () => {
    expect(
      createThreadRequestSchema.parse({
        ...baseRequest,
        nativeResumeSessionId: codexNativeId,
      }).nativeResumeSessionId,
    ).toBe(codexNativeId);
    expect(
      createThreadRequestSchema.parse({
        ...baseRequest,
        providerId: "acp-zcode",
        nativeResumeSessionId: zcodeNativeId,
      }).nativeResumeSessionId,
    ).toBe(zcodeNativeId);
  });

  it.each([
    { claudeSourceSessionId: "08a43925-7a0c-46a6-b6a4-a045b20976e6" },
    { claudeResumeSessionId: "08a43925-7a0c-46a6-b6a4-a045b20976e6" },
    { originKind: "fork", sourceThreadId: "thr_other" },
    { sourceThreadId: "thr_other" },
    { sourceSeqEnd: 3 },
    { nativeResumeSessionId: "short" },
    { nativeResumeSessionId: " spaces and dashes!" },
  ])("rejects conflicting sources or malformed ids: %j", (override) => {
    expect(
      createThreadRequestSchema.safeParse({
        ...baseRequest,
        nativeResumeSessionId: codexNativeId,
        ...override,
      }).success,
    ).toBe(false);
  });
});
