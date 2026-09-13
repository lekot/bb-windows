import { Command } from "commander";
import type { ThreadNativeHistoryResponse } from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadNativeHistoryCommandOptions {
  before?: string;
  json?: boolean;
  limit?: string;
  self?: boolean;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error("--limit must be a positive integer no greater than 100");
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be a positive integer no greater than 100");
  }
  return limit;
}

function printNativeHistory(history: ThreadNativeHistoryResponse): void {
  if (!history.supported) {
    console.log("Native history is not supported by this thread's provider.");
    return;
  }
  const { metadata } = history;
  if (metadata.title || metadata.model || metadata.permissionMode) {
    console.log("Native history:");
    if (metadata.title) console.log(`  Title: ${metadata.title}`);
    if (metadata.model) console.log(`  Model: ${metadata.model}`);
    if (metadata.permissionMode) {
      console.log(`  Permission mode: ${metadata.permissionMode}`);
    }
    console.log("");
  }
  if (history.contextUsage) {
    console.log(`Native context tokens: ${history.contextUsage.usedTokens}`);
    if (history.contextUsage.model) {
      console.log(`  Model: ${history.contextUsage.model}`);
    }
    if (history.contextUsage.observedAt) {
      console.log(`  Observed at: ${history.contextUsage.observedAt}`);
    }
    console.log("");
  }
  for (const message of history.messages) {
    const timestamp = message.timestamp ? ` (${message.timestamp})` : "";
    console.log(`${message.role}${timestamp}:`);
    console.log(message.text);
    console.log("");
  }
  if (history.truncated) {
    console.log("Older or oversized native history was omitted.");
  }
  if (history.nextCursor) {
    console.log(`Next cursor: ${history.nextCursor}`);
  }
}

export function registerNativeHistoryCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("native-history [id]")
    .description("Show the latest read-only native history for the thread's provider")
    .option("--before <cursor>", "Read the page before an opaque cursor")
    .option("--limit <count>", "Messages per page (1-100, default: 20)")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (
        id: string | undefined,
        opts: ThreadNativeHistoryCommandOptions,
      ) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const history = await createCliBbSdk(getUrl()).threads.nativeHistory({
          before: opts.before,
          limit: parseLimit(opts.limit),
          threadId,
        });
        if (opts.json) {
          outputJson(opts, history);
          return;
        }
        printNativeHistory(history);
      }),
    );
}
