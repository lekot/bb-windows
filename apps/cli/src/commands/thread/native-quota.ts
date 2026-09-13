import { Command } from "commander";
import type { ThreadNativeQuotaResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

function printQuota(quota: ThreadNativeQuotaResponse): void {
  if (!quota.supported) {
    console.log("Native quota is not supported by this thread's provider.");
    return;
  }
  if (quota.status !== "ok") {
    console.log(`Native quota is unavailable: ${quota.reason ?? quota.status}`);
    return;
  }
  if (quota.fiveHour !== null) {
    const reset = quota.fiveHour.nextResetTime
      ? new Date(quota.fiveHour.nextResetTime).toLocaleString()
      : "время неизвестно";
    console.log(
      `Five-hour window: ${quota.fiveHour.remainingPercentage}% remaining (${quota.fiveHour.usedPercentage}% used), reset ${reset}`,
    );
  } else {
    console.log("Five-hour window: no data");
  }
  if (quota.toolCalls !== null) {
    const used =
      quota.toolCalls.used === null ? "?" : String(quota.toolCalls.used);
    const total =
      quota.toolCalls.total === null ? "?" : String(quota.toolCalls.total);
    console.log(`Tool calls: ${used}/${total} used`);
  }
  if (quota.fetchedAt) {
    console.log(`Fetched at: ${quota.fetchedAt}`);
  }
}

export function registerNativeQuotaCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("native-quota [id]")
    .description("Show the provider account's read-only native usage quota")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: { json?: boolean; self?: boolean }) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const quota = await createCliBbSdk(getUrl()).threads.nativeQuota({
          threadId,
        });
        if (opts.json) {
          outputJson(opts, quota);
          return;
        }
        printQuota(quota);
      }),
    );
}
