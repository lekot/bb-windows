import { createHash } from "node:crypto";
import type {
  HostDaemonOnlineRpcResult,
  HostProbeNativeHistoryItem,
} from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandOf,
} from "../../command-dispatch-support.js";
import { readNativeCodexHistory } from "./codex.js";
import { readNativeZcodeHistory } from "./zcode.js";

type NativeHistoryProbeCommand = CommandOf<"host.probe_native_history">;
type NativeHistoryProbeResult = HostDaemonOnlineRpcResult<
  "host.probe_native_history"
>;

export async function probeNativeHistory(
  command: NativeHistoryProbeCommand,
): Promise<NativeHistoryProbeResult> {
  const items: NativeHistoryProbeResult["items"] = [];
  for (const item of command.items) {
    items.push(await probeItem(item));
  }
  return { items };
}

async function probeItem(
  item: HostProbeNativeHistoryItem,
): Promise<NativeHistoryProbeResult["items"][number]> {
  try {
    if (item.reader === "codex-rollout") {
      const page = await readNativeCodexHistory({
        before: null,
        cwd: item.cwd,
        limit: 1,
        sessionId: item.sessionId,
      });
      const last = page.messages[page.messages.length - 1];
      return {
        status: "ok",
        lastMessageTimestamp: last?.timestamp ?? null,
        revision: createHash("sha256").update(JSON.stringify(last ?? null)).digest("base64url"),
      };
    }
    const page = await readNativeZcodeHistory({
      before: null,
      cwd: item.cwd,
      limit: 1,
      sessionId: item.sessionId,
    });
    const last = page.messages[page.messages.length - 1];
    return {
      status: "ok",
      lastMessageTimestamp: last?.timestamp ?? null,
      revision: createHash("sha256").update(JSON.stringify(last ?? null)).digest("base64url"),
    };
  } catch (error) {
    if (error instanceof CommandDispatchError) {
      if (error.code === "native_history_missing") {
        return { status: "missing" };
      }
      if (error.code === "native_history_unavailable") {
        return { status: "unavailable", reason: error.message };
      }
    }
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
