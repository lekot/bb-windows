import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread native-image", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("returns the image payload for agents without changing its identifiers", async () => {
    const image = { mimeType: "image/png", base64: "aGVsbG8=" };
    const readImage = vi.fn(async () => image);
    stubServerApi({ "v1.threads.:id.native-image.$get": readImage });
    await runCommand(["thread", "native-image", "thr_test", "--message", "message&1", "--attachment", "part+1", "--json"], register);
    expect(readImage).toHaveBeenCalledWith({
      param: { id: "thr_test" },
      query: { messageId: "message&1", attachmentId: "part+1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([JSON.stringify(image, null, 2)]);
  });

  it("uses the current thread and keeps base64 out of ordinary output", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_current");
    const readImage = vi.fn(async () => ({ mimeType: "image/png", base64: "aGVsbG8=" }));
    stubServerApi({ "v1.threads.:id.native-image.$get": readImage });
    await runCommand(["thread", "native-image", "--self", "--message", "msg", "--attachment", "part"], register);
    expect(readImage).toHaveBeenCalledWith({ param: { id: "thr_current" }, query: { messageId: "msg", attachmentId: "part" } });
    expect(collectLogLines(vi.mocked(console.log))).toEqual(["image/png, 5 bytes; use --json for image data"]);
  });
});
