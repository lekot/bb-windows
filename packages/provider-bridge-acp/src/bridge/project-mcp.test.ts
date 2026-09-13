import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ACP_PROJECT_MCP_HEADERS_ENV,
  ACP_PROJECT_MCP_URL_ENV,
  loadProjectMcpServers,
} from "./project-mcp.js";

const cleanups: string[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true })));
});

async function fixture(contents?: unknown): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "bb-acp-mcp-"));
  cleanups.push(cwd);
  if (contents !== undefined) {
    await writeFile(join(cwd, ".mcp.json"), JSON.stringify(contents));
  }
  return cwd;
}

describe("ACP project MCP discovery", () => {
  it("returns no servers when the project has no .mcp.json", async () => {
    expect(
      await loadProjectMcpServers({
        cwd: await fixture(),
        proxyArgs: ["bridge.js", "--mcp-http-proxy"],
        proxyCommand: "node",
        runtimeEnv: [],
      }),
    ).toEqual([]);
  });

  it("maps stdio and HTTP project servers into ACP stdio configs", async () => {
    const cwd = await fixture({
      mcpServers: {
        local: { command: "local-mcp", args: ["--stdio"], env: { A: "B" } },
        edt: { type: "http", url: "http://127.0.0.1:8766/mcp" },
      },
    });
    const result = await loadProjectMcpServers({
      cwd,
      proxyArgs: ["bridge.js", "--mcp-http-proxy"],
      proxyCommand: "node",
      runtimeEnv: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    });

    expect(result[0]).toEqual({
      name: "local",
      command: "local-mcp",
      args: ["--stdio"],
      env: [{ name: "A", value: "B" }],
    });
    expect(result[1]).toMatchObject({
      name: "edt",
      command: "node",
      args: ["bridge.js", "--mcp-http-proxy"],
    });
    expect(result[1]?.env).toContainEqual({
      name: ACP_PROJECT_MCP_URL_ENV,
      value: "http://127.0.0.1:8766/mcp",
    });
    expect(result[1]?.env).toContainEqual({
      name: ACP_PROJECT_MCP_HEADERS_ENV,
      value: "{}",
    });
  });
});
