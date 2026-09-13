import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AcpMcpServerConfig } from "./tool-proxy-mcp.js";

export const ACP_PROJECT_MCP_URL_ENV = "BB_ACP_PROJECT_MCP_URL";
export const ACP_PROJECT_MCP_HEADERS_ENV = "BB_ACP_PROJECT_MCP_HEADERS";

const stdioServerSchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const httpServerSchema = z.object({
  type: z.literal("http").optional(),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
});

const projectMcpSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.union([stdioServerSchema, httpServerSchema]),
  ),
});

export async function loadProjectMcpServers(args: {
  cwd: string;
  proxyArgs: string[];
  proxyCommand: string;
  runtimeEnv: AcpMcpServerConfig["env"];
}): Promise<AcpMcpServerConfig[]> {
  let raw: string;
  try {
    raw = await readFile(join(args.cwd, ".mcp.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw) as unknown;
  } catch (error) {
    process.stderr.write(
      `acp bridge: ignoring malformed project .mcp.json in "${args.cwd}": ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return [];
  }
  const parsed = projectMcpSchema.safeParse(json);
  if (!parsed.success) {
    process.stderr.write(
      `acp bridge: ignoring invalid project .mcp.json in "${args.cwd}": ${parsed.error.message}\n`,
    );
    return [];
  }

  return Object.entries(parsed.data.mcpServers).map(([name, server]) => {
    if ("command" in server) {
      return {
        name,
        command: server.command,
        args: server.args ?? [],
        env: Object.entries(server.env ?? {}).map(([envName, value]) => ({
          name: envName,
          value,
        })),
      };
    }
    return {
      name,
      command: args.proxyCommand,
      args: args.proxyArgs,
      env: [
        ...args.runtimeEnv,
        { name: ACP_PROJECT_MCP_URL_ENV, value: server.url },
        {
          name: ACP_PROJECT_MCP_HEADERS_ENV,
          value: JSON.stringify(server.headers ?? {}),
        },
      ],
    };
  });
}
