# Codex Desktop + Aster models

Aster exposes a local MCP server that lets Codex delegate bounded work to models connected
through Aster. The server uses MCP over `stdio`: Codex starts it as a child process, and it
opens no network listener. Ollama traffic is restricted to `http://127.0.0.1:11434`.

## Tools

- `aster_list_models` — list available models and each provider's configured default.
- `aster_delegate_start` — start a read-only task using an exact model or provider default.
- `aster_delegate_start_mutating` — start an Auto-mode workspace task when explicitly authorized.
- `aster_delegate_get` — poll a task for exact attribution, usage, response, or error.

- `law_ollama_list_models` — list models installed in local Ollama.
- `law_ollama_select_model` — choose the default model for new runs.
- `law_ollama_get_selection` — show the current default.
- `law_ollama_start_readonly` — start bounded Aster/Pi inspection and return immediately.
- `law_ollama_get_job` — poll a background job and retrieve its compact result.
- `law_ollama_get_run` — read a compact checkpoint result without loading its transcript.
- `law_ollama_export_evidence` — write a redacted evidence bundle locally.

The model is locked when each run starts. Changing a default affects only later runs. An
exact model always takes precedence over a provider default; missing and unavailable targets
fail without substitution. Mutating delegation is exposed separately and remains subject to
Aster's selected execution mode and policy gates.

## Codex configuration

```toml
[mcp_servers.law_ollama]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/Aster/dist/mcp/server.js"]
startup_timeout_sec = 30

[mcp_servers.law_ollama.env]
LAW_PROJECT_ROOT = "/absolute/path/to/Aster"
```

After building and adding this configuration, restart Codex Desktop. Example requests:

1. “List my local Ollama models and select `qwen:latest`.”
2. “Ask my selected local model to inspect `/absolute/path/to/my-project` and
   summarize its architecture.”
3. “Export the evidence for the Aster run you just completed.”

Only the bounded result returned by a tool enters the Codex conversation. Pi's full
session transcript, Aster checkpoints, model weights, and evidence remain on this device.

## Claude Code registration

The same server can be shared across every Claude Code project:

```bash
claude mcp add --scope user law-ollama \
  -e LAW_PROJECT_ROOT=/absolute/path/to/Aster -- \
  /absolute/path/to/node \
  /absolute/path/to/Aster/dist/mcp/server.js
```

Codex and Claude Code share the selected model and Aster evidence. Background jobs live in
the client-owned MCP process; restarting that client interrupts an active job, while
completed Aster checkpoints and evidence remain on disk.
