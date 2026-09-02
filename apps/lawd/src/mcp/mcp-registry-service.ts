import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServerConfig, type McpServerConfig as McpServerConfigType, type McpServerView } from "@law/contracts";

type Probe = (server: McpServerConfigType) => Promise<string[]>;
const SECRET_KEY = /(token|secret|password|api.?key|credential)/i;

export class McpRegistryService {
  private readonly status = new Map<string, { status: "ready" | "error"; tools: string[]; detail?: string }>();

  constructor(private readonly path: string, private readonly probe: Probe = probeServer) {}

  static forRoot(root: string): McpRegistryService {
    return new McpRegistryService(join(root, ".aster", "mcp-servers.json"));
  }

  get configPath(): string { return this.path; }
  get claudeConfigPath(): string { return join(dirname(this.path), "claude-mcp.generated.json"); }

  environment(): Record<string, string> {
    const combined: Record<string, string> = {};
    for (const server of this.read().filter((item) => item.enabled && item.transport === "stdio")) {
      const resolved = expandedEnv(server);
      for (const key of Object.keys(server.env)) combined[key] = resolved[key]!;
    }
    return combined;
  }

  list(): { servers: McpServerView[]; configPath: string } {
    return { servers: this.read().map((server) => this.view(server)), configPath: this.path };
  }

  upsert(input: unknown): { server: McpServerView } {
    const server = McpServerConfig.parse(input);
    validateSecretReferences(server);
    const servers = this.read();
    const index = servers.findIndex((item) => item.id === server.id);
    if (index >= 0) servers[index] = server; else servers.push(server);
    this.write(servers); this.status.delete(server.id);
    return { server: this.view(server) };
  }

  importJson(json: string): { imported: number; servers: McpServerView[] } {
    const parsed = JSON.parse(json) as unknown;
    const source = parsed && typeof parsed === "object" && "mcpServers" in parsed
      ? (parsed as { mcpServers: unknown }).mcpServers : parsed;
    if (!source || typeof source !== "object" || Array.isArray(source)) throw new Error("MCP JSON must contain an mcpServers object.");
    const incoming = Object.entries(source as Record<string, unknown>).map(([id, raw]) => normalizeImportedServer(id, raw));
    const current = this.read();
    for (const server of incoming) {
      validateSecretReferences(server);
      const index = current.findIndex((item) => item.id === server.id);
      if (index >= 0) current[index] = server; else current.push(server);
      this.status.delete(server.id);
    }
    this.write(current);
    return { imported: incoming.length, servers: current.map((server) => this.view(server)) };
  }

  setEnabled(id: string, enabled: boolean): { server: McpServerView } {
    const servers = this.read(); const server = servers.find((item) => item.id === id);
    if (!server) throw Object.assign(new Error(`No MCP server named ${id}`), { code: "NOT_FOUND" });
    server.enabled = enabled; this.write(servers);
    return { server: this.view(server) };
  }

  remove(id: string): { removed: boolean } {
    const servers = this.read(); const next = servers.filter((server) => server.id !== id);
    if (next.length === servers.length) return { removed: false };
    this.status.delete(id); this.write(next); return { removed: true };
  }

  async test(id: string): Promise<{ server: McpServerView }> {
    const server = this.read().find((item) => item.id === id);
    if (!server) throw Object.assign(new Error(`No MCP server named ${id}`), { code: "NOT_FOUND" });
    try {
      const tools = await this.probe(server);
      this.status.set(id, { status: "ready", tools, detail: `${tools.length} tool${tools.length === 1 ? "" : "s"} discovered` });
    } catch (cause) {
      this.status.set(id, { status: "error", tools: [], detail: cause instanceof Error ? cause.message : String(cause) });
    }
    return { server: this.view(server) };
  }

  private view(server: McpServerConfigType): McpServerView {
    const observed = this.status.get(server.id);
    return { server, status: observed?.status ?? "untested", tools: observed?.tools ?? [], ...(observed?.detail ? { detail: observed.detail } : {}) };
  }

  private read(): McpServerConfigType[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as unknown;
      if (Array.isArray(parsed)) return McpServerConfig.array().parse(parsed);
      const source = parsed && typeof parsed === "object" && "mcpServers" in parsed ? (parsed as { mcpServers: unknown }).mcpServers : parsed;
      if (!source || typeof source !== "object" || Array.isArray(source)) return [];
      return Object.entries(source as Record<string, unknown>).map(([id, raw]) => normalizeImportedServer(id, raw));
    }
    catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Invalid MCP configuration at ${this.path}: ${detail}`);
    }
  }

  private write(servers: McpServerConfigType[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    const editable = { mcpServers: Object.fromEntries(servers.map((server) => [server.id, {
      name: server.name, enabled: server.enabled,
      ...(server.transport === "stdio" ? { command: server.command, args: server.args, env: server.env } : { url: server.url }),
    }])) };
    writeFileSync(temporary, `${JSON.stringify(editable, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
    writeFileSync(this.claudeConfigPath, `${JSON.stringify({ mcpServers: Object.fromEntries(servers.filter((server) => server.enabled).map((server) => [server.id, claudeServer(server)])) }, null, 2)}\n`, { mode: 0o600 });
  }
}

function normalizeImportedServer(id: string, raw: unknown): McpServerConfigType {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`MCP server ${id} must be an object.`);
  const value = raw as Record<string, unknown>;
  return McpServerConfig.parse({
    id, name: typeof value.name === "string" ? value.name : id, enabled: value.enabled !== false,
    transport: typeof value.url === "string" ? "http" : "stdio",
    ...(typeof value.command === "string" ? { command: value.command } : {}),
    ...(Array.isArray(value.args) ? { args: value.args } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(value.env && typeof value.env === "object" && !Array.isArray(value.env) ? { env: value.env } : {}),
  });
}

function validateSecretReferences(server: McpServerConfigType): void {
  for (const [key, value] of Object.entries(server.env)) {
    if (SECRET_KEY.test(key) && !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) {
      throw new Error(`Environment value ${key} looks sensitive. Store it in the environment and use a placeholder such as \${${key}}.`);
    }
  }
}

function expandedEnv(server: McpServerConfigType): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(server.env)) {
    const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    if (match) {
      const resolved = process.env[match[1]!];
      if (!resolved) throw new Error(`Required environment variable ${match[1]} is not available to Aster.`);
      env[key] = resolved;
    } else env[key] = value;
  }
  return env;
}

function claudeServer(server: McpServerConfigType): Record<string, unknown> {
  if (server.transport === "http") return { type: "http", url: server.url };
  const plainEnv = Object.fromEntries(Object.entries(server.env).filter(([, value]) => !/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)));
  return { command: server.command, args: server.args, ...(Object.keys(plainEnv).length ? { env: plainEnv } : {}) };
}

async function probeServer(server: McpServerConfigType): Promise<string[]> {
  const transport = server.transport === "stdio"
    ? new StdioClientTransport({ command: server.command!, args: server.args, env: expandedEnv(server) })
    : new StreamableHTTPClientTransport(new URL(server.url!));
  const client = new Client({ name: "aster-mcp-hub", version: "0.1.0" });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools.map((tool) => tool.name).sort();
  } finally { await client.close().catch(() => {}); }
}
