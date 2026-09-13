import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const captureInput = z.object({ monitor: z.number().int().min(0).max(15).default(0) }).strict();
export const shotSchema = z.object({
  data: z.string().min(1).max(8_000_000),
  mimeType: z.literal("image/jpeg"),
  width: z.number().int().positive(), height: z.number().int().positive(),
  monitor: z.number().int().nonnegative(), monitorCount: z.number().int().positive(),
  hostName: z.string(), capturedAt: z.string(),
});
export const hostContract = defineRpcContract({ capture: { input: captureInput, output: shotSchema } });
export const rpcContract = defineRpcContract({
  capture: { input: captureInput.extend({ threadId: z.string().min(1) }), output: shotSchema },
  latest: { input: z.object({ threadId: z.string().min(1) }), output: shotSchema.nullable() },
});
