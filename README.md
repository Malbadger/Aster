# Aster — Local Agent Workbench

Aster is a Linux-first desktop workbench and command-line harness for local and
remote AI models. It combines Aster Core, Pi, Ollama, provider adapters, task
history, verification, and audit evidence behind one local policy boundary.

> **Status:** pre-release Linux build. Local Ollama operation, packaged desktop
> launch, task execution, cancellation, evidence export, and model discovery
> have automated coverage. See [Current limitations](#current-limitations).

## Quick start

### Install Aster

Debian/Ubuntu:

```bash
sudo apt install ./Aster_0.1.0_amd64.deb
law-desktop
```

You can also launch **Aster** from the desktop application menu. To uninstall:

```bash
sudo apt remove law
```

AppImage:

```bash
chmod +x Aster_0.1.0_amd64.AppImage
./Aster_0.1.0_amd64.AppImage
```

The AppImage is portable and does not require installation.

### Start Ollama for local/offline use

Install Ollama separately, start its service, and confirm that a model is
available:

```bash
ollama serve
ollama list
```

For example:

```bash
ollama pull qwen:latest
```

Aster connects to Ollama through `127.0.0.1:11434`. Local models remain usable
when external network access is unavailable.

## Operate the desktop application

### Start screen

- **Open Folder** — select an existing project directory.
- **New Workspace** — select a directory for new work.
- **New Chat** — begin without opening files.
- **Open File** — open one file directly in the editor.
- **Open Recent** — resume a task from local history.

Repository cloning is visible but not connected in this pre-release build.
Clone with Git first, then choose **Open Folder**.

### Select a model and effort

The model selector is beside the chat composer. All discovered models appear in
one list, regardless of provider.

1. Open the model selector.
2. Search for or choose a model such as `Qwen:latest`.
3. Select an effort level supported by that model.
4. Enter the task in chat and send it.

Model and effort are locked when a phase starts. Changing either affects a
later phase or task, not the active phase.

### Request multi-model work

Describe orchestration in chat instead of configuring a fixed workflow ribbon:

```text
Use my selected local model to inspect this project. Then use Claude to audit
the proposed changes. Summarize the audit and run the local checks.
```

Only configured, available providers can run. Aster displays interpreted phases
and results chronologically. Prompt text cannot grant extra filesystem,
command, network, or credential permissions.

### Edit and verify files

Open a file from the Start screen. The editor reports whether it is saved,
modified, verified, or stale.

- **Save** writes the current editor contents locally.
- **Run checks** verifies the saved version.
- Editing a verified file marks its prior verification stale.

Review changes before publishing them with Git. A model success message does
not prove code was committed, pushed, or deployed.

### Stop and resume tasks

Use **Stop** while a task is active to request cancellation. Task history is
stored locally and displayed separately from the file workspace. Completed Aster
checkpoints and evidence survive an application restart, although a live model
process may not.

## Provider authentication

Open **Settings → Providers** to connect an account, enter an API key, or add a
compatible endpoint. Aster keeps every discovered model in the same selector;
provider names are metadata, not selectable pseudo-models.

- **Claude, ChatGPT/OpenAI, Grok/xAI, and GitHub Copilot** use the login methods
  exposed by the installed Pi runtime.
- **Gemini account login** runs Google's official Gemini CLI inside the Aster
  chat surface. Complete the interactive Google flow, choose **Done — refresh
  models**, then select **Gemini CLI Auto**.
- **Gemini API keys** use Pi's Google provider and remain separate from Google
  account login.
- **Ollama** is discovered automatically and needs no credential on loopback.

To add a local server, proxy, or enterprise gateway, choose **Another service →
Add provider** and enter its exact model IDs. Supported wire protocols are
OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, and Google
Generative AI. Credentials can be supplied through Pi's encrypted/provider-owned
API-key flow, an environment-variable name, or an external secret command. The
saved connection contains only endpoint metadata and the credential reference,
never the resolved value.

Remote authentication belongs to the provider, official Gemini CLI, or Pi;
Aster must not display or store credential values in chat or logs. CLI setup is
also available:

```bash
cd /path/to/Aster
npm ci
npm run build
npm link

law configure
law provider login claude-pro
law provider login chatgpt
law doctor
```

Login commands hand control to Pi's provider-owned flow. Never paste API keys,
OAuth tokens, passwords, or session cookies into an Aster prompt or ordinary
configuration file.

The legacy Aster Core CLI preserves its original owner policy, including its
Claude Max denial. Public desktop provider policy is intended to be
administrator/user configurable and does not impose that global product rule.

## Command-line operation

Inspect readiness:

```bash
law doctor
law doctor --json
```

Run a local task with an exact model selection:

```bash
law run \
  --workflow default \
  --provider ollama-local \
  --model 'qwen:latest' \
  --prompt 'Inspect this project and provide a concise read-only summary.'
```

Add `--mutate` only for an attended coding run. Unattended mutation remains
blocked unless an approved container engine is available. Pi has no built-in OS
sandbox; Aster's policy gate is not a substitute for one.

Export redacted evidence:

```bash
law evidence export <run-id>
```

List all CLI commands:

```bash
law --help
```

## Codex and Claude Code integration

Aster includes a local stdio MCP server for delegating bounded read-only work to
Ollama without sending model weights, checkpoints, or full local transcripts to
the client conversation.

Build it first:

```bash
cd /path/to/Aster
npm ci
npm run build
```

Codex configuration:

```toml
[mcp_servers.law_ollama]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/Aster/dist/mcp/server.js"]
startup_timeout_sec = 30

[mcp_servers.law_ollama.env]
LAW_PROJECT_ROOT = "/absolute/path/to/Aster"
```

Claude Code registration:

```bash
claude mcp add --scope user law-ollama \
  -e LAW_PROJECT_ROOT=/absolute/path/to/Aster -- \
  /absolute/path/to/node \
  /absolute/path/to/Aster/dist/mcp/server.js
```

Restart the client after registration. More detail is available in
[`docs/CODEX-MCP.md`](docs/CODEX-MCP.md).

## Logging and evidence

- Community operational logging is off by default.
- Managed deployments may require visibly disclosed logging.
- Credentials and configured secret patterns are excluded from logs/evidence.
- Task state and evidence stay local unless explicitly exported or published.

Inspect an evidence bundle for project-specific sensitive information before
sharing it, even though Aster performs automated redaction.

## Troubleshooting

### No local models appear

```bash
ollama list
curl http://127.0.0.1:11434/api/tags
law doctor
```

Start Ollama if its loopback endpoint is unavailable. Aster does not silently
download models.

### Aster reports degraded status

`degraded` can mean Aster remains usable while an optional capability is absent.
For example, attended read-only work can run without Docker or Podman, while
unattended mutation is blocked. Run `law doctor` and follow **next safe
actions**.

### A remote model is unavailable

Run `law provider login <provider-id>`, then `law doctor`. Login is human-only,
and paid-provider use may incur charges under the user's provider account.

### AppImage does not launch

```bash
chmod +x LAW_0.1.0_amd64.AppImage
./Aster_0.1.0_amd64.AppImage --appimage-extract-and-run
```

### Check versions

The desktop version appears in the upper-right status area. For Aster Core:

```bash
law doctor
law pi status
```

## Current limitations

The following areas are incomplete in this pre-release:

- repository cloning from the Start screen;
- a fully interactive integrated terminal;
- recursive file-tree browsing;
- logging settings, source control, and the complete editable-diff experience;
- release signing and automatic updates;
- final screen-reader, visual, usability, and public-release approval.
- the private qualification corpus, internal build records, and development
  prompts are intentionally not distributed with the source repository.

Use Git for collaboration between workstations. Aster intentionally does not link
workstations or share live local-agent state.

## Build from source

Ubuntu prerequisites and packaging details are in
[`packaging/README.md`](packaging/README.md). Standard validation:

```bash
npm ci
npm run build:all
npm run check:all
npm run desktop:test
npm run desktop:package
npm run desktop:smoke:packaged
npm run desktop:exemplars
npm run desktop:a11y
npm run release:audit
```

## License and release warning

Package metadata declares `AGPL-3.0-only`. A public release must include and
review the corresponding root `LICENSE` file before distribution. Until that
gate is closed, treat this repository as pre-release source rather than a
finalized public distribution.
