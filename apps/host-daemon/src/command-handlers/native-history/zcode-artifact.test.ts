import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readZcodeImageArtifact } from "./zcode-artifact.js";

const sessionId = "sess_2f4f8b7e-a38b-4216-929d-22274ef1ed90";
const artifactId = "tool-result-5c8fb381-534c-4008-a7b3-54f9a0f9e1d3";
const uri = `zcode-artifact://${sessionId}/${artifactId}`;
let cliDirectory: string;
let directory: string;
let file: string;

beforeEach(async () => {
  cliDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bb-zcode-artifact-"));
  directory = path.join(cliDirectory, "artifacts", sessionId);
  await fs.mkdir(directory, { recursive: true });
  file = path.join(directory, `prompt-attachment-1-hash-${artifactId}.txt`);
  await fs.writeFile(file, "data:image/png;base64,aGVsbG8=");
});
afterEach(async () => { await fs.rm(cliDirectory, { recursive: true, force: true }); });

it("reads the native artifact URI without returning a host file path", async () => {
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).resolves.toEqual({ mimeType: "image/png", base64: "aGVsbG8=" });
});
it.each([
  "data:image/svg+xml;base64,aGVsbG8=",
  "data:image/png;base64,a===",
  "data:image/png;base64,",
  `data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}`,
])("rejects invalid inline image payload %i", async (inlineUri) => {
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri: inlineUri })).rejects.toThrow();
});
it("rejects another session and path traversal", async () => {
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId: "sess_other", uri })).rejects.toThrow("requested native session");
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri: `${uri}/../outside` })).rejects.toThrow();
});
it("refuses duplicate artifact matches", async () => {
  await fs.copyFile(file, path.join(directory, `other-${artifactId}.txt`));
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).rejects.toThrow("ambiguous");
});
it("rejects executable formats and malformed base64", async () => {
  await fs.writeFile(file, "data:image/svg+xml;base64,aGVsbG8=");
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).rejects.toThrow("encoding");
  await fs.writeFile(file, "data:image/png;base64,a===");
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).rejects.toThrow("Invalid");
});

it("rejects a session directory redirected to another session", async () => {
  const otherDirectory = path.join(cliDirectory, "artifacts", "sess_other");
  await fs.rename(directory, otherDirectory);
  await fs.symlink(otherDirectory, directory, process.platform === "win32" ? "junction" : "dir");
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).rejects.toThrow("session storage");
});

it("rejects oversized artifacts before loading their contents", async () => {
  await fs.truncate(file, 12 * 1024 * 1024);
  await expect(readZcodeImageArtifact({ cliDirectory, sessionId, uri })).rejects.toThrow("size limit");
});
