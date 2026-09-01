/**
 * Task store (REQ-D-013/033). Durable tasks, phases, and an append-only chat
 * event log per task. File-backed under `${lawRoot}/.law/desktop-tasks/` (0600);
 * a memory variant backs tests. Events are secret-scanned by the orchestrator
 * before they reach the store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ChatEvent, Phase, Task } from "@law/contracts";

interface TaskRecord {
  task: Task;
  phases: Phase[];
  events: ChatEvent[];
}

export interface TaskStore {
  createTask(task: Task): void;
  getTask(taskId: string): Task | undefined;
  updateTask(task: Task): void;
  listTasks(query: string): Task[];
  deleteTask(taskId: string): boolean;
  addPhase(phase: Phase): void;
  updatePhase(phase: Phase): void;
  getPhases(taskId: string): Phase[];
  /** Append an event, assigning the next seq; returns the stored event. */
  appendEvent(taskId: string, event: Omit<ChatEvent, "seq">): ChatEvent;
  getEvents(taskId: string, sinceSeq: number): ChatEvent[];
  nextSeq(taskId: string): number;
}

export class MemoryTaskStore implements TaskStore {
  protected records = new Map<string, TaskRecord>();

  private rec(taskId: string): TaskRecord {
    const r = this.records.get(taskId);
    if (!r) throw Object.assign(new Error(`no such task: ${taskId}`), { code: "NOT_FOUND" });
    return r;
  }

  createTask(task: Task): void {
    this.records.set(task.taskId, { task, phases: [], events: [] });
  }
  getTask(taskId: string): Task | undefined {
    return this.records.get(taskId)?.task;
  }
  updateTask(task: Task): void {
    this.rec(task.taskId).task = task;
  }
  listTasks(query: string): Task[] {
    const q = query.trim().toLowerCase();
    return [...this.records.values()]
      .map((r) => r.task)
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  deleteTask(taskId: string): boolean {
    return this.records.delete(taskId);
  }
  addPhase(phase: Phase): void {
    this.rec(phase.taskId).phases.push(phase);
  }
  updatePhase(phase: Phase): void {
    const r = this.rec(phase.taskId);
    const i = r.phases.findIndex((p) => p.phaseId === phase.phaseId);
    if (i >= 0) r.phases[i] = phase;
  }
  getPhases(taskId: string): Phase[] {
    return [...this.rec(taskId).phases];
  }
  appendEvent(taskId: string, event: Omit<ChatEvent, "seq">): ChatEvent {
    const r = this.rec(taskId);
    const seq = r.events.length;
    const stored: ChatEvent = { ...event, seq };
    r.events.push(stored);
    this.persist(taskId);
    return stored;
  }
  getEvents(taskId: string, sinceSeq: number): ChatEvent[] {
    return this.rec(taskId).events.filter((e) => e.seq >= sinceSeq);
  }
  nextSeq(taskId: string): number {
    return this.rec(taskId).events.length;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected persist(_taskId: string): void {
    /* memory store: nothing to do */
  }
}

export class FileTaskStore extends MemoryTaskStore {
  constructor(private readonly dir: string) {
    super();
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as TaskRecord;
          this.records.set(rec.task.taskId, rec);
        } catch {
          /* skip unreadable */
        }
      }
    }
  }

  static forRoot(lawRoot: string): FileTaskStore {
    return new FileTaskStore(join(lawRoot, ".law", "desktop-tasks"));
  }

  protected override persist(taskId: string): void {
    const rec = (this as unknown as { records: Map<string, TaskRecord> }).records.get(taskId);
    if (!rec) return;
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, `${taskId}.json`);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  override createTask(task: Task): void {
    super.createTask(task);
    this.persist(task.taskId);
  }
  override updateTask(task: Task): void {
    super.updateTask(task);
    this.persist(task.taskId);
  }
  override addPhase(phase: Phase): void {
    super.addPhase(phase);
    this.persist(phase.taskId);
  }
  override updatePhase(phase: Phase): void {
    super.updatePhase(phase);
    this.persist(phase.taskId);
  }
  override deleteTask(taskId: string): boolean {
    const deleted = super.deleteTask(taskId);
    const path = join(this.dir, `${taskId}.json`);
    if (existsSync(path)) unlinkSync(path);
    return deleted;
  }
}
