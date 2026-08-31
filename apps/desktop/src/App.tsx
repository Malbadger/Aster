import React from "react";
import { open as openNativePath, save as saveNativePath } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  DESKTOP_VERSION, daemon_get_health, daemon_probe_capabilities,
  model_list_catalog, model_set_favorite, task_cancel, task_create,
  task_get_events, task_list, task_send_message,
  fs_read_file, fs_write_file, verify_run,
  workspace_set_root,
  provider_list_connections, provider_add_connection, provider_remove_connection, provider_set_enabled, provider_check_credential,
  provider_auth_methods, provider_auth_start, provider_auth_get, provider_auth_respond, provider_auth_cancel, provider_auth_logout,
  type CapabilityProbe, type ChatEvent, type EffortLevel,
  type ModelDescriptor, type PhaseIdentity, type ProviderConnection, type Task, type AuthFlow,
} from "@law/contracts";
import { createIpcClient, type IpcClient } from "./ipc/client.js";
import { tauriTransport } from "./ipc/tauri-transport.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { AppMenuBar } from "./components/AppMenuBar.js";
import { EmbeddedTerminal } from "./components/EmbeddedTerminal.js";
import { VscodiumEditor } from "./components/VscodiumEditor.js";
import { SettingsPanel, type EditorEngine, type LawTheme, type SettingsTab } from "./components/SettingsPanel.js";
import type { AddConnectionForm } from "./components/ProviderConnections.js";
import { FlatModelSelector } from "./components/FlatModelSelector.js";
import { FirstRunSetup } from "./components/FirstRunSetup.js";
import { StartSurface, type StartAction } from "./components/StartSurface.js";
import { TaskHistory } from "./components/TaskHistory.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";
import { AuthCard, type AuthProvider } from "./components/AuthCard.js";
import { DEFAULT_LAYOUT, applyPreset, resetLayout, togglePanel, type Layout, type Panel, type Preset } from "./layout/layout.js";

type View = "boot" | "setup" | "start" | "workspace";
export interface AppProps { client?: IpcClient }
const LAYOUT_KEY = "law.desktop.layout.v2";
const THEME_KEY = "law.desktop.theme.v1";
const EDITOR_KEY = "law.desktop.editor.v1";
const defaultClient = createIpcClient(tauriTransport);

function loadLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    return saved ? { ...DEFAULT_LAYOUT, ...saved } : { ...DEFAULT_LAYOUT };
  } catch { return { ...DEFAULT_LAYOUT }; }
}

function identityFor(model: ModelDescriptor | undefined, effort: EffortLevel): PhaseIdentity | undefined {
  return model ? { provider: model.provider, model: model.id, effort } : undefined;
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
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [taskId, setTaskId] = React.useState<string>();
  const [conversationKey, setConversationKey] = React.useState(0);
  const [events, setEvents] = React.useState<ChatEvent[]>([]);
  const [running, setRunning] = React.useState(false);
  const [layout, setLayout] = React.useState<Layout>(loadLayout);
  const [activePanel, setActivePanel] = React.useState<Panel>("chat");
  const [modelOpen, setModelOpen] = React.useState(false);
  const [workspaceRoot, setWorkspaceRoot] = React.useState<string>();
  const [openFile, setOpenFile] = React.useState<string>();
  const [fileContent, setFileContent] = React.useState("");
  const [savedContent, setSavedContent] = React.useState("");
  const [verification, setVerification] = React.useState("unverified");
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>();
  const [theme, setTheme] = React.useState<LawTheme>(() => (localStorage.getItem(THEME_KEY) as LawTheme | null) ?? "graphite");
  const [editorEngine, setEditorEngine] = React.useState<EditorEngine>("vscode-oss");
  const [terminalLaunch, setTerminalLaunch] = React.useState<{ program: "pi"; initialInput?: string }>();
  const [connections, setConnections] = React.useState<ProviderConnection[]>([]);
  const [providerState, setProviderState] = React.useState<"empty" | "loading" | "error" | "ready">("loading");
  const [providerError, setProviderError] = React.useState<string>();
  const [authProviders, setAuthProviders] = React.useState<AuthProvider[]>([]);
  const [authFlow, setAuthFlow] = React.useState<AuthFlow>();
  const [authOpen, setAuthOpen] = React.useState(false);
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

  const refreshProviders = React.useCallback(async () => {
    try {
      setProviderState("loading"); setProviderError(undefined);
      const result = await client.call(provider_list_connections, {});
      setConnections(result.connections); setProviderState(result.connections.length ? "ready" : "empty");
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause)); setProviderState("error");
    }
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
      await Promise.all([refreshCatalog(), refreshTasks(), refreshProviders()]);
      const ready = detected.capabilities.filter((capability) => !capability.optional).every((capability) => capability.state === "ready");
      setView(ready ? "workspace" : "setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, refreshCatalog, refreshProviders, refreshTasks]);

  React.useEffect(() => { void boot(); }, [boot]);
  React.useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);
  React.useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem(THEME_KEY, theme); }, [theme]);
  React.useEffect(() => {
    if (!authFlow || !["running", "waiting"].includes(authFlow.status)) return;
    const timer = window.setInterval(() => void client.call(provider_auth_get, { flowId: authFlow.flowId }).then((result) => setAuthFlow(result.flow)), 750);
    return () => window.clearInterval(timer);
  }, [authFlow?.flowId, authFlow?.status, client]);
  React.useEffect(() => { localStorage.setItem(EDITOR_KEY, editorEngine); }, [editorEngine]);

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
    setConversationKey((value) => value + 1);
    setActivePanel("chat");
    setLayout((old) => ({ ...old, chat: true }));
    setView("workspace");
  }

  async function startAction(action: StartAction): Promise<void> {
    if (action === "new-chat") return newChat();
    if (action === "open-folder" || action === "new-workspace") {
      const chosen = await openNativePath({ directory: true, multiple: false, title: action === "open-folder" ? "Open folder in LAW" : "Choose workspace folder" });
      if (typeof chosen === "string") { await client.call(workspace_set_root, { path: chosen }); setWorkspaceRoot(chosen); newChat(); }
      return;
    }
    if (action === "open-file") {
      const chosen = await openNativePath({ directory: false, multiple: false, title: "Open file in LAW" });
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
      if (name === "clear") {
        setEvents([]); return;
      }
      if (name === "login") {
        local("user", text);
        const result = await client.call(provider_auth_methods, {}); setAuthProviders(result.providers); setAuthOpen(true); setAuthFlow(undefined);
        const requested = args.toLowerCase() === "claude-pro" ? "anthropic" : args.toLowerCase() === "chatgpt" ? "openai" : args.toLowerCase();
        const provider = requested && result.providers.find((item) => item.id === requested);
        if (provider && provider.methods.length === 1) setAuthFlow((await client.call(provider_auth_start, { provider: provider.id, authType: provider.methods[0]! })).flow);
        return;
      }
      if (name === "logout") {
        local("user", text);
        const provider = args.toLowerCase() === "claude-pro" ? "anthropic" : args.toLowerCase() === "chatgpt" ? "openai" : args.toLowerCase();
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
        const created = await client.call(task_create, { title: label, ...(workspaceRoot ? { workspaceId: workspaceRoot } : {}), defaultIdentity: identityFor(selected, effort) });
        targetTaskId = created.task.taskId;
        setTaskId(targetTaskId);
      }
      const result = await client.call(task_send_message, { taskId: targetTaskId, text, identity: identityFor(selected, effort) });
      setEvents((await client.call(task_get_events, { taskId: targetTaskId, sinceSeq: 0 })).events);
      setRunning(result.status === "running"); await refreshTasks();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message); setRunning(false);
      setEvents((current) => [...current, { id: `local-error-${Date.now()}`, taskId: taskId ?? "pending", seq: current.length, at: new Date().toISOString(), kind: "error", text: `Message was not sent: ${message}` }]);
    }
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

  async function loginProvider(provider: string): Promise<void> {
    try { await invoke("provider_login", { provider, directory: workspaceRoot }); }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); setProviderState("error"); }
  }

  async function addConnection(form: AddConnectionForm): Promise<void> {
    try { await client.call(provider_add_connection, form); await refreshProviders(); }
    catch (cause) { setProviderError(cause instanceof Error ? cause.message : String(cause)); setProviderState("error"); }
  }

  async function removeConnection(connectionId: string): Promise<void> {
    await client.call(provider_remove_connection, { connectionId }); await refreshProviders();
  }

  async function setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void> {
    await client.call(provider_set_enabled, { connectionId, enabled }); await refreshProviders();
  }

  async function checkConnection(connectionId: string): Promise<void> {
    await client.call(provider_check_credential, { connectionId }); await refreshProviders();
  }

  async function verifyFile(): Promise<void> {
    if (!openFile) return;
    const result = await client.call(verify_run, { path: openFile });
    setVerification(result.state.verification);
  }

  const controls = <div className="composer-controls">
    <div className="model-popover-anchor">
      <button className="model-trigger" type="button" aria-expanded={modelOpen} onClick={() => setModelOpen((open) => !open)}>
        <span>{selected?.displayName ?? "Select model"}</span><small>{selected ? `${selected.provider} · ${selected.locality}` : "No model available"}</small>
      </button>
      {modelOpen && <div className="model-popover"><FlatModelSelector models={models} selectedId={selectedId} favorites={favorites} query={query}
        onQueryChange={(value) => { setQuery(value); void refreshCatalog(value); }}
        onSelect={(id) => { setSelectedId(id); setModelOpen(false); }}
        onToggleFavorite={(modelId, favorite) => void client.call(model_set_favorite, { modelId, favorite }).then((result) => setFavorites(result.favorites))} /></div>}
    </div>
  </div>;

  const slots: Partial<Record<Panel, React.ReactNode>> = {
    chat: <ChatPanel key={conversationKey} events={events} running={running} onSend={(text) => void send(text)} onStop={() => void stop()} controls={controls} interactive={authOpen ? <AuthCard providers={authProviders} flow={authFlow}
      onStart={(provider, authType) => void client.call(provider_auth_start, { provider, authType }).then((result) => setAuthFlow(result.flow))}
      onRespond={(response) => authFlow && void client.call(provider_auth_respond, { flowId: authFlow.flowId, response }).then(() => client.call(provider_auth_get, { flowId: authFlow.flowId })).then((result) => setAuthFlow(result.flow))}
      onCancel={() => { if (authFlow) void client.call(provider_auth_cancel, { flowId: authFlow.flowId }); setAuthOpen(false); setAuthFlow(undefined); }} /> : undefined} />,
    editor: openFile ? <VscodiumEditor directory={workspaceRoot ?? openFile.slice(0, Math.max(1, openFile.lastIndexOf("/")))} /> : undefined,
    fileTree: workspaceRoot ? <div className="file-summary"><span className="empty-kicker">Workspace</span><strong>{workspaceRoot}</strong>{openFile && <button type="button" onClick={() => void openInEditor(editorEngine, openFile)}>{openFile.slice(workspaceRoot.length + 1)}</button>}</div> : <EmptyPanel title="Files" detail="Open a folder to browse its contents." action="Open folder" onAction={() => void startAction("open-folder")} />,
    taskHistory: <TaskHistory tasks={tasks} state={tasks.length ? "ready" : "empty"} query="" onQueryChange={() => {}} onOpen={(id) => void openTask(id)} onExportEvidence={() => {}} onDelete={() => {}} />,
    terminal: <EmbeddedTerminal directory={workspaceRoot} launch={terminalLaunch} />,
    problems: <EmptyPanel title="Problems" detail="Diagnostics for the active file appear here." />,
    output: <EmptyPanel title="Output" detail="Checks, tool output, and process status appear here." />,
  };

  const toggleSurface = (panel: Panel) => {
    if (panel === "editor" && !openFile) { void startAction("open-file"); return; }
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

  return <div className="law-app" aria-label="LAW">
    <header className="titlebar">
      <button className="brand" type="button" onClick={newChat} aria-label="LAW home"><span className="brand-mark">L</span><strong>LAW</strong></button>
      <div className="workspace-identity"><span>{view === "workspace" ? tasks.find((task) => task.taskId === taskId)?.title ?? "Workspace" : "Local Agent Workbench"}</span><small>{running ? "Working" : workspaceRoot ?? "Ready"}</small></div>
      <div className="runtime-state"><small data-testid="app-version">v{DESKTOP_VERSION}</small></div>
    </header>
    <AppMenuBar hasFile={Boolean(openFile)} dirty={fileContent !== savedContent} onNewChat={newChat} onNewFile={() => void newFile()}
      onOpenFile={() => void startAction("open-file")} onOpenFolder={() => void startAction("open-folder")} onSave={() => void saveFile()} onSaveAs={() => void saveFileAs()}
      onTogglePanel={toggleSurface} onResetLayout={() => setLayout(resetLayout())} onOpenSettings={(tab) => setSettingsTab(tab)} onOpenTerminal={() => void openSystemTerminal()} />
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)}>Dismiss</button></div>}
    <div className="app-body">
      {view === "boot" && <main className="center-stage"><div className="boot-card"><span className="pulse active" aria-hidden /><h1>{error ? "LAW cannot reach its local service" : "Starting LAW"}</h1><p>{error ?? bootDetail}</p>{error && <button className="primary" type="button" onClick={() => void boot()}>Retry connection</button>}</div></main>}
      {view === "setup" && probe && <main className="center-stage"><FirstRunSetup probe={probe} onContinue={() => setView("workspace")} onRetry={() => void boot()} /></main>}
      {view === "start" && <main className="start-stage"><StartSurface recents={tasks.map((task) => ({ id: task.taskId, label: task.title, kind: "task" }))} state={tasks.length ? "ready" : "empty"} onAction={(action) => void startAction(action)} onOpenRecent={(id) => void openTask(id)} /></main>}
      {view === "workspace" && <main className="workspace-stage"><WorkspaceShell layout={layout} activePanel={activePanel} slots={slots} onToggle={toggleSurface} onPreset={(preset: Preset) => setLayout(applyPreset(preset, activePanel))} onReset={() => setLayout(resetLayout())} onSettings={() => setSettingsTab("appearance")} /></main>}
    </div>
    {settingsTab && <SettingsPanel tab={settingsTab} theme={theme} editorEngine={editorEngine} connections={connections} providerState={providerState} providerError={providerError}
      onTab={setSettingsTab} onTheme={setTheme} onEditorEngine={setEditorEngine} onClose={() => setSettingsTab(undefined)} onAddConnection={(form) => void addConnection(form)}
      onRemoveConnection={(id) => void removeConnection(id)} onSetConnectionEnabled={(id, enabled) => void setConnectionEnabled(id, enabled)}
      onCheckConnection={(id) => void checkConnection(id)} onLoginProvider={(provider) => void loginProvider(provider)} />}
  </div>;
}

function EmptyPanel({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return <div className="empty-panel"><span className="empty-kicker">{title}</span><p>{detail}</p>{action && <button type="button" onClick={onAction}>{action}</button>}</div>;
}
