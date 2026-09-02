import { z } from "zod";
import { defineOperation } from "./ipc.js";

const SafeEnvValue = z.string().max(4_096);

export const McpServerConfig = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(100),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  transport: z.enum(["stdio", "http"]),
  command: z.string().min(1).max(4_096).optional(),
  args: z.array(z.string().max(4_096)).max(100).default([]),
  url: z.string().url().max(4_096).optional(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), SafeEnvValue).default({}),
}).superRefine((server, ctx) => {
  if (server.transport === "stdio" && !server.command) ctx.addIssue({ code: "custom", path: ["command"], message: "stdio servers require a command" });
  if (server.transport === "http" && !server.url) ctx.addIssue({ code: "custom", path: ["url"], message: "HTTP servers require a URL" });
});
export type McpServerConfig = z.infer<typeof McpServerConfig>;

export const McpServerView = z.object({
  server: McpServerConfig,
  status: z.enum(["untested", "ready", "error"]),
  tools: z.array(z.string()),
  detail: z.string().optional(),
});
export type McpServerView = z.infer<typeof McpServerView>;

export const mcp_server_list = defineOperation({
  name: "mcp_server_list", schemaVersion: 1, summary: "List locally configured MCP servers.", consequential: false,
  request: z.object({}).strict(), response: z.object({ servers: z.array(McpServerView), configPath: z.string() }),
});

export const mcp_server_upsert = defineOperation({
  name: "mcp_server_upsert", schemaVersion: 1, summary: "Add or update a validated MCP server definition.", consequential: true,
  request: McpServerConfig, response: z.object({ server: McpServerView }),
});

export const mcp_server_import = defineOperation({
  name: "mcp_server_import", schemaVersion: 1, summary: "Import standard mcpServers JSON after validation.", consequential: true,
  request: z.object({ json: z.string().min(1).max(500_000) }), response: z.object({ imported: z.number().int().nonnegative(), servers: z.array(McpServerView) }),
});

export const mcp_server_set_enabled = defineOperation({
  name: "mcp_server_set_enabled", schemaVersion: 1, summary: "Enable or disable one MCP server.", consequential: true,
  request: z.object({ id: z.string().min(1), enabled: z.boolean() }), response: z.object({ server: McpServerView }),
});

export const mcp_server_remove = defineOperation({
  name: "mcp_server_remove", schemaVersion: 1, summary: "Remove one MCP server definition.", consequential: true,
  request: z.object({ id: z.string().min(1) }), response: z.object({ removed: z.boolean() }),
});

export const mcp_server_test = defineOperation({
  name: "mcp_server_test", schemaVersion: 1, summary: "Connect to one MCP server and discover its tools.", consequential: true,
  request: z.object({ id: z.string().min(1) }), response: z.object({ server: McpServerView }),
});
