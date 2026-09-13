import { Command } from "commander";
import type { ThreadDesktopSyncResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

export function printDesktopSync(sync: ThreadDesktopSyncResponse): void {
  if (!sync.supported) {
    console.log(sync.reason ?? "Desktop sync diagnostics are not available for this thread.");
    return;
  }
  console.log(`Native session: ${sync.nativeSessionId ?? "unavailable"}`);
  console.log(
    `Native history: ${
      sync.nativeHistoryStatus === "ok"
        ? `last message ${sync.lastNativeMessageAt ?? "time unknown"}`
        : sync.nativeHistoryStatus
    }`,
  );
  if (sync.desktopStatus === "registered") {
    console.log(`Desktop registration: registered`);
    if (sync.desktopTitle) console.log(`  Title: ${sync.desktopTitle}`);
    if (sync.desktopWorkspacePath) {
      console.log(`  Workspace: ${sync.desktopWorkspacePath}`);
    }
  } else if (sync.desktopStatus === "not_registered") {
    console.log("Desktop registration: not registered");
  } else {
    console.log(`Desktop registration: unavailable${sync.reason ? ` — ${sync.reason}` : ""}`);
  }
}

export function registerDesktopSyncCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("desktop-sync [id]")
    .description("Check native session sync status between bb and ZCode Desktop")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: { json?: boolean; self?: boolean }) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sync = await createCliBbSdk(getUrl()).threads.desktopSync({
          threadId,
        });
        if (opts.json) {
          outputJson(opts, sync);
          return;
        }
        printDesktopSync(sync);
      }),
    );
}
