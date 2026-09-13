import fs from "node:fs/promises";
import path from "node:path";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_STORED_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128;
const SESSION_ID = /^sess_[a-zA-Z0-9_-]+$/;
const ARTIFACT_ID = /^tool-result-[a-f0-9-]{36}$/i;

export interface ZcodeImageArtifact {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}

function isWithin(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function decodeImageDataUrl(value: string): ZcodeImageArtifact {
  if (value.length > MAX_STORED_BYTES) throw new Error("Native image artifact exceeds size limit");
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value.trim());
  if (!match) throw new Error("Unsupported native image artifact encoding");
  const base64 = match[2].replace(/[\r\n]/g, "");
  const decoded = Buffer.from(base64, "base64");
  if (decoded.length === 0 || decoded.length > MAX_IMAGE_BYTES || decoded.toString("base64") !== base64) {
    throw new Error("Invalid native image artifact data");
  }
  const mimeType = match[1];
  if (mimeType !== "image/png" && mimeType !== "image/jpeg" && mimeType !== "image/webp" && mimeType !== "image/gif") throw new Error("Unsupported image type");
  return { mimeType, base64 };
}

export async function readZcodeImageArtifact(args: {
  cliDirectory: string;
  sessionId: string;
  uri: string;
}): Promise<ZcodeImageArtifact> {
  if (!SESSION_ID.test(args.sessionId)) throw new Error("Invalid native session ID");
  if (args.uri.startsWith("data:")) return decodeImageDataUrl(args.uri);
  const uri = new URL(args.uri);
  const artifactId = uri.pathname.slice(1);
  if (
    uri.protocol !== "zcode-artifact:" || uri.hostname !== args.sessionId ||
    uri.username || uri.password || uri.port || uri.search || uri.hash ||
    !ARTIFACT_ID.test(artifactId)
  ) throw new Error("Artifact does not belong to the requested native session");
  const root = await fs.realpath(path.join(args.cliDirectory, "artifacts"));
  const expectedDirectory = path.join(root, args.sessionId);
  const directory = await fs.realpath(expectedDirectory);
  if (!isWithin(root, directory) || path.relative(expectedDirectory, directory) !== "") throw new Error("Artifact directory escapes its session storage");
  const entries = await fs.opendir(directory);
  const matches: string[] = [];
  let count = 0;
  for await (const entry of entries) {
    if (++count > 10000) throw new Error("Artifact directory exceeds scan limit");
    if (entry.name.includes(`-${artifactId}.`)) matches.push(entry.name);
  }
  if (matches.length !== 1) throw new Error("Native image artifact is missing or ambiguous");
  const file = await fs.realpath(path.join(directory, matches[0]));
  if (!isWithin(directory, file)) throw new Error("Artifact escapes its session directory");
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_STORED_BYTES) throw new Error("Native image artifact exceeds size limit");
    const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_STORED_BYTES + 1));
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(bytes, length, bytes.length - length, null);
      if (read.bytesRead === 0) break;
      length += read.bytesRead;
    }
    if (length !== stat.size) throw new Error("Native image artifact changed while reading");
    return decodeImageDataUrl(bytes.subarray(0, length).toString("utf8"));
  } finally {
    await handle.close();
  }
}
