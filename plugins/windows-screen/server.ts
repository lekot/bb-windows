import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { captureInput, hostContract, rpcContract, shotSchema } from "./contract.js";

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  function screenshots() {
    const db = bb.storage.database();
    bb.storage.migrate(db, ["CREATE TABLE screenshots (thread_id TEXT PRIMARY KEY, payload TEXT NOT NULL)"]);
    return db;
  }
  async function capture(threadId: string, monitor: number, signal?: AbortSignal) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) throw new Error("Session has no execution host.");
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const shot = await host.call("capture", { monitor }, { hostId: environment.hostId, signal });
    screenshots().prepare("INSERT INTO screenshots (thread_id, payload) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET payload = excluded.payload").run(threadId, JSON.stringify(shot));
    await bb.storage.kv.delete(`latest:${threadId}`);
    return shot;
  }
  bb.rpc.register(rpcContract, {
    capture: (input) => capture(input.threadId, input.monitor),
    async latest({ threadId }) {
      await bb.sdk.threads.get({ threadId });
      const row = screenshots().prepare("SELECT payload FROM screenshots WHERE thread_id = ?").get(threadId);
      const value = row && typeof row === "object" && "payload" in row && typeof row.payload === "string"
        ? JSON.parse(row.payload)
        : await bb.storage.kv.get<unknown>(`latest:${threadId}`);
      return value == null ? null : shotSchema.parse(value);
    },
  });
  bb.agents.registerTool({
    name: "CaptureWindowsScreen",
    description: "Capture the Windows PC screen where this session executes, not the browser device. On demand only. Monitor 0 is primary. May expose private desktop content. Returns an image. No mouse or keyboard control.",
    parameters: captureInput,
    async execute(input, ctx) {
      try {
        const shot = await capture(ctx.threadId, input.monitor, ctx.signal);
        return { content: [
          { type: "text" as const, text: `${shot.hostName}, monitor ${shot.monitor}/${shot.monitorCount - 1}, ${shot.capturedAt}, ${shot.width}x${shot.height}` },
          { type: "image" as const, data: shot.data, mimeType: shot.mimeType },
        ] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] };
      }
    },
  });
  bb.agents.configure(() => ({ tools: [{ name: "CaptureWindowsScreen", parameters: { type: "object", properties: { monitor: { type: "integer", minimum: 0, maximum: 15 } }, additionalProperties: false } }], skills: [] }));
  bb.cli.register({
    name: "windows-screen", summary: "Capture the Windows execution host screen",
    commands: [{ name: "capture", summary: "Capture a monitor", usage: "bb windows-screen capture <thread-id> [monitor-index] [--json]" }],
    async run(argv) {
      const args = argv.filter((arg) => arg !== "--json");
      if (args[0] !== "capture" || !args[1] || args.length > 3) return { exitCode: 1, stderr: "Usage: bb windows-screen capture <thread-id> [monitor-index] [--json]" };
      const input = captureInput.parse({ monitor: args[2] === undefined ? 0 : Number(args[2]) });
      return { exitCode: 0, stdout: JSON.stringify(await capture(args[1], input.monitor)) };
    },
  });
}
