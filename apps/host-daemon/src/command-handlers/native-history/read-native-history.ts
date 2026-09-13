import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  type CommandOf,
} from "../../command-dispatch-support.js";
import { readNativeCodexHistory } from "./codex.js";
import { readNativeZcodeHistory } from "./zcode.js";

type NativeHistoryCommand = CommandOf<"host.read_native_history">;
type NativeHistoryResult = HostDaemonOnlineRpcResult<"host.read_native_history">;

export async function readNativeHistory(
  command: NativeHistoryCommand,
): Promise<NativeHistoryResult> {
  switch (command.reader) {
    case "codex-rollout":
      return readNativeCodexHistory({
        before: command.before,
        cwd: command.cwd,
        limit: command.limit,
        sessionId: command.sessionId,
      });
    case "zcode-sqlite":
      return readNativeZcodeHistory({
        before: command.before,
        cwd: command.cwd,
        limit: command.limit,
        sessionId: command.sessionId,
      });
    case "claude-transcript":
      throw new Error(
        "claude-transcript native history is served by host.read_native_claude_history",
      );
  }
}
