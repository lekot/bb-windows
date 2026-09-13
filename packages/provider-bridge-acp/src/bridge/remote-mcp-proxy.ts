import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ACP_PROJECT_MCP_HEADERS_ENV,
  ACP_PROJECT_MCP_URL_ENV,
} from "./project-mcp.js";

export async function runAcpRemoteMcpProxy(): Promise<void> {
  const rawUrl = process.env[ACP_PROJECT_MCP_URL_ENV];
  if (!rawUrl) throw new Error(`Missing ${ACP_PROJECT_MCP_URL_ENV}`);
  const headers = JSON.parse(
    process.env[ACP_PROJECT_MCP_HEADERS_ENV] ?? "{}",
  ) as Record<string, string>;

  const remote = new Client({ name: "bb-acp-project-mcp", version: "1.0.0" });
  await remote.connect(
    new StreamableHTTPClientTransport(new URL(rawUrl), {
      requestInit: { headers },
    }),
  );

  const server = new Server(
    { name: "bb-acp-project-mcp-proxy", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    remote.callTool(request.params),
  );
  process.stdin.once("end", () => void remote.close());
  await server.connect(new StdioServerTransport());
}
