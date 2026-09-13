import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

export function registerNativeImageCommand(parent: Command, getUrl: () => string): void {
  parent.command("native-image [id]")
    .description("Read a native ZCode image by its message and attachment IDs")
    .requiredOption("--message <id>", "Native message ID")
    .requiredOption("--attachment <id>", "Native attachment ID")
    .option("--self", "Target BB_THREAD_ID")
    .option("--json", "Print MIME type and base64 image data")
    .action(action(async (id: string | undefined, opts: { message: string; attachment: string; self?: boolean; json?: boolean }) => {
      const result = await createCliBbSdk(getUrl()).threads.nativeImage({
        threadId: requireThreadIdOrSelf(id, opts),
        messageId: opts.message,
        attachmentId: opts.attachment,
      });
      if (opts.json) outputJson(opts, result);
      else console.log(`${result.mimeType}, ${Buffer.from(result.base64, "base64").length} bytes; use --json for image data`);
    }));
}
