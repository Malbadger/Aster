import React from "react";
import { open as openNativePath, save as saveNativePath } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  DESKTOP_VERSION, daemon_get_health, daemon_probe_capabilities,
  model_list_catalog, model_set_favorite, task_cancel, task_create,
  task_get_events, task_list, task_send_message, task_delete, task_rewind, task_respond_approval,
  usage_get_summary,
  fs_list_directory, fs_read_file, fs_write_file, verify_run,
  workspace_set_root,
  attachment_import, attachment_stage,
  provider_list_connections, provider_add_connection, provider_remove_connection, provider_set_enabled, provider_check_credential,
  provider_auth_methods, provider_auth_start, provider_auth_get, provider_auth_respond, provider_auth_cancel, provider_auth_logout,
  provider_gemini_cli_status,
  mcp_server_list, mcp_server_upsert, mcp_server_import, mcp_server_set_enabled, mcp_server_remove, mcp_server_test,
  type CapabilityProbe, type ChatEvent, type EffortLevel, type ExecutionMode,
  type ModelDescriptor, type PhaseIdentity, type ProviderConnection, type Task, type AuthFlow, type AttachmentDescriptor, type UsageSummary, type McpServerConfig, type McpServerView,
} from "@law/contracts";
import { createIpcClient, type IpcClient } from "./ipc/client.js";
import { tauriTransport } from "./ipc/tauri-transport.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { AppMenuBar } from "./components/AppMenuBar.js";
import { EmbeddedTerminal, type TerminalProgram } from "./components/EmbeddedTerminal.js";
import { VscodiumEditor } from "./components/VscodiumEditor.js";
import { SettingsPanel, type EditorEngine, type LawTheme, type SettingsTab } from "./components/SettingsPanel.js";
import type { AddConnectionForm } from "./components/ProviderConnections.js";
import { FlatModelSelector } from "./components/FlatModelSelector.js";
import { FirstRunSetup } from "./components/FirstRunSetup.js";
import { StartSurface, type StartAction } from "./components/StartSurface.js";
import { TaskHistory } from "./components/TaskHistory.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";
import { AuthCard, type AuthProvider } from "./components/AuthCard.js";
import { GeminiCliLogin } from "./components/GeminiCliLogin.js";
import { ClaudeCodeLogin } from "./components/ClaudeCodeLogin.js";
import { FileExplorer } from "./components/FileExplorer.js";
import type { GeminiCliStatusView } from "./components/ProviderConnections.js";
import { DEFAULT_LAYOUT, applyPreset, resetLayout, togglePanel, type Layout, type Panel, type Preset } from "./layout/layout.js";
import asterMark from "./assets/aster-mark-muted-transparent.svg";

type View = "boot" | "setup" | "start" | "workspace";
export interface AppProps { client?: IpcClient }
const LAYOUT_KEY = "law.desktop.layout.v2";
const THEME_KEY = "law.desktop.theme.v1";
const EDITOR_KEY = "law.desktop.editor.v1";
const MODE_KEY = "aster.desktop.mode.v1";
const defaultClient = createIpcClient(tauriTransport);

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return saved ? { ...DEFAULT_LAYOUT, ...saved } : { ...DEFAULT_LAYOUT };
  } catch { return { ...DEFAULT_LAYOUT }; }
}

function identityFor(model: ModelDescriptor | undefined, effort: EffortLevel, mode: ExecutionMode): PhaseIdentity | undefined {
  return model ? { provider: model.provider, model: model.id, effort, mode, locality: model.locality } : undefined;
}

function showsEffortControl(model: ModelDescriptor | undefined): model is ModelDescriptor {
  return Boolean(model && !/(ollama|gemini|antigravity)/i.test(`${model.provider}:${model.id}`));
}

function supportedEffort(model: ModelDescriptor, current: EffortLevel): EffortLevel {
  if (model.effort.supported.includes(current)) return current;
  if (model.effort.supported.includes("medium")) return "medium";
  return model.effort.supported[0] ?? "medium";
}

export function App({ client = defaultClient }: AppProps): React.JSX.Element {
  const [view, setView] = React.useState<View>("boot");
  const [error, setError] = React.useState<string>();
  const [bootDetail, setBootDetail] = React.useState("Connecting to the private local runtime…");
  const [probe, setProbe] = React.useState<CapabilityProbe>();
  const [models, setModels] = React.useState<ModelDescriptor[]>([]);
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string>();
  const [effort, setEffort] = React.useState<EffortLevel>("medium");
  const [mode, setMode] = React.useState<ExecutionMode>(() => (localStorage.getItem(MODE_KEY) as ExecutionMode | null) ?? "manual");
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [taskQuery, setTaskQuery] = React.useState("");
  const [taskId, setTaskId] = React.useState<string>();
  const [conversationKey, setConversationKey] = React.useState(0);
  const [events, setEvents] = React.useState<ChatEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const [layout, setLayout] = React.useState<Layout>(loadLayout);
  const [activePanel, setActivePanel] = React.useState<Panel>("chat");
  const [modelOpen, setModelOpen] = React.useState(false);
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string>();
  const [homeDirectory, setHomeDirectory] = React.useState<string>();
  const [openFile, setOpenFile] = React.useState<string>();
  const [fileContent, setFileContent] = React.useState("");
  const [savedContent, setSavedContent] = React.useState("");
  const [verification, setVerification] = React.useState("unverified");
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>();
  const [theme, setTheme] = React.useState<LawTheme>(() => (localStorage.getItem(THEME_KEY) as LawTheme | null) ?? "graphite");
  const [editorEngine, setEditorEngine] = React.useState<EditorEngine>("vscode-oss");
  const [terminalLaunch, setTerminalLaunch] = React.useState<{ program: TerminalProgram; initialInput?: string }>();
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [providerState, setProviderState] = React.useState<"empty" | "loading" | "error" | "ready">("loading");
  const [providerError, setProviderError] = React.useState<string>();
  const [usage, setUsage] = React.useState<UsageSummary>();
  const [mcpServers, setMcpServers] = React.useState<McpServerView[]>([]);
  const [mcpConfigPath, setMcpConfigPath] = React.useState<string>();
  const [mcpBusyId, setMcpBusyId] = React.useState<string>();
  const [mcpError, setMcpError] = React.useState<string>();
  const [authProviders, setAuthProviders] = React.useState<AuthProvider[]>([]);
  const [authFlow, setAuthFlow] = React.useState<AuthFlow>();
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authBrowserError, setAuthBrowserError] = React.useState<string>();
  const [geminiCli, setGeminiCli] = React.useState<GeminiCliStatusView>();
  const [geminiLoginOpen, setGeminiLoginOpen] = React.useState(false);
  const [claudeLoginOpen, setClaudeLoginOpen] = React.useState(false);
  const [attachments, setAttachments] = React.useState<AttachmentDescriptor[]>([]);
  const [attachmentBusy, setAttachmentBusy] = React.useState(false);
  const [remoteAttachmentConfirm, setRemoteAttachmentConfirm] = React.useState<{ names: string[]; resolve: (allowed: boolean) => void }>();
  const attachmentEgressApproved = React.useRef(false);
  const openedAuthUrl = React.useRef<string>();
  const refreshedAuthFlow = React.useRef<string>();
  const selected = models.find((model) => model.id === selectedId);

  const refreshCatalog = React.useCallback(async (search = "") => {
    const catalog = await client.call(model_list_catalog, { query: search });
    setModels(catalog.models); setFavorites(catalog.favorites);
    setSelectedId((current) => current && catalog.models.some((model) => model.id === current)
      ? current : catalog.models.find((model) => model.availability === "available")?.id);
  }, [client]);

  const refreshTasks = React.useCallback(async () => {
    setTasks((await client.call(task_list, { query: "" })).tasks);
  }, [client]);

  const listWorkspaceDirectory = React.useCallback(async (path: string) => (
    await client.call(fs_list_directory, { path })
  ).entries, [client]);

  const refreshProviders = React.useCallback(async () => {
    try {
      setProviderState("loading"); setProviderError(undefined);
      const result = await client.call(provider_list_connections, {});
      setConnections(result.connections); setProviderState(result.connections.length ? "ready" : "empty");
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause)); setProviderState("error");
    }
  }, [client]);

  const refreshAuthProviders = React.useCallback(async () => {
    const result = await client.call(provider_auth_methods, {});
    setAuthProviders(result.providers);
    return result.providers;
  }, [client]);

  const refreshGeminiCli = React.useCallback(async () => {
    const status = await client.call(provider_gemini_cli_status, {});
    setGeminiCli(status);
    return status;
  }, [client]);

  const refreshMcp = React.useCallback(async () => {
    const result = await client.call(mcp_server_list, {});
    setMcpServers(result.servers); setMcpConfigPath(result.configPath);
    return result;
  }, [client]);

  const boot = React.useCallback(async () => {
    setError(undefined); setView("boot");
    try {
      setBootDetail("Connecting to the private local runtime…");
      await client.call(daemon_get_health, {});
      setBootDetail("Inspecting local capabilities…");
      const detected = await client.call(daemon_probe_capabilities, { refresh: false });
      setProbe(detected);
      setBootDetail("Loading models and task history…");
      setHomeDirectory(await Promise.resolve(invoke<string>("home_directory")).catch(() => undefined));
      await Promise.all([refreshCatalog(), refreshTasks(), refreshProviders(), refreshAuthProviders(), refreshGeminiCli()]);
      const ready = detected.capabilities.filter((capability) => !capability.optional).every((capability) => capability.state === "ready");
      setView(ready ? "workspace" : "setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, refreshAuthProviders, refreshCatalog, refreshGeminiCli, refreshProviders, refreshTasks]);

  React.useEffect(() => { void boot(); }, [boot]);
  React.useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);
  React.useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); }, [theme]);
  React.useEffect(() => {
    if (view !== "workspace" && view !== "start") return;
    // Warm VSCodium and its matching web host before the editor is requested.
    // A later workspace change may restart the lightweight server, but reuses
    // the downloaded host and persistent data directory.
    void Promise.resolve(invoke<string>("vscodium_start", { directory: workspaceRoot, theme })).catch(() => {});
  }, [view, workspaceRoot, theme]);
  React.useEffect(() => {
    if (!authFlow || !["running", "waiting"].includes(authFlow.status)) return;
    const timer = window.setInterval(() => void client.call(provider_auth_get, { flowId: authFlow.flowId }).then((result) => setAuthFlow(result.flow)), 750);
    return () => window.clearInterval(timer);
  }, [authFlow?.flowId, authFlow?.status, client]);
  React.useEffect(() => {
    const url = authFlow?.messages.map((message) => message.url ?? message.verificationUri).filter(Boolean).at(-1);
    const launchKey = authFlow ? `${authFlow.flowId}:${url}` : url;
    if (!url || openedAuthUrl.current === launchKey) return;
    openedAuthUrl.current = launchKey; setAuthBrowserError(undefined);
    void Promise.resolve(invoke<string>("open_external_url", { url })).catch((cause) => {
      setAuthBrowserError(`Browser did not open: ${cause instanceof Error ? cause.message : String(cause)}. Use Open browser to try again.`);
    });
  }, [authFlow?.messages]);
  React.useEffect(() => {
    if (authFlow?.status !== "completed" || refreshedAuthFlow.current === authFlow.flowId) return;
    refreshedAuthFlow.current = authFlow.flowId;
    void Promise.all([refreshCatalog(query), refreshAuthProviders()]);
  }, [authFlow?.flowId, authFlow?.status, query, refreshAuthProviders, refreshCatalog]);
  React.useEffect(() => { localStorage.setItem(EDITOR_KEY, editorEngine); }, [editorEngine]);
  React.useEffect(() => { localStorage.setItem(MODE_KEY, mode); }, [mode]);
  React.useEffect(() => {
    if (settingsTab !== "usage") return;
    void client.call(usage_get_summary, {}).then(setUsage).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [client, settingsTab]);
  React.useEffect(() => {
    if (settingsTab !== "mcp") return;
    void refreshMcp().catch((cause) => setMcpError(cause instanceof Error ? cause.message : String(cause)));
  }, [refreshMcp, settingsTab]);

  React.useEffect(() => {
    if (!taskId || !running) return;
    let disposed = false;
    const poll = async () => {
      try {
        const result = await client.call(task_get_events, { taskId, sinceSeq: 0 });
        if (disposed) return;
        setEvents(result.events);
        if (result.taskStatus !== "active") { setRunning(false); await refreshTasks(); }
      } catch (cause) {
        if (!disposed) { setError(cause instanceof Error ? cause.message : String(cause)); setRunning(false); }
      }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 700);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [client, taskId, running, refreshTasks]);

  async function openTask(id: string): Promise<void> {
    setError(undefined); setTaskId(id);
    const result = await client.call(task_get_events, { taskId: id, sinceSeq: 0 });
    setEvents(result.events); setView("workspace");
  }

  function newChat(): void {
    setError(undefined);
    setTaskId(undefined);
    setEvents([]);
    setRunning(false);
    setAttachments([]);
    attachmentEgressApproved.current = false;
    setConversationKey((value) => value + 1);
    setActivePanel("chat");
    setLayout((old) => ({ ...old, chat: true }));
    setView("workspace");
  }

  async function startAction(action: StartAction): Promise<void> {
    if (action === "new-chat") return newChat();
    if (action === "open-folder" || action === "new-workspace") {
      const chosen = await openNativePath({ directory: true, multiple: false, title: action === "open-folder" ? "Open folder in Aster" : "Choose workspace folder" });
      if (typeof chosen === "string") { await client.call(workspace_set_root, { path: chosen }); setWorkspaceRoot(chosen); newChat(); }
      return;
    }
    if (action === "open-file") {
      const chosen = await openNativePath({ directory: false, multiple: false, title: "Open file in Aster" });
      if (typeof chosen === "string") {
        const root = chosen.slice(0, Math.max(1, chosen.lastIndexOf("/")));
        await client.call(workspace_set_root, { path: root }); setWorkspaceRoot(root); newChat();
        const file = await client.call(fs_read_file, { path: chosen });
        setOpenFile(chosen); setFileContent(file.content); setSavedContent(file.content); setVerification(file.state.verification);
        setLayout((old) => ({ ...old, chat: true })); await openInEditor(editorEngine, chosen);
      }
      return;
    }
    if (action === "open-recent" && tasks[0]) return openTask(tasks[0].taskId);
    setError(`${action.replaceAll("-", " ")} is not connected yet.`);
  }

  async function send(text: string): Promise<void> {
    const command = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
    if (command) {
      const name = command[1]?.toLowerCase();
      const args = command[2]?.trim() ?? "";
      const local = (kind: "user" | "assistant" | "error", message: string) => setEvents((current) => [...current, {
        id: `local-${kind}-${Date.now()}-${current.length}`, taskId: taskId ?? "local", seq: current.length,
        at: new Date().toISOString(), kind, text: message,
      }]);
      if (name === "model") {
        local("user", text);
        if (!args) { setModelOpen(true); local("assistant", "Choose a model from the selector beside the chat box."); return; }
        const needle = args.toLowerCase();
        const match = models.find((model) => model.id.toLowerCase() === needle || model.displayName.toLowerCase() === needle || model.id.toLowerCase().endsWith(`:${needle}`));
        if (!match) { setModelOpen(true); local("error", `No model matched “${args}”. Choose one from the model selector.`); return; }
        setSelectedId(match.id); local("assistant", `Model selected: ${match.displayName} (${match.provider}).`); return;
      }
      if (name === "effort") {
        local("user", text);
        const requested = args.toLowerCase() as EffortLevel;
        if (!selected) { local("error", "Select a model before setting effort."); return; }
        if (!args) { local("assistant", `Current effort: ${effort}. Supported by ${selected.displayName}: ${selected.effort.supported.join(", ")}. Use /effort <level>.`); return; }
        if (!selected.effort.supported.includes(requested)) { local("error", `${selected.displayName} does not support “${args}”. Available: ${selected.effort.supported.join(", ")}.`); return; }
        setEffort(requested); local("assistant", `Effort set to ${requested} for ${selected.displayName}.`); return;
      }
      if (name === "mode") {
        local("user", text);
        const aliases: Record<string, ExecutionMode> = { plan: "plan", manual: "manual", auto: "auto", full: "full-access", "full-access": "full-access" };
        if (!args) { local("assistant", `Current mode: ${mode}. Use /mode plan, /mode manual, /mode auto, or /mode full.`); return; }
        const requested = aliases[args.toLowerCase()];
        if (!requested) { local("error", `Unknown mode “${args}”. Available: plan, manual, auto, full.`); return; }
        if (requested === "full-access" && !window.confirm("Full access runs configured tools without per-action approval. Continue?")) { local("assistant", "Mode change cancelled."); return; }
        setMode(requested); local("assistant", `Mode set to ${requested}. It will be locked for the next phase.`); return;
      }
      if (name === "new") { newChat(); return; }
      if (name === "login") {
        local("user", text);
        if (["gemini", "gemini-cli", "google"].includes(args.toLowerCase())) { startGeminiCliLogin(); return; }
        if (["claude", "claude-code", "claude-pro", "anthropic"].includes(args.toLowerCase())) { startClaudeCodeLogin(); return; }
        const result = await client.call(provider_auth_methods, {}); setAuthProviders(result.providers); setAuthOpen(true); setAuthFlow(undefined);
        const requested = args.toLowerCase() === "claude-pro" ? "anthropic" : ["chatgpt", "openai"].includes(args.toLowerCase()) ? "openai-codex" : args.toLowerCase();
        const provider = requested && result.providers.find((item) => item.id === requested);
        if (provider && provider.methods.length === 1) setAuthFlow((await client.call(provider_auth_start, { provider: provider.id, authType: provider.methods[0]! })).flow);
        return;
      }
      if (name === "logout") {
        local("user", text);
        const provider = args.toLowerCase() === "claude-pro" ? "anthropic" : ["chatgpt", "openai"].includes(args.toLowerCase()) ? "openai-codex" : args.toLowerCase();
        if (!provider) { local("assistant", "Use /logout <provider>, for example /logout anthropic."); return; }
        await client.call(provider_auth_logout, { provider }); local("assistant", `Logged out of ${provider}.`); await refreshCatalog(); return;
      }
      if (name === "pi") { local("user", text); local("assistant", "Pi is already the engine behind this chat. Use /model, /effort, /login, or enter your request here."); return; }
    }
    setError(undefined);
    const optimistic: ChatEvent = { id: `local-${Date.now()}`, taskId: taskId ?? "pending", seq: events.length, at: new Date().toISOString(), kind: "user", text };
    setEvents((current) => [...current, optimistic]);
    try {
      let targetTaskId = taskId;
      if (!targetTaskId) {
        const label = workspaceRoot ? workspaceRoot.split("/").filter(Boolean).at(-1) ?? workspaceRoot : "New chat";
        const created = await client.call(task_create, { title: label, ...(workspaceRoot ? { workspaceId: workspaceRoot } : {}), defaultIdentity: identityFor(selected, effort, mode) });
        targetTaskId = created.task.taskId;
        setTaskId(targetTaskId);
      }
      const result = await client.call(task_send_message, { taskId: targetTaskId, text, identity: identityFor(selected, effort, mode), attachmentIds: attachments.map((attachment) => attachment.attachmentId), attachmentEgressApproved: attachmentEgressApproved.current });
      setEvents((await client.call(task_get_events, { taskId: targetTaskId, sinceSeq: 0 })).events);
      attachmentEgressApproved.current = false; setAttachments([]); setRunning(result.status === "running"); await refreshTasks();
    } catch (cause) {
      attachmentEgressApproved.current = false;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message); setRunning(false);
      setEvents((current) => [...current, { id: `local-error-${Date.now()}`, taskId: taskId ?? "pending", seq: current.length, at: new Date().toISOString(), kind: "error", text: `Message was not sent: ${message}` }]);
    }
  }

  async function chooseAttachments(): Promise<void> {
    const chosen = await openNativePath({ directory: false, multiple: true, title: "Attach files to this message" });
    const paths = typeof chosen === "string" ? [chosen] : chosen ?? [];
    if (!paths.length) return;
    setAttachmentBusy(true); setError(undefined);
    try {
      const imported = await Promise.all(paths.map((path) => client.call(attachment_import, { path })));
      setAttachments((current) => mergeAttachments(current, imported.map((item) => item.attachment)));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setAttachmentBusy(false); }
  }

  async function stageFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    setAttachmentBusy(true); setError(undefined);
    try {
      const staged: AttachmentDescriptor[] = [];
      for (const file of files) {
        const dataBase64 = bufferToBase64(await file.arrayBuffer());
        staged.push((await client.call(attachment_stage, { name: file.name || `pasted-${Date.now()}.png`, mimeType: file.type || "application/octet-stream", dataBase64 })).attachment);
      }
      setAttachments((current) => mergeAttachments(current, staged));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setAttachmentBusy(false); }
  }

  function approveRemoteAttachmentSend(): Promise<boolean> {
    if (attachments.some((attachment) => attachment.kind === "image") && !selected?.capabilities.vision) {
      setError(`${selected?.displayName ?? "The selected model"} does not report image support. Choose a vision-capable model or remove the image.`);
      return Promise.resolve(false);
    }
    if (!attachments.length || selected?.locality !== "remote") return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setRemoteAttachmentConfirm({ names: attachments.map((attachment) => attachment.name), resolve }));
  }

  async function stop(): Promise<void> {
    if (!taskId) return;
    await client.call(task_cancel, { taskId }); setRunning(false);
    setEvents((await client.call(task_get_events, { taskId, sinceSeq: 0 })).events);
    await refreshTasks();
  }

  async function saveFile(): Promise<void> {
    if (!openFile) return;
    const result = await client.call(fs_write_file, { path: openFile, content: fileContent, author: "human" });
    setSavedContent(fileContent); setVerification(result.state.verification);
  }

  async function openInEditor(engine: EditorEngine, path: string): Promise<void> {
    setEditorEngine(engine);
    setOpenFile(path); setLayout((old) => ({ ...old, editor: true })); setActivePanel("editor");
  }

  async function saveFileAs(): Promise<void> {
    if (!openFile) return;
    const chosen = await saveNativePath({ title: "Save file as", defaultPath: openFile });
    if (typeof chosen !== "string") return;
    const result = await client.call(fs_write_file, { path: chosen, content: fileContent, author: "human" });
    setOpenFile(chosen); setSavedContent(fileContent); setVerification(result.state.verification);
    setLayout((old) => ({ ...old, editor: true })); setActivePanel("editor");
  }

  async function newFile(): Promise<void> {
    const base = workspaceRoot && !workspaceRoot.includes("appimage_extracted_") ? workspaceRoot : await invoke<string>("home_directory");
    const chosen = await saveNativePath({ title: "Create a new file", defaultPath: `${base}/untitled.txt` });
    if (typeof chosen !== "string") return;
    const root = chosen.slice(0, Math.max(1, chosen.lastIndexOf("/")));
    await client.call(workspace_set_root, { path: root });
    await client.call(fs_write_file, { path: chosen, content: "", author: "human" });
    setWorkspaceRoot(root); setOpenFile(chosen); setFileContent(""); setSavedContent(""); setVerification("unverified");
    setLayout((old) => ({ ...old, chat: true })); await openInEditor(editorEngine, chosen);
    if (!taskId) newChat();
  }

  async function openSystemTerminal(): Promise<void> {
    try { await invoke("open_terminal", { directory: workspaceRoot }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function authenticateProvider(provider: string, authType: "oauth" | "api_key"): Promise<void> {
    try {
      setProviderError(undefined);
      setSettingsTab(undefined);
      setView("workspace"); setActivePanel("chat"); setLayout((old) => ({ ...old, chat: true }));
      setAuthOpen(true); setAuthBrowserError(undefined);
      const result = await client.call(provider_auth_start, { provider, authType });
      setAuthFlow(result.flow);
    } catch (cause) {
      setAuthOpen(false);
      setProviderError(cause instanceof Error ? cause.message : String(cause));
      setProviderState("error");
      setSettingsTab("providers");
    }
  }

  async function addConnection(form: AddConnectionForm): Promise<void> {
    try {
      await client.call(provider_add_connection, form);
      await Promise.all([refreshProviders(), refreshAuthProviders(), refreshCatalog(query)]);
      if (form.endpoint && form.authMethod === "oauth-device") await authenticateProvider(form.provider, "api_key");
    }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); setProviderState("error"); }
  }

  async function removeConnection(connectionId: string): Promise<void> {
    await client.call(provider_remove_connection, { connectionId }); await Promise.all([refreshProviders(), refreshCatalog(query)]);
  }

  async function setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void> {
    await client.call(provider_set_enabled, { connectionId, enabled }); await Promise.all([refreshProviders(), refreshCatalog(query)]);
  }

  function startGeminiCliLogin(): void {
    if (!geminiCli?.antigravityInstalled) {
      setSettingsTab(undefined); setView("workspace"); setActivePanel("chat"); setLayout((old) => ({ ...old, chat: true }));
      setError("Google moved personal Gemini CLI accounts to Antigravity CLI. The official installation guide has been opened; install it, then return to Providers and choose Sign in.");
      void Promise.resolve(invoke<string>("open_external_url", { url: "https://antigravity.google/docs/cli/install/" })).catch(() => {});
      return;
    }
    setSettingsTab(undefined); setView("workspace"); setActivePanel("chat"); setLayout((old) => ({ ...old, chat: true }));
    setAuthOpen(false); setGeminiLoginOpen(true);
  }

  function startClaudeCodeLogin(): void {
    setSettingsTab(undefined); setView("workspace"); setActivePanel("chat"); setLayout((old) => ({ ...old, chat: true }));
    setAuthOpen(false); setGeminiLoginOpen(false); setClaudeLoginOpen(true);
  }

  async function finishGeminiCliLogin(): Promise<void> {
    setGeminiLoginOpen(false);
    await Promise.all([refreshGeminiCli(), refreshCatalog(query)]);
  }

  async function checkConnection(connectionId: string): Promise<void> {
    await client.call(provider_check_credential, { connectionId }); await refreshProviders();
  }

  async function updateMcp(action: () => Promise<unknown>): Promise<void> {
    setMcpError(undefined);
    try { await action(); await refreshMcp(); }
    catch (cause) { setMcpError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function testMcp(id: string): Promise<void> {
    setMcpBusyId(id); setMcpError(undefined);
    try {
      const result = await client.call(mcp_server_test, { id });
      setMcpServers((current) => current.map((item) => item.server.id === id ? result.server : item));
    } catch (cause) { setMcpError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setMcpBusyId(undefined); }
  }

  async function deleteChat(id: string): Promise<void> {
    const task = tasks.find((item) => item.taskId === id);
    if (!window.confirm(`Delete “${task?.title ?? "this chat"}” and its local message history? This cannot be undone.`)) return;
    try {
      await client.call(task_delete, { taskId: id });
      if (taskId === id) newChat();
      await refreshTasks();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function rewindChat(event: ChatEvent): Promise<string | undefined> {
    if (!taskId || event.kind !== "user") return undefined;
    try {
      const result = await client.call(task_rewind, { taskId, userSeq: event.seq });
      setTaskId(result.task.taskId);
      setEvents(result.events);
      setRunning(false);
      setConversationKey((value) => value + 1);
      await refreshTasks();
      return result.draft;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }

  async function verifyFile(): Promise<void> {
    if (!openFile) return;
    const result = await client.call(verify_run, { path: openFile });
    setVerification(result.state.verification);
  }

  const controls = <div className="composer-controls">
    <div className="model-popover-anchor">
      <button className="model-trigger" type="button" aria-expanded={modelOpen} onClick={() => setModelOpen((open) => !open)}>
        <svg className="composer-control-icon" aria-hidden viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/></svg>
        <span>{selected?.displayName ?? "Select model"}</span>
        <svg className="composer-chevron" aria-hidden viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>
      </button>
      {modelOpen && <div className="model-popover"><FlatModelSelector models={models} selectedId={selectedId} favorites={favorites} query={query}
        onQueryChange={(value) => { setQuery(value); void refreshCatalog(value); }}
        onSelect={(id) => {
          const next = models.find((model) => model.id === id);
          setSelectedId(id);
          if (next) setEffort((current) => supportedEffort(next, current));
          setModelOpen(false);
        }}
        onToggleFavorite={(modelId, favorite) => void client.call(model_set_favorite, { modelId, favorite }).then((result) => setFavorites(result.favorites))} /></div>}
    </div>
    {showsEffortControl(selected) && <label className="composer-select-control effort-select-control" title="Reasoning effort">
      <svg className="composer-control-icon" aria-hidden viewBox="0 0 24 24"><path d="M4 15a8 8 0 0 1 16 0"/><path d="m12 15 4-6"/></svg>
      <select aria-label="Reasoning effort" value={effort} onChange={(event) => setEffort(event.target.value as EffortLevel)}>
        {selected.effort.supported.map((level) => <option key={level} value={level}>{level[0]!.toUpperCase() + level.slice(1)}</option>)}
      </select>
      <svg className="composer-chevron" aria-hidden viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>
    </label>}
    <label className={`mode-control mode-${mode}`} title="Execution permission mode">
      <svg className="composer-control-icon" aria-hidden viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      <select aria-label="Execution mode" value={mode} onChange={(event) => {
        const next = event.target.value as ExecutionMode;
        if (next === "full-access" && !window.confirm("Full access runs configured tools without per-action approval. Continue?")) return;
        setMode(next);
      }}>
        <option value="plan">Plan</option><option value="manual">Manual</option><option value="auto">Auto</option><option value="full-access">Full access</option>
      </select>
      <svg className="composer-chevron" aria-hidden viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>
    </label>
  </div>;

  const slots: Partial<Record<Panel, React.ReactNode>> = {
    chat: <ChatPanel key={conversationKey} events={events} running={running} attachments={attachments} attachmentBusy={attachmentBusy} onRewind={rewindChat}
      onChooseAttachments={() => void chooseAttachments()} onFiles={(files) => void stageFiles(files)} onRemoveAttachment={(id) => setAttachments((current) => current.filter((attachment) => attachment.attachmentId !== id))}
      onBeforeSend={approveRemoteAttachmentSend} onSend={(text) => void send(text)} onStop={() => void stop()} onRespondApproval={(approvalId, approved) => {
      if (!taskId) return;
      void client.call(task_respond_approval, { taskId, approvalId, approved }).then(async () => setEvents((await client.call(task_get_events, { taskId, sinceSeq: 0 })).events));
    }} controls={controls} composerNotice={remoteAttachmentConfirm ? <div className="attachment-disclosure" role="alert"><strong>Send local files to {selected?.displayName}?</strong><span>{remoteAttachmentConfirm.names.join(", ")} will leave this device for this message.</span><div><button type="button" onClick={() => { attachmentEgressApproved.current = false; remoteAttachmentConfirm.resolve(false); setRemoteAttachmentConfirm(undefined); }}>Keep local</button><button className="primary" type="button" onClick={() => { attachmentEgressApproved.current = true; remoteAttachmentConfirm.resolve(true); setRemoteAttachmentConfirm(undefined); }}>Send files</button></div></div> : undefined} interactive={claudeLoginOpen
      ? <ClaudeCodeLogin directory={workspaceRoot} onDone={() => { setClaudeLoginOpen(false); void refreshCatalog(query); }} onCancel={() => setClaudeLoginOpen(false)} />
      : geminiLoginOpen
      ? <GeminiCliLogin directory={workspaceRoot} onDone={() => void finishGeminiCliLogin()} onCancel={() => setGeminiLoginOpen(false)} />
      : authOpen ? <AuthCard providers={authProviders} flow={authFlow} browserError={authBrowserError}
      onStart={(provider, authType) => void client.call(provider_auth_start, { provider, authType }).then((result) => setAuthFlow(result.flow))}
      onOpenUrl={(url) => { setAuthBrowserError(undefined); void Promise.resolve(invoke<string>("open_external_url", { url })).catch((cause) => setAuthBrowserError(`Browser did not open: ${cause instanceof Error ? cause.message : String(cause)}`)); }}
      onRespond={(response) => authFlow && void client.call(provider_auth_respond, { flowId: authFlow.flowId, response }).then(() => client.call(provider_auth_get, { flowId: authFlow.flowId })).then((result) => setAuthFlow(result.flow))}
      onCancel={() => { if (authFlow) void client.call(provider_auth_cancel, { flowId: authFlow.flowId }); setAuthOpen(false); setAuthFlow(undefined); }} /> : undefined} />,
    editor: <VscodiumEditor directory={workspaceRoot ?? (openFile ? openFile.slice(0, Math.max(1, openFile.lastIndexOf("/"))) : homeDirectory)} file={openFile} theme={theme} />,
    fileTree: workspaceRoot ? <FileExplorer root={workspaceRoot} activeFile={openFile}
      listDirectory={listWorkspaceDirectory}
      onOpenFile={(path) => void openInEditor(editorEngine, path)} />
      : <EmptyPanel title="Files" detail="Open a folder to browse its contents." action="Open folder" onAction={() => void startAction("open-folder")} />,
    taskHistory: <TaskHistory tasks={tasks.filter((task) => task.title.toLowerCase().includes(taskQuery.trim().toLowerCase()))} state={tasks.length ? "ready" : "empty"} query={taskQuery} onQueryChange={setTaskQuery} onOpen={(id) => void openTask(id)} onDelete={(id) => void deleteChat(id)} />,
    terminal: <EmbeddedTerminal directory={workspaceRoot} launch={terminalLaunch} />,
    problems: <EmptyPanel title="Problems" detail="Diagnostics for the active file appear here." />,
    output: <EmptyPanel title="Output" detail="Checks, tool output, and process status appear here." />,
  };

  const toggleSurface = (panel: Panel) => {
    if (panel === "terminal") setTerminalLaunch(undefined);
    setActivePanel(panel);
    setLayout((old) => {
      if (panel === "fileTree" || panel === "taskHistory") {
        return { ...old, fileTree: panel === "fileTree" ? !old.fileTree : false, taskHistory: panel === "taskHistory" ? !old.taskHistory : false };
      }
      if (panel === "terminal" || panel === "problems" || panel === "output") {
        const opening = !old[panel];
        return { ...old, terminal: panel === "terminal" && opening, problems: panel === "problems" && opening, output: panel === "output" && opening };
      }
      return togglePanel(old, panel);
    });
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (key === "n") { event.preventDefault(); if (event.shiftKey) newChat(); else void newFile(); }
      if (key === "o" && !event.shiftKey) { event.preventDefault(); void startAction("open-file"); }
      if (key === "s") { event.preventDefault(); void (event.shiftKey ? saveFileAs() : saveFile()); }
      if (event.key === "`") { event.preventDefault(); toggleSurface("terminal"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return <div className="law-app" aria-label="Aster">
    <header className="titlebar">
      <button className="brand" type="button" onClick={newChat} aria-label="Aster home"><span className="brand-mark"><img src={asterMark} alt="" /></span><strong>Aster</strong></button>
      <div className="workspace-identity"><span>{view === "workspace" ? tasks.find((task) => task.taskId === taskId)?.title ?? "Workspace" : "Local Agent Workbench"}</span><small>{running ? "Working" : workspaceRoot ?? "Ready"}</small></div>
      <div className="runtime-state"><small data-testid="app-version">v{DESKTOP_VERSION}</small></div>
    </header>
    <AppMenuBar hasFile={Boolean(openFile)} dirty={fileContent !== savedContent} onNewChat={newChat} onNewFile={() => void newFile()}
      onOpenFile={() => void startAction("open-file")} onOpenFolder={() => void startAction("open-folder")} onSave={() => void saveFile()} onSaveAs={() => void saveFileAs()}
      onTogglePanel={toggleSurface} onResetLayout={() => setLayout(resetLayout())} onOpenSettings={(tab) => setSettingsTab(tab)} onOpenTerminal={() => void openSystemTerminal()} />
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)}>Dismiss</button></div>}
    <div className="app-body">
      {view === "boot" && <main className="center-stage"><div className="boot-card"><span className="pulse active" aria-hidden /><h1>{error ? "Aster cannot reach its local service" : "Starting Aster"}</h1><p>{error ?? bootDetail}</p>{error && <button className="primary" type="button" onClick={() => void boot()}>Retry connection</button>}</div></main>}
      {view === "setup" && probe && <main className="center-stage"><FirstRunSetup probe={probe} onContinue={() => setView("workspace")} onRetry={() => void boot()} /></main>}
      {view === "start" && <main className="start-stage"><StartSurface recents={tasks.map((task) => ({ id: task.taskId, label: task.title, kind: "task" }))} state={tasks.length ? "ready" : "empty"} onAction={(action) => void startAction(action)} onOpenRecent={(id) => void openTask(id)} /></main>}
      {view === "workspace" && <main className="workspace-stage"><WorkspaceShell layout={layout} activePanel={activePanel} slots={slots} onToggle={toggleSurface} onPreset={(preset: Preset) => setLayout(applyPreset(preset, activePanel))} onReset={() => setLayout(resetLayout())} onSettings={() => setSettingsTab("appearance")} /></main>}
    </div>
    {settingsTab && <SettingsPanel tab={settingsTab} theme={theme} editorEngine={editorEngine} connections={connections} providerState={providerState} providerError={providerError} authProviders={authProviders} geminiCli={geminiCli} usage={usage}
      mcpServers={mcpServers} mcpConfigPath={mcpConfigPath} mcpBusyId={mcpBusyId} mcpError={mcpError}
      onTab={setSettingsTab} onTheme={setTheme} onEditorEngine={setEditorEngine} onClose={() => setSettingsTab(undefined)} onAddConnection={(form) => void addConnection(form)}
      onRemoveConnection={(id) => void removeConnection(id)} onSetConnectionEnabled={(id, enabled) => void setConnectionEnabled(id, enabled)}
      onCheckConnection={(id) => void checkConnection(id)} onAuthenticate={(provider, method) => void authenticateProvider(provider, method)} onGeminiCliLogin={startGeminiCliLogin} onClaudeCodeLogin={startClaudeCodeLogin}
      onMcpUpsert={(server: McpServerConfig) => void updateMcp(() => client.call(mcp_server_upsert, server))}
      onMcpImport={(json) => void updateMcp(() => client.call(mcp_server_import, { json }))}
      onMcpSetEnabled={(id, enabled) => void updateMcp(() => client.call(mcp_server_set_enabled, { id, enabled }))}
      onMcpTest={(id) => void testMcp(id)} onMcpRemove={(id) => void updateMcp(() => client.call(mcp_server_remove, { id }))} />}
  </div>;
}

function EmptyPanel({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return <div className="empty-panel"><span className="empty-kicker">{title}</span><p>{detail}</p>{action && <button type="button" onClick={onAction}>{action}</button>}</div>;
}

function mergeAttachments(current: AttachmentDescriptor[], added: AttachmentDescriptor[]): AttachmentDescriptor[] {
  const merged = [...current];
  for (const attachment of added) if (!merged.some((item) => item.attachmentId === attachment.attachmentId) && merged.length < 10) merged.push(attachment);
  return merged;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer); let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}
