import React from "react";
import { open as openNativePath } from "@tauri-apps/plugin-dialog";
import {
  DESKTOP_VERSION, daemon_get_health, daemon_probe_capabilities,
  model_list_catalog, model_set_favorite, task_cancel, task_create,
  task_get_events, task_list, task_send_message,
  fs_read_file, fs_write_file, verify_run,
  workspace_set_root,
  type CapabilityProbe, type ChatEvent, type EffortLevel,
  type ModelDescriptor, type PhaseIdentity, type Task,
} from "@law/contracts";
import { createIpcClient, type IpcClient } from "./ipc/client.js";
import { tauriTransport } from "./ipc/tauri-transport.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { EffortControl } from "./components/EffortControl.js";
import { FlatModelSelector } from "./components/FlatModelSelector.js";
import { FirstRunSetup } from "./components/FirstRunSetup.js";
import { StartSurface, type StartAction } from "./components/StartSurface.js";
import { TaskHistory } from "./components/TaskHistory.js";
import { WorkspaceShell } from "./components/WorkspaceShell.js";
import { DEFAULT_LAYOUT, applyPreset, resetLayout, togglePanel, type Layout, type Panel, type Preset } from "./layout/layout.js";

type View = "boot" | "setup" | "start" | "workspace";
export interface AppProps { client?: IpcClient }
const LAYOUT_KEY = "law.desktop.layout.v1";
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

  const boot = React.useCallback(async () => {
    setError(undefined); setView("boot");
    try {
      setBootDetail("Connecting to the private local runtime…");
      await client.call(daemon_get_health, {});
      setBootDetail("Inspecting local capabilities…");
      const detected = await client.call(daemon_probe_capabilities, { refresh: false });
      setProbe(detected);
      setBootDetail("Loading models and task history…");
      await Promise.all([refreshCatalog(), refreshTasks()]);
      const ready = detected.capabilities.filter((capability) => !capability.optional).every((capability) => capability.state === "ready");
      setView(ready ? "start" : "setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [client, refreshCatalog, refreshTasks]);

  React.useEffect(() => { void boot(); }, [boot]);
  React.useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }, [layout]);

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

  async function newChat(root = workspaceRoot): Promise<void> {
    const label = root ? root.split("/").filter(Boolean).at(-1) ?? root : "New chat";
    const result = await client.call(task_create, { title: label, ...(root ? { workspaceId: root } : {}), defaultIdentity: identityFor(selected, effort) });
    await refreshTasks(); await openTask(result.task.taskId);
  }

  async function startAction(action: StartAction): Promise<void> {
    if (action === "new-chat") return newChat();
    if (action === "open-folder" || action === "new-workspace") {
      const chosen = await openNativePath({ directory: true, multiple: false, title: action === "open-folder" ? "Open folder in LAW" : "Choose workspace folder" });
      if (typeof chosen === "string") { await client.call(workspace_set_root, { path: chosen }); setWorkspaceRoot(chosen); await newChat(chosen); }
      return;
    }
    if (action === "open-file") {
      const chosen = await openNativePath({ directory: false, multiple: false, title: "Open file in LAW" });
      if (typeof chosen === "string") {
        const root = chosen.slice(0, Math.max(1, chosen.lastIndexOf("/")));
        await client.call(workspace_set_root, { path: root }); setWorkspaceRoot(root); await newChat(root);
        const file = await client.call(fs_read_file, { path: chosen });
        setOpenFile(chosen); setFileContent(file.content); setSavedContent(file.content); setVerification(file.state.verification);
      }
      return;
    }
    if (action === "open-recent" && tasks[0]) return openTask(tasks[0].taskId);
    setError(`${action.replaceAll("-", " ")} is not connected yet.`);
  }

  async function send(text: string): Promise<void> {
    if (!taskId) return;
    setError(undefined);
    const result = await client.call(task_send_message, { taskId, text, identity: identityFor(selected, effort) });
    setEvents((await client.call(task_get_events, { taskId, sinceSeq: 0 })).events);
    setRunning(result.status === "running"); await refreshTasks();
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
    <span className="effort-label">Effort</span>
    <EffortControl value={effort} supported={selected?.effort.supported ?? []} onChange={setEffort} />
  </div>;

  const slots: Partial<Record<Panel, React.ReactNode>> = {
    chat: <ChatPanel events={events} running={running} onSend={(text) => void send(text)} onStop={() => void stop()} controls={controls} />,
    editor: openFile ? <EditorPanel path={openFile} content={fileContent} dirty={fileContent !== savedContent} verification={verification} onChange={(value) => { setFileContent(value); if (value !== savedContent && verification === "pass") setVerification("stale"); }} onSave={() => void saveFile()} onVerify={() => void verifyFile()} /> : <EmptyPanel title="Editor" detail="Open a file to begin editing. Changes remain local until you explicitly publish them." action="Open file" onAction={() => void startAction("open-file")} />,
    fileTree: workspaceRoot ? <div className="file-summary"><span className="empty-kicker">Workspace</span><strong>{workspaceRoot}</strong>{openFile && <button type="button" onClick={() => setActivePanel("editor")}>{openFile.slice(workspaceRoot.length + 1)}</button>}</div> : <EmptyPanel title="Files" detail="Open a folder to browse its contents." action="Open folder" onAction={() => void startAction("open-folder")} />,
    taskHistory: <TaskHistory tasks={tasks} state={tasks.length ? "ready" : "empty"} query="" onQueryChange={() => {}} onOpen={(id) => void openTask(id)} onExportEvidence={() => {}} onDelete={() => {}} />,
    terminal: <EmptyPanel title="Terminal" detail="Terminal sessions run through the daemon policy boundary." action="New terminal" />,
    problems: <EmptyPanel title="Problems" detail="Diagnostics for the active file appear here." />,
    output: <EmptyPanel title="Output" detail="Checks, tool output, and process status appear here." />,
  };

  return <div className="law-app" aria-label="LAW">
    <header className="titlebar">
      <button className="brand" type="button" onClick={() => setView("start")} aria-label="LAW home"><span className="brand-mark">L</span><strong>LAW</strong></button>
      <div className="workspace-identity"><span>{view === "workspace" ? tasks.find((task) => task.taskId === taskId)?.title ?? "Workspace" : "Local Agent Workbench"}</span><small>{running ? "Working" : workspaceRoot ?? "Ready"}</small></div>
      <div className="runtime-state"><span className={running ? "pulse active" : "pulse"} aria-hidden />{running ? "Task active" : "Local runtime"}<small data-testid="app-version">v{DESKTOP_VERSION}</small></div>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button type="button" onClick={() => setError(undefined)}>Dismiss</button></div>}
    <div className="app-body">
      {view === "boot" && <main className="center-stage"><div className="boot-card"><span className="pulse active" aria-hidden /><h1>{error ? "LAW cannot reach its local service" : "Starting LAW"}</h1><p>{error ?? bootDetail}</p>{error && <button className="primary" type="button" onClick={() => void boot()}>Retry connection</button>}</div></main>}
      {view === "setup" && probe && <main className="center-stage"><FirstRunSetup probe={probe} onContinue={() => setView("start")} onRetry={() => void boot()} /></main>}
      {view === "start" && <main className="start-stage"><StartSurface recents={tasks.map((task) => ({ id: task.taskId, label: task.title, kind: "task" }))} state={tasks.length ? "ready" : "empty"} onAction={(action) => void startAction(action)} onOpenRecent={(id) => void openTask(id)} /></main>}
      {view === "workspace" && <main className="workspace-stage"><WorkspaceShell layout={layout} activePanel={activePanel} slots={slots} onToggle={(panel) => { setActivePanel(panel); setLayout((old) => togglePanel(old, panel)); }} onPreset={(preset: Preset) => setLayout(applyPreset(preset, activePanel))} onReset={() => setLayout(resetLayout())} /></main>}
    </div>
  </div>;
}

function EmptyPanel({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return <div className="empty-panel"><span className="empty-kicker">{title}</span><p>{detail}</p>{action && <button type="button" onClick={onAction}>{action}</button>}</div>;
}

function EditorPanel(props: { path: string; content: string; dirty: boolean; verification: string; onChange: (value: string) => void; onSave: () => void; onVerify: () => void }): React.JSX.Element {
  return <section className="editor-panel" aria-label="Editor">
    <header><code>{props.path}</code><span>{props.dirty ? "Modified" : "Saved"}</span><span>Checks: {props.verification}</span><button type="button" disabled={!props.dirty} onClick={props.onSave}>Save</button><button type="button" disabled={props.dirty} onClick={props.onVerify}>Run checks</button></header>
    <textarea aria-label={`Editing ${props.path}`} spellCheck={false} value={props.content} onChange={(event) => props.onChange(event.target.value)} />
  </section>;
}
