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

### Select a model, effort, and mode

The model selector is beside the chat composer. All discovered models appear in
one list, regardless of provider.

1. Open the model selector.
2. Search for or choose a model such as `Qwen:latest`.
3. Select an effort level supported by that model. The visual effort control is
   shown for providers that expose reasoning effort; Ollama and Gemini manage
   their execution through their own model/runtime controls, so Aster keeps the
   slider out of the way for those providers.
4. Select the execution mode beside the model.
5. Enter the task in chat and send it.

Open **Settings → Models** to choose one exact default model for each provider.
When an orchestration prompt names a provider but omits its model, Aster uses
that provider's configured default. An exact model in the prompt always wins.
If the requested model/default is missing or unavailable, the phase fails
clearly—Aster never silently substitutes a different model. You can also mark a
provider default directly from the flat model selector.

Provider, model, effort, and mode are locked when a phase starts. Changing any
of them affects a later phase, not the active phase. The modes are:

- **Plan** — read-only investigation and proposed steps.
- **Manual** — pause mutating tools in chat for explicit approval (default).
- **Auto** — perform policy-compliant workspace edits and checks without each
  approval prompt.
- **Full access** — run configured tools without per-action approval. Aster
  shows a warning before selecting it; provider and platform boundaries still
  apply.

Use `/mode plan`, `/mode manual`, `/mode auto`, or `/mode full` from chat as an
alternative to the selector. `/plan` also forces its phase into read-only mode.

### Request multi-model work

Describe orchestration in chat instead of configuring a fixed workflow ribbon:

```text
Use my selected local model to inspect this project. Then use Claude to audit
the proposed changes. Summarize the audit and run the local checks.
```

Name exact provider-qualified models when the choice matters. Aster ships the
`orchestrate-aster-models` skill and exposes provider-neutral delegation tools
through its local MCP server. A coordinating model lists Aster's available
models, starts a bounded delegated task, and polls its result. It must not search
for vendor SDKs, invent an `openai.py` client, read credentials, or silently
substitute another model.

When a role names only a provider, the coordinating model asks Aster to resolve
that provider's configured default. Delegation results report the exact resolved
provider/model, whether resolution was explicit or defaulted, and measured token
usage. A delegated task that returns no assistant response is reported as an
error rather than a false completion.

Read-only delegation is available in Plan mode. Delegated workspace changes
require the coordinating phase to be in Auto or Full access; Aster does not let
a model bypass the mode selected by the user. Full Access is propagated as Full
Access rather than being silently downgraded to Auto. Results report the actual
locked mode alongside provider and model attribution.

Aster delegates only against the workspace selected in the application. It
rejects its temporary AppImage runtime directory and any model-supplied path
that differs from the active workspace. With no prior selection, Aster safely
starts in the user's home directory; an explicitly opened folder is remembered.

Delegated tasks expose a native wait operation. Coordinators use it instead of
shell sleeps, timers, or external monitor tools, and may resume waiting with the
same task ID after a timeout or follow-up. Claude Code keeps the same session
when a follow-up no longer repeats the orchestration command names.

Every response carries a compact provider/model badge. Tool calls, commands,
results, and permission denials are grouped into collapsed **Tools** disclosures.
Press **↑** in the composer to recall earlier prompts. Hover a prior user
message and choose **Rewind** to create a safe branch before that message; the
original chat remains intact and the old prompt becomes editable. The composer
grows with longer prompts (up to a bounded portion of the window) and returns
to its compact height after sending.

Only configured, available providers can run. Prompt text cannot grant extra
filesystem, command, network, or credential permissions.

### Attach files to chat

Use the paperclip beside the composer, drag files onto the chat, or paste a
copied file. Aster supports up to 10 files per message and 25 MB per file:

- text and source-code files are added as bounded model context;
- PDF text is extracted locally before it is sent;
- PNG, JPEG, WebP, and GIF images use the selected model's image input when
  that model advertises vision support.

Attachments are copied into Aster's private local staging directory. Chat
history records only attachment names, types, and sizes—not extracted text or
image contents. When a remote model is selected, Aster names the files and asks
for confirmation before their contents leave the machine. Choose a local model
to keep attached content on-device. Unsupported binary files are rejected.

An attachment-only message is treated as a request to review the selected
files. Attach the relevant files for chat-style analysis; open a workspace in
VSCodium for longer code-style work where the model needs project context.

### Edit and verify files

Open **Editor** at any time to start VSCodium in the current workspace, or in
your home directory when no workspace is selected. Opening an individual file
is optional. The editor reports whether tracked files are saved, modified,
verified, or stale.

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

Open **Settings → Usage** for locally measured input, output, and total tokens
grouped by provider and model. It reports only usage emitted to Aster in retained
chats; it does not estimate subscription balances or plan limits.

- **Claude** chat phases pass through the user's official Claude Code CLI. The
  bridge is invisible in chat; replies carry a **Claude Code** badge and the
  concrete model name. Claude Code owns authentication, sessions, model access,
  and permission handling. Install it separately and confirm `claude auth
  status` reports a logged-in account. Individual models may still require
  usage credits under the user's Anthropic plan.
- **ChatGPT/OpenAI, Grok/xAI, and GitHub Copilot** use the login methods exposed
  by the installed Pi runtime.
- **Gemini personal-account login** uses Google's supported Antigravity CLI
  inside the Aster chat surface. If it is missing, Aster opens Google's official
  installation guide. Complete the Google flow, choose **Done — refresh
  models**, then select one of the concrete models Antigravity reports.
- **Gemini API keys and enterprise Gemini CLI authentication** remain separate
  supported paths through Pi/the legacy enterprise CLI.
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

### MCP Hub

Open **Settings → MCP Hub** to add local stdio servers or remote MCP HTTP URLs.
You can use the visual form, paste a standard `{"mcpServers": {...}}` object, or
choose a JSON file. Aster validates every definition, lets you test/discover its
tools, and provides enable, disable, and remove controls. The editable local
configuration path is shown on that page.

Do not place credential values in MCP JSON. Reference an environment variable,
for example `"GITHUB_TOKEN": "${GITHUB_TOKEN}"`; Aster resolves it at launch
without copying the value into its generated model configuration. Enabled
servers are supplied to supported bridges such as the transparent Claude Code
runner. Any conforming server is accepted—official SDK, FastMCP, or otherwise.

The 2026-07-28 MCP protocol made transport stateless. Aster therefore treats
server/task identifiers as explicit application handles rather than relying on
hidden transport sessions. A migration from the legacy TypeScript SDK line to
the official v2 SDK is tracked separately so existing integrations remain
compatible during the transition.

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

For the official Claude Code bridge, check:

```bash
claude --version
claude auth status
```

Aster displays Claude Code's exact provider or model-limit message when the CLI
cannot complete a phase.

### AppImage does not launch

```bash
chmod +x Aster_0.1.0_amd64.AppImage
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
