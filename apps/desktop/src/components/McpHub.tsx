import React from "react";
import type { McpServerConfig, McpServerView } from "@law/contracts";

export interface McpHubProps {
  servers: McpServerView[];
  configPath?: string;
  busyId?: string;
  error?: string;
  onUpsert(server: McpServerConfig): void;
  onImport(json: string): void;
  onSetEnabled(id: string, enabled: boolean): void;
  onTest(id: string): void;
  onRemove(id: string): void;
}

export function McpHub(props: McpHubProps): React.JSX.Element {
  const [advanced, setAdvanced] = React.useState(false);
  const [json, setJson] = React.useState('{\n  "mcpServers": {\n    "my-tools": {\n      "command": "npx",\n      "args": ["-y", "@example/mcp-server"]\n    }\n  }\n}');
  const [form, setForm] = React.useState({ id: "", name: "", transport: "stdio" as "stdio" | "http", command: "", args: "", url: "" });

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const id = form.id.trim();
    props.onUpsert({
      id, name: form.name.trim() || id, enabled: true, transport: form.transport,
      ...(form.transport === "stdio" ? { command: form.command.trim(), args: splitArgs(form.args) } : { url: form.url.trim(), args: [] }),
      env: {},
    });
  }

  async function readFile(file?: File): Promise<void> {
    if (!file) return;
    setJson(await file.text()); setAdvanced(true);
  }

  return <section className="mcp-hub"><h2>MCP Hub</h2><p>Add local stdio or remote HTTP tool servers without using a terminal. Aster validates definitions, discovers their tools, and supplies enabled servers to supported model bridges.</p>
    <div className="mcp-security-note"><strong>Credentials stay outside this file.</strong><span>For sensitive environment values, use placeholders such as <code>{"${GITHUB_TOKEN}"}</code>; Aster resolves them from its environment when testing or launching a server.</span></div>
    {props.error && <div className="mcp-error" role="alert">{props.error}</div>}
    <form className="mcp-builder" onSubmit={submit}>
      <label><span>ID</span><input required pattern="[A-Za-z0-9._-]+" value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder="github-tools" /></label>
      <label><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="GitHub tools" /></label>
      <label><span>Transport</span><select value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as "stdio" | "http" })}><option value="stdio">Local command (stdio)</option><option value="http">Remote URL (HTTP)</option></select></label>
      {form.transport === "stdio" ? <><label className="wide"><span>Command</span><input required value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} placeholder="npx" /></label><label className="wide"><span>Arguments</span><input value={form.args} onChange={(event) => setForm({ ...form, args: event.target.value })} placeholder={'-y "@modelcontextprotocol/server-filesystem" /workspace'} /></label></>
        : <label className="wide"><span>Server URL</span><input required type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://tools.example.com/mcp" /></label>}
      <button className="primary" type="submit">Add server</button>
    </form>
    <div className="mcp-import-heading"><button type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced}>{advanced ? "Hide JSON import" : "Import MCP JSON"}</button><label className="mcp-file-button">Choose JSON file<input type="file" accept="application/json,.json" onChange={(event) => void readFile(event.target.files?.[0])} /></label></div>
    {advanced && <div className="mcp-json-import"><textarea aria-label="MCP configuration JSON" spellCheck={false} value={json} onChange={(event) => setJson(event.target.value)} /><button type="button" onClick={() => props.onImport(json)}>Validate and import</button></div>}
    <div className="mcp-list-heading"><div><strong>Configured servers</strong>{props.configPath && <small title={props.configPath}>{props.configPath}</small>}</div><span>{props.servers.length}</span></div>
    {!props.servers.length ? <div className="settings-empty"><strong>No MCP servers added</strong><span>Add one with the form or import an existing mcpServers JSON object.</span></div> : <ul className="mcp-server-list">{props.servers.map(({ server, status, tools, detail }) => <li key={server.id}>
      <div className="mcp-server-title"><label><input type="checkbox" checked={server.enabled} onChange={(event) => props.onSetEnabled(server.id, event.target.checked)} /><span><strong>{server.name}</strong><small>{server.transport === "stdio" ? [server.command, ...server.args].join(" ") : server.url}</small></span></label><em data-status={status}>{status}</em></div>
      {detail && <p>{detail}</p>}{tools.length > 0 && <div className="mcp-tools">{tools.map((tool) => <code key={tool}>{tool}</code>)}</div>}
      <div className="mcp-server-actions"><button type="button" disabled={props.busyId === server.id} onClick={() => props.onTest(server.id)}>{props.busyId === server.id ? "Testing…" : "Test & discover"}</button><button type="button" onClick={() => props.onRemove(server.id)}>Remove</button></div>
    </li>)}</ul>}
  </section>;
}

function splitArgs(value: string): string[] {
  const result: string[] = []; const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) result.push(match[1] ?? match[2] ?? match[3]!);
  return result;
}
