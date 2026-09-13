import { Command } from "commander";
import type { ThreadDesktopRegisterResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

export function printDesktopRegister(
  register: ThreadDesktopRegisterResponse,
): void {
  if (!register.supported) {
    console.log(
      register.reason ??
        "Desktop registration is not available for this thread.",
    );
    return;
  }
  console.log(`Native session: ${register.nativeSessionId ?? "unavailable"}`);
  const outcome = register.outcome;
  switch (outcome.status) {
    case "preflight_ok":
      console.log("Desktop registration: not registered (preflight)");
      console.log(`  Would write title: ${outcome.title}`);
      console.log(`  Workspace: ${outcome.workspacePath}`);
      console.log(`  Mode: ${outcome.mode}`);
      console.log(`  Model: ${outcome.model ?? "unknown"}`);
      console.log(
        "Re-run with --apply to write this row after a verified backup.",
      );
      break;
    case "registered":
      console.log("Desktop registration: registered");
      console.log(`  Title: ${outcome.title}`);
      console.log(`  Workspace: ${outcome.workspacePath}`);
      console.log(`  Backup: ${outcome.backupPath}`);
      break;
    case "already_registered":
      console.log("Desktop registration: already registered");
      if (outcome.title) console.log(`  Title: ${outcome.title}`);
      if (outcome.workspacePath) {
        console.log(`  Workspace: ${outcome.workspacePath}`);
      }
      break;
    case "rejected":
      console.log(`Desktop registration: rejected — ${outcome.reason}`);
      break;
    case "unavailable":
      console.log(`Desktop registration: unavailable — ${outcome.reason}`);
      break;
  }
}

export function registerDesktopRegisterCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("desktop-register [id]")
    .description(
      "Register the thread's native ZCode session in ZCode Desktop (preflight by default; --apply writes after a verified backup)",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--apply", "Write the tasks-index row after a verified backup")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: { apply?: boolean; json?: boolean; self?: boolean },
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const register = await createCliBbSdk(getUrl()).threads.desktopRegister({
            threadId,
            apply: opts.apply === true,
          });
          if (opts.json) {
            outputJson(opts, register);
            return;
          }
          printDesktopRegister(register);
        },
      ),
    );
}
